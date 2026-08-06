# VaravuSelavu — Roadmap

> **Single source of truth for *what* we are building, *when*, and *what's already done*.**
> For *why* (architecture, locked decisions, data model, deploy runbook) see **[`DECISIONS.md`](./DECISIONS.md)**.
> For the canonical release history (per-version notes) see **[`CHANGELOG.md`](./CHANGELOG.md)**.

| | |
|---|---|
| **Current release** | **v1.5.0** (2026-08-03) — PWA update prompt with version-aware changelog |
| **Next release (target)** | v1.6.0 — Core Stability sweep (Phase 1) · PR 1 (tests + CI) merged; PR 2 (backup hardening) done locally, ready for review |
| **Long-term vision** | Self-hosted personal finance OS (expenses + budgets + investments + loans + AI) |
| **Status legend** | ✅ Shipped &nbsp; · &nbsp; 🔄 Partial / in progress &nbsp; · &nbsp; ⏳ Not started &nbsp; · &nbsp; ❌ Deferred / cut |

---

## How to read this doc

Each item below is one **shippable feature** (or a tight group of related changes).
It carries:

- **Status** — what's true *right now* on `main`.
- **Version** — the release that shipped it (if shipped). Links to `CHANGELOG.md` for detail.
- **Notes** — the specific design choice, the file/endpoint, or what the "partial" part is.

Phases are ordered. Within a phase, items are roughly sequenced. We work a phase to
"done enough to ship" before moving on, but security/stability items (Phase 1) are
exceptions — they can be cherry-picked into any release.

---

## At-a-glance status

| Phase | Theme | Target version | Status |
|---|---|---|---|
| 1 | Core Stability | v1.6.0 | 🔄 ~95% — PR 1 (tests + CI) **merged to `main`** (commits `91b347d`+`e20792f`+`85134ca`+`840747b`, merge `7ae8bc8`, PR #1). PR 2 (backup hardening) **done locally on `phase1/pr2-backup-hardening`** (commit `29e9f7b`); ready for review. PR 3 (security headers) next. |
| 2 | Budget Management | v1.7.0 | 🔄 ~25% (monthly budget + progress shipped; rest is new) |
| 3 | Better Finance Tracking | v1.8.0 | 🔄 ~30% (filters, transfers, archive done) |
| 4 | Advanced Reporting | v1.9.0 | 🔄 ~45% (lifetime tiles, daily-spends, top categories done; timeline + heatmap added) |
| 5 | Investment Tracker | v2.0.0 | 🔄 ~20% (MF/FD/RD accounts exist; no market data, no perf metrics) |
| 6 | Loan Management | v2.1.0 | 🔄 ~35% (credit cards done; loans + subscriptions new) |
| 7 | AI Features | v2.2.0 | ⏳ 0% |
| 8 | Family Features | v2.3.0 | 🔄 ~15% (2-user model exists; sharing, per-person compare, splitter added) |
| 9 | Premium Experience | v3.0.0 | 🔄 ~25% (PWA, dark mode, JSON export, changelog page done) |
| — | Not yet phased | v3.x+ | ⏳ 11 items parked (PIN recovery, WebAuthn, wishlist, multi-currency, bank OAuth, tax helper, etc.) |
| — | Stretch goals | v4.0+ | ⏳ 0% |

---

## Phase 1 — Core Stability · target v1.6.0

Make the current app production-grade before piling on features. Hardening only;
no new surface area.

### 1. Session Management — 🔄 partial

- **What's done (v1.0.0)**:
  - httpOnly, SameSite=Lax session cookie carrying `userId` (signed via the cookie itself, not a server-side token).
  - 30-day `Max-Age` expiry.
  - `POST /api/auth/logout` clears the cookie (`server/utils/auth.ts`).
- **What's missing**:
  - Server-side session table → no way to enumerate, revoke, or expire individual sessions.
  - "Log out other devices" UI.
  - "Force re-login on suspicious activity" hook (would consume the audit log from §48).
- **Proposed shape**: new `sessions` table (`id` (random token), `user_id`, `user_agent`, `ip`, `created_at`, `last_seen_at`, `expires_at`, `revoked_at`); cookie stores the token, server validates on every request; admin UI under Settings → Active sessions.

### 2. Security Hardening — 🔄 partial

| Sub-item | Status | Where |
|---|---|---|
| CSRF protection (SameSite=Lax is the current defense) | 🔄 partial | `setSessionUserId` in `server/utils/auth.ts` |
| Content Security Policy (CSP) | ⏳ not started | — |
| HSTS header | ⏳ not started | Note: app is behind Tailscale Funnel, which already does HSTS — but header from the app is still belt-and-suspenders |
| Secure cookie flag (HTTPS-only) | ✅ done | `setSessionUserId` sets `secure` when `getRequestProtocol(event) === 'https'` |
| HttpOnly + SameSite=Lax cookie | ✅ done | `server/utils/auth.ts` |
| Login rate limit (per-IP throttle + per-IP block + per-account cooldown) | ✅ done (v1.3.0) | `server/utils/rateLimit.ts`, 20/min throttle, 5 fail/15min block, progressive cooldown 30s → 1m → 5m |
| Login lockout UI with live countdown | ✅ done (v1.3.0) | `pages/login.vue` reads `data.retryAfter` |
| Fail2Ban integration (journal-based) | ✅ done (v1.3.0) | `fail2ban/budget-auth.conf`, `fail2ban/jail-budget-auth.conf`, deployed by `scripts/deploy.sh` |
| Generic security headers (X-Content-Type-Options, Referrer-Policy, X-Frame-Options) | ⏳ not started | Add via Nitro middleware |
| **PIN recovery flow** (replaces the "nuke the DB" workaround in §8 Q10) | ⏳ not started | Forgot-PIN page → email/PGP challenge or security-question reset, gated on user identity check |
| **WebAuthn / biometric login** (replaces PIN on supported devices) | ⏳ not started | Passkey registration under Settings; login offers "use Face ID" when a credential is bound |

### 3. Automated Testing — ✅ done (v1.6.0, PR 1)

Vitest (Node env, Vite-native) with `@nuxt/test-utils` installed. `vitest.config.ts` aliases `~~` → repo root, `tests/**/*.test.ts` is the include pattern, `isolate: true` for per-file isolation. Per-test workers are deferred — current suite is pure functions, so the shared pool is fine.

What shipped in PR 1 (64 unit tests across 4 files; 72 total with PR 2's backup suite):
- `tests/unit/money.test.ts` — paise conversions, `formatPaise` edge cases (negative, zero, lakh grouping, rounding).
- `tests/unit/dates.test.ts` — `localISODate` for UTC+0, UTC+5:30 (IST), DST boundaries.
- `tests/unit/accountBalances.test.ts` — golden sums for `bank` / `credit_card` / `mutual_fund` across all four `transactions.type` values; archived accounts excluded from liquidity.
- `tests/unit/dashboardPeriods.test.ts` — the `since_last_salary` fallback chain (4 branches; the kind of thing that silently breaks in a refactor).

Refactors to make the high-risk code unit-testable:
- `composables/useAccountBalances.ts` — hoisted a `Map<id, account>` for O(1) type lookups (was O(n) per transaction).
- `utils/dates.ts` — new file. `localISODate` + `localMonthKey` moved out of `server/api/dashboard.get.ts` (they're shared across server + client).
- `server/utils/dashboardPeriods.ts` — new module, extracted from `server/api/dashboard.get.ts`. The since_last_salary resolver now takes a `FindSalaryDate` callback so the chain is pure (no DB dependency in the unit test).

`package.json` scripts: `test` (watch), `test:run` (one-shot, used in CI), `test:watch`.

Still parked: `tests/server/` (in-memory SQLite + drizzle migrator), `tests/auth/`, `tests/financial/` — deferred to a later PR. The financial golden-sums test is the highest-value of these; will land when the next big financial refactor shows up.

### 4. GitHub Actions CI — ✅ done (v1.6.0, PR 1)

Two workflows in `.github/workflows/`:

- **`build-and-test.yml`** (reusable) — the actual pipeline. Always runs inside `container: image: node:22-bookworm` so the underlying machine (hosted or self-hosted) stays clean of pnpm/Node version drift. Steps: `actions/checkout@v5` → `pnpm/action-setup@v5` (reads `packageManager` from `package.json`) → `actions/cache@v5` (pnpm store, keyed on lockfile hash) → `pnpm install --frozen-lockfile` → `node scripts/generate-version-json.mjs` → `pnpm typecheck` → `pnpm test:run` → `pnpm build`. Takes one input: `runner` (a `runs-on` value, string for hosted or JSON array for self-hosted).
- **`ci.yml`** (caller) — triggers on `push` + `pull_request` to `main` **and** `phase1/**`, plus `workflow_dispatch` for manual re-run. Two jobs:
  - **`hosted`** (primary) — `runs-on: ubuntu-latest`. Free for public repos, no machine overhead.
  - **`self-hosted`** (fallback) — `runs-on: [self-hosted, linux, dev]`, `needs: hosted, if: failure()`. Only runs when the hosted job failed or was cancelled (e.g., GitHub Actions outage, quota exhausted, hosted-region infra issue). Runs in the same `node:22-bookworm` container so the self-hosted host stays clean.

**Branch protection:** require the **"Build & Test (self-hosted fallback)"** check on `main` (and any other gated branch). During normal operation this check is `skipped` (because hosted succeeded) and `skipped` counts as passing for branch protection, so merges stay unblocked. During an outage, hosted fails → self-hosted runs; if self-hosted passes the merge is allowed.

**Concurrency:** `group: ${{ github.workflow }}-${{ github.ref }}`, `cancel-in-progress: true`. New pushes cancel in-flight runs for the same ref.

No deploy from CI — deploys stay manual (`./scripts/deploy.sh`). The self-hosted runner is registered as `vimal-dev` (pool `Default`, labels `self-hosted, Linux, X64, dev`) and lives at `/home/vimal/actions-runner` on `vimal-hp` (this machine).

### 5. SQLite Backup Improvements — ✅ done (v1.6.0)

| Sub-item | Status | Where |
|---|---|---|
| JSON snapshot export (now 5 tables — adds `user_settings`; snapshot version bumped 1.0 → 1.1) | ✅ done (v1.0.0; fixed v1.6.0) | `scripts/export.mjs`, `server/api/export/json.get.ts` |
| Nightly local JSON export to `/var/lib/budget-tracker/exports/` | ✅ done (v1.0.0) | `systemd/budget-tracker-export.timer` (02:00 daily) |
| Push to Google Drive with 30-day retention via rclone | ✅ done (v1.0.0) | `scripts/export.sh` |
| Restore from JSON snapshot (backward-compat: v1.0 snapshots still restore; `user_settings` defaults to `[]`) | ✅ done (v1.0.0; fixed v1.6.0) | `scripts/import.ts` (wipes + re-inserts in one transaction; FK-ordered) |
| **Binary SQLite backup** (faster, preserves all state including `__drizzle_migrations`) | ✅ done (v1.6.0) | `scripts/backup-binary.mjs` — `db.backup(destPath)` from `better-sqlite3` |
| **Daily automated binary backup** (03:00, 1h after JSON export) | ✅ done (v1.6.0) | `systemd/budget-tracker-binary-backup.{service,timer}`, `User=budget` |
| **Backup verification** (open the backup, run `PRAGMA integrity_check`; assert expected 5 user-facing tables) | ✅ done (v1.6.0) | Both `backup-binary.mjs` and `export.mjs` call `PRAGMA integrity_check` on the source DB before writing |
| **Restore validation** (open the backup, count rows per table) | ✅ done (v1.6.0) | `tests/server/backup.test.ts` — 8 integration tests (backup has all 5 tables, valid SQLite, captures `__drizzle_migrations`, failure paths) |
| **Off-Pi backup of the raw DB file** (e.g. snapshot to NAS / second rclone remote) | ⏳ not started | Stretch; JSON + binary backups are the safety net for now |

### 6. Performance Optimization — 🔄 partial

| Sub-item | Status | Where |
|---|---|---|
| DB indexes on `transactions(date)`, `(account_id)`, `(category_id)`, `(spent_by)`, `(type)` | ✅ done (v1.0.0) | `db/migrations/0000_goofy_nicolaos.sql`, mirrored in `server/db/schema.ts` |
| Dashboard aggregate endpoints in a single round-trip | ✅ done (v1.3.0+) | `GET /api/dashboard` |
| Day-by-day spends series in SQL (not in-memory) | ✅ done (v1.3.0) | `server/api/dashboard.get.ts` |
| **Dashboard caching** (short TTL on `/api/dashboard`) | ⏳ not started | Currently recomputed on every request |
| **Pagination on `/api/transactions`** | ⏳ not started | Currently `LIMIT 200` ceiling; no `offset` paging yet (UI does infinite scroll from the cap) |
| **Virtual scrolling** in the transactions list | ⏳ not started | At <200 rows the rendered list is fine; revisit at ~5k |
| **Compound index on (account_id, date)** for the per-account detail page | ⏳ not started | Will matter when account histories grow |

---

## Phase 1 — Implementation plan · target v1.6.0

**Progress:**

| PR | Title | Status |
|---|---|---|
| PR 1 | Tests + CI (Vitest + GitHub Actions) | ✅ done & merged (commits `91b347d`, `e20792f`, `85134ca`, `840747b`, PR #1). 64 unit tests, hosted→self-hosted+docker fallback CI chain, actions v5 (Node 24). |
| PR 2 | Backup hardening (binary + user_settings fix + integrity check) | ✅ done locally — branch `phase1/pr2-backup-hardening` (commit `29e9f7b`); rebased onto `origin/main`; ready for review. Part of v1.6.0. |
| PR 3 | Security headers + CSRF (Origin check) | ⏳ |
| PR 4 | Server-side sessions (SHA-256 token, no UI) | ⏳ |
| PR 5 | Performance: compound index only | ⏳ |
| PR 6 (v1.6.1) | Active sessions UI | ⏳ |
| PR 7 (v1.6.1) | PIN recovery | ⏳ |

**Scope:** five PRs for v1.6.0 (PR 1, 2, 3, 4, 5); PR 6 and PR 7 deferred to
v1.6.1. Total estimate: ~3.5 dev days, 2-3 calendar weeks with review.

**Ordering rationale:** tests + CI ship together so the safety net is live
before any change. Backup hardening ships next so the binary backup is
verified working before any schema migration that we'd need it for. Security
headers (no schema change) can parallel with backup. Session management
ships after — the schema change is the largest one and benefits from a
verified backup. Performance (compound index only) is last — small, isolated,
low-risk.

**Deferred out of v1.6.0:** ESLint / Prettier (skip linter entirely for now),
WebAuthn / biometric (v1.7.0+), active-sessions UI (v1.6.1), PIN recovery
(v1.6.1), dashboard cache and `total: COUNT(*)` on transactions (deferred
until benchmarked and a UI consumer exists, respectively), virtual scrolling
(stretch), off-Pi binary backup (stretch).

### PR 1 — Tests + CI (combined, gates everything else) — ✅ shipped v1.6.0

Tests without CI are a promise; CI without tests is empty. Shipped together on 2026-08-07 (commits `91b347d`, `e20792f`, `85134ca`, `840747b`, PR #1).

**Tests (64 unit tests across 4 files; 72 total with PR 2's backup suite):**
- `tests/unit/money.test.ts` — paise conversions, `formatPaise` edge cases (negative, zero, lakh grouping, rounding).
- `tests/unit/dates.test.ts` — `localISODate` for UTC+0, UTC+5:30 (IST), DST boundaries.
- `tests/unit/accountBalances.test.ts` — golden sums for `bank` / `credit_card` / `mutual_fund` across all four `transactions.type` values; archived accounts excluded from liquidity.
- `tests/unit/dashboardPeriods.test.ts` — the `since_last_salary` fallback chain (4 branches; the kind of thing that silently breaks in a refactor).

**Refactors to make the high-risk code unit-testable:**
- `composables/useAccountBalances.ts` — hoisted a `Map<id, account>` for O(1) type lookups (was O(n) per transaction).
- `utils/dates.ts` — new file. `localISODate` + `localMonthKey` moved out of `server/api/dashboard.get.ts` (shared across server + client).
- `server/utils/dashboardPeriods.ts` — new module, extracted from `server/api/dashboard.get.ts`. The `since_last_salary` resolver now takes a `FindSalaryDate` callback so the chain is pure (no DB dependency in the unit test).

**CI (final shape — diverged from the original plan, see commits `e20792f` and `840747b`):**

Originally planned: a single workflow `ci.yml` on `ubuntu-latest` with `actions/setup-node@v4`. What shipped: two workflows in `.github/workflows/`:

- `build-and-test.yml` (reusable) — the actual pipeline. `container: image: node:22-bookworm` (hosted + self-hosted both run inside it; the host stays clean). Steps: `actions/checkout@v5` → `pnpm/action-setup@v5` (reads `packageManager` from `package.json`) → `actions/cache@v5` (pnpm store) → `pnpm install --frozen-lockfile` → `node scripts/generate-version-json.mjs` → `pnpm typecheck` → `pnpm test:run` → `pnpm build`. One input: `runner` (the `runs-on` value, string for hosted or JSON array for self-hosted).
- `ci.yml` (caller) — triggers on `push` + `pull_request` to `main` **and** `phase1/**`, plus `workflow_dispatch`. Two jobs:
  - **`hosted`** (primary) — `runs-on: ubuntu-latest`.
  - **`self-hosted`** (fallback) — `runs-on: [self-hosted, linux, dev]`, `needs: hosted, if: failure()`. Only runs when the hosted job failed or was cancelled.

**Why the divergence:** the original plan (hosted-only) hit a real-world constraint during a GitHub Actions outage — the self-hosted runner was online but couldn't acquire jobs because `run-actions-2-azure-eastus.actions.githubusercontent.com/.../acquirejob` was returning HTTP 503, and the hosted queue was equally stuck. The chain pattern (hosted → self-hosted fallback) makes the self-hosted runner an actual fallback rather than a parallel experiment. Branch protection requires the **"Build & Test (self-hosted fallback)"** check (it counts as `skipped` → passing when hosted succeeds, so normal merges stay unblocked).

**actions v5 / Node 24:** the original plan had `actions/checkout@v4` + `pnpm/action-setup@v4` + `actions/cache@v4` (all pinned to `using: node20`). GitHub is force-upgrading v4 to Node 24 and emitting "Node 20 is being deprecated" warnings in every job log. v5 of all three pins to `using: node24` and silences the noise. The PR landed actions v5 as a follow-up commit (`840747b`) on the same branch.

**README badge + branch protection:** the README badge was added in `91b347d`; branch protection on `main` requires the "Build & Test (self-hosted fallback)" check (configured post-merge, not by this PR).

### PR 2 — Backup hardening (must ship before PR 4) — ✅ done locally, ready for review (v1.6.0)

This PR exists in part to *fix a pre-existing bug*: `scripts/export.mjs` and
`scripts/import.ts` only handle 4 tables (`users`, `accounts`, `categories`,
`transactions`) and silently drop `user_settings` (added in v1.1.0,
migration 0001). PR 4's `sessions` table would make this worse. The pre-fix
JSON snapshot was a *silent* data-loss bug — primary account + monthly budget
+ per-user settings all disappeared on restore.

**Shipped on `phase1/pr2-backup-hardening` (commit `29e9f7b`):**

- **JSON export fix** (`scripts/export.mjs`): `user_settings` added to the
  snapshot. Snapshot version bumped 1.0 → 1.1. Source DB is opened with a
  separate `Database` instance and `PRAGMA integrity_check` is run before
  writing — exit non-zero on `not ok`. The list of user-facing tables the
  script expects is asserted in the new test. Module exports `runExport()`
  for testability.
- **JSON import fix** (`scripts/import.ts`): accepts the new `userSettings`
  field; v1.0 snapshots still restore (the field defaults to `[]`).
  Wipe + insert order updated to respect the new `user_settings` → `accounts`
  FK (`users` → `accounts` → `categories` → `user_settings` →
  `transactions`). Header documents the FK ordering.
- **Binary backup** (`scripts/backup-binary.mjs`, new): full DB snapshot via
  `better-sqlite3`'s online backup API (`db.backup(destPath)`). Captures
  user data, schema, WAL state, AND `__drizzle_migrations` (so the backup
  survives schema changes). Verifies via `PRAGMA integrity_check` on the
  copy; asserts the expected 5 user-facing tables are present. Module
  exports `runBackup()` for testability.
- **New systemd unit** `systemd/budget-tracker-binary-backup.{service,timer}`
  — daily 03:00, 1h after the JSON export at 02:00, runs `backup-binary.mjs`
  as the `budget` user, `Type=oneshot`. Picked up by the existing deploy.sh
  systemd rsync step (the deploy script already globs `systemd/`).
- **Test** (`tests/server/backup.test.ts`, 8 integration tests):
  - backup file has all 5 user-facing tables
  - backup is a valid SQLite file with the same data
  - binary captures `__drizzle_migrations` (survives schema changes)
  - `runBackup` throws if source DB missing
  - export produces a v1.1 snapshot with all 5 tables
  - export handles empty DBs
  - export + backup both pass `integrity_check`
  - failure path (corrupt backup) is detected

**Divergences from the original plan:** none. The plan was specific enough
that everything landed as designed. The one thing worth calling out is that
the source-DB integrity check on the JSON export path was an addition beyond
what the plan strictly required — it's a no-cost way to catch a corrupt
source DB before we push it to Drive.

**Why this PR ships before sessions (PR 4):** the session table migration
in PR 4 is non-idempotent (the dual-path for legacy cookies). If anything
went wrong on the Pi during that migration, the only recovery path today is
the JSON export — which, as of this commit, no longer silently drops
`user_settings`.

### PR 3 — Security headers + CSRF

- New `server/middleware/security-headers.ts` (runs after `auth.ts`).
- Headers set on every response:
  - `Content-Security-Policy` — dev: `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; font-src 'self' https://fonts.gstatic.com`. Prod: same minus `unsafe-eval`. **ECharts caveat:** ECharts uses `new Function()` internally for some formatter features. Ship prod CSP with `Content-Security-Policy-Report-Only` first, hit all three dashboard charts (donut, cash-flow, daily-spends), and only flip to enforcing once we know the real prod CSP works without violations. If `unsafe-eval` is unavoidable in prod, keep it and add a comment explaining why.
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains` (Funnel already does this; belt-and-suspenders)
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
- New `server/middleware/csrf.ts` (runs BEFORE the auth gate):
  - **Origin check, not `X-Requested-With`.** Earlier plan said `$fetch` sets
    `X-Requested-With` — it does not. Nuxt's `$fetch` (ofetch) sends no custom
    headers by default. Either wire up a global plugin to set the header on
    every call (~20 call sites) **or** use the `Origin` header check, which
    requires zero client changes (browsers always set `Origin` on
    `POST`/`PATCH`/`DELETE` and cannot be tricked into omitting it from
    cross-site form submissions). **Going with Origin.**
  - Skip `/api/auth/*` (login, logout, recover).
  - Allowed origins: configured via `NUXT_PUBLIC_ALLOWED_ORIGINS` env var
    (comma-separated). Dev default: `http://localhost:3000`. Prod:
    `https://${TAILSCALE_FUNNEL_HOST}` plus the LAN origin
    (`http://192.168.0.224:3000`) if the user ever accesses directly.
  - Reject if `Origin` is missing (curl, Postman, non-browser clients) **or**
    not in the allowlist. Return `403`.
- Test (`tests/server/middleware.test.ts`): cross-origin request rejected
  (403); same-origin accepted (200); `Origin` header missing rejected;
  GET requests unaffected.

### PR 4 — Server-side sessions (no UI in v1.6.0)

The UI for listing/revoking sessions is a *feature*, not hardening, and is
deferred to v1.6.1 (PR 6 below). This PR delivers the security-critical
table + API.

- Migration `0002_*.sql` (mirror in `scripts/migrate.mjs`):
  ```sql
  CREATE TABLE sessions (
    id text PRIMARY KEY,                 -- SHA-256(raw_token), hex; NOT the cookie value
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_agent text,
    ip text,
    created_at text NOT NULL,
    last_seen_at text NOT NULL,
    expires_at text NOT NULL,
    revoked_at text
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);
  CREATE INDEX idx_sessions_expires ON sessions(expires_at);
  ```
  **Hash the session ID before storing.** The cookie holds the raw token;
  the DB holds `SHA-256(token)`. On lookup, hash the cookie value and query
  by hash. A leaked DB file then yields only hashes, not bearer tokens. Cost
  per request: one SHA-256 (microseconds).
- `server/utils/auth.ts`:
  - `setSessionUserId(event, userId)` → generate 32-byte random token
    (base64url), `id = sha256(token).hex`, insert `sessions` row, set
    cookie to raw token.
  - `getCurrentUser(event)` → read token from cookie, `id =
    sha256(token).hex`, look up session, reject if `expires_at < now()` or
    `revoked_at IS NOT NULL`; on success, bump `last_seen_at` debounced
    to 60s. Cookie holds raw token; DB stores hash; they never collide.
  - `clearSessionCookie(event)` → also `UPDATE sessions SET revoked_at = now() WHERE id = ?`.
  - **Revoke all other sessions on PIN change.** In the change-PIN endpoint,
    add `UPDATE sessions SET revoked_at = now() WHERE user_id = ? AND id != ?`
    (keep the current session, revoke the rest). One line.
- **Pinia reset on logout** (`stores/auth.ts`): when `logout()` succeeds,
  iterate the registered Pinia stores and call `$reset()` on each, so the
  next login on the same browser doesn't briefly see stale
  `useAccounts` / `useTransactions` / `useDashboard` data. Cheap insurance
  against a UI bug that becomes more visible once server-side revocation is
  in play.
- **Backward compat:** keep a dual-path in `getCurrentUser` for one release —
  if the cookie value matches a `userId` (legacy), create a session row
  on-demand using the user_id as the token (no security change vs. today:
  the value is the user_id either way). After 30d, remove the legacy path.
  CHANGELOG entry.
- Cookie name stays `vs_session`. Same `httpOnly` / `SameSite=Lax` /
  `secure`-on-HTTPS settings.
- **Periodic cleanup** (one-shot script `scripts/cleanup-sessions.mjs`,
  scheduled by a third systemd timer monthly): `DELETE FROM sessions WHERE
  expires_at < ?` for `now() - 30 days` (or `revoked_at IS NOT NULL AND
  revoked_at < now() - 7 days`). The `idx_sessions_expires` index makes
  this cheap. Without it, the table grows unbounded.
- Tests: token round-trip, expiry, revoke, debounce, legacy fallback,
  cross-user isolation, PIN change revokes others, hash in DB never
  matches raw cookie value.

### PR 5 — Performance: compound index only

Defer the dashboard cache and the `total: COUNT(*)` field. The cache is
premature optimization until we benchmark; the `total` field has no UI
consumer today (the transactions page does infinite scroll from a 200-row
cap). Both can land in a later release once we have evidence they're needed.

- Migration `0003_*.sql` (mirror in `scripts/migrate.mjs`):
  `CREATE INDEX idx_txn_account_date ON transactions(account_id, date);`
  Covers the per-account detail page (most-frequent access pattern after the
  dashboard). Small change, real win.
- `EXPLAIN QUERY PLAN` before/after on a representative dataset (seed
  ~5k transactions) to confirm the index is used.

### PR 6 (v1.6.1) — Active sessions UI

- `GET /api/auth/sessions` — own sessions only.
- `POST /api/auth/sessions/:id/revoke` — sets `revoked_at = now()` if owned by current user.
- `POST /api/auth/sessions/revoke-all-others` — convenience.
- `stores/auth.ts` + `composables/useActiveSessions.ts`.
- `components/SettingsActiveSessions.vue` mounted in `pages/settings.vue`:
  list with `{ userAgent, ip, lastSeenAt, isCurrent }`, "Log out" per row,
  "Log out all other devices" button.
- Tests: only see own sessions, can't revoke others' (403).

### PR 7 (v1.6.1) — PIN recovery

- Migration `0004_*.sql` (mirror in `scripts/migrate.mjs`):
  ```sql
  CREATE TABLE pin_recovery_codes (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash text NOT NULL,            -- bcryptjs (DECISIONS D50)
    created_at text NOT NULL,
    used_at text
  );
  CREATE INDEX idx_recovery_user ON pin_recovery_codes(user_id);
  ```
- `/settings` → new "Recovery codes" section: generate 5 single-use 8-char
  alphanum codes, displayed once on creation, regenerable (old set marked
  `used_at = now()` to invalidate).
- `POST /api/auth/recover` — body `{ userId, code, newPin }` — verifies
  `code_hash`, marks code used, sets new PIN hash on the user. Use
  `bcryptjs` (DECISIONS D50), not the native `bcrypt` package.
- New page `pages/recover-pin.vue` (public, rate-limited like login).
- Tests: full flow, code reuse rejected (409), regeneration invalidates prior set.

### Critical risks

1. ~~**Pre-existing `user_settings` export bug.**~~ **Resolved in v1.6.0.**
   `scripts/export.mjs` now includes `user_settings`; `scripts/import.ts`
   restores it; the source DB is integrity-checked before writing. PR 2's
   binary backup is the second defense — full DB including
   `__drizzle_migrations`, so even a schema change between backup and
   restore works. Any pre-v1.6.0 JSON snapshot is now considered unsafe;
   re-export once after the v1.6.0 deploy to refresh.
2. **ECharts and prod CSP.** `unsafe-eval` may be required for ECharts
   formatter functions. Test with `Report-Only` first; document the
   decision in the file if we keep `unsafe-eval`.
3. **Old `vs_session` cookies carry the userId, not a token.** Dual-path in
   `getCurrentUser` for one release. CHANGELOG entry. Remove legacy path
   after 30d.
4. **Hashed session IDs must round-trip correctly.** A bug in the SHA-256
   step silently 401s every request. Test asserts: cookie value ≠ DB
   value, and the hash lookup is exact.
5. **Binary backup holds a read lock for the copy duration.** `db.backup()`
   uses SQLite's online backup API (safe), but a killed-mid-copy leaves a
   partial file. `PRAGMA integrity_check` after copy catches this.
   Mitigated in v1.6.0 (PR 2).
6. **Recovery codes are a security feature.** Store hashed (bcryptjs), never
   log them, single-use. If a user loses all 5, locked out — re-seed remains
   the nuclear option.
7. **CSP/CSRF middleware order matters.** `csrf.ts` must run before
   `auth.ts` so it can reject unauthenticated cross-origin requests without
   spending a DB lookup. Verify by integration test.

### Decisions to revisit when PR 1 lands

- ~~Is the `useAccountBalances` refactor (hoist the account Map) worth doing
  in PR 1, or wait for the test to dictate?~~ **Done in v1.6.0.** Map was
  hoisted; `accountBalances.test.ts` exercises it.
- Once tests exist, benchmark `GET /api/dashboard` on the Pi. If >500ms,
  revisit the deferred cache. If <100ms, drop it. _Not yet benchmarked —
  pending Pi deploy of v1.6.0._
- Linter is intentionally skipped; the user may want to add it before any
  Phase 2 work.

---

## Phase 2 — Budget Management · target v1.7.0

Turn VaravuSelavu into a real budgeting app. Some pieces are already there; the rest is genuinely new.

### 7. Recurring Transactions ⭐ — ⏳ not started

The biggest single feature in the backlog. Out of scope for v1 by explicit decision (DECISIONS §2.6).

Proposed shape:
- New `recurring_rules` table: `id`, `account_id`, `to_account_id?`, `category_id?`, `amount_paise`, `description`, `cadence` (`daily`/`weekly`/`monthly`/`yearly`), `anchor_day?` (for monthly), `start_date`, `end_date?`, `next_run_date`, `active`.
- Background "tick" runs on every authenticated request (cheap `SELECT next_run_date <= today LIMIT 1`); when due, materialize a real `transactions` row and advance `next_run_date`.
- UI on each transaction row: "Make recurring" → opens rule editor; on investment detail / CC detail: "Auto-pay EMI" / "Auto-credit SIP" shortcuts.
- Each generated row is a normal transaction (full audit trail) — rules are just a generator.
- One-off change to a generated row does *not* affect the rule.

### 8. Monthly Budgets — ✅ done (v1.1.0)

- `user_settings.monthly_budget_paise` (paise integer, nullable).
- `GET/PUT /api/user-settings`.
- "Set as primary" / "Primary" badge on `AccountCard` and `CreditCardCard`.
- `QuickAddModal` pre-selects the primary account on open (transfer override preserved).
- Empty state: `+ Set budget` inline editor on the dashboard period selector.

### 9. Budget Progress — ✅ done (v1.1.0)

- Inline progress bar in the period selector.
- Three states: under (sage/ink), at (~80–100%, warn), over (terra/danger).
- Subtitle reads "Income − expense" or "Overspent by ₹X".
- Tile is part of the period selector; the dashboard hero stayed focused on the lifetime tiles (per v1.4.0 cleanup).

### 10. Savings Goals — ⏳ not started

Per DECISIONS §7.4. Proposed:
- New `goals` table: `id`, `name`, `target_paise`, `target_date?`, `current_paise` (derived), `linked_account_id?`, `color`, `icon`, `archived`, `created_at`.
- "Contribute to goal" = regular expense to a dedicated category, OR a transfer to a dedicated "Goal Pot" account (the account approach is simpler and reuses existing infra).
- Dashboard card: progress bar + projected completion date (linear extrapolation from last 30 days of contributions).

### 11. Bill Reminders — ⏳ not started

Per DECISIONS §7 (backlog). Touches Phase 9 (Notification Center §54).

Proposed:
- Derive "bills" from `recurring_rules` (Phase 2 §7) + manual `bills` table for one-offs (property tax, insurance renewal).
- Due dates inferred from `accounts.statement_day` / `due_day` (credit cards) — already in the schema, currently informational only.
- In-app notification list (Phase 9 §54) is the v1 channel; web push (DECISIONS §7.10) is a v2 stretch.

### 12. Cash Flow Forecast — ⏳ not started

The dashboard already shows period income / expense and a 30-day daily-spends series. The missing piece is the **forecast** — projecting end-of-period.

Proposed:
- Add `forecast` block to `GET /api/dashboard`: `projectedIncome` (sum of pending income + average income from prior 30d for the rest of the period), `projectedExpense`, `projectedBalance` = current + projectedIncome − projectedExpense − pendingBills.
- Honest about what it is: a "if nothing changes" estimate, not a budgeting tool.
- Display in the period selector next to the budget bar — a single line: "On track for ₹X by {period end} · ₹Y headroom".

---

## Phase 3 — Better Finance Tracking · target v1.8.0

Reduce friction on day-to-day transaction entry and review.

### 13. Split Transactions — ⏳ not started

One purchase, multiple categories. Example: an Amazon order that's half "Electronics" and half "Groceries".

Proposed:
- A transaction can have N `transaction_splits` rows (`id`, `transaction_id`, `category_id`, `amount_paise`, `notes`).
- If a transaction has splits, the `category_id` on the parent is null and the per-category aggregates use the splits.
- UI in `QuickAddModal`: "Split" toggle, repeatable category + amount rows with a remaining-to-allocate indicator.
- Display: a transaction with splits shows a small "+ 2 more" chip that expands the breakdown.

### 14. Tags — ⏳ not started

Per DECISIONS §7.6. Free-form string labels on transactions (different axis from categories).

Proposed:
- `tags` table: `id`, `name` (unique), `color`.
- `transaction_tags` join table.
- Filter chip in `TransactionFilters` ("Tag: vacation, medical, office") and the search bar accepts `tag:vacation`.
- Saved filter combinations ("My recurring subscriptions") stored per-user.

### 15. Powerful Search — 🔄 partial

Current filters (`server/api/transactions/index.get.ts`, `TransactionFilters.vue`):

| Filter | Status |
|---|---|
| Date range (from / to) | ✅ done |
| Account | ✅ done |
| Category | ✅ done |
| Person (`spent_by`) | ✅ done |
| Type (expense / income / transfer / interest) | ✅ done |
| Free-text `q` (description + notes) | ✅ done |

What's missing for "powerful": combined `tag:` queries (depends on §14), saved searches (depends on §14), full-text search with stemming (probably overkill for a household-sized dataset).

### 16. Receipt Storage — ⏳ not started

Per DECISIONS §7.9. Local filesystem on the Pi, thumbnail in transaction detail.

Proposed:
- `receipts` table: `id`, `transaction_id`, `path`, `mime_type`, `size_bytes`, `created_at`.
- Upload endpoint `POST /api/transactions/:id/receipt` (multipart).
- Storage path: `/var/lib/budget-tracker/receipts/{year}/{month}/{txn_id}.{ext}`.
- Backup: include `receipts/` in the export bundle (`scripts/export.sh`).
- OCR is a stretch (Phase 7 §44 territory).

### 17. Transfer Wizard — 🔄 partial

Transfers exist today via `QuickAddModal` (the existing 4th type pill). What's missing is the **wizard** UX:

- "Move ₹X from A to B" as a one-tap entry on the account detail page ("Transfer to…").
- Validation: source and destination must be different; both must be non-archived; warn if destination is a CC (you probably meant "Pay card", use that button instead).
- Quick-suggest: list the top 3 accounts the user transfers to most often.

### 18. Favorites & Templates — ⏳ not started

Per-row "★" on transactions; "Add from favorite" in the QuickAdd header.

Proposed: `transaction_templates` table: `id`, `user_id`, `template` (the same shape as a transaction minus date/amount), `use_count`, `last_used_at`. Top 5 surfaced in `QuickAddModal` header.

### 19. Bulk Editing — ⏳ not started

Multi-select in the transactions list; bulk action menu: re-categorize, change account, change person, delete, add tag.

UI: long-press to start selection mode on mobile; checkboxes on hover for desktop. Pattern lifted from iOS Mail / Google Photos.

### 20. Undo Delete — ⏳ not started

Today, `DELETE /api/transactions/:id` is a hard delete (rare, but real). Two paths:

- **Soft delete** (preferred): add `deleted_at` column, hide from all queries by default, "Trash" view with restore + permanent-delete.
- **Undo toast** (cheap version): on delete, show a 5-second "Undo" snackbar that re-inserts the row from a client-side cache.

Start with the toast (zero schema change); promote to soft delete if users actually use it.

### 21. Archive Accounts — ✅ done (v1.0.0)

`accounts.archived` boolean (`DECISIONS D13`). `DELETE /api/accounts/:id` is a soft delete that sets `archived = 1`. Archived accounts are hidden from active lists but their transactions remain queryable.

---

## Phase 4 — Advanced Reporting · target v1.9.0

Insights and visualizations. The lifetime tiles and daily spends chart are already in; this phase layers deeper cuts on top.

### 22. Net Worth Dashboard — ✅ done (v1.4.0)

- **What changed in v1.4.0**: the dashboard hero is now three lifetime-position tiles instead of one net worth number.
  - **Cash Liquidity** — sum of `bank` + `cash` + `digital_wallet` balances.
  - **Credit Liquidity** — total headroom across credit cards (`creditLimit − outstanding`).
  - **Savings** — sum of `mutual_fund` + `fixed_deposit` + `recurring_deposit` balances (per D09, principal-only).
- `other` account type is excluded from all three tiles (per the "no clarity" decision).
- Net worth is still on the accounts page; the formula `Σ assets − Σ CC outstanding` is unchanged.

### 23. Spending Trends — 🔄 partial

- ✅ Donut by category (current period).
- ✅ Daily spends bar chart (current period, v1.3.0).
- ⏳ Period-over-period comparison: "this month vs last month" overlay on the daily chart.
- ⏳ Rolling 7-day average line.

### 24. Income Trends — 🔄 partial

- ✅ Period income in the period selector.
- ⏳ Income-over-time line chart (6 / 12 months).
- ⏳ Income source breakdown (salary vs freelance vs investment returns).

### 25. Category Analysis — 🔄 partial

- ✅ Top categories in the current period.
- ⏳ Drill-down: tap a category → its own sub-page with monthly trend, top merchants, average amount.
- ⏳ "Essential vs discretionary" split (we already have `categories.is_essential`; the data is there, the view isn't).

### 26. Year-over-Year Comparison — ⏳ not started

New `/reports/annual` page. Side-by-side: 2025 vs 2024 by month, by category, by account. Will need at least one full year of real data before it's worth shipping.

### 27. Dashboard Widgets — 🔄 partial

- ✅ Period selector, hero tiles, donut, cash flow, daily spends, top categories, recent transactions, account cards.
- ⏳ User-rearrangeable widget grid (drag-and-drop, saved per user).
- ⏳ Widget show/hide per user.

### 27a. Net Worth Timeline — ⏳ not started

Plot account balances (or net worth) over time. Builds on §22's lifetime tiles; the timeline is the *trend*, the tiles are the *current snapshot*.

- Daily snapshot via a small end-of-day job that writes the current net worth to a `net_worth_snapshots` table (`date`, `net_worth_paise`, `breakdown_json`).
- `/reports/net-worth` page: line chart (echarts) with selectable range (3M / 1Y / 5Y / All).
- Per-account overlay: toggle accounts on/off to see what drove the change.

### 27b. Calendar Heatmap — ⏳ not started

GitHub-style spending intensity by day. One cell per day, color = expense magnitude relative to the user's 90-day median.

- Drives off existing transactions + the daily spends series (no new schema).
- `/reports/calendar` page; also a compact card on the dashboard below the daily-spends chart.
- Click a cell → filtered transactions for that day.

---

## Phase 5 — Investment Tracker · target v2.0.0

The biggest single phase after Phase 1. The current app tracks investments as accounts (principal only); v2.0 adds market data, performance, and a real portfolio view.

### 28. Stock Portfolio — ⏳ not started

Today: stocks are a `bank`-type account with a manual `opening_balance`. v2.0:

- New `stock_holdings` table: `id`, `account_id`, `symbol` (e.g. `RELIANCE.NS`), `exchange` (`NSE`/`BSE`/`US`), `quantity` (decimal — biggest schema departure so far; stored as `text` for now to avoid float), `avg_buy_price_paise`, `first_buy_date`.
- Price source: manual entry (v1 of this feature) → daily NAV fetch from a free API later (stretch).
- Holdings view: symbol, qty, avg cost, LTP, invested, current value, unrealized P/L, day change.
- Account balance for a stock account becomes `Σ(current value)` instead of `opening_balance`.

### 29. Mutual Fund Portfolio — 🔄 partial

- ✅ MF/FD/RD accounts exist (Sprint 2.12, D09).
- ✅ `interest` transaction type for credited/compounded interest (Sprint 2.14, D15).
- ⏳ NAV tracking. Add `mf_holdings` (folio, scheme code, units, NAV at purchase) — units are decimal.
- ⏳ XIRR computation (transactions-based: each `buy` is an outflow, each `redeem` or `interest` is an inflow). Use a small `xirr` library or hand-rolled Newton iteration; test on fixtures.
- ⏳ CAGR per holding.
- ⏳ Daily NAV fetch (AMFI / mfapi.in) — stretch; manual NAV entry is fine for v2.0.

### 30. Fixed Deposits — 🔄 partial

- ✅ FD accounts exist.
- ✅ Interest credits tracked.
- ⏳ Maturity view: principal, accrued interest, days to maturity, expected maturity value (`P × (1 + r/400)^(4n)` for quarterly compounding).
- ⏳ Auto-create a future-dated "FD matures" transaction on creation (or on demand), reminding the user.

### 31. Bond Portfolio — ⏳ not started

New account type `bond`. Per-bond fields: face value, coupon rate, coupon frequency (`monthly`/`quarterly`/`annual`), maturity date, ISIN. Coupon schedule generator that pre-creates expected `interest` transactions (one per coupon date) — same machinery as recurring rules (§7) but date-anchored.

### 32. Gold Investments — ⏳ not started

Two flavors:
- **Physical** — `account.type = 'gold_physical'`, weight in grams, purity (22K / 24K), current rate per gram (manual).
- **Digital** — `account.type = 'gold_digital'`, units, current NAV (manual, then API later).

Both feed into the same investment dashboard.

### 33. EPF / PPF / NPS — ⏳ not started

Each is an account with a slightly different shape:
- **EPF** — employer + employee contribution, monthly, government rate. Mostly tracking; interest is a once-a-year credit.
- **PPF** — annual contribution cap, 15-year lock-in, government rate. Same shape as a long-term FD.
- **NPS** — equity/debt/corp-bond allocation per choice; tracks fund value like an MF.

All three can ride the MF/FD machinery with custom account types + a small per-type metadata block (JSON column) to keep the schema sane.

### 34. Asset Allocation — ⏳ not started

One donut, four slices: Equity / Debt / Cash / Gold. Driven by:
- Equity: stocks (§28) + equity MF (§29) at current value.
- Debt: bonds (§31) + FD (§30) + EPF/PPF/NPS debt portion (§33) + debt MF.
- Cash: bank + cash + digital wallet balances.
- Gold: §32.

### 35. Investment Dashboard — ⏳ not started

Top-level card on `/` (or `/investments`): total invested, current value, absolute profit, return %, allocation donut (§34). Per-account drill-down: the existing investment detail page, enhanced with the per-section fields above.

### 36. Portfolio Performance — ⏳ not started

- XIRR per holding + portfolio-level.
- CAGR per holding.
- Dividend income (sum of `interest` transactions tagged as dividend — needs a `subtype` field or a separate `dividends` table).
- Interest income (sum of `interest` transactions on FD/RD/bond).

---

## Phase 6 — Loan Management · target v2.1.0

Liability tracking. Credit cards are already in; this phase formalizes the rest.

### 37. Loan Tracker — ⏳ not started

New `loans` table: `id`, `name`, `lender`, `type` (`home`/`personal`/`vehicle`/`education`/`other`), `principal_paise`, `interest_rate` (annual %), `tenure_months`, `start_date`, `emi_paise`, `linked_account_id?` (the bank from which EMIs debit), `archived`.

Computed on read: outstanding balance (reducing-balance method), `n_emis_remaining`, `next_emi_date`, `total_interest_remaining`, `payoff_date`.

Tie-in: when an EMI is paid (regular `expense` to category "Loan Repayment", or `transfer` from a bank account), the outstanding auto-decrements. Alternatively, an EMI scheduler that pre-creates recurring `expense` rows via Phase 2 §7.

### 38. Credit Card Tracker — ✅ done (Sprint 2.11)

- `accounts.type = 'credit_card'` with first-class `credit_limit`, `statement_day`, `due_day`, `opening_balance` (initial outstanding).
- Dedicated `CreditCardCard.vue` with prominent outstanding, available credit, utilization bar, due date, "Pay card" action.
- "Pay card" = `transfer` from a bank account to the CC (DECISIONS D08).
- CC outstanding is a liability (subtracted from net worth) — DECISIONS D07.

Stretch: per-card minimum payment tracking, statement period (v2 of CC tracking, DECISIONS §2.6). See "Not yet phased" §60–§61 for the explicit v2 features.

### 39. Subscription Tracker — ⏳ not started

Per DECISIONS §7.3. Two flavors:

- **Manual list** — `subscriptions` table: `id`, `name`, `amount_paise`, `cadence`, `next_renewal_date`, `account_id` (the card that gets charged), `category_id`, `notes`, `active`. Sum-of-active = monthly cost tile.
- **Auto-detect** — find recurring merchants in the transaction list (same amount + same description + ~monthly cadence); suggest them as subscriptions. Requires the historical data to exist first; this is a v2.x enhancement (see "Not yet phased" §58).

---

## Phase 7 — AI Features · target v2.2.0

All of these depend on a private LLM endpoint (Ollama on the Pi is the obvious fit — no data leaves the network). Each feature ships behind a "Smart" toggle in Settings so the app stays usable if the LLM is down.

### 40. Auto Categorization — ⏳ not started

On transaction create, the description goes to the LLM with the user's existing category list; the response is a category id (or "new: <name>"). Falls back to "Miscellaneous" on any failure. Confidence threshold: only auto-apply if the model returns a top-1 with high confidence; otherwise surface the suggestion in a "Did you mean…?" pill on the row.

### 41. Spending Insights — ⏳ not started

Weekly digest: "You spent 40% more on Restaurants this week than your 90-day average. The biggest contributor was BigBasket on Friday." Generated from the existing aggregates, not from raw transactions.

### 42. Monthly Financial Summary — ⏳ not started

End-of-month email-able (or in-app) summary: income, expense, savings, top 3 categories, top 3 merchants, net worth change. Same data that drives §41, longer form.

### 43. Savings Suggestions — ⏳ not started

"Subscriptions you're paying for but didn't use in 60 days" / "You spent ₹X on delivery in the last 30 days; cooking at home would save ₹Y". Rule + LLM hybrid — rules are reliable, the LLM writes the prose.

### 44. Natural Language Search — ⏳ not started

"Show all Amazon purchases" → translates to `q=Amazon` (we already have free-text search) but with stemming/expansion ("fuel" matches "petrol", "Bharat Petroleum", etc.). "How much did I spend on fuel last month?" → SQL aggregate + LLM phrasing.

### 45. Spending Prediction — ⏳ not started

Per-category linear projection to end of period. Show alongside the period selector as a "if you continue at this pace" line. Different from §12 (which is income/expense totals); this is per-category.

---

## Phase 8 — Family Features · target v2.3.0

Already a 2-user app for Vimal + Pavithra. This phase adds the collaboration layer.

### 46. Household Sharing — ⏳ not started

Today every account is shared by definition (single household pool, DECISIONS D01). What's missing:

- "This is a personal account, not shared" flag on `accounts` (per-user balances, not household).
- Per-account visibility: `all` / `mine` / `specific_users`.
- The `/accounts` page filters by what the current user is allowed to see.

### 47. User Permissions — ⏳ not started

Role on `users`: `owner` (the only one who can manage users, see the audit log, change household settings) vs `member`. Future: `read_only` for a "Pavithra's parent can view but not edit" scenario.

### 48. Activity History — ⏳ not started

New `audit_log` table: `id`, `actor_user_id`, `entity_type`, `entity_id`, `action` (`create`/`update`/`delete`/`archive`), `before_json`, `after_json`, `created_at`. UI: per-transaction "history" tab, per-account "history" tab. Owner-only access to the full log.

This unlocks the session-revocation feature in §1 ("force re-login on suspicious activity").

### 49. Comments — ⏳ not started

Per-transaction comment thread. Uses the existing `notes` field as the first comment for backward compatibility; thread-style display below the transaction. Notification on new comment (Phase 9 §54).

### 49a. Per-Person Comparison — ⏳ not started

A "Vimal vs Pavithra" spending breakdown. The data is already there (`transactions.spent_by`); the view isn't.

- `/reports/people` page: side-by-side per-category totals, ratio bar, trend over time.
- Useful for spotting who carries which category (e.g. one of us always pays for groceries).
- No schema change; pure read-side.

### 49b. Shared Expense Splitter — ⏳ not started

"I paid ₹1,200 for dinner but Pavithra owes half." The most-asked-for feature in personal-finance apps for couples.

- `splits` table: `id`, `transaction_id`, `from_user_id`, `to_user_id`, `amount_paise`, `settled_at?`.
- `QuickAddModal` gets a "Split with" toggle when the transaction is paid by one person; UI picks the other user + the split rule (50/50, custom %, or fixed amount).
- `/people/balances` page: who owes whom, running total, "Settle up" action that creates a paired `expense` + matching `income` to clear the balance.
- Touches the audit log (§48) for the settle-up action.

---

## Phase 9 — Premium Experience · target v3.0.0

The polish and convenience layer that makes the app feel finished.

### 50. Mobile App — 🔄 partial

- ✅ **PWA installable** on iOS and Android (v1.0.0). Home-screen icon, splash screen, full-screen launch.
- ✅ **Offline shell** via the service worker precache.
- ⏳ **Capacitor** wrapper for a real app store presence. Only worth doing if distribution outside Tailscale Funnel is wanted.

### 51. Offline Sync — 🔄 partial

- ✅ Service worker precache of static assets (PWA).
- ✅ Forms work offline in the sense that they don't crash, but mutations queue nowhere.
- ⏳ **Mutation queue** — write transactions to IndexedDB when offline; flush via background sync when back online. Conflict resolution: last-write-wins for now, surfaced as a "Synced" toast.
- ⏳ **Read cache** — show a stale snapshot of the dashboard when offline with a clear "Last synced N min ago" badge.

### 52. CSV Import — ⏳ not started

Per DECISIONS §7.7. Today we have **export** (`/api/export/json`, `scripts/export.mjs`); v3.0 adds **import**.

- Column-mapping UI: first row previews, user maps each column to a field (date, amount, description, account, category).
- Save mapping per institution for reuse.
- Dedupe by `(date, amount, description)` hash.
- Per-account routing: select the destination account at the top of the import flow.

### 53. PDF Reports — ⏳ not started

Server-side PDF generation for the monthly summary (§42) — print-quality, with the user's chart exports embedded. Tooling: `@react-pdf/renderer` is React-only; for Vue use `pdfmake` (heavy) or render HTML → print with `playwright` (heavy but on-demand only). Decision deferred.

### 54. Notification Center — ⏳ not started

In-app notification list at `/notifications`:

- Bill due (from §11).
- Budget threshold (80% / 100%) hit on a category.
- Unusual spend (from §41).
- New comment on a transaction (from §49).
- Unsuccessful backup (from §5).

Web push (`DECISIONS §7.10`) is a stretch on top — see "Not yet phased" §59.

### 55. Plugin System — ⏳ not started

A small JS hook surface for user-defined automations: "every time a transaction at Swiggy > ₹500 hits, add a tag `treat`". Configurable, not a security risk (plugins run server-side in the same process with the same user permissions, not in the browser).

Lowest priority of the v3.0 features — skip if bandwidth is tight.

---

## 🅿️ Not yet phased (backlog)

Items we know we want *eventually* but haven't picked a phase for. Most were
carried over from the original `DECISIONS.md §7` backlog (now retired) and the
`§2.6` out-of-scope-for-v1 list. Promote to a phase when the use case gets
sharp enough to plan.

| # | Item | Natural home | Why it's not phased yet |
|---|---|---|---|
| 56 | **PIN recovery flow** | Phase 1 §2 (Security) | Phase 1 is already large; could fold in if WebAuthn lands first (replaces the need entirely) |
| 57 | **WebAuthn / biometric login** | Phase 1 §2 (Security) | Same as 56; either-or, not both |
| 58 | **Auto-detect subscriptions** | Phase 6 §39 (Subscription Tracker) | Needs a year+ of real transaction history to be useful |
| 59 | **Web push notifications** | Phase 9 §54 (Notification Center) | In-app list is the v1 channel; push is a v3.x enhancement |
| 60 | **CC statement tracking** | Phase 6 §38 (CC Tracker) | Currently we derive the statement from `date` + `statement_day`; explicit statement periods are nice-to-have |
| 61 | **Per-card minimum payment tracking** | Phase 6 §38 (CC Tracker) | Statement tracking (60) is a prerequisite |
| 62 | **Calendar heatmap** | Phase 4 (Advanced Reporting) | Pure visualization; only valuable once spending data has variance to show |
| 63 | **Wishlist** | Phase 9 or stretch | Not strictly financial; depends on whether it should hold prices + alerts |
| 64 | **Multi-currency** | Schema-level (Phases 1–6) | Would require changes to every money column (already paise); revisit if a real second-currency need appears |
| 65 | **Bank OAuth integrations** | Stretch | Not feasible in India without an aggregator (Account Aggregator framework could change this) |
| 66 | **Indian tax helper** (80C / 80D) | Stretch | Regulatory, easy to get wrong, low daily-use value |

**Promotion rule:** when an item above gets a concrete use case or user
pressure, move it into the appropriate phase (delete from this table, add as
a numbered feature under that phase, renumber if needed). Don't let this
table grow without bound.

---

## 🌟 Stretch goals (v4.0+)

Items that aren't on the v1–v3 critical path but are listed because they came up in planning and are worth not forgetting.

- **Broker integrations** — Zerodha Kite, Groww, INDmoney. Read-only holdings/positions via their public APIs (where available). Most require OAuth and a partner agreement; "v4 if ever".
- **Bank synchronization** — generally not feasible in India (no aggregator exposes free OAuth to small players); Account Aggregator framework could change this. Revisit when AA is more widely adopted.
- **Tax estimation** — 80C / 80D tagging on transactions, year-end summary. Aligns with the new tax regime in India; useful but easy to get wrong.
- **FIRE calculator** — Financial Independence, Retire Early. Inputs: current expenses, current investments, expected return, withdrawal rate. Output: years to FI, FI number. Pure compute, no schema change.
- **Retirement planning** — projection of current savings + monthly SIP to a retirement corpus; reverse: "what SIP gets me to ₹X by age 60?".
- **Goal-based investment recommendations** — "You want ₹10L for a vacation in 18 months; you need to invest ₹X/month at Y% return". Requires expected-return assumptions.
- **Portfolio rebalancing suggestions** — driven by §34 allocation; "Your equity is at 72%, target is 60%; move ₹X to debt".
- **Family financial planning dashboard** — net worth across generations, estate planning notes. Not a v1–v3 priority.

---

## Cross-references

- **Architecture / locked decisions** → [`DECISIONS.md`](./DECISIONS.md) (§2: locked decisions, §3: data model, §9: Pi deployment runbook)
- **Per-version release notes** → [`CHANGELOG.md`](./CHANGELOG.md) (one section per release, with `### Added` / `### Changed` / `### Fixed` / `### Removed` subsections)
- **Per-sprint detail (historical)** → `DECISIONS.md` §6 (Sprint 0–4), §11–§17 (Sprint 1 kickoff, Sprint 3, Sprint 2.12, Sprint 4, Sprint 2.13, Sprint 2.14, header removal)
- **Historical v2+ backlog** (now retired) → `DECISIONS.md` §7 (kept as a pointer table; the live list is in this file)
- **Open questions** → `DECISIONS.md` §8 (Q1–Q10, most are now resolved by Phase 1+ work)
- **README / runbook** → [`README.md`](./README.md) (dev setup, Pi deploy, backup, troubleshooting)

---

## Updating this doc

This file is the source of truth for **what** we're building and **when**.
**Update it whenever** a feature's status changes (started, partially done, shipped) or
when a phase's target version shifts. The next person reading this should be able to
plan their week from the top of the file alone.

When a "Not yet phased" item gets a concrete use case, **promote it into the
right phase** (delete from the table, add as a numbered feature under that
phase, renumber if needed). Don't let the parking lot grow without bound.

For the *why* behind any specific feature or design call, the trail leads to `DECISIONS.md`.
For the *what actually shipped* on any given release, the trail leads to `CHANGELOG.md`.
