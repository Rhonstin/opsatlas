# Deployment Guide

Step-by-step instructions for deploying opsatlas and configuring each cloud provider.

---

## Table of contents

1. [Prerequisites](#1-prerequisites)
2. [Backend environment variables](#2-backend-environment-variables)
3. [GCP — service account setup](#3-gcp--service-account-setup)
4. [GCP — billing export (for actuals)](#4-gcp--billing-export-for-actuals)
5. [AWS — IAM user setup](#5-aws--iam-user-setup)
6. [Hetzner Cloud — API token](#6-hetzner-cloud--api-token)
7. [Cloudflare — DNS integration](#7-cloudflare--dns-integration)
8. [Authentik — SSO setup](#8-authentik--sso-setup)
9. [Docker Compose deployment](#9-docker-compose-deployment)
10. [Post-deploy checklist](#10-post-deploy-checklist)

---

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Docker + Docker Compose | v24+ | For containerised deployment |
| Node.js | 20+ | For local dev only |
| PostgreSQL | 16+ | Provided via Docker Compose |
| `gcloud` CLI | latest | For GCP setup only |
| `bq` CLI | latest | For billing export setup only |

---

## 2. Backend environment variables

Create `backend/.env` from the example:

```bash
cp backend/.env.example backend/.env
```

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | `postgresql://user:pass@host:5432/dbname` |
| `JWT_SECRET` | Yes | Long random string — signs session tokens |
| `ENCRYPTION_KEY` | Yes | Exactly **32 characters** — encrypts credentials at rest |
| `PORT` | No | API port (default: `4000`) |
| `FRONTEND_URL` | No | CORS origin (default: `http://localhost:3000`) |
| `AUTHENTIK_URL` | No | Authentik base URL — can also be set in Settings → SSO |
| `AUTHENTIK_CLIENT_ID` | No | OAuth2 client ID — can also be set in Settings → SSO |
| `AUTHENTIK_CLIENT_SECRET` | No | OAuth2 client secret — can also be set in Settings → SSO |

Generate secrets:

```bash
openssl rand -hex 32    # → JWT_SECRET (64 hex chars)
openssl rand -base64 24 # → ENCRYPTION_KEY (use first 32 chars)
```

**Frontend** — create `frontend/.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:4000   # or your backend URL
```

---

## 3. GCP — service account setup

opsatlas needs a dedicated service account with read-only access.

### 3.1 Create the service account

```bash
PROJECT_ID="your-home-project-id"
SA_NAME="opsatlas-viewer"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts create "${SA_NAME}" \
  --display-name="OpsAtlas Viewer" \
  --project="${PROJECT_ID}"
```

### 3.2 Grant required roles

Grant these roles on **every project** you want opsatlas to sync:

| Role | IAM identifier | Purpose |
|---|---|---|
| Compute Viewer | `roles/compute.viewer` | List/view Compute Engine instances |
| Cloud SQL Viewer | `roles/cloudsql.viewer` | List/view Cloud SQL instances |
| Browser | `roles/browser` | Read project metadata for discovery |

```bash
# Repeat for each project you want to sync
TARGET_PROJECT="your-project-id"

for ROLE in roles/compute.viewer roles/cloudsql.viewer roles/browser; do
  gcloud projects add-iam-policy-binding "${TARGET_PROJECT}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${ROLE}"
done
```

### 3.3 Download the JSON key

```bash
gcloud iam service-accounts keys create opsatlas-key.json \
  --iam-account="${SA_EMAIL}" \
  --project="${PROJECT_ID}"
```

> **Keep `opsatlas-key.json` secret — do not commit it to git.**

### 3.4 Add to opsatlas

In opsatlas → **Settings → Connections → Add connection**:
- Provider: **Google Cloud (GCP)**
- Paste the full contents of `opsatlas-key.json`
- Click **Discover** to select projects, then **Sync**

---

## 4. GCP — billing export (for actuals)

To see real spend data in opsatlas → Billing, GCP must export billing data to BigQuery.

### 4.1 Enable the BigQuery API

```bash
gcloud services enable bigquery.googleapis.com --project="${PROJECT_ID}"
```

### 4.2 Create a dataset for the export

```bash
bq mk \
  --dataset \
  --location=US \
  --description="GCP billing export for opsatlas" \
  "${PROJECT_ID}:billing_export"
```

> Use `--location=EU` if your billing account is EU-based.

### 4.3 Enable billing export

Go to [GCP Console → Billing → Data export](https://console.cloud.google.com/billing/export):

1. Select your billing account
2. Click **Edit settings** under **Standard usage cost**
3. Set:
   - **Project**: the project where you created the dataset
   - **Dataset**: `billing_export` (or whatever you named it)
4. Click **Save**

> Data takes **24–48 hours** to start appearing. GCP creates the `gcp_billing_export_v1_*` table automatically on first export.

### 4.4 Grant the service account BigQuery access

Grant these on the **project that holds the billing dataset**:

| Role | IAM identifier | Purpose |
|---|---|---|
| BigQuery Data Viewer | `roles/bigquery.dataViewer` | Read billing export tables |
| BigQuery Job User | `roles/bigquery.jobUser` | Run queries on the dataset |

```bash
BILLING_PROJECT="project-with-billing-dataset"

for ROLE in roles/bigquery.dataViewer roles/bigquery.jobUser; do
  gcloud projects add-iam-policy-binding "${BILLING_PROJECT}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${ROLE}"
done
```

### 4.5 Add billing_dataset to the key file

opsatlas reads `billing_dataset` from the JSON credential to know where to query.
Add it to your `opsatlas-key.json`:

```bash
python3 -c "
import json
with open('opsatlas-key.json') as f:
    d = json.load(f)
d['billing_dataset'] = '${BILLING_PROJECT}.billing_export'
with open('opsatlas-key.json', 'w') as f:
    json.dump(d, f, indent=2)
print('Done:', d['billing_dataset'])
"
```

Then update the connection in opsatlas: **Settings → Connections → Edit** → re-paste the updated JSON.

---

## 5. AWS — IAM user setup

### 5.1 Create an IAM user

In [AWS Console → IAM → Users](https://console.aws.amazon.com/iam/home#/users) → **Create user**:

- Username: `opsatlas-viewer` (or any name)
- Select **Attach policies directly**

### 5.2 Attach required policies

| Policy | Purpose |
|---|---|
| `ReadOnlyAccess` | List EC2 instances across all regions |
| `AWSCostExplorerReadOnlyAccess` | Fetch billing actuals from Cost Explorer |

> `ReadOnlyAccess` is broad — for a tighter scope attach only:
> `AmazonEC2ReadOnlyAccess` + `AWSCostExplorerReadOnlyAccess`

### 5.3 Generate an access key

In the user → **Security credentials** tab → **Create access key**:
- Use case: **Third-party service**
- Copy the **Access Key ID** and **Secret Access Key**

> AWS does not show the secret again after creation — save it immediately.

### 5.4 Add to opsatlas

**Settings → Connections → Add connection**:
- Provider: **Amazon Web Services (AWS)**
- Enter Access Key ID and Secret Access Key
- All enabled regions sync automatically

---

## 6. Hetzner Cloud — API token

### 6.1 Generate a token

In [Hetzner Cloud Console](https://console.hetzner.cloud/) → select project → **Security → API Tokens → Generate API Token**:

- Name: `opsatlas`
- Permissions: **Read & Write**
  - Read is required to list servers
  - Write is required for future automation (safe to keep read-only if you only need monitoring)

> Copy the token immediately — it is only shown once.

### 6.2 Add to opsatlas

**Settings → Connections → Add connection**:
- Provider: **Hetzner Cloud**
- Paste the API token

Each Hetzner project is one connection. Repeat for each project you want to track.

---

## 7. Cloudflare — DNS integration

### 7.1 Generate an API token

In [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Profile → API Tokens → Create Token**:

- Template: **Edit zone DNS** (or create custom)
- Permissions:
  - Zone → DNS → **Read**
- Zone resources: **All zones** (or select specific zones)

### 7.2 Add to opsatlas

**Settings → DNS → Add connection**:
- Provider: **Cloudflare**
- Paste the API token
- Click **Sync** to pull records

DNS records will appear in **DNS → Records** and be mapped to matching instances automatically.

---

## 8. Authentik — SSO setup

Authentik SSO can be configured via env vars **or** directly in the opsatlas UI at Settings → SSO.

### 8.1 Create an OAuth2/OpenID Provider in Authentik

In Authentik admin → **Applications → Providers → Create**:

- Type: **OAuth2/OpenID Provider**
- Name: `opsatlas`
- Client type: **Confidential**
- Client ID: (generated — copy it)
- Client Secret: (generated — copy it)
- Redirect URIs:
  ```
  https://your-opsatlas-domain.com/auth/callback
  ```
- Scopes: `openid`, `email`, `profile`
- Subject mode: **Based on the User's Email**

### 8.2 Create an Application

In Authentik → **Applications → Applications → Create**:
- Name: `opsatlas`
- Slug: `opsatlas`
- Provider: select the provider created above
- Launch URL: `https://your-opsatlas-domain.com`

### 8.3 Configure in opsatlas

Either set env vars (takes effect after backend restart):

```env
AUTHENTIK_URL=https://your-authentik-domain.com
AUTHENTIK_CLIENT_ID=<client-id>
AUTHENTIK_CLIENT_SECRET=<client-secret>
```

Or go to **Settings → SSO** and enter the values there — no restart needed.

### 8.4 Test

Settings → SSO → **Test login** — opens the Authentik login in a new tab and completes the OAuth2 flow.

---

## 9. Docker Compose deployment

```yaml
# docker-compose.yml (example — adapt to your setup)
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: opsatlas
      POSTGRES_USER: opsatlas
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data

  backend:
    build: ./backend
    env_file: ./backend/.env
    environment:
      DATABASE_URL: postgresql://opsatlas:${DB_PASSWORD}@postgres:5432/opsatlas
    depends_on:
      - postgres
    ports:
      - "4000:4000"

  frontend:
    build: ./frontend
    environment:
      NEXT_PUBLIC_API_URL: http://backend:4000
    depends_on:
      - backend
    ports:
      - "3000:3000"

volumes:
  pgdata:
```

### Start

```bash
docker compose up -d
docker compose exec backend npm run migrate
```

### Update

```bash
git pull
docker compose build
docker compose up -d
docker compose exec backend npm run migrate   # run after every deploy
```

---

## 10. Post-deploy checklist

- [ ] Backend `.env` has strong random `JWT_SECRET` and `ENCRYPTION_KEY`
- [ ] HTTPS is configured in front of both services (nginx, Caddy, Cloudflare Tunnel, etc.)
- [ ] At least one admin account created via **Create account**
- [ ] **Settings → Config → New registrations → Disable** — prevents public sign-ups
- [ ] At least one cloud connection added and synced
- [ ] If using SSO: Authentik redirect URI matches your production domain exactly
- [ ] Database has regular backups configured (`pg_dump` or managed DB snapshots)
- [ ] `opsatlas-key.json` and `.env` files are not committed to git (check `.gitignore`)
