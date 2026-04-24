#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Rhonstin/opsatlas.git}"
REPO_REF="${REPO_REF:-main}"
INSTALL_DIR="${INSTALL_DIR:-opsatlas}"
DOMAIN="${DOMAIN:-}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
BACKEND_PORT="${BACKEND_PORT:-4000}"
EXPOSE_POSTGRES="${EXPOSE_POSTGRES:-false}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
FRONTEND_URL="${FRONTEND_URL:-}"
API_URL="${API_URL:-}"
PROXY_CONFIG="${PROXY_CONFIG:-none}"

TTY=""
if [ -r /dev/tty ]; then
  TTY="/dev/tty"
fi

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need docker
need openssl

prompt() {
  local var_name="$1"
  local label="$2"
  local default_value="$3"
  local current_value="${!var_name:-$default_value}"
  local input=""

  if [ -n "$TTY" ]; then
    printf "%s [%s]: " "$label" "$current_value" >"$TTY"
    if read -r input <"$TTY" && [ -n "$input" ]; then
      printf -v "$var_name" '%s' "$input"
      return
    fi
  fi

  printf -v "$var_name" '%s' "$current_value"
}

prompt_bool() {
  local var_name="$1"
  local label="$2"
  local default_value="$3"
  local current_value="${!var_name:-$default_value}"
  local input=""

  if [ -n "$TTY" ]; then
    printf "%s [%s]: " "$label" "$current_value" >"$TTY"
    if read -r input <"$TTY" && [ -n "$input" ]; then
      current_value="$input"
    fi
  fi

  case "${current_value,,}" in
    y|yes|true|1) printf -v "$var_name" '%s' "true" ;;
    *) printf -v "$var_name" '%s' "false" ;;
  esac
}

prompt_choice() {
  local var_name="$1"
  local label="$2"
  local default_value="$3"
  local current_value="${!var_name:-$default_value}"
  local input=""

  if [ -n "$TTY" ]; then
    printf "%s [%s]: " "$label" "$current_value" >"$TTY"
    if read -r input <"$TTY" && [ -n "$input" ]; then
      current_value="$input"
    fi
  fi

  case "${current_value,,}" in
    none|caddy|nginx|both) printf -v "$var_name" '%s' "${current_value,,}" ;;
    *)
      echo "$var_name must be one of: none, caddy, nginx, both" >&2
      exit 1
      ;;
  esac
}

require_port() {
  local name="$1"
  local value="$2"

  case "$value" in
    ''|*[!0-9]*)
      echo "$name must be a numeric TCP port" >&2
      exit 1
      ;;
  esac

  if [ "$value" -lt 1 ] || [ "$value" -gt 65535 ]; then
    echo "$name must be between 1 and 65535" >&2
    exit 1
  fi
}

write_postgres_override() {
  local override_file="compose.override.yml"
  local marker="# Managed by opsatlas install.sh"

  if [ "$EXPOSE_POSTGRES" = "true" ]; then
    cat > "$override_file" <<EOF
$marker
services:
  postgres:
    ports:
      - '127.0.0.1:${POSTGRES_PORT}:5432'
EOF
  elif [ -f "$override_file" ] && grep -qF "$marker" "$override_file"; then
    rm -f "$override_file"
  fi
}

extract_host() {
  local value="$1"
  value="${value#http://}"
  value="${value#https://}"
  value="${value%%/*}"
  value="${value%%:*}"
  printf '%s\n' "$value"
}

write_proxy_configs() {
  local proxy_dir="deploy/proxy"
  local caddy_file="$proxy_dir/opsatlas.Caddyfile"
  local nginx_file="$proxy_dir/opsatlas.nginx.conf"
  local marker="# Managed by opsatlas install.sh"
  local domain_host

  domain_host="$(extract_host "${DOMAIN:-$FRONTEND_URL}")"

  if [ "$PROXY_CONFIG" != "none" ] && [ -z "$domain_host" ]; then
    echo "A domain is required to generate Caddy or Nginx config" >&2
    exit 1
  fi

  mkdir -p "$proxy_dir"

  case "$PROXY_CONFIG" in
    caddy|both)
      cat > "$caddy_file" <<EOF
$marker
$domain_host {
        encode gzip zstd

        @backend {
                path /health
                path /auth*
                path /connections*
                path /sync*
                path /instances*
                path /dns-connections*
                path /dns-sync*
                path /dns/records*
                path /auto-update-policies*
                path /billing*
                path /config*
        }

        handle @backend {
                reverse_proxy 127.0.0.1:$BACKEND_PORT
        }

        handle {
                reverse_proxy 127.0.0.1:$FRONTEND_PORT
        }
}
EOF
      ;;
    *)
      if [ -f "$caddy_file" ] && grep -qF "$marker" "$caddy_file"; then
        rm -f "$caddy_file"
      fi
      ;;
  esac

  case "$PROXY_CONFIG" in
    nginx|both)
      cat > "$nginx_file" <<EOF
$marker
server {
    listen 80;
    server_name $domain_host;

    location /health {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ~ ^/(auth|connections|sync|instances|dns-connections|dns-sync|dns/records|auto-update-policies|billing|config) {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:$FRONTEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
      ;;
    *)
      if [ -f "$nginx_file" ] && grep -qF "$marker" "$nginx_file"; then
        rm -f "$nginx_file"
      fi
      ;;
  esac
}

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required: docker compose" >&2
  exit 1
fi

if [ -f docker-compose.yml ] && [ -d backend ] && [ -d frontend ]; then
  APP_DIR="$(pwd)"
else
  need git
  if [ -d "$INSTALL_DIR/.git" ]; then
    APP_DIR="$INSTALL_DIR"
    git -C "$APP_DIR" fetch origin "$REPO_REF"
    git -C "$APP_DIR" checkout -B "$REPO_REF" "origin/$REPO_REF"
  elif [ -e "$INSTALL_DIR" ]; then
    echo "Install directory exists but is not a git checkout: $INSTALL_DIR" >&2
    exit 1
  else
    git clone --branch "$REPO_REF" --single-branch "$REPO_URL" "$INSTALL_DIR"
    APP_DIR="$INSTALL_DIR"
  fi
fi

cd "$APP_DIR"

if [ ! -f .env ]; then
  prompt DOMAIN "Public domain for OpsAtlas (leave blank for localhost)" "$DOMAIN"
  prompt_choice PROXY_CONFIG "Generate reverse proxy config (none/caddy/nginx/both)" "$PROXY_CONFIG"
  prompt FRONTEND_PORT "Host port for frontend" "$FRONTEND_PORT"
  prompt BACKEND_PORT "Host port for backend" "$BACKEND_PORT"
  prompt_bool EXPOSE_POSTGRES "Expose PostgreSQL on the host? (yes/no)" "$EXPOSE_POSTGRES"

  require_port "FRONTEND_PORT" "$FRONTEND_PORT"
  require_port "BACKEND_PORT" "$BACKEND_PORT"

  if [ "$EXPOSE_POSTGRES" = "true" ]; then
    prompt POSTGRES_PORT "Host port for PostgreSQL" "$POSTGRES_PORT"
    require_port "POSTGRES_PORT" "$POSTGRES_PORT"
  fi

  if [ -z "$FRONTEND_URL" ]; then
    if [ -n "$DOMAIN" ]; then
      case "$DOMAIN" in
        http://*|https://*) FRONTEND_URL="$DOMAIN" ;;
        *) FRONTEND_URL="https://$DOMAIN" ;;
      esac
    else
      FRONTEND_URL="http://localhost:$FRONTEND_PORT"
    fi
  fi

  if [ -z "$API_URL" ]; then
    if [ -n "$DOMAIN" ]; then
      API_URL="$FRONTEND_URL"
    else
      API_URL="http://localhost:$BACKEND_PORT"
    fi
  fi

  umask 077
  cat > .env <<EOF
JWT_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 16)
FRONTEND_URL=$FRONTEND_URL
API_URL=$API_URL
DOMAIN=$DOMAIN
PROXY_CONFIG=$PROXY_CONFIG
FRONTEND_PORT=$FRONTEND_PORT
BACKEND_PORT=$BACKEND_PORT
EOF

  write_postgres_override
fi

set -a
. ./.env
set +a

if [ -f compose.override.yml ] && grep -qF "# Managed by opsatlas install.sh" compose.override.yml; then
  EXPOSE_POSTGRES="true"
  POSTGRES_PORT="$(sed -n "s/.*127\.0\.0\.1:\([0-9][0-9]*\):5432.*/\1/p" compose.override.yml | head -n 1)"
fi

write_proxy_configs

docker compose pull
docker compose up -d
docker compose exec -T backend npm run migrate:prod

echo "opsatlas is running at $FRONTEND_URL"
if [ "$EXPOSE_POSTGRES" = "true" ]; then
  echo "PostgreSQL is exposed on 127.0.0.1:$POSTGRES_PORT"
else
  echo "PostgreSQL is not exposed on the host"
fi
case "$PROXY_CONFIG" in
  caddy)
    echo "Generated Caddy config: $APP_DIR/deploy/proxy/opsatlas.Caddyfile"
    ;;
  nginx)
    echo "Generated Nginx config: $APP_DIR/deploy/proxy/opsatlas.nginx.conf"
    ;;
  both)
    echo "Generated Caddy config: $APP_DIR/deploy/proxy/opsatlas.Caddyfile"
    echo "Generated Nginx config: $APP_DIR/deploy/proxy/opsatlas.nginx.conf"
    ;;
esac
