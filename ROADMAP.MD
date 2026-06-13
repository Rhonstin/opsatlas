# opsatlas — Roadmap

## Product Summary

**opsatlas** is a multi-cloud dashboard for:
- Viewing compute resources (GCP + AWS + Hetzner) and managed databases (Cloud SQL)
- Status, IP, region, uptime
- Estimated cost
- Centralized connection management (projects / accounts)
- DNS mapping: VM → external IP → domain name
- Favorites, tags, and smart organization for faster navigation
- Controlled auto-update workflows for infrastructure metadata refresh

---

## 1. High-Level Architecture

### Stack
- Frontend: Next.js 15 + React 19 (TypeScript)
- Backend: Express + TypeScript
- DB: PostgreSQL (Knex migrations)
- Auth: JWT + bcrypt

### Core Components
- Express API server
- GCP / AWS / Hetzner sync workers (async, fire-and-forget)
- PostgreSQL database
- Next.js frontend (App Router, CSS Modules)

---

## 2. Data Model

### CloudConnection
- id, user_id, provider (`gcp` | `aws` | `hetzner` | `coolify`), name
- credentials_enc (AES-256-GCM)
- status, last_sync_at, last_error

### ProjectOrAccount
- id, connection_id, external_id, name

### Instance
- id, provider, connection_id, project_or_account_id
- **resource_type** (`compute` | `cloudsql` | `app`) — distinguishes VMs from managed DBs and PaaS apps
- instance_id, name, status, region, zone
- private_ip, public_ip, instance_type
- launched_at, last_seen_at
- estimated_hourly_cost, estimated_monthly_cost
- raw_payload (jsonb)

### SyncRun
- id, connection_id, status, started_at, finished_at, error_log

### AutoUpdatePolicy
- id, user_id, scope (`connection` | `provider` | `instance` | `global`)
- target_id (nullable), enabled, interval_minutes
- sync_instances, sync_dns, sync_cost (boolean toggles)
- last_run_at, next_run_at, last_status, last_error, failure_count
- created_at, updated_at

### AutoUpdateRun *(audit log)*
- id, policy_id, status, started_at, finished_at
- connections_synced, error

### DnsConnection
- id, user_id, provider (`cloudflare` | `route53` | `gcpdns` | `manual`)
- name, credentials_enc, status, last_sync_at, last_error

### DnsRecord
- id, dns_connection_id, zone, zone_id, record_id, name, type (`A` | `AAAA` | `CNAME`)
- value (IP or CNAME target), ttl, proxied, last_seen_at

### BillingActual *(implemented, nav-disabled)*
- id, connection_id, period (YYYY-MM), project_id, project_name
- service, amount_usd, currency, fetched_at

### FavoriteInstance *(Milestone 10A)*
- id, user_id, instance_id, created_at

### Tag *(Milestone 10B)*
- id, user_id, name, color, created_at, updated_at

### InstanceTag *(Milestone 10B)*
- id, instance_id, tag_id

### OpenPort *(Milestone 12)*
- id, instance_id, port (integer), protocol (`tcp` | `udp`)
- service_name (e.g. `PostgreSQL`, `MySQL`, `RDP`)
- risk_level (`low` | `medium` | `high`)
- last_seen_at, created_at

### PortAlert *(Milestone 12)*
- id, user_id, rule_name (e.g. `flag-postgres-exposed`)
- trigger_port (integer), trigger_service (nullable)
- enabled (boolean), last_triggered_at
- created_at, updated_at

---

## 3. Milestones

### Milestone 1 — Core Foundation ✅
- [x] Project setup (Express backend + Next.js frontend)
- [x] PostgreSQL + Knex migrations
- [x] All DB models created
- [x] Basic auth (register / login, JWT, bcrypt)
- [x] Connection CRUD (create, read, update, delete)

### Milestone 2 — GCP Integration ✅
- [x] Service account JSON auth
- [x] Fetch Compute Engine instances (aggregated list across all zones)
- [x] Upsert instances into DB
- [x] Calculate uptime from `launched_at`
- [x] Estimate hourly + monthly cost (static rate table, ported from gcp-vm-janitor)
- [x] Test connection endpoint (real API call validation)
- [x] Instances list page with status badges + cost columns

### Milestone 3 — Multi-Project GCP ✅
- [x] Project discovery via Cloud Resource Manager (`searchProjectsAsync`)
- [x] Project selection UI (discover + checkbox + manual entry + select all)
- [x] Multiple projects per connection saved to `projects_or_accounts`
- [x] Sync iterates all selected projects in parallel
- [x] Unified instances list across all projects
- [x] Filter by provider and status
- [x] Per-project error isolation (one failing project doesn't abort others)

### Milestone 4 — AWS Integration ✅
- [x] EC2 integration (AWS SDK, list instances per region)
- [x] Normalize to shared Instance model
- [x] Uptime from `LaunchTime`
- [x] Estimated pricing (EC2 on-demand rate table, ~80 instance types + fallback)
- [x] AWS connection test endpoint (`DescribeRegions` validation)
- [x] All enabled regions synced in parallel via `DescribeRegions`
- [x] Instance name from `Name` tag, falls back to instance ID
- [x] IAM policy documented (`ec2:DescribeInstances`, `ec2:DescribeRegions`, `ce:GetCostAndUsage`)

### Milestone 5 — Multi-Account AWS
- [ ] Multiple AWS connections
- [ ] Region selection per connection
- [ ] Account filters on instances page
- [ ] Sync health tracking per account

### Milestone 5A — Hetzner Integration ✅
- [x] Hetzner Cloud integration (API token auth)
- [x] Fetch servers, server types, locations, public/private networking
- [x] Normalize Hetzner servers to shared Instance model
- [x] Estimate monthly cost from Hetzner pricing catalog
- [x] Hetzner connection test endpoint

### Milestone 5B — Hetzner Projects & Networking
- [ ] Multiple Hetzner connections / projects
- [ ] Network + firewall metadata sync
- [ ] Labels from Hetzner mapped into internal tags (optional import)
- [ ] Sync health tracking per Hetzner project

### Milestone 5C — Cloud SQL Integration ✅
- [x] Cloud SQL Admin REST API sync (per GCP project)
- [x] `resource_type` column on `instances` table (`compute` | `cloudsql`)
- [x] Status normalization (`RUNNABLE` → `RUNNING`, etc.)
- [x] Cost estimation from tier table + `db-custom-{cpus}-{ram}` fallback
- [x] Cloud SQL instances appear in unified instances table
- [x] Resource type filter on instances page (`All types / Compute / Cloud SQL`)
- [x] Drawer shows `Tier` label and `DB version` (e.g. `POSTGRES_14`) for Cloud SQL
- [x] Non-fatal sync: project skipped if Cloud SQL API not enabled
- [x] `roles/cloudsql.viewer` added to `scripts/create-sa.sh`

### Milestone 6 — Unified Dashboard ✅
- [x] Single instances table (all providers)
- [x] Filter by provider, status, and resource type
- [x] Sorting on all columns (client-side, `useSort` hook)
- [x] Search / text filter (name, IP, region, zone, connection, machine type)
- [x] Summary widgets (instance count, running count, est. monthly cost)
- [ ] Per-provider breakdown widget

### Milestone 7 — Cost Layer ✅
- [x] Estimated cost per instance (hourly + monthly)
- [x] Total monthly cost on instances page
- [x] Cost aggregation by project / account
- [x] Top N most expensive instances view
- [x] Long-running instance detection
- [x] Idle candidate detection (stopped but incurring costs)

### Milestone 8 — Connection Management
- [x] Add connection modal
- [x] Provider + credential validation
- [x] Test connection button (real API call)
- [x] Status badge per connection (active / error / pending)
- [x] GCP project selection after adding connection
- [x] Last error message displayed inline on connection row
- [ ] Connection wizard (step-by-step guided flow)

### Milestone 9 — Sync Engine
- [x] Manual sync trigger (`POST /sync/:id`)
- [x] Async fire-and-forget with DB status tracking
- [x] Sync run polling (frontend polls `GET /sync/:run_id`)
- [x] Sync history log (`GET /sync/history`)
- [x] Scheduled auto-sync (via Auto-Update Policies)
- [x] Per-project error isolation — partial success accepted
- [ ] Retry on transient errors
- [ ] Per-project sync status in UI

### Milestone 10 — UI Polish ✅
- [x] Dark theme with CSS variables
- [x] Status badges (active / error / pending)
- [x] Loading states on buttons
- [x] Sortable table columns with ↑↓ indicators
- [x] Global search / text filter (instances page)
- [x] Toast notifications (sync done, errors — connections + DNS pages)
- [x] Empty states with guidance text (all pages)
- [x] Mobile-responsive layout (hamburger nav, table scroll, drawer snap)

### Milestone 10A — Favorites
Quickly pin important instances and surface them across the UI.

**Goal:** one-click bookmarking for frequently used infrastructure.

#### Work items
- [ ] Add favorite / unfavorite action on instance rows and detail pages
- [ ] Favorites-only filter on instances page
- [ ] Favorites widget on dashboard
- [ ] Persist favorites per user
- [ ] Sort favorites above non-favorites (optional toggle)
- [ ] API + DB support for favorites

### Milestone 10B — Tags
Organize infrastructure with manual and provider-derived tags.

**Goal:** flexible categorization like `production`, `db`, `client-a`, `urgent`, `gpu`.

#### Work items
- [ ] Create / edit / delete tags
- [ ] Assign multiple tags to instances
- [ ] Filter instances by one or many tags
- [ ] Color-coded tags in tables and details
- [ ] Bulk tag actions from instances table
- [ ] Optional import of provider-native labels into tags
- [ ] Tag management page

### Milestone 11 — DNS Integration ✅
Map domain names to compute instances by syncing DNS A/AAAA records.

**Goal:** unified table — `VM name | provider | external IP | domain name(s)`

#### DNS Providers (phased)
- [x] **Phase A** — Cloudflare (API token auth)
- [ ] **Phase B** — AWS Route 53 (reuses existing AWS connection)
- [ ] **Phase C** — Google Cloud DNS (reuses existing GCP connection)
- [ ] **Phase D** — Manual (paste zone file or CSV)

#### Work items
- [x] `dns_connections` + `dns_records` DB migrations
- [x] Cloudflare sync: list zones → list A/AAAA records per zone → upsert
- [x] `GET /dns-connections`, `POST`, `DELETE`, `POST /test`
- [x] `POST /dns-sync/:id` — trigger DNS record sync
- [x] `GET /dns/records` — filterable record list
- [x] `GET /instances?with_dns=true` — instances enriched with matched domains
- [x] DNS Connections page (reuses connection CRUD pattern)
- [x] Domain column on instances table
- [x] DNS Records page (zone + record table with matched instance)
- [x] Dashboard card: "X domains mapped"
- [x] UI warning for Cloudflare-proxied records (IP is edge, not instance)

### Milestone 12 — Port Scanning & Service Discovery
Detect open ports and running services on instances; alert on insecure exposures.

**Goal:** identify risky configurations (exposed databases, etc.) at a glance.

#### Work items
- [ ] Port scan instances via GCP / AWS APIs (firewall rules, security groups)
- [ ] Detect common services (PostgreSQL 5432, MySQL 3306, RDP 3389, etc.)
- [ ] Store port + service metadata per instance
- [ ] Alert rules: flag if port open + not SSH (22)
- [ ] Instances page gains **Open Ports** column
- [ ] New **Port Scan** page: all ports + services across fleet
- [ ] Alert threshold config (which ports to flag)
- [ ] Dashboard card: "N instances with exposed ports"

#### Implementation notes
- GCP: fetch firewall rules from Compute Engine API, match against instance network tags
- AWS: fetch security groups via EC2 API, match against instance SG assignments
- Service inference: static port → service mapping (5432 → PostgreSQL, 3306 → MySQL, etc.)
- Risk levels based on common exploits / compliance (databases = high, RDP = high, HTTP = low, SSH = skip)
- Alert webhook to Slack / email (Phase 2)

### Milestone 13 — Auto-Update Policies ✅
Automate refresh workflows for inventory and related metadata.

**Goal:** configurable background refresh without forcing full sync every time.

#### Work items
- [x] Auto-update policies (`global`, `provider`, `connection`, `instance`)
- [x] Configurable intervals (e.g. 5m / 15m / 1h / 6h / daily)
- [x] Independent toggles for instance sync, DNS refresh, cost refresh
- [x] Queue / scheduler integration (60s tick, setInterval)
- [x] Last run / next run / last error visible in UI
- [x] Pause / resume auto-update per policy
- [x] Exponential backoff on repeated failures (interval × 2^failures, cap 24h)
- [x] Audit trail for automatic refresh jobs (`auto_update_runs` table)

### Milestone 14 — Billing Actuals *(implemented, nav-disabled)*
Real billing data from cloud provider APIs.

**Goal:** show actual spend alongside estimates.

#### Work items
- [x] GCP BigQuery billing export (`gcp_billing_export_v1_*` table, requires `billing_dataset` in credentials)
- [x] AWS Cost Explorer (`GetCostAndUsage` grouped by SERVICE + LINKED_ACCOUNT)
- [x] `billing_actuals` DB table (connection_id, period, project_id, service, amount_usd)
- [x] `GET /billing/actuals`, `GET /billing/periods`, `POST /billing/refresh`
- [x] Billing page (period picker, top services, full line items) — `/dashboard/billing`
- [x] Billing nav link enabled
- [ ] Scheduled billing refresh via auto-update policy

### Milestone 15A — Coolify Integration ✅ *(known gaps in M17)*
Connect to self-hosted Coolify instances to surface deployed applications, projects, and domain names alongside cloud infrastructure.

**Goal:** unified view of Coolify apps and services with their live domains, status, and resource links.

#### Work items
- [x] `provider: 'coolify'` support on `cloud_connections`
- [x] Coolify API token auth + connection test
- [x] Fetch applications and services → upsert into `instances` with `resource_type: 'app'`
- [x] Domain names from app `fqdn` stored in `raw_payload.fqdn_list`, shown in instances table
- [x] Applications appear in unified instances table (name, project, status, domains)
- [x] Instance detail drawer: resource type, repo URL, app URLs
- [x] Scheduled sync via existing auto-update policies
- [ ] Service status from API (currently hardcoded `RUNNING` — see M17)
- [ ] Cost display as "n/a" instead of $0 (see M17)
- [ ] Phase 2: linked resources (databases, Redis, etc.) as child instances

#### Implementation notes
- Coolify v4 REST API: `GET /api/v1/applications`, `GET /api/v1/projects`, `GET /api/v1/services`
- Auth header: `Authorization: Bearer <api_token>` — token scoped to the Coolify instance
- Each Coolify server is one `cloud_connection`; `base_url` stored in credentials JSON
- Application statuses map to internal: `running` → `RUNNING`, `stopped` → `STOPPED`, `exited` → `ERROR`
- Domain names come from app `fqdn` field (can be a comma-separated list)
- Phase 2: linked resources (databases, Redis, etc.) as child instances

### Milestone 15 — Dashboard Overhaul
Consolidate cost visibility and surface real billing data on the main dashboard.

**Goal:** one screen to see actual vs estimated spend, per-provider breakdown, and key fleet health signals.

#### Work items
- [x] Integrate actual billing totals from `billing_actuals` into dashboard
- [x] Replace dual "Spent This Month" + "Est. Monthly Cost" cards with unified cost view
- [x] Per-provider cost breakdown section (actual vs estimated for GCP / AWS / Hetzner)
- [x] Show actual/estimate delta badge when billing data is available
- [x] Fix long-running / idle candidate quick links (tabs were removed from instances page)
- [x] Provider instance count breakdown (GCP N · AWS N · Hetzner N)

### Milestone 16 — Security & Reliability Hardening ✅ *(June 2026)*
Outcome of the full-system audit: RBAC enforcement, crypto hardening, scheduler robustness, infra hygiene.

#### Work items
- [x] RBAC enforced server-side: `requireAdmin` on all mutation routes (sync, dns-sync, auto-update CRUD/trigger, config import/**export**, auth/sso config)
- [x] Default JWT role is `viewer` when role claim is missing (was `admin`)
- [x] Ownership checks: `user_id` in UPDATE clauses, auto-update `target_id` must reference caller's own connection
- [x] `ENCRYPTION_KEY` validated at startup (min 32 chars, fail-fast; was zero-padded)
- [x] Rate limiting on login / register / MFA confirm (10 per 15 min per IP)
- [x] Timeouts on every external HTTP call (`fetchWithTimeout`, 10–30 s)
- [x] Scheduler: atomic policy claim (no duplicate concurrent runs), max 3 policies in flight, interrupted-run recovery on startup
- [x] Graceful shutdown (SIGTERM/SIGINT: drain runs, close pool, 30 s cap)
- [x] Exchange rates fail-closed: persisted last-good rate, error instead of silent 1:1
- [x] `/health` checks DB connectivity; knex pool bounds
- [x] Docker: `restart: unless-stopped`, healthchecks, non-root backend, `.dockerignore`
- [x] `update.sh` auto-backup (`pg_dump`, keep 7) before migrations
- [x] Admin CLI (`node dist/cli.js`): list-users, create-admin/viewer, reset-password, set-role, disable-mfa
- [x] CI gates: typecheck (backend + frontend) + backend integration tests before image build
- [x] Auth/RBAC integration test suite (22 tests, vitest + supertest, role × endpoint matrix)
- [x] Frontend: settings page split into per-tab files, shared `lib/cost.ts` + `usePollUntil`, Next.js middleware route gating, dashboard error surfacing
- [x] Instances JSON export (`GET /instances/export` + UI button; viewers get no cost fields)
- [ ] httpOnly-cookie sessions (replace localStorage token — larger auth-flow change)
- [ ] Structured logging (pino) with request IDs
- [ ] Retry/backoff framework for provider API calls

### Milestone 17 — Data Collection Correctness ✅ *(Stage A+B — June 2026)*
Fix systemic data-quality issues found in the cloud data-collection audit. Full details: `wiki/opsatlas-data-collection-audit-2026-06-13.md`. Covered by `test/sync-runner.test.ts`, `test/cloudflare.test.ts`, `test/billing.test.ts`.

#### Stage A — correctness of existing data ✅
- [x] **Unified currency conversion**: a single shared `lib/sync-runner.ts` `syncConnectionInstances()` now powers both the manual route and the scheduler, so conversion is applied identically (Hetzner EUR no longer leaks through unconverted)
- [x] **Fixed `billing_actuals` semantics**: migration `20240025` adds `source_amount` + `source_currency` (raw provider values); the read path converts to the current display currency, so changing currency never corrupts history
- [x] **DNS sync once per policy run**: moved out of the per-connection loop into `syncDnsForUser()` (was N× duplicate Cloudflare calls)
- [x] **Stale resource cleanup**: instances and dns_records not refreshed since the run start are pruned after a clean sync; skipped on a failed listing so a transient blip can't wipe live rows
- [x] **Cloudflare pagination**: `cfFetchAll()` follows `result_info.total_pages` for both zones and records
- [x] **Cloud SQL pagination**: follows `nextPageToken`

#### Stage B — completeness ✅ *(partial — see Stage C for deferred pricing depth)*
- [x] Coolify: real service status from API; costs stored as `null` ("—", not "$0")
- [x] DNS: all record types synced (TXT/MX/SRV included; `type=` filter removed)
- [x] AWS: `session_token` support in Cost Explorer (temporary STS/SSO credentials); `terminated` instances skipped
- [x] Hetzner billing: IPv6 primary IPs priced by type + location
- [ ] GCP: regional disk pricing from SKU catalog (still hardcoded us-central1 rates); surface `preemptible`/SPOT flag — deferred, needs disk SKUs in the price catalog
- [ ] billing-refresh: per-connection transactional upsert + "N/M connections ok" reporting

#### Stage C — coverage extensions *(deferred — larger features)*
- [ ] AWS: RDS, EBS volumes, Elastic IPs
- [ ] GCP: GKE nodes, unattached disks, load balancers, static IPs; network egress in estimates; sustained-use/CUD discount modeling
- [ ] exchange-rates: separate `lastAttemptAt` from `fetchedAt` (true rate age currently lost on fallback)

---

## 4. API Reference

### Auth
- `POST /auth/register`, `POST /auth/login` (rate-limited)
- `POST /auth/mfa/confirm`, `GET /auth/mfa/setup`, `POST /auth/mfa/verify-setup`, `POST /auth/mfa/disable`, `GET /auth/mfa/status`
- `POST /auth/google/callback`, `POST /auth/authentik/callback`, `GET /auth/providers`
- `GET|PUT /auth/config`, `GET|PUT /auth/sso-config` *(PUT admin-only)*, `GET|PUT /auth/google-config` *(admin)*
- `GET /auth/me`

### Connections
- `GET /connections`
- `POST /connections`
- `GET /connections/:id`
- `PATCH /connections/:id`
- `DELETE /connections/:id`
- `POST /connections/:id/test`
- `GET /connections/:id/projects`
- `POST /connections/:id/projects`
- `GET /connections/:id/projects/discover`
- `GET /connections/:id/health`

### Instances
- `GET /instances` (supports `?provider=`, `?status=`, `?connection_id=`, `?resource_type=`, `?with_dns=`, `?favorite=`, `?tags=`)
- `GET /instances/:id` — includes `project_name`, `database_version` (Cloud SQL), `cpu_count`, `ram_gb`, `disks`, `domains`
- `GET /instances/cost-summary` — aggregated cost by project, top expensive, long-running, idle
- `GET /instances/export` — JSON file download (filters: `?provider=`, `?status=`, `?resource_type=`; viewers get no cost fields)

### Favorites *(Milestone 10A)*
- `GET /favorites`
- `POST /instances/:id/favorite`
- `DELETE /instances/:id/favorite`

### Tags *(Milestone 10B)*
- `GET /tags`
- `POST /tags`
- `PATCH /tags/:id`
- `DELETE /tags/:id`
- `POST /instances/:id/tags`
- `DELETE /instances/:id/tags/:tag_id`

### Sync
- `POST /sync/:connection_id`
- `GET /sync/:run_id`
- `GET /sync/history`

### DNS
- `GET /dns-connections`
- `POST /dns-connections`
- `DELETE /dns-connections/:id`
- `POST /dns-connections/:id/test`
- `POST /dns-sync/:connection_id`
- `GET /dns/records`

### Auto-Update
- `GET /auto-update-policies`
- `POST /auto-update-policies`
- `PATCH /auto-update-policies/:id`
- `DELETE /auto-update-policies/:id`
- `POST /auto-update-policies/:id/run`
- `GET /auto-update-policies/:id/runs` — audit log

### Billing *(nav-disabled)*
- `GET /billing/actuals?period=YYYY-MM`
- `GET /billing/periods`
- `POST /billing/refresh`

### Coolify *(Milestone 15A)*
- `POST /connections/:id/test` — validates Coolify API token + base URL
- `GET /connections/:id/projects` — Coolify projects
- `POST /sync/:connection_id` — syncs apps, services, domains from Coolify

### Port Scanning *(Milestone 12)*
- `POST /port-scan/:instance_id`
- `GET /ports`
- `GET /instances/:id/ports`
- `GET /port-alerts`
- `POST /port-alerts`
- `PUT /port-alerts/:id`
- `DELETE /port-alerts/:id`

---

## 5. MVP Scope

### Providers
- [x] GCP (multiple projects per connection)
- [x] GCP Cloud SQL (synced alongside Compute Engine)
- [x] Hetzner (API token, all servers)
- [x] AWS (1 account, EC2 only — RDS/EBS in M17 Stage C)
- [x] Coolify (self-hosted, API token, apps + services + domains)

### Core Features
- [x] Instances list with uptime + cost
- [x] Resource type filter (Compute / Cloud SQL)
- [x] Search, sort, and filter
- [x] Manual sync + scheduled auto-sync
- [x] DNS mapping (Cloudflare)
- [x] Instance detail drawer (hardware, network, cost, timeline, project, DB version)
- [x] Auto-update policies with audit trail
- [x] Toast notifications + empty states + mobile layout
- [ ] Favorites
- [ ] Tags

### Out of MVP Scope
- ~~RBAC / multi-user~~ → **implemented** (admin/viewer roles, server-side enforcement, SSO via Google/Authentik, MFA) — teams still out of scope
- Alerts / notifications / Slack
- Instance control (start / stop)
- Port scanning
- Billing API in main nav (implemented, deferred)

---

## 6. Future Extensions

- **Providers:** Azure, Hetzner Robot (dedicated), DigitalOcean, AWS EC2, Coolify (Milestone 15A)
- **Orchestration:** Kubernetes (pods / nodes), RDS, Cloud Spanner
- **DNS:** Route 53 + Cloud DNS (Milestone 11 Phase B/C), reverse DNS lookup
- **Billing:** Enable billing nav link, scheduled billing refresh, cost anomaly alerts
- **Alerting:** Slack / email alerts on sync errors or port exposure
- **Security:** Port scanning, compliance scanning (PCI, SOC2, CIS)
- **Organization:** RBAC / teams, smart tag suggestions from provider labels, favorites
- **Connection wizard:** step-by-step guided flow for adding providers
