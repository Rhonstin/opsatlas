#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
BACKEND_PORT="${BACKEND_PORT:-4000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
PG_CONTAINER="opsatlas-dev-pg"
PG_PORT="${PG_PORT:-5432}"
PG_USER="postgres"
PG_PASS="postgres"
PG_DB="opsatlas"

# ── colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[dev]${RESET} $*"; }
success() { echo -e "${GREEN}[dev]${RESET} $*"; }
error()   { echo -e "${RED}[dev] ERROR:${RESET} $*" >&2; }
header()  { echo -e "\n${BOLD}$*${RESET}"; }

# ── cleanup on exit ───────────────────────────────────────────────────────────
cleanup() {
  trap - EXIT INT TERM   # prevent re-entrancy
  echo ""
  info "Shutting down…"
  # kill 0 sends SIGTERM to every process in this script's process group
  # (backend, frontend, log-prefixer subprocesses all share it)
  kill 0 2>/dev/null || true
  wait 2>/dev/null || true
  success "Done."
}
trap cleanup EXIT INT TERM

# ── prereqs ───────────────────────────────────────────────────────────────────
need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    error "Required command not found: $1"
    exit 1
  fi
}
need node
need npm

# ── env files ─────────────────────────────────────────────────────────────────
header "Checking environment files…"

if [ ! -f "$BACKEND_DIR/.env" ]; then
  info "Creating backend/.env with defaults"
  cat > "$BACKEND_DIR/.env" <<EOF
PORT=$BACKEND_PORT
FRONTEND_URL=http://localhost:$FRONTEND_PORT
DATABASE_URL=postgresql://$PG_USER:$PG_PASS@localhost:$PG_PORT/$PG_DB
JWT_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 16)
EOF
  success "backend/.env created"
else
  info "backend/.env already exists — skipping"
fi

if [ ! -f "$FRONTEND_DIR/.env.local" ]; then
  info "Creating frontend/.env.local"
  cat > "$FRONTEND_DIR/.env.local" <<EOF
NEXT_PUBLIC_API_URL=http://localhost:$BACKEND_PORT
EOF
  success "frontend/.env.local created"
else
  info "frontend/.env.local already exists — skipping"
fi

# ── npm install ───────────────────────────────────────────────────────────────
header "Checking dependencies…"

if [ ! -d "$BACKEND_DIR/node_modules" ]; then
  info "Installing backend dependencies…"
  npm install --prefix "$BACKEND_DIR" --silent
  success "Backend deps installed"
else
  info "Backend node_modules present"
fi

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  info "Installing frontend dependencies…"
  npm install --prefix "$FRONTEND_DIR" --silent
  success "Frontend deps installed"
else
  info "Frontend node_modules present"
fi

# ── kill stale dev servers ────────────────────────────────────────────────────
for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  pid=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    info "Port $port in use by PID $pid — killing stale process…"
    kill "$pid" 2>/dev/null || true
    sleep 1
  fi
done

# ── postgres ──────────────────────────────────────────────────────────────────
header "Checking PostgreSQL…"

# TCP check — works without pg_isready
pg_ready() {
  if command -v pg_isready >/dev/null 2>&1; then
    pg_isready -h localhost -p "$PG_PORT" -U "$PG_USER" -q 2>/dev/null
  else
    # bash TCP probe: open /dev/tcp and immediately close
    (echo >/dev/tcp/localhost/"$PG_PORT") 2>/dev/null
  fi
}

if pg_ready; then
  info "PostgreSQL already running on port $PG_PORT"
elif command -v docker >/dev/null 2>&1; then
  # Reuse existing container if it exists but is stopped
  if docker inspect "$PG_CONTAINER" >/dev/null 2>&1; then
    info "Starting existing container $PG_CONTAINER…"
    docker start "$PG_CONTAINER" >/dev/null
  else
    info "Starting PostgreSQL container…"
    docker run -d \
      --name "$PG_CONTAINER" \
      -e POSTGRES_USER="$PG_USER" \
      -e POSTGRES_PASSWORD="$PG_PASS" \
      -e POSTGRES_DB="$PG_DB" \
      -p "127.0.0.1:${PG_PORT}:5432" \
      postgres:16-alpine \
      >/dev/null
  fi
  info "Waiting for PostgreSQL to be ready…"
  for i in $(seq 1 30); do
    if pg_ready; then
      success "PostgreSQL ready"
      break
    fi
    sleep 1
    if [ "$i" -eq 30 ]; then
      error "PostgreSQL did not become ready after 30s"
      info "Check container logs with: docker logs $PG_CONTAINER"
      exit 1
    fi
  done
else
  error "PostgreSQL is not running and Docker is not available."
  error "Start PostgreSQL manually or install Docker, then re-run."
  exit 1
fi

# ── migrations ────────────────────────────────────────────────────────────────
header "Running migrations…"
(cd "$BACKEND_DIR" && npm run migrate --silent)
success "Migrations applied"

# ── start servers ─────────────────────────────────────────────────────────────
header "Starting servers…"

# Prefix each line of output with a colored label
prefix_output() {
  local label="$1" color="$2"
  while IFS= read -r line; do
    echo -e "${color}[${label}]${RESET} ${line}"
  done
}

# Backend
(cd "$BACKEND_DIR" && npm run dev 2>&1) | prefix_output "backend" "$BLUE" &

# Frontend
(cd "$FRONTEND_DIR" && npm run dev 2>&1) | prefix_output "frontend" "$GREEN" &

# Wait for backend to accept connections before announcing URLs
info "Waiting for backend to be ready…"
for i in $(seq 1 30); do
  if (echo >/dev/tcp/localhost/"$BACKEND_PORT") 2>/dev/null; then
    break
  fi
  sleep 1
  if [ "$i" -eq 30 ]; then
    error "Backend did not start in time — check output above for errors"
    exit 1
  fi
done

echo ""
success "All systems go"
echo -e "  ${BOLD}Frontend:${RESET} http://localhost:${FRONTEND_PORT}"
echo -e "  ${BOLD}Backend:${RESET}  http://localhost:${BACKEND_PORT}"
echo ""
info "Press Ctrl+C to stop"
echo ""

# Wait for all background jobs
wait
