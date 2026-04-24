<div align="center">
  <img src="./assets/logo.svg" alt="opsatlas" width="220"/>
  <br/>
  <br/>
  <p>A self-hosted multi-cloud infrastructure dashboard.<br/>Monitor GCP, AWS, and Hetzner Cloud instances — with billing, DNS, auto-sync, and SSO.</p>

  ![Status](https://img.shields.io/badge/status-active-brightgreen)
  ![License](https://img.shields.io/badge/license-MIT-blue)
</div>

---

## Features

| | |
|---|---|
| **Multi-cloud sync** | GCP Compute Engine + Cloud SQL, AWS EC2, Hetzner Cloud |
| **Per-project status** | GCP connections track last-sync time and errors per project |
| **Billing actuals** | Real spend from GCP Cloud Billing API, AWS Cost Explorer, Hetzner |
| **DNS mapping** | Cloudflare records synced and mapped to instances |
| **Auto-update policies** | Scheduled sync with configurable intervals, scope, and cost sync |
| **Connection wizard** | Step-by-step guided flow for adding cloud providers |
| **SSO — Authentik** | OAuth2/OIDC login, fully configurable via the Settings UI |
| **Settings hub** | Connections, DNS, Billing, SSO, Config in one tabbed page |
| **Disable registrations** | Lock down new sign-ups once your team is set up |
| **Encrypted credentials** | AES-256-GCM at rest, never stored in plain text |

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, CSS Modules |
| Backend | Express, TypeScript, Node.js 20 |
| Database | PostgreSQL 16 + Knex migrations |
| Auth | JWT · bcrypt · Authentik OAuth2/OIDC |
| Cloud clients | `@google-cloud/compute`, AWS SDK v3, Hetzner REST API |

---

## Quick start

### One-line install

```bash
curl -fsSL https://raw.githubusercontent.com/Rhonstin/opsatlas/main/install.sh | bash
```

The installer asks for:
- Public domain for the UI, if you are putting OpsAtlas behind Caddy/Nginx
- Whether to generate a Caddy config, Nginx config, both, or neither
- Host ports for the frontend and backend containers
- Whether PostgreSQL should be exposed on the host at all

When selected, the installer writes managed reverse proxy configs to:
- `deploy/proxy/opsatlas.Caddyfile`
- `deploy/proxy/opsatlas.nginx.conf`

Override defaults on the `bash` side of the pipeline:

```bash
curl -fsSL https://raw.githubusercontent.com/Rhonstin/opsatlas/main/install.sh | INSTALL_DIR=/opt/opsatlas bash
```

### Docker images (recommended)

```bash
git clone https://github.com/Rhonstin/opsatlas
cd opsatlas

cat > .env <<EOF
JWT_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 16)
FRONTEND_URL=http://localhost:3000
API_URL=http://localhost:4000
EOF

docker compose pull
docker compose up -d
docker compose exec -T backend npm run migrate:prod
```

Open http://localhost:3000

PostgreSQL is not published on the host by default in `docker-compose.yml`. The installer can generate a local `compose.override.yml` if you explicitly choose to expose it.

The default `docker-compose.yml` uses published GitHub Container Registry images:

| Service | Image |
|---|---|
| Backend | `ghcr.io/rhonstin/opsatlas/backend:main` |
| Frontend | `ghcr.io/rhonstin/opsatlas/frontend:main` |

Images are built by `.github/workflows/containers.yml` on pull requests, pushes to `main`, and `v*` tags. Pull requests build only; `main` and tag builds publish to GHCR.

### Local Docker builds

Use `compose.dev.yml` when you want Docker Compose to build images from the local source tree:

```bash
cp backend/.env.example backend/.env
# Edit backend/.env if you are running backend outside Compose

cat > .env <<EOF
JWT_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 16)
FRONTEND_URL=http://localhost:3000
API_URL=http://localhost:4000
EOF

docker compose -f compose.dev.yml up -d --build
docker compose -f compose.dev.yml exec -T backend npm run migrate:prod
```

### Local development

```bash
# 1. Postgres
docker compose -f compose.dev.yml up -d postgres

# 2. Backend
cd backend
cp .env.example .env        # fill in JWT_SECRET, ENCRYPTION_KEY, DATABASE_URL
npm install
npm run migrate
npm run dev                 # :4000

# 3. Frontend
cd frontend
npm install
npm run dev                 # :3000
```

---

## Environment variables

### Docker Compose (`.env`)

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | Yes | Long random string for signing JWTs |
| `ENCRYPTION_KEY` | Yes | Exactly 32 chars — encrypts cloud credentials at rest |
| `FRONTEND_URL` | No | CORS origin (default: `http://localhost:3000`) |
| `API_URL` | No | Frontend build-time backend URL for local Docker builds |

```bash
# Generate secrets
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 16   # ENCRYPTION_KEY (32 hex chars)
```

### Backend (`backend/.env`, local development)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Long random string for signing JWTs |
| `ENCRYPTION_KEY` | Yes | Exactly 32 chars — encrypts cloud credentials at rest |
| `PORT` | No | API port (default: `4000`) |
| `FRONTEND_URL` | No | CORS origin (default: `http://localhost:3000`) |

Authentik SSO credentials (`AUTHENTIK_URL`, `AUTHENTIK_CLIENT_ID`, `AUTHENTIK_CLIENT_SECRET`) can be set as env vars **or** entered directly in Settings → SSO.

### Frontend (`frontend/.env.local`)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend URL (default: `http://localhost:4000`) |

---

## Adding a connection

### GCP
1. Create a service account in GCP IAM — roles: **Compute Viewer**, **Browser**, **Cloud SQL Viewer**
2. Download the JSON key
3. Settings → Connections → **Add connection** → paste JSON
4. Click **Discover** to select projects, then **Sync**

### AWS
1. Create an IAM user with `ReadOnlyAccess` + `AWSCostExplorerReadOnlyAccess`
2. Generate an access key
3. Settings → Connections → **Add connection** → enter Key ID + Secret

### Hetzner
1. Hetzner Cloud Console → Security → API Tokens → generate **Read & Write** token
2. Settings → Connections → **Add connection** → paste token

---

## Project structure

```
opsatlas/
├── backend/src/
│   ├── routes/          # auth, connections, sync, billing, dns, config
│   ├── gcp/             # Compute, Cloud SQL, billing cache
│   ├── aws/             # EC2, pricing
│   ├── hetzner/         # servers, billing
│   ├── db/migrations/   # Knex migrations (20240001 → 20240019)
│   ├── lib/             # crypto, billing-refresh
│   ├── middleware/       # JWT auth
│   └── scheduler.ts     # auto-update runner
│
└── frontend/src/app/
    ├── dashboard/
    │   ├── instances/   # sortable instance table + drawer
    │   ├── billing/     # actuals table by period
    │   ├── dns/records/ # DNS record list
    │   ├── auto-update/ # policy management
    │   └── settings/    # Connections · DNS · Billing · SSO · Config tabs
    ├── login/           # email/password + SSO button
    └── auth/callback/   # Authentik OAuth2 callback
```

---

## Roadmap

See [ROADMAP.MD](./ROADMAP.MD) for full milestone details and completion status.

---

## License

MIT
