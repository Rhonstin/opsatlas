# opsatlas — Детальний план робіт (ROADMAP_DETAIL)

Покрокові інструкції для невиконаних пунктів `ROADMAP.MD`. Кожен блок: **навіщо**,
**файли**, **кроки**, **критерії приймання**, **тести**. Позначки складності: **S** (≤пів дня),
**M** (1–2 дні), **L** (3+ днів).

Поточний стан: Milestones 1–17 (Stage A+B) виконані. Tier 1–3 (1.1–1.5, 2.1, 3.1–3.3) виконані.
Нижче — те, що лишилось, у порядку рекомендованого виконання. Перед роботою: `cd backend && npm ci`, тести — `npm test`
(потрібен Postgres: `docker run -d --rm --name pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=opsatlas_test -p 5433:5432 postgres`,
далі `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/opsatlas_test npm test`).

Конвенції коду (дотримуватись): RBAC — мутації під `requireAdmin`; усі зовнішні HTTP — через
`lib/http.ts::fetchWithTimeout`; instance-upsert лише через `lib/instances.ts`; sync лише через
`lib/sync-runner.ts` / `lib/dns-sync.ts`; коміти без co-author трейлерів.

---

## Виконано (Tier 1–3 + CI/CD)

| # | Задача | Статус | Тести |
|---|--------|--------|-------|
| 1.1 | Структуроване логування (pino) | ✅ | `test/logger.test.ts` |
| 1.2 | Retry/backoff для провайдерів | ✅ | `test/retry.test.ts` (7 tests) |
| 1.3 | billing-refresh транзакційність | ✅ | `test/billing.test.ts` (6 tests) |
| 1.4 | exchange-rates lastAttemptAt/fetchedAt | ✅ | `test/exchange-rates.test.ts` (9 tests) |
| 1.5 | Per-project sync status UI | ✅ | — (frontend-only) |
| 2.1 | httpOnly-cookie сесії | ✅ | `test/auth-cookie.test.ts` (6 tests) |
| 3.1 | Favorites | ✅ | `test/favorites.test.ts` (6 tests) |
| 3.2 | Tags | ✅ | `test/tags.test.ts` (10 tests) |
| 3.3 | Scheduled billing refresh | ✅ | `test/billing.test.ts` |
| — | CI/CD (GitHub Actions) | ✅ | `.github/workflows/ci.yml` |
| — | Тестове покриття (77 tests) | ✅ | `npm test` — всі зелені |

---

## ТIER 1 — Технічний борг надійності (мале, висока цінність) ✅ DONE

### 1.1 Структуроване логування (pino) — **M** ✅
**Навіщо:** зараз ~10 файлів пишуть `console.log/warn/error` без часу, рівня, кореляції.
Неможливо зв'язати логи одного sync-прогону чи запиту.

**Файли:** новий `backend/src/lib/logger.ts`; заміна `console.*` у `scheduler.ts`,
`lib/sync-runner.ts`, `lib/dns-sync.ts`, `lib/billing-refresh.ts`, `lib/exchange-rates.ts`,
`routes/sync.ts`, `routes/dns-sync.ts`, `index.ts`, `aws/*`, `gcp/*`; middleware у `app.ts`.

**Кроки:**
1. `npm i pino pino-http`. У `lib/logger.ts` експортувати `export const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', ...(NODE_ENV==='test' ? { level: 'silent' } : {}) })`.
2. У `app.ts` підключити `pino-http` middleware з генерацією `req.id` (UUID) → кожен запит має `requestId`.
3. Завести дочірні логери в sync: `const log = logger.child({ runId, connectionId, provider })`; замінити `console.*` на `log.info/warn/error`.
4. Прибрати чутливі поля з логів (жодних токенів/credentials — логувати лише `connection.id`/`name`).
5. У `package.json` додати `"LOG_LEVEL"` приклад у `.env.example`.

**Приймання:** при ручному sync у логах видно `{requestId, connectionId, provider, level, time}`;
у тестах логи мовчазні (`level: silent`); жоден лог не містить розшифрованих credentials.

**Тести:** `test/logger.test.ts` — перевірити, що `logger` ініціалізується silent у NODE_ENV=test
і що redaction не пропускає ключ `credentials_enc`/`token` (можна через `pino`'s `redact`).

---

### 1.2 Retry/backoff для викликів провайдерів — **M** ✅
**Навіжно:** транзієнтні 429/500/503 від GCP/AWS/Hetzner/Cloudflare валять весь sync конекшена.
Зараз retry є лише на рівні політики (`scheduler.ts` exponential backoff між прогонами), не на рівні виклику.

**Файли:** новий `backend/src/lib/retry.ts`; точки застосування — `lib/http.ts::fetchWithTimeout`
(або обгортка над ним), `hetzner/sync.ts`, `hetzner/billing.ts`, `coolify/sync.ts`,
`dns/cloudflare.ts`, `gcp/cloudsql.ts`. AWS SDK і `@google-cloud/*` мають власний retry — НЕ чіпати.

**Кроки:**
1. `lib/retry.ts`: `export async function withRetry<T>(fn: () => Promise<T>, opts?: { retries?: number; baseMs?: number; retryOn?: (e) => boolean }): Promise<T>` — експоненційна затримка `baseMs * 2^n` + джиттер, дефолт 3 спроби.
2. Додати `fetchWithRetry(url, init, { timeoutMs, retries })` у `lib/http.ts`, що обгортає `fetchWithTimeout` через `withRetry`; retry лише на мережевих помилках та статусах 429/500/502/503/504, **не** на 4xx (крім 429).
3. Замінити прямі `fetchWithTimeout` у перелічених провайдер-модулях на `fetchWithRetry`.
4. Поважати `Retry-After` заголовок, якщо є.

**Приймання:** мок-сервер, що віддає 503 двічі і потім 200, успішно завершує sync; 401/403 не ретраяться.

**Тести:** `test/retry.test.ts` — `withRetry` робить N спроб і кидає після вичерпання; `fetchWithRetry`
ретраїть 503, не ретраїть 400 (мок `lib/http`/глобальний fetch як у `test/cloudflare.test.ts`).

---

### 1.3 billing-refresh: транзакційність + звіт «N/M ok» — **S** ✅
**Навіщо:** зараз якщо провайдер впав посеред upsert'ів, частина рядків лишається (змішаний стан),
а агрегований звіт не розрізняє часткового успіху.

**Файли:** `backend/src/lib/billing-refresh.ts`, споживач `routes/billing.ts`, `scheduler.ts`.

**Кроки:**
1. Загорнути upsert рядків ОДНОГО конекшена у `db.transaction(async (trx) => { ... })` — або всі рядки конекшена, або жодного.
2. У `BillingRefreshRowResult` додати агрегат: повертати `{ ok, skipped, errored, total }` поряд з масивом.
3. У `scheduler.ts` логувати `"billing: 2/3 connections ok (1 errored: <names>)"`.
4. UI billing-вкладки (`frontend/src/app/dashboard/settings/BillingTab.tsx`) — у toast показувати «N/M ok» замість лише errors-count.

**Приймання:** якщо у конекшена 5 рядків і 3-й кидає — у БД 0 рядків цього конекшена за період (rollback),
інші конекшени не зачеплені; toast показує точний розподіл.

**Тести:** `test/billing.test.ts` (доповнити) — мок одного провайдера, що кидає на середині; перевірити
відсутність часткових рядків + форму звіту.

---

### 1.4 exchange-rates: розділити `lastAttemptAt` і `fetchedAt` — **S** ✅
**Навіщо:** при fallback `fetchedAt` перезаписується хаком — справжній вік курсу губиться (видно лише в console.warn).

**Файли:** `backend/src/lib/exchange-rates.ts`.

**Кроки:**
1. У persisted-структуру `app_settings` (`fx_rate:FROM:TO`) додати поле `lastAttemptAt` окремо від `fetchedAt`.
2. При fallback: НЕ чіпати `fetchedAt` (справжній вік); зберігати `lastAttemptAt = now` і робити повторну спробу API не частіше, ніж раз на годину, базуючись на `lastAttemptAt`.
3. Логувати справжній вік: `using rate fetched Nh ago`.

**Приймання:** після кількох послідовних падінь API вік курсу в логах відображає реальний `fetchedAt`, не «1 год».

**Тести:** `test/exchange-rates.test.ts` — мок `lib/http`, що завжди 503; перевірити, що `fetchedAt`
persisted-значення не змінюється між спробами, а `lastAttemptAt` оновлюється.

---

### 1.5 Per-project / per-connection статус sync у UI — **S** ✅
**Навіщо:** `routes/sync.ts` повертає `error_log`, а `projects_or_accounts` має `last_error`/`last_sync_at`,
але UI показує лише загальний статус конекшена.

**Файли:** `frontend/src/app/dashboard/settings/ConnectionsTab.tsx`, можливо новий
`GET /connections/:id/projects` уже віддає поля; перевірити `routes/connections.ts`.

**Кроки:**
1. У рядку конекшена показувати кількість успішних/проблемних проєктів (для GCP).
2. Tooltip/expander з `last_error` по кожному проєкту.
3. Бейдж «partial» коли `last_sync_at` свіжий, але є проєкти з `last_error`.

**Приймання:** GCP-конекшен з 1 зламаним проєктом із 3 показує «2/3 synced» + помилку по проблемному.

---

## ТIER 2 — Безпека сесій ✅ DONE

### 2.1 httpOnly-cookie сесії замість localStorage токена — **L** ✅
**Навіщо:** зараз JWT і роль у `localStorage` (XSS може вкрасти токен; роль редагується в DevTools —
сервер це не приймає, але клієнтський UX вводить в оману). Це остання велика діра з первинного аудиту.

**Файли (backend):** `routes/auth.ts` (login/register/MFA/OAuth callbacks), `middleware/auth.ts`,
`app.ts` (cookie-parser, CORS credentials).
**Файли (frontend):** `lib/auth.ts`, `lib/api.ts`, `middleware.ts`, `app/login/page.tsx`,
`app/oauth/callback/page.tsx`, `app/dashboard/layout.tsx`.

**Кроки:**
1. Backend: `npm i cookie-parser`. На успішний логін/реєстрацію/MFA/OAuth — `res.cookie('opsatlas_token', jwt, { httpOnly: true, secure: NODE_ENV==='production', sameSite: 'lax', maxAge: 7d })` замість віддавання токена в тілі.
2. `middleware/auth.ts`: читати токен з cookie (`req.cookies.opsatlas_token`) із фолбеком на `Authorization` header (для CLI/тестів).
3. `app.ts`: `app.use(cookieParser())`; CORS — `credentials: true`, `origin` точний (не `*`).
4. Додати `POST /auth/logout` — чистить cookie.
5. Frontend `lib/api.ts`: `fetch(..., { credentials: 'include' })`; прибрати `Authorization` header і читання токена з localStorage.
6. `lib/auth.ts`: лишити лише не-секретний профіль (email/role) у пам'яті/`localStorage` ВИКЛЮЧНО для UI-рендера; справжній gate — cookie + middleware. Залишити marker-cookie логіку (вже є) або замінити на наявність `opsatlas_token`.
7. `middleware.ts` (Next): перевіряти наявність cookie сесії (вже зроблено через `opsatlas_session` — звести до одного cookie).
8. Оновити `test/rbac.test.ts` — supertest з `Authorization` header лишається валідним (фолбек), додати тест cookie-флоу.

**Приймання:** після логіну в DevTools немає JWT у localStorage; запити несуть httpOnly cookie;
`/auth/logout` розлогінює; XSS не дістає токен. RBAC-тести (header-фолбек) проходять.

**Ризик:** змінює auth-флоу — робити окремою гілкою, ретельно перевірити OAuth-callback і MFA.

---

## ТIER 3 — Фічі з частковою основою ✅ DONE

### 3.1 Favorites (Milestone 10A) — **M** ✅ *(таблиця `favorite_instances` вже є, роут/UI — ні)*
**Файли (backend):** новий `routes/favorites.ts`; реєстрація в `app.ts`; розширити `routes/instances.ts`
(параметр `?favorite=true`, який згаданий у ROADMAP API, але не реалізований).
**Файли (frontend):** `app/dashboard/instances/page.tsx`, `InstanceDrawer.tsx`, `app/dashboard/page.tsx`,
`lib/api.ts`.

**Кроки:**
1. Backend роут: `GET /favorites` (instance_id список юзера), `POST /instances/:id/favorite`, `DELETE /instances/:id/favorite`. Перевірка власності інстансу через join `cloud_connections.user_id`. Viewer — дозволити (персональні закладки) або лише admin — узгодити; за замовчуванням дозволити обом для власних видимих інстансів.
2. `routes/instances.ts`: `?favorite=true` → join `favorite_instances` за `req.userId`.
3. Frontend: іконка-зірка в таблиці і в drawer; оптимістичний апдейт; фільтр «Favorites only»; віджет на дашборді.
4. `lib/api.ts`: `getFavorites`, `addFavorite`, `removeFavorite`.

**Приймання:** зірка перемикається й персистить між сесіями; фільтр показує лише обране;
два юзери мають незалежні закладки.

**Тести:** `test/favorites.test.ts` — favorite/unfavorite, ізоляція між юзерами, 404 на чужий інстанс.

---

### 3.2 Tags (Milestone 10B) — **L** ✅ *(нічого немає — повний стек)*
**Файли (backend):** міграція `20240026_create_tags.ts` (`tags`, `instance_tags`); `routes/tags.ts`; `app.ts`;
розширити `routes/instances.ts` (`?tags=` фільтр).
**Файли (frontend):** новий tag-менеджер, теги в таблиці/drawer, bulk-дії.

**Кроки:**
1. Міграція: `tags(id, user_id, name, color, timestamps)` UNIQUE(user_id,name); `instance_tags(instance_id, tag_id)` PK(instance_id, tag_id), FK CASCADE.
2. `routes/tags.ts`: CRUD тегів (під `requireAdmin` для create/edit/delete), `POST /instances/:id/tags`, `DELETE /instances/:id/tags/:tagId`.
3. `routes/instances.ts`: `?tags=a,b` → інстанси, що мають усі/будь-який тег (визначити семантику; рекоменд. «будь-який»).
4. Frontend: сторінка керування тегами; кольорові чипи в таблиці; multi-select bulk-призначення; фільтр.
5. (Опційно) імпорт provider-labels у теги — окремий під-етап.

**Приймання:** створення/редагування/видалення тегів; призначення кількох; фільтр за тегами; кольори; bulk.

**Тести:** `test/tags.test.ts` — CRUD, унікальність на юзера, фільтр інстансів, RBAC (viewer не створює).

---

### 3.3 Scheduled billing refresh (Milestone 14) — **S** ✅ *(імовірно вже працює — верифікувати)*
`scheduler.ts::runPolicy` вже викликає `runBillingForConnections` коли `policy.sync_cost`.
**Кроки:** написати інтеграційний тест, що політика з `sync_cost=true` upsertить `billing_actuals`
(мок провайдер-fetch), і поставити галочку в ROADMAP. Якщо тест зелений — пункт закрити.

---

## ТIER 4 — Розширення покриття провайдерів (велике)

### 4.1 Multi-account AWS (Milestone 5) + Hetzner projects (5B) — **M**
**Навіщо:** зараз 1 акаунт/проєкт на конекшен.
**Кроки:** дозволити кілька конекшенів одного провайдера (вже технічно можливо — перевірити UI-фільтри
за акаунтом); додати per-account фільтр на сторінці інстансів; `region selection per connection`
у credentials JSON (AWS) — зберігати масив регіонів, поважати в `aws/ec2.ts::listAwsInstances`
замість завжди `DescribeRegions`.

**Приймання:** 2 AWS-конекшени показуються окремо; фільтр за акаунтом; обмеження регіонів працює.

---

### 4.2 GCP: регіональні ціни дисків + preemptible/SPOT (M17 Stage B відкладене) — **M**
**Навіщо:** диски рахуються за хардкодом us-central1 (`gcp/sync.ts:64-83`); preemptible не врахований.
**Файли:** `gcp/billing.ts` (каталог SKU), `gcp/sync.ts`, `gcp/cost.ts`.
**Кроки:**
1. Розширити `refreshBillingCache` — тягнути disk-SKU (Persistent Disk родини) з Cloud Billing Catalog, кешувати з регіоном у `billing_price_cache` (додати колонку `region` якщо нема — міграція).
2. У `gcp/sync.ts` брати ставку диска з кешу за `(diskKind, region)`, фолбек на поточні константи.
3. Витягти `scheduling.preemptible`/`provisioningModel === 'SPOT'` у top-level поле raw_payload або нову колонку `is_spot` (міграція) — і застосувати spot-ставку (з каталогу, якщо доступна).

**Приймання:** інстанси в europe/asia мають коректнішу вартість диска; spot-VM позначені й дешевші.

---

### 4.3 AWS RDS / EBS / Elastic IP (M17 Stage C) — **L**
**Файли:** новий `aws/rds.ts`, `aws/ebs.ts` (або розширити `ec2.ts`); `lib/sync-runner.ts` (AWS гілка).
**Кроки:** `DescribeDBInstances` (RDS) → `resource_type: 'rds'`; `DescribeVolumes` (EBS) →
окремий resource_type або в raw_payload вартості; `DescribeAddresses` (EIP) — невживані EIP коштують.
Ціни — Pricing API (розширити `aws/pricing.ts`). Додати `resource_type` значення в enum/UI-фільтр.
**Приймання:** RDS-інстанси у таблиці; неприкріплені EIP у костах; EBS у вартості.

---

### 4.4 GCP GKE / unattached disks / LB / static IP / network egress / CUD (M17 Stage C) — **L/XL**
Поетапно, кожне — окремий sub-resource у `gcp/`. Network egress і committed-use discounts —
складне моделювання; робити останніми. Зафіксувати у raw_payload + `resource_type`.

---

### 4.5 DNS Phase B/C/D (Milestone 11) — **M кожен**
- **Route 53** (`dns/route53.ts`) — reuse AWS credentials; `ListHostedZones` + `ListResourceRecordSets` (пагінація!); інтегрувати в `lib/dns-sync.ts` (додати гілку провайдера).
- **Google Cloud DNS** (`dns/gcpdns.ts`) — reuse GCP service account; `managedZones.list` + `resourceRecordSets.list`.
- **Manual** — імпорт zone-file/CSV у `dns_records` без зовнішнього API.
**Спільне:** `lib/dns-sync.ts::syncDnsConnection` має `if (provider === 'cloudflare')` — додати гілки;
stale-cleanup і пагінація вже є шаблоном. Тести на пагінацію кожного.

---

## ТIER 5 — Нові підсистеми

### 5.1 Port Scanning & Service Discovery (Milestone 12) — **L**
**Навіщо:** виявляти небезпечні відкриті порти (БД, RDP) через firewall/security-group метадані.
**Файли:** міграції `open_ports`, `port_alerts` (схема вже описана в ROADMAP data-model); новий
`routes/ports.ts`, `routes/port-alerts.ts`; `gcp/firewall.ts`, `aws/security-groups.ts`; UI-сторінка.
**Кроки:**
1. Міграції `open_ports(instance_id, port, protocol, service_name, risk_level, last_seen_at)` + `port_alerts(user_id, rule_name, trigger_port, trigger_service, enabled, last_triggered_at)`.
2. GCP: firewall rules з Compute API, матчити за network tags інстансу. AWS: security groups з EC2 API за SG інстансу.
3. Статичний мапінг порт→сервіс (5432→PostgreSQL, 3306→MySQL, 3389→RDP, 22→SSH-skip) + risk_level.
4. `POST /port-scan/:instance_id`, `GET /ports`, `GET /instances/:id/ports`, CRUD `/port-alerts`.
5. Stale-cleanup портів (той самий патерн `last_seen_at`).
6. UI: колонка Open Ports, сторінка Port Scan, дашборд-картка «N exposed».
**Приймання:** інстанс з відкритим 5432 на 0.0.0.0/0 позначений high-risk; алерт спрацьовує.
**Тести:** мапінг порт→сервіс/risk; матчинг firewall↔instance; RBAC.

---

## Наскрізні правила приймання (для будь-якого пункту)
- `npx tsc --noEmit` (backend і frontend) — без помилок.
- Нові ендпоінти-мутації — під `requireAdmin`; ізоляція по `user_id`.
- Нові зовнішні API — пагінація + `fetchWithTimeout`(+retry); stale-cleanup для будь-яких синхронізованих сутностей.
- Кожен пункт — інтеграційний тест на живому Postgres; `npm test` зелений.
- Оновити `ROADMAP.MD` (галочка) і `API Reference` при нових ендпоінтах.
- Коміт від імені користувача, без co-author.

## Рекомендований порядок

✅ ~~1.3 → 1.4 → 1.2 → 1.1 → 1.5 (швидкі надійність/UX), далі 3.3 (верифікація), 3.1 (favorites),
потім 2.1 (httpOnly — окрема гілка), 3.2 (tags)~~ — ВСЕ ВИКОНАНО.

Наступні: Tier 4 (4.1 → 4.2 → 4.5а → 4.5б → 4.5в → 4.3 → 4.4) → Tier 5 (5.1).
