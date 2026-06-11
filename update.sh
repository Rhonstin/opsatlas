#!/usr/bin/env bash
set -euo pipefail

# ── Locate the install directory ──────────────────────────────────────────────

# If the script is run from within the repo, use that directory.
# Otherwise check the default install location used by install.sh.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${INSTALL_DIR:-opsatlas}"

if [ -f "$SCRIPT_DIR/docker-compose.yml" ] && [ -d "$SCRIPT_DIR/backend" ] && [ -d "$SCRIPT_DIR/frontend" ]; then
  APP_DIR="$SCRIPT_DIR"
elif [ -f "docker-compose.yml" ] && [ -d backend ] && [ -d frontend ]; then
  APP_DIR="$(pwd)"
elif [ -d "$INSTALL_DIR/.git" ]; then
  APP_DIR="$(cd "$INSTALL_DIR" && pwd)"
else
  echo "Cannot locate OpsAtlas install directory." >&2
  echo "Run this script from inside the OpsAtlas repo, or set INSTALL_DIR." >&2
  exit 1
fi

cd "$APP_DIR"
INSTALL_COMPOSE_FILE="$(pwd)/compose.install.yml"

if [ ! -f .env ]; then
  echo "No .env found in $APP_DIR — run install.sh first." >&2
  exit 1
fi

# ── Pull latest code ──────────────────────────────────────────────────────────

echo "==> Pulling latest code …"
git fetch origin
git pull --ff-only

# ── Load config ───────────────────────────────────────────────────────────────

set -a
. ./.env
set +a

# ── Derive URLs (same logic as install.sh) ────────────────────────────────────

DOMAIN="${DOMAIN:-}"
PROXY_CONFIG="${PROXY_CONFIG:-none}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
BACKEND_PORT="${BACKEND_PORT:-4000}"

if [ -n "$DOMAIN" ]; then
  case "$DOMAIN" in
    http://*|https://*) FRONTEND_URL="$DOMAIN" ;;
    *) FRONTEND_URL="https://$DOMAIN" ;;
  esac
else
  FRONTEND_URL="http://localhost:$FRONTEND_PORT"
fi

if [ "$PROXY_CONFIG" != "none" ] && [ -n "$DOMAIN" ]; then
  NEXT_PUBLIC_API_URL=""
else
  NEXT_PUBLIC_API_URL="http://localhost:$BACKEND_PORT"
fi

# ── Rebuild images ────────────────────────────────────────────────────────────

COMPOSE_FILES=(-f docker-compose.yml)
if [ -f "$INSTALL_COMPOSE_FILE" ]; then
  COMPOSE_FILES+=(-f "$INSTALL_COMPOSE_FILE")
fi

echo "==> Building images …"
NEXT_PUBLIC_API_URL="$NEXT_PUBLIC_API_URL" \
FRONTEND_URL="$FRONTEND_URL" \
  docker compose "${COMPOSE_FILES[@]}" build

# ── Restart containers ────────────────────────────────────────────────────────

echo "==> Restarting containers …"
docker compose "${COMPOSE_FILES[@]}" up -d

# ── Run migrations ────────────────────────────────────────────────────────────

echo "==> Running database migrations …"
docker compose "${COMPOSE_FILES[@]}" exec -T backend npm run migrate:prod

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "OpsAtlas updated successfully and is running at $FRONTEND_URL"
