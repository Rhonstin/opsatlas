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
- id, user_id, provider (`gcp` | `aws` | `hetzner`), name
- credentials_enc (AES-256-GCM)
- status, last_sync_at, last_error

### ProjectOrAccount
- id, connection_id, external_id, name

### Instance
- id, provider, connection_id, project_or_account_id
- **resource_type** (`compute` | `cloudsql`) — distinguishes VMs from managed DBs
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
- [x] Per-provider breakdown widget

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

### Milestone 15A — Long-Running Instance Alerts
Notify users when costly instances have been running continuously for too long, with per-instance suppression.

**Goal:** catch forgotten instances burning money — a single daily digest surfaces anything running ≥ 1 day that isn't explicitly excluded.

#### Data model

**LongRunningAlert rule** (`long_running_alert_rules`)
- `id`, `user_id`
- `threshold_hours` — integer, default `24`; alert fires when `uptime_hours ≥ threshold_hours`
- `enabled` — boolean
- `created_at`, `updated_at`

**LongRunningExclusion** (`long_running_exclusions`)
- `id`, `user_id`, `instance_id` (FK → instances)
- `reason` — optional free-text note (e.g. "24/7 prod DB — expected")
- `created_at`

#### Work items
- [ ] DB migrations: `long_running_alert_rules`, `long_running_exclusions`
- [ ] `GET /alerts/long-running/rule` — fetch the user's rule (threshold + enabled)
- [ ] `PUT /alerts/long-running/rule` — update threshold / toggle enabled
- [ ] `GET /alerts/long-running/exclusions` — list excluded instances
- [ ] `POST /alerts/long-running/exclusions` — exclude an instance (body: `{ instance_id, reason? }`)
- [ ] `DELETE /alerts/long-running/exclusions/:instance_id` — remove exclusion
- [ ] `GET /alerts/long-running/triggered` — instances currently matching the rule (uptime ≥ threshold, not excluded, RUNNING)
- [ ] Scheduler: evaluate rule every hour, write results to `alert_events` (deduplicated — one open event per instance until resolved)
- [ ] In-app notification bell: badge count of open long-running alerts
- [ ] Alert list page (`/dashboard/alerts`) — shows triggered instances with cost, uptime, and Exclude / Dismiss actions
- [ ] Instances page: "Exclude from alerts" action in the row context menu and detail drawer
- [ ] Dashboard card: "N instances running > Xh" with link to alert list
- [ ] Settings tab: configure threshold (24h / 48h / 7d / custom) and toggle alerts on/off

#### Implementation notes
- Deduplication: use an `alert_events` table (`instance_id`, `rule_id`, `opened_at`, `resolved_at`) — only open one event per instance; resolve when instance stops or is excluded
- Evaluation query: `SELECT instances.* FROM instances LEFT JOIN long_running_exclusions ... WHERE uptime_hours >= threshold AND exclusion IS NULL AND status = 'RUNNING'`
- Phase 2: email / Slack webhook delivery of the daily digest

### Milestone 15B — Cost Limits & Budget Alerts
Set monthly spend budgets at the project, connection, or provider level and get notified when actual or estimated spend approaches or exceeds the limit.

**Goal:** prevent surprise cloud bills — define a ceiling, get warned early, see at a glance what's over budget.

#### Data model

**CostLimit** (`cost_limits`)
- `id`, `user_id`
- `scope` — `provider` | `connection` | `project`
- `scope_id` — provider string (e.g. `gcp`) or UUID of connection / project_or_account
- `scope_label` — display name, denormalized for fast rendering
- `limit_usd` — decimal, the monthly ceiling
- `warn_pct` — integer 0–99, warn threshold as % of limit (default `80`)
- `enabled` — boolean
- `created_at`, `updated_at`

**AlertEvent** (shared with 15A) — reuse `alert_events` table with `type` column (`long_running` | `cost_limit`)

#### Work items
- [ ] DB migration: `cost_limits` table
- [ ] `GET /cost-limits` — list all limits for the user
- [ ] `POST /cost-limits` — create a limit
- [ ] `PATCH /cost-limits/:id` — update amount, warn_pct, enabled
- [ ] `DELETE /cost-limits/:id` — remove a limit
- [ ] `GET /cost-limits/status` — each limit enriched with current actual + estimated spend, status (`ok` | `warn` | `exceeded`)
- [ ] Scheduler: evaluate limits hourly against `billing_actuals` + estimated MTD; write alert events on threshold crossing; resolve when spend drops below warn_pct (e.g. after a new period starts)
- [ ] Budget status widget on dashboard: colored bar (green / amber / red) per limit showing spent / ceiling
- [ ] Alert list page (`/dashboard/alerts`) — merge cost limit breaches with long-running alerts from 15A
- [ ] In-app notification bell: include cost limit breach count in badge
- [ ] Billing page: inline limit bar above each provider/project section
- [ ] Settings tab: manage all limits (add / edit / delete, set warn threshold %)
- [ ] Phase 2: email / Slack notification when warn or exceeded threshold crossed

#### Implementation notes
- Spend source priority: use `billing_actuals` if available for the period; fall back to estimated MTD (hourly rate × hours elapsed this month)
- Status thresholds: `ok` = spend < warn_pct% of limit; `warn` = spend ≥ warn_pct% but < 100%; `exceeded` = spend ≥ limit
- Scope resolution: `provider` → sum all `billing_actuals` rows for that provider; `connection` → filter by `connection_id`; `project` → filter by `project_id`

### Milestone 15C — Notification Providers
Deliver alerts (from 15A long-running and 15B cost limits) to external channels. Configured in Settings → Notifications.

**Goal:** get alerted where you already work — Slack, Telegram, email, or any webhook — without polling the dashboard.

#### Data model

**NotificationChannel** (`notification_channels`)
- `id`, `user_id`
- `provider` — `slack` | `telegram` | `email` | `webhook` | `ntfy` | `pushover`
- `name` — user-defined label (e.g. "Ops Slack", "Personal Telegram")
- `config_enc` — AES-encrypted JSON; shape varies by provider (see below)
- `enabled` — boolean
- `last_tested_at`, `last_error`
- `created_at`, `updated_at`

**AlertChannelBinding** (`alert_channel_bindings`)
- `id`, `user_id`
- `alert_type` — `long_running` | `cost_limit` | `all`
- `channel_id` — FK → `notification_channels`

#### Provider config shapes (stored in `config_enc`)
| Provider | Fields |
|---|---|
| Slack | `webhook_url` |
| Telegram | `bot_token`, `chat_id` |
| Email | `to`, `smtp_host`, `smtp_port`, `smtp_user`, `smtp_pass`, `from` |
| Webhook (generic) | `url`, `method` (`POST`\|`GET`), `headers` (key-value map), `body_template` |
| ntfy.sh | `topic`, `server` (default `https://ntfy.sh`) |
| Pushover | `app_token`, `user_key` |

#### Work items
- [ ] DB migrations: `notification_channels`, `alert_channel_bindings`
- [ ] `GET /notification-channels` — list channels
- [ ] `POST /notification-channels` — create channel (credentials encrypted at rest)
- [ ] `PATCH /notification-channels/:id` — update config / name / enabled
- [ ] `DELETE /notification-channels/:id` — remove
- [ ] `POST /notification-channels/:id/test` — send a test notification through the channel
- [ ] `GET /notification-channels/:id/bindings` — which alert types are routed here
- [ ] `PUT /notification-channels/:id/bindings` — update bindings
- [ ] Notification dispatcher service (`src/lib/notify.ts`): `sendAlert(alertType, payload, userId)` → looks up enabled channels for user + alert type, calls provider-specific sender
- [ ] Provider senders: `slack.ts` (Incoming Webhook), `telegram.ts` (Bot API `sendMessage`), `email.ts` (nodemailer), `webhook.ts` (fetch + template), `ntfy.ts`, `pushover.ts`
- [ ] Scheduler integration: call dispatcher after evaluating 15A + 15B rules
- [ ] Settings → Notifications tab: channel list, add/edit modal with provider picker, Test button, per-channel binding toggles (which alerts go here)
- [ ] Notification history log: last 50 dispatches per channel (timestamp, alert type, status, error)

#### Implementation notes
- All credentials stored via `encrypt()` — never returned to frontend in plaintext; test endpoint decrypts server-side and fires live
- Deduplication: dispatcher checks `alert_events` — only send when an event transitions to `warn`/`exceeded`/`triggered`, not on every scheduler tick
- Body template for generic webhook: simple `{{variable}}` substitution (`{{instance_name}}`, `{{uptime_hours}}`, `{{cost}}`, `{{limit}}`, `{{provider}}`)
- ntfy.sh is the easiest self-hosted option — good default to highlight in the UI

### Milestone 16 — Multi-User & Roles (RBAC)
Share an opsatlas instance across a team with three role tiers. Each role limits what data is visible and what actions can be taken.

**Goal:** let ops teams, developers, and external stakeholders use the same dashboard without exposing credentials, billing data, or destructive controls to everyone.

#### Roles

| Role | Description |
|---|---|
| **Admin** | Full access. Manages connections, credentials, users, settings, billing, alerts, policies. |
| **Viewer** | Read-only access to instances, DNS, sync history, alerts. Sees cost estimates. Cannot see actual billing amounts, credentials, or connection details. |
| **Observer** | Like Viewer but with all cost and pricing information hidden — suitable for developers or external guests who need to see infrastructure state without financial data. |

#### Permission matrix

| Capability | Admin | Viewer | Observer |
|---|---|---|---|
| View instances / DNS | ✓ | ✓ | ✓ |
| View estimated cost | ✓ | ✓ | — |
| View actual billing | ✓ | — | — |
| Trigger sync | ✓ | ✓ | — |
| Add / edit connections | ✓ | — | — |
| View connection credentials | ✓ | — | — |
| Manage auto-update policies | ✓ | — | — |
| Manage alert rules | ✓ | — | — |
| Manage cost limits | ✓ | — | — |
| Manage users | ✓ | — | — |
| Settings (SSO, config, notifications) | ✓ | — | — |
| Star favorites | ✓ | ✓ | ✓ |

#### Data model

**User** (existing) — add `role` column: `admin` | `viewer` | `observer`; add `invited_by` (FK → users, nullable)

**UserInvite** (`user_invites`)
- `id`, `invited_by` (FK → users), `email`, `role`
- `token` — secure random token sent in invite link
- `accepted_at`, `expires_at`
- `created_at`

#### Work items
- [ ] DB migration: add `role` to `users`; create `user_invites` table
- [ ] Migrate existing users to `admin` role
- [ ] `GET /admin/users` — list all users with roles (admin only)
- [ ] `PATCH /admin/users/:id` — change role or deactivate (admin only)
- [ ] `DELETE /admin/users/:id` — remove user and their data (admin only)
- [ ] `POST /admin/invites` — generate invite link for email + role (admin only)
- [ ] `GET /auth/invite/:token` — validate token, return email + role for the accept form
- [ ] `POST /auth/invite/:token/accept` — set password and activate account
- [ ] `requireRole(role)` middleware — returns 403 if `req.user.role` is insufficient; applied to all mutating and sensitive routes
- [ ] `requireRole('admin')` on: connections CRUD, settings, billing refresh, user management, alert rule edits, cost limit edits, policy edits
- [ ] `requireRole('viewer')` on: sync trigger, alert rule reads, billing actuals reads
- [ ] Cost / billing fields stripped from API responses for Observer role: `estimated_hourly_cost`, `estimated_monthly_cost`, billing actuals endpoints return 403
- [ ] Settings → Users tab (admin only): user list with role badges, Invite button, role change dropdown, Remove button
- [ ] Invite flow UI: `/auth/invite/[token]` page — shows invited email + role, password fields, creates account on submit
- [ ] Role badge visible on the user avatar / nav (so users know their own role)
- [ ] SSO-provisioned users default to `viewer` role (configurable via Settings → SSO)

#### Implementation notes
- Role stored on the JWT payload (`role` claim) so middleware can check it without a DB round-trip per request
- Re-issue token on role change so the old token loses its elevated claims within its remaining TTL (max 24 h, per security hardening)
- Observer cost stripping: done in the API response layer, not the DB query, to avoid duplicating queries
- Invite tokens: `crypto.randomBytes(32).toString('hex')`, expire in 7 days, single-use

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

### Milestone 17 — In-App Self-Update
Update the opsatlas application to a new release directly from the web UI — no SSH, no CLI — exactly like Coolify's "Upgrade Available → Upgrade Now" flow.

**Goal:** admins see a version badge in the nav, get notified when a new release is available, and can upgrade with a single button click. The UI streams live progress and shows success or rollback options.

#### UX flow (mirrors the Coolify pattern)

1. Nav shows current version + a red badge when an update is available
2. Clicking the badge opens an **Upgrade modal**: current version → new version, caution note ("opsatlas will restart for ~30 seconds"), changelog excerpt from GitHub
3. Admin clicks **Upgrade Now** → backend streams live log output to the modal terminal
4. On completion the modal shows "Up to date ✓" and prompts a page reload
5. On failure: error log visible in-modal + **Rollback** button

#### Data model / state

No DB table. A single in-memory `UpdateJob` singleton writes its state to `/tmp/opsatlas-update.json` so it survives the Node restart mid-upgrade.

**UpdateJob**
- `status` — `idle` | `checking` | `pulling` | `restarting` | `migrating` | `done` | `error`
- `current_version` — read from `package.json` at startup
- `latest_version` — fetched from GitHub releases API
- `started_at`, `finished_at`
- `log` — ring buffer of output lines (last 200)
- `error` — error string if failed

#### Work items
- [ ] Embed `APP_VERSION` from `package.json` into backend at startup
- [ ] `GET /admin/update/check` — query GitHub releases API for latest tag; diff against `APP_VERSION`; return `{ current, latest, update_available, changelog_url, changelog_excerpt }`; cache response 5 min with ETag
- [ ] `POST /admin/update/start` — admin only; validates Docker socket is reachable; tags current images as `:rollback`; spawns detached update script; returns job id
- [ ] `GET /admin/update/status` — returns `UpdateJob` state + last N log lines; frontend polls at 2 s intervals while status is not `done`/`error`
- [ ] `GET /admin/update/stream` — SSE endpoint streaming live stdout/stderr from the update script
- [ ] `POST /admin/update/rollback` — admin only; runs `docker compose up -d` with the `:rollback` tagged images
- [ ] Update script (`scripts/self-update.sh`):
  ```
  docker compose pull
  docker compose up -d
  docker compose exec -T backend npm run migrate
  ```
  Writes step markers to `/tmp/opsatlas-update.json` throughout
- [ ] `GET /health` extended with `version` field so frontend detects when new backend is live
- [ ] **Nav version badge**: small muted version string in the sidebar/footer; turns amber with "↑ Update available" dot when newer version detected; polls `check` every 6 h
- [ ] **Upgrade modal** (Settings → About or triggered from nav badge):
  - Current → new version header
  - Caution warning box ("opsatlas will be unavailable for ~30 seconds during restart")
  - Changelog excerpt with link to full release notes
  - **Upgrade Now** button → opens live log terminal in-modal
  - Scrolling monospace log output streamed via SSE
  - Success state: "✓ Updated to vX.Y.Z" + **Reload** button
  - Error state: log + **Rollback** button
- [ ] Settings → About tab: version info, last checked timestamp, manual "Check now" button

#### Implementation notes
- Detached child process: `spawn('bash', ['scripts/self-update.sh'], { detached: true, stdio: 'pipe' })` — outlives the Node process during restart
- `/tmp/opsatlas-update.json` is the source of truth during the restart gap — new process reads it on boot and resumes SSE stream from where it left off
- Docker socket: backend container must mount `/var/run/docker.sock`; document in `DEPLOYMENT.md` and example `docker-compose.yml`
- Version tagging before pull: `docker tag opsatlas-backend:latest opsatlas-backend:rollback` gives rollback a concrete target
- GitHub API rate limit: 60 req/h unauthenticated — 6 h polling cadence keeps well under the limit
- Air-gap installs: if GitHub is unreachable, `check` returns `{ reachable: false }` and the modal shows a manual "I have version X.Y.Z" input instead

### Milestone 18 — Real-Time Live Updates (SSE)
Push live data changes to the browser as they happen — no manual refresh, no polling — similar to how Coolify streams build logs and BorgBase shows backup progress in real time.

**Goal:** the dashboard, instances list, sync status, and alerts update themselves the moment the backend has new data, giving an always-current view of the fleet.

#### Transport

**Server-Sent Events (SSE)** — simpler than WebSocket, works through proxies, auto-reconnects natively. One persistent connection per browser tab on `GET /events`.

#### Event types

| Event | Payload | Triggered by |
|---|---|---|
| `sync.started` | `{ connection_id, run_id }` | `POST /sync/:id` |
| `sync.finished` | `{ connection_id, run_id, status, error? }` | sync job completion |
| `instance.updated` | `{ id, status, last_seen_at }` | sync upsert batch complete |
| `billing.refreshed` | `{ period, connection_id, rows }` | billing refresh done |
| `alert.triggered` | `{ type, instance_id?, limit_id?, message }` | alert evaluator |
| `alert.resolved` | `{ type, instance_id?, limit_id? }` | alert cleared |
| `ping` | `{ ts }` | every 30 s — keeps connection alive through proxies |

#### Data model

No DB table. Events flow through an **in-process event bus** () fanned out to all connected SSE clients for that user. No Redis required for single-node deployments.

#### Work items
- [ ] `src/lib/eventBus.ts` — typed `EventEmitter` singleton; `emit(userId, event)` + `subscribe(userId, handler)` + `unsubscribe`
- [ ] `GET /events` — SSE endpoint; authenticates via `?token=<jwt>` query param (native `EventSource` cannot set headers); streams events for the authenticated user; sends `ping` every 30 s; cleans up handlers on disconnect
- [ ] Emit `sync.started` / `sync.finished` from `routes/sync.ts`
- [ ] Emit `instance.updated` from sync route after each full sync run (one event per run, not per row)
- [ ] Emit `billing.refreshed` from `billing-refresh.ts` after upsert loop
- [ ] Emit `alert.triggered` / `alert.resolved` from the alert scheduler (Milestones 15A + 15B)
- [ ] Frontend `src/lib/useEvents.ts` hook — wraps `EventSource`, reconnects with exponential backoff, dispatches typed events to registered handlers
- [ ] Dashboard: subscribe to `instance.updated`, `sync.finished`, `billing.refreshed` → auto-refetch affected data
- [ ] Instances page: `sync.finished` → refetch list; `instance.updated` → patch changed row in-place without full reload
- [ ] Sync history: `sync.started` / `sync.finished` → append / update run row live
- [ ] Alert list: `alert.triggered` / `alert.resolved` → add/remove from list; notification bell badge updates
- [ ] Live indicator: pulsing green dot in the nav while SSE connection is open; grey when disconnected

#### Implementation notes
- SSE auth via query param: `new EventSource('/events?token=' + token)` — validated identically to the `Authorization: Bearer` middleware
- Fan-out: connected responses stored in `Map<userId, Set<Response>>`; `emit(userId, e)` iterates the set and writes `data: ...` to each
- Missed events: assign `id:` to each event; browser sends `Last-Event-ID` on reconnect; backend replays from an in-memory ring buffer (last 50 events per user)
- Nginx / proxy: set `X-Accel-Buffering: no` and `Cache-Control: no-cache` on the SSE response to prevent buffering

---

## 4. API Reference

### Auth
- `POST /auth/register`
- `POST /auth/login`

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

### Live Updates / SSE *(Milestone 18)*
- `GET /events`

### Self-Update *(Milestone 17)*
- `GET /admin/update/check`
- `POST /admin/update/start`
- `GET /admin/update/status`
- `GET /admin/update/stream` *(SSE)*
- `POST /admin/update/rollback`

### Users & Roles *(Milestone 16)*
- `GET /admin/users`
- `PATCH /admin/users/:id`
- `DELETE /admin/users/:id`
- `POST /admin/invites`
- `GET /auth/invite/:token`
- `POST /auth/invite/:token/accept`

### Notification Channels *(Milestone 15C)*
- `GET /notification-channels`
- `POST /notification-channels`
- `PATCH /notification-channels/:id`
- `DELETE /notification-channels/:id`
- `POST /notification-channels/:id/test`
- `PUT /notification-channels/:id/bindings`

### Cost Limits *(Milestone 15B)*
- `GET /cost-limits`
- `POST /cost-limits`
- `PATCH /cost-limits/:id`
- `DELETE /cost-limits/:id`
- `GET /cost-limits/status`

### Long-Running Alerts *(Milestone 15A)*
- `GET /alerts/long-running/rule`
- `PUT /alerts/long-running/rule`
- `GET /alerts/long-running/triggered`
- `GET /alerts/long-running/exclusions`
- `POST /alerts/long-running/exclusions`
- `DELETE /alerts/long-running/exclusions/:instance_id`

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
- [ ] AWS (1 account)

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
- RBAC / multi-user / teams
- Alerts / notifications / Slack
- Instance control (start / stop)
- Port scanning
- Billing API in main nav (implemented, deferred)

---

## 6. Future Extensions

- **Providers:** Azure, Hetzner Robot (dedicated), DigitalOcean, AWS EC2
- **Orchestration:** Kubernetes (pods / nodes), RDS, Cloud Spanner
- **DNS:** Route 53 + Cloud DNS (Milestone 11 Phase B/C), reverse DNS lookup
- **Billing:** Enable billing nav link, scheduled billing refresh, cost anomaly alerts
- **Alerting:** Slack / email alerts on sync errors or port exposure
- **Security:** Port scanning, compliance scanning (PCI, SOC2, CIS)
- **Organization:** smart tag suggestions from provider labels, team workspaces (multiple orgs)
- **Connection wizard:** step-by-step guided flow for adding providers
