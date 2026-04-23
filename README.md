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

### Docker (recommended)

```bash
git clone https://github.com/your-username/opsatlas
cd opsatlas

cp backend/.env.example backend/.env
# Edit backend/.env — set JWT_SECRET and ENCRYPTION_KEY

docker compose up -d
docker compose exec backend npm run migrate
```

Open http://localhost:3000

### Local development

```bash
# 1. Postgres
docker compose up -d postgres

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

### Backend (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Long random string for signing JWTs |
| `ENCRYPTION_KEY` | Yes | Exactly 32 chars — encrypts cloud credentials at rest |
| `PORT` | No | API port (default: `4000`) |
| `FRONTEND_URL` | No | CORS origin (default: `http://localhost:3000`) |

```bash
# Generate secrets
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 16   # ENCRYPTION_KEY (32 hex chars)
```

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
