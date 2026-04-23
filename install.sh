#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Rhonstin/opsatlas.git}"
INSTALL_DIR="${INSTALL_DIR:-opsatlas}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:3000}"
API_URL="${API_URL:-http://localhost:4000}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need docker
need openssl

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
    git -C "$APP_DIR" pull --ff-only
  elif [ -e "$INSTALL_DIR" ]; then
    echo "Install directory exists but is not a git checkout: $INSTALL_DIR" >&2
    exit 1
  else
    git clone "$REPO_URL" "$INSTALL_DIR"
    APP_DIR="$INSTALL_DIR"
  fi
fi

cd "$APP_DIR"

if [ ! -f .env ]; then
  umask 077
  cat > .env <<EOF
JWT_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 16)
FRONTEND_URL=$FRONTEND_URL
API_URL=$API_URL
EOF
fi

docker compose pull
docker compose up -d
docker compose exec -T backend npm run migrate:prod

echo "opsatlas is running at $FRONTEND_URL"
