# Feature-Based Test Plan

## Goal

Build a durable, feature-owned test specification for the three-PR testing
initiative. The initiative is complete only when every **implemented,
user-facing capability and its important subscenarios** has executable test
evidence. The primary measure is user-visible behavior and preserved product
invariants, not the percentage of source lines executed.

## Non-goals

- Do not set a global line-coverage threshold or treat a high percentage as
  proof that a feature works.
- Do not test every component or route in isolation merely because a file
  exists.
- Do not redesign the product, add unimplemented functionality, or make PR 1
  change runtime behavior.
- Do not replace exact financial assertions with snapshots or approximate
  values.
- Do not make the app's integration tests depend on an in-memory SQLite
  database.

## Baseline

The current baseline is **133 tests across 9 files**:

| Current file | Count | Current responsibility |
| --- | ---: | --- |
| `tests/unit/money.test.ts` | 18 | Paise conversion and display formatting |
| `tests/unit/dates.test.ts` | 9 | Local date/month/greeting helpers |
| `tests/unit/accountBalances.test.ts` | 18 | Account balance, net worth, and liquidity math |
| `tests/unit/dashboardPeriods.test.ts` | 19 | Dashboard period and salary fallback resolution |
| `tests/server/backup.test.ts` | 9 | Binary backup and JSON export scripts |
| `tests/server/csrf.test.ts` | 17 | CSRF allowlist pure helpers |
| `tests/server/csp.test.ts` | 11 | CSP policy pure builder |
| `tests/server/auth.test.ts` | 24 | Session token helpers, schema, and revocation SQL |
| `tests/server/migrations.test.ts` | 8 | Migration snapshots, fresh schema, and upgrades |
| **Total** | **133** | **4 `tests/unit/*.test.ts` + 5 `tests/server/*.test.ts`** |

This is implementation-layer organization, not feature ownership. In
particular, the current auth tests do not exercise real login/session HTTP
flows, and the CSRF/CSP tests mostly exercise helpers rather than the actual
middleware paths.

The migration contract is currently represented by
`db/migrations/0002_sessions_and_index.sql` and
`db/migrations/meta/0002_snapshot.json`. The migration suite includes snapshot
parity, fresh installation, migrate idempotency, and a simulated migration-0001
database whose user, account, and transaction rows survive the upgrade. Those
tests are preserved and reorganized before new boundary tests are added.

## Terminology

- **Feature**: a user-visible capability or a cross-cutting product contract,
  such as Auth, Transactions, or Backup.
- **Scenario**: one meaningful user action, state transition, input class, or
  invariant. A scenario may have several assertions.
- **Feature-owned test**: a test stored with the capability it protects. It may
  be a pure, database, HTTP, mounted UI, or browser test; its storage location
  does not dictate its test level.
- **Golden assertion**: a deterministic expected value, especially an exact
  integer-paise aggregate or an exact persisted row.
- **Current status**: `covered` means the current suite already proves the
  listed contract at an appropriate level; `partial` means useful lower-level
  coverage exists but the user-facing boundary or scenarios are incomplete;
  `missing` means no meaningful current evidence exists.
- **Final acceptance evidence**: the named test file(s), fixture, and/or
  command that must be green before the matrix row is complete.

## Definition of Done

- Every implemented feature and subscenario in the matrix has a test, or a
  written `N/A` rationale that explains why a test is not applicable.
- Every state-changing endpoint has coverage for:
  - the successful request and response;
  - unauthenticated behavior;
  - authorization behavior for a different user or disallowed resource;
  - validation failure, including malformed and boundary input; and
  - a persistence assertion against the file-backed database.
- Financial flows assert exact integer paise values end to end. No float
  comparisons, visual-only checks, or rounded rupee assertions may replace the
  underlying paise assertion.
- Per-user flows prove both same-user success and other-user isolation. A
  successful response is not enough if another household user could read or
  mutate the data.
- Migration tests cover a fresh database and upgrade from an immutable frozen
  historical database. The upgrade assertion checks both schema and preserved
  rows.
- Security tests use actual HTTP requests through the relevant middleware and
  assert both accepted and rejected requests. Pure helper tests supplement,
  but do not substitute for, middleware tests.
- UI tests are limited to behavior-heavy state machines: login/setup flows,
  countdowns, user switching, update prompts, cache/update activation, and
  theme persistence. Static markup and styling are not acceptance criteria.
- Runtime composition is tested with Nuxt's real server and real headers where
  the behavior depends on middleware ordering, cookies, runtime config, or
  `useDb()` initialization.
- No global line-coverage threshold is introduced. The scenario/feature matrix
  is the gate; line coverage may be inspected diagnostically only.

## Target Test Layout

The following is the target tree after the three PRs. `[move]` identifies
existing tests relocated or split without changing their behavior; `[new]`
identifies tests to be added. Files under a feature directory may contain pure,
DB, HTTP, mounted UI, or browser tests as appropriate.

```text
tests/
├── features/
│   ├── auth/
│   │   ├── token-and-session-lifecycle.test.ts [move: auth, token/debounce]
│   │   ├── session-schema.test.ts [move: auth, schema]
│   │   ├── revocation.test.ts [move: auth, revocation SQL]
│   │   ├── http-flows.test.ts [new]
│   │   ├── rate-limits.test.ts [new]
│   │   └── login-state-ui.test.ts [new]
│   ├── accounts/
│   │   ├── balance-math.test.ts [move: accountBalances]
│   │   └── accounts-http.test.ts [new]
│   ├── transactions/
│   │   └── transactions-http.test.ts [new]
│   ├── categories/
│   │   └── categories-http.test.ts [new]
│   ├── dashboard/
│   │   ├── period-resolution.test.ts [move: dashboardPeriods]
│   │   ├── dashboard-http.test.ts [new]
│   │   └── chart-contracts.test.ts [new]
│   ├── budget/
│   │   └── budget-settings.test.ts [new]
│   ├── backup/
│   │   ├── binary-backup.test.ts [move: backup, runBackup]
│   │   ├── json-export.test.ts [move: backup, runExport]
│   │   ├── json-import-compatibility.test.ts [new]
│   │   └── operations-http.test.ts [new]
│   ├── security/
│   │   ├── csrf-policy.test.ts [move: csrf]
│   │   ├── csp-policy.test.ts [move: csp]
│   │   ├── middleware-http.test.ts [new]
│   │   ├── security-headers-http.test.ts [new]
│   │   └── error-envelope.test.ts [new]
│   ├── migrations/
│   │   ├── snapshot-integrity.test.ts [move: migrations, snapshot checks]
│   │   ├── fresh-schema.test.ts [move: migrations, fresh DB]
│   │   ├── historical-upgrade.test.ts [move: migrations, upgrade]
│   │   └── runtime-pragmas.test.ts [new]
│   ├── pwa/
│   │   ├── version-metadata.test.ts [new]
│   │   ├── update-prompt.test.ts [new]
│   │   └── offline-cache.test.ts [new]
│   ├── preferences/
│   │   └── theme.test.ts [new]
│   └── changelog/
│       └── changelog-rendering.test.ts [new]
├── unit/
│   ├── money.test.ts [keep: current 18; genuinely shared utility]
│   └── dates.test.ts [keep: current 9; genuinely shared utility]
├── integration/
│   └── runtime/
│       ├── nuxt-http-harness.test.ts [new]
│       └── db-isolation.test.ts [new]
├── helpers/
│   ├── nuxt-server.ts [new]
│   ├── file-db.ts [new]
│   ├── fixtures.ts [new]
│   ├── http.ts [new]
│   └── assertions.ts [new]
└── fixtures/
    ├── db/
    │   └── v1.5-pre-sessions.sqlite [new, frozen and immutable]
    ├── snapshots/
    │   ├── export-v1.0.json [new, frozen]
    │   ├── export-v1.1.json [new, frozen]
    │   └── export-v1.2.json [new, frozen]
    └── changelog/
        └── representative-release.md [new, frozen]
```

Naming rule: use `<capability>-<contract>.test.ts`; describe blocks name the
user-facing feature and scenario, not the production filename or private
function. A file represents one cohesive user-visible capability or invariant,
not necessarily one route. A route can therefore be covered by several
feature files, while a feature file can exercise several routes when that is
the complete user action.

## Feature Coverage Matrix

The target PR column is the first PR expected to close the row; PR 3 is the
final closure gate for the whole matrix. Existing pure tests are marked as
partial when they do not prove the product boundary.

| Domain | Scenarios | Current status | Target PR | Final acceptance evidence |
| --- | --- | --- | --- | --- |
| **Auth & sessions** | User list is available before login; first-time user with no PIN is routed to setup; first PIN setup succeeds and persists a bcrypt hash; valid PIN login succeeds; invalid PIN, no-PIN login, and malformed setup input return 400 with human-readable validation text; a syntactically valid non-existent setup user returns 404 with `User not found` and no mutation; current PIN is required to change an existing PIN; correct current PIN plus new PIN changes the PIN; logout revokes the current session; `/api/auth/me` returns the current user and rejects no session; missing, legacy user-id, unknown, expired, and revoked cookies are rejected; a session row is created, hashed in storage, last-seen debounce is honored, and revoke-all-other-sessions keeps only the current session; login rate limit at 20/min per IP, the first five wrong PIN requests return 401, the next request returns 429 with nested `retryAfter`, and progressive per-account cooldown is covered at 5/10/15+ failures without claiming a `Retry-After` header; login UI countdown reaches zero and enables retry; switching users clears old user state. `Forget PIN` is **NOT IMPLEMENTED** and is tracked as PR 7/v1.6.1, not a live scenario. | **closed (PR 2 + PR 3)** — 40 active tests (14 auth HTTP + 5 rate-limits + 4 login-state-ui + 16 token/session + 5 schema) plus 4 mount-skipped page scenarios with assertion plans ready when `@vue/test-utils` lands. | done | `auth/http-flows.test.ts`, `auth/rate-limits.test.ts`, `auth/login-state-ui.test.ts`, `auth/token-and-session-lifecycle.test.ts`, `auth/session-schema.test.ts` |
| **Accounts** | Create/read/update/archive/delete behavior for all eight types: `bank`, `cash`, `digital_wallet`, `credit_card`, `mutual_fund`, `fixed_deposit`, `recurring_deposit`, and `other`; credit-card limit, statement day, due day, and required-field validation; account history/transactions endpoint; archived accounts are hidden from active views but remain in history; primary account set/read/changed and cannot cross users; balance changes from each transaction type; cash, credit, and savings liquidity include exactly their intended types, exclude archived accounts, and exclude `other`; account authorization prevents another user from mutating a resource. | **closed (PR 3)** — 14 HTTP tests + 18 pure math tests; household-shared semantics confirmed (no per-user column). | done | `accounts/accounts-http.test.ts`, `accounts/balance-math.test.ts` |
| **Categories** | List categories; preserve parent/child tree; return type (`expense`/`income`) and essential flag; archive behavior; archived categories are not offered for new transactions while historical rows still resolve; invalid type/parent and other-user access are rejected. | **closed (PR 3)** — 6 HTTP tests; 37-category seeded tree, exact ordering, parent/child, isEssential, archive filter, 401 gate. | done | `categories/categories-http.test.ts` |
| **Transactions** | Create and persist expense, income, transfer, and interest; strict validation for type, positive integer paise amount, date, account, category, `toAccountId`, and required transfer fields; reject same-account transfers; enforce account/category/type compatibility; same-user success and other-user authorization rejection; edit and delete each type; merged-state validation after create/edit/delete prevents stale or duplicate local state; account history; date/type/category/account filters; pagination ordering and boundaries; `spentBy` filtering and persistence; exact balance effects for all four flows. | **closed (PR 3)** — 22 HTTP tests; all 4 types, strict validation, transfer/interest/expense/income invariants, FK 404s, post-merge type-compat revalidation, list filters + pagination + invalid-query 400, date range, shared ledger, post-delete orphan check, golden paise balances. Household-shared model confirmed. | done | `transactions/transactions-http.test.ts` |
| **Dashboard & budget** | Golden aggregates for income, expense, interest, transfers, savings, and net totals; cash/credit/savings liquidity tiles; account cards and recent transactions; static periods (`this_month`, `last_30`, `last_90`); since-last-salary previous-month/current-month/most-recent/start-of-month fallback and precedence; custom range validation; chart contracts for donut, cash flow, and daily spends; daily series zero-fills missing dates and uses local calendar dates; user settings read/write; monthly budget and primary account are isolated per user; budget progress and empty-data behavior. | **closed (PR 3)** — 23 active tests (12 HTTP + 5 chart + 6 budget) + 19 pure period tests; golden aggregates, mixed paise/rupee units, static/custom periods, topCategories, recentTransactions, liquidity, per-user budget isolation. | done | `dashboard/dashboard-http.test.ts`, `dashboard/chart-contracts.test.ts`, `dashboard/period-resolution.test.ts`, `budget/budget-settings.test.ts` |
| **Backup & operations** | JSON export is complete and versioned for v1.0, v1.1, and v1.2; import accepts all three versions with documented defaults for missing fields; FK-safe wipe/insert order preserves users, accounts, categories, settings, transactions, and sessions; export API matches script output; binary backup is a valid SQLite copy containing schema, data, WAL state, and `__drizzle_migrations`; source/copy integrity failures fail loudly; cleanup deletes sessions expired more than 30 days or revoked more than 7 days, and retains rows exactly at each cutoff; version metadata is generated from the changelog; runtime DB uses WAL, foreign keys ON, and synchronous NORMAL. | **closed (PR 2 + PR 3)** — 15 active tests (5 import + 3 operations + 4 cleanup + 3 version) + 9 migration tests; v1.0/v1.1/v1.2 round trips, FK-safe wipe, API/script parity (camel↔snake normalized), cutoff boundaries, version.json generation, live runtime-pragma probe. | done | `backup/json-import-compatibility.test.ts`, `backup/operations-http.test.ts`, `backup/cleanup-cutoffs.test.ts`, `backup/binary-backup.test.ts`, `backup/json-export.test.ts`, `migrations/runtime-pragmas.test.ts`, `migrations/historical-upgrade.test.ts`, `migrations/fresh-schema.test.ts`, `migrations/snapshot-integrity.test.ts`, `pwa/version-metadata.test.ts` |
| **Security** | Actual CSRF middleware checks state-changing `/api/*` methods (`POST`, `PATCH`, `PUT`, `DELETE`) with exact allowed Origin; accepts configured origin and rejects missing, foreign, partial, scheme-mismatched, and production-empty allowlists; skips safe methods and the explicitly allowed `/api/auth/*` bootstrap paths; global auth gate returns 401 for protected routes and allows auth routes; security headers appear on success, 401, 403, and 500; CSP report-only/enforce mode follows config; rate limiter keys and cooldowns are correct; all login errors expose the documented `data.message` and `data.data.retryAfter` shape without leaking details. | **closed (PR 2)** — 67+ active tests (11 middleware + 6 headers + 4 envelope + 4 policy + 17 CSRF + 11 CSP); 500-response header case explicitly skipped (no deterministic unhandled-500 route). The configured `nitro.errorHandler` and `render:response` plugin guarantee the shared policy on error paths. | done | `security/middleware-http.test.ts`, `security/security-headers-http.test.ts`, `security/error-envelope.test.ts`, `security/security-headers-policy.test.ts`, `security/csrf-policy.test.ts`, `security/csp-policy.test.ts` |
| **PWA, changelog & preferences** | `public/version.json` contains the current changelog version and release bullets; old app shell learns the new version with no-store metadata fetch; update prompt appears when an update is waiting, activates only on user action, and dismisses correctly; offline cache contains app shell but does not expose one user's authenticated API data to another; theme toggles and persists as a device preference across logout/user switching; changelog page renders representative release sections, bullets, and version metadata without relying on fragile styling. | **closed (PR 3)** — 17 active tests (4 update-prompt + 2 offline-cache + 4 theme + 4 changelog + 3 version-metadata) + 3 mount/browser skips with assertion plans + manual production-preview smoke checklist. | done | `pwa/version-metadata.test.ts`, `pwa/update-prompt.test.ts`, `pwa/offline-cache.test.ts`, `preferences/theme.test.ts`, `changelog/changelog-rendering.test.ts` |
| **Forget PIN** | Recovery/Forget PIN flow, recovery authentication, rate limit, and session consequences. | **N/A — NOT IMPLEMENTED; planned for PR 7/v1.6.1** | Deferred | No live test until an implementation specification, threat model, API/UI contract, and recovery mechanism exist; add a new matrix row or replace this N/A when implementation starts |

## PR 1 — Reorganize around capabilities

PR 1 is a no-behavior-change test move and split. It establishes ownership and
the matrix without claiming new product coverage. The count must remain exactly
133.

### Exact move/split map

| Source file | Current tests | Destination | Tests after split | Action |
| --- | ---: | --- | ---: | --- |
| `tests/unit/money.test.ts` | 18 | `tests/unit/money.test.ts` | 18 | Keep in shared unit lane |
| `tests/unit/dates.test.ts` | 9 | `tests/unit/dates.test.ts` | 9 | Keep in shared unit lane |
| `tests/unit/accountBalances.test.ts` | 18 | `tests/features/accounts/balance-math.test.ts` | 18 | Move unchanged |
| `tests/unit/dashboardPeriods.test.ts` | 19 | `tests/features/dashboard/period-resolution.test.ts` | 19 | Move unchanged |
| `tests/server/auth.test.ts` | 24 | `auth/token-and-session-lifecycle.test.ts` (16), `auth/session-schema.test.ts` (5), `auth/revocation.test.ts` (3) | 24 | Split by token/lifecycle, schema, and revocation invariant |
| `tests/server/backup.test.ts` | 9 | `backup/binary-backup.test.ts` (6), `backup/json-export.test.ts` (3) | 9 | Split by operation |
| `tests/server/migrations.test.ts` | 8 | `migrations/snapshot-integrity.test.ts` (2), `migrations/fresh-schema.test.ts` (3), `migrations/historical-upgrade.test.ts` (3) | 8 | Split by migration boundary |
| `tests/server/csrf.test.ts` | 17 | `security/csrf-policy.test.ts` | 17 | Move unchanged |
| `tests/server/csp.test.ts` | 11 | `security/csp-policy.test.ts` | 11 | Move unchanged |
| **Total** | **133** | Feature-owned tree plus shared unit tests | **133** | No new scenarios in PR 1 |

The auth lifecycle destination includes the 4 hash tests, 4 token-generation
tests, 3 token-length discriminator tests, and 5 last-seen debounce tests.
The backup binary destination contains the 6 `runBackup` tests; JSON contains
the 3 `runExport` tests. The migration destinations contain, respectively,
the 2 snapshot parity tests, 3 fresh-schema tests, and 3 existing-DB tests.
This makes the split mechanically auditable rather than an approximate rename.

### PR 1 acceptance criteria

- The target tree and file ownership match the map above; no implementation
  files, migrations, or assertions are changed.
- The README's test command/layout note and this feature matrix identify the
  feature-first ownership rule.
- `pnpm test:run` remains at **133 passing tests**.
- `pnpm typecheck` passes.
- The two shared utility files remain in `tests/unit/`; all other existing
  tests have a feature owner.
- The moved migration tests still explicitly name the current
  `0002_sessions_and_index.sql` and `meta/0002_snapshot.json` contract.

## PR 2 — Real auth, security, and migration boundaries

PR 2 turns the existing helper/schema evidence into real application boundary
tests. It adds an estimated **45–55 tests**, with the exact count determined by
the scenario matrix rather than by an arbitrary target.

### Harness requirements

- Use Nuxt 3's `@nuxt/test-utils` to start the real Nuxt server and exercise
  actual Nitro routes and middleware ordering.
- Each test context gets a unique **file-backed SQLite database** and a unique
  `NUXT_DB_PATH`, created before the module that first calls `useDb()` is
  imported. Never use `:memory:` for app integration: WAL and singleton
  behavior differ from production.
- Because `useDb()` is a module-level singleton, isolate contexts by process or
  worker with one database path per context, run singleton-sensitive suites
  serially, close the server before deleting the temporary directory, and
  never reuse a DB path across parallel workers. Do not let a test mutate a
  shared singleton DB.
- Set the test runtime allowlist explicitly and send real `Origin` and
  `Cookie` headers. Do not call route handlers directly for middleware tests.
- Seed deterministic `u_vimal` and `u_pavithra` users, known PIN hashes, and
  the minimum category/account graph. Keep each test's data small enough that
  a persistence assertion can name the exact row.
- Use real cookies from the response for `/me`, logout, setup-PIN, and protected
  routes. Assert both the cookie attributes/clearing behavior and the session
  row state where relevant.
- For rate-limit boundaries, use isolated IPs or isolated server processes;
  do not share limiter state between parallel tests. Use fake time only for
  pure cooldown calculations, not as a substitute for a real HTTP request.
- Put the immutable historical database at
  `tests/fixtures/db/v1.5-pre-sessions.sqlite`. It represents the v1.5
  pre-sessions schema, is never modified in place, and is copied to a temporary
  path before an upgrade test.

### Required boundary scenarios

1. **Auth HTTP**: list users without exposing PIN hashes; first setup for a
   no-PIN user; valid and invalid login; malformed setup input returns 400,
   while a syntactically valid non-existent user returns 404 with `User not found`;
   current-PIN setup/change; logout; `/me`; and the missing, legacy, unknown,
   expired, and revoked cookie cases. Assert status, response envelope, cookie,
   DB session, and user identity.
2. **Session lifecycle**: login creates a 43-character raw cookie token but a
   64-character SHA-256 ID in SQLite; logout revokes before the request is
   considered complete; changing a PIN revokes other sessions in the correct
   order and retains the newly created session; same-user sessions never affect
   another user's rows.
3. **Rate limits**: permit the configured 20 requests/minute threshold and
   reject the next request; return 401 for the first five wrong PIN requests,
   then 429 with nested `retryAfter` on the next request; assert progressive
   account cooldown at 5, 10, and 15+ failures; do not claim a `Retry-After`
   HTTP header.
4. **CSRF and auth middleware**: exercise every state-changing method,
   missing/allowed/foreign Origin, auth bootstrap exceptions, safe-method
   skips, protected-route 401, and an authenticated request with a valid
   Cookie. Confirm CSRF rejection happens before a protected DB lookup.
5. **Headers and errors**: assert CSP mode plus HSTS, nosniff, frame, referrer,
   permissions, and related headers on success and 401/403 responses. The 500
   header case is explicitly skipped — no deterministic unhandled-500 route
   exists, and no production crash route will be added solely for testing. The
   configured `nitro.errorHandler` and `render:response` plugin guarantee the
   shared security policy on every error path.
   Assert the login error envelope at 400/401/429, including human text in
   `data.message` and lockout seconds in nested `data.retryAfter`; setup-pin
   validation errors are 400, while syntactically valid unknown users are 404.
6. **Migration boundary**: copy the frozen v1.5 DB, run the real migrator, and
   assert `sessions`, its indexes, `idx_txn_account_date`, migration journal
   parity, and preservation of the historical user/account/transaction rows.
   Run the migrator again and assert byte-level logical schema/data state is
   unchanged. Keep the existing fresh and snapshot tests in the same feature
   owner.
7. **Runtime DB**: boot the app against a unique file and prove through a
   live, env-guarded test-only probe route (only registered when the harness
   sets `NUXT_TEST_RUNTIME_PROBE=1`) that the *live* server-process
   `useDb()` connection reports `journal_mode=WAL`, `foreign_keys=1`, and
   `synchronous=NORMAL`, and that its `database_list` resolves to the
   harness's unique file-backed path — never `:memory:` or the shared
  `data/dev.db`. The probe is auth-gated (`/api/*` not `/api/auth/*`) and
  returns 404 in production.

### Expected additions, risks, and evidence

| Area | Expected new scenarios | Main risk | Mitigation | Acceptance evidence |
| --- | ---: | --- | --- | --- |
| Auth HTTP and session lifecycle | 20–24 | Tests accidentally trust handler helpers or stale cookies | Real Nuxt HTTP, response cookies, DB row assertions, two users | `auth/http-flows.test.ts` green |
| Rate limits | 7–9 | Shared in-process state makes tests order-dependent | Unique IP/process per case and explicit time control for pure branches | `auth/rate-limits.test.ts` green |
| Middleware, headers, envelope | 12–15 | Testing only pure builders misses ordering and error responses | Actual Origin/Cookie requests through the server | `security/*-http.test.ts` green |
| Historical migration/runtime DB | 6–8 | Fixture mutated or latest schema used as a fake history | Copy immutable v1.5 fixture; inspect journal and preserved rows | `migrations/historical-upgrade.test.ts` and `runtime-pragmas.test.ts` green |
| **Estimated addition** | **45–55** |  |  | Baseline remains 133 before these additions |

PR 2 is accepted only when all 133 reorganized tests plus these new boundary
scenarios pass, `pnpm typecheck` passes, and the auth/security/migration rows in
the matrix have named evidence. A passing pure-helper suite alone is not PR 2
evidence.

## PR 3 — Core financial, household, backup, and UI contracts

PR 3 closes the remaining product matrix with an estimated **60–75 tests**.
The work may be split into safe execution lanes or commits (for example,
financial HTTP, backup/operations, and UI/PWA) as long as the final PR gate
runs the complete matrix.

### Required scenarios by lane

#### Financial and household lane

- **Accounts**: create and update each of the eight account types; validate
  credit-card-only fields and invalid combinations; archive and verify active
  list/history behavior; fetch account transactions; set/read/change the
  primary account; assert CRUD persistence and authorization for both users.
- **Transactions**: exercise expense, income, transfer, and interest through
  the real API; reject every strict-invalid shape in the schema; reject a
  same-account transfer; test edit/delete and a fresh reload/merged-state
  sequence; filter by dates, account, category, type, and `spentBy`; page over
  stable ordering; assert exact paise effects on source and destination
  accounts.
- **Categories**: verify flat listing and parent/child tree, type, essential,
  archive, historical reference, validation, and user authorization behavior.
- **Dashboard**: seed a golden household ledger and assert the complete
  aggregate response, liquidity buckets, account cards, recent transactions,
  salary fallback period, custom period validation, and empty-state behavior.
  Assert daily chart labels use local `YYYY-MM-DD` dates and include zero rows
  for every missing day. Assert donut/cash-flow/daily-spends payloads rather
  than canvas pixels.
- **Budget/settings**: read and write monthly budget and primary account;
  verify settings are isolated by `user_id`, changing one user does not alter
  the other, and dashboard budget progress consumes the stored integer paise
  value.

#### Operations lane

- Import immutable v1.0, v1.1, and v1.2 snapshots into disposable file DBs.
  Verify missing `userSettings`/`sessions` fields receive the documented
  defaults, current fields round-trip, and FK-safe deletion/insertion does not
  lose rows.
- Compare JSON script export with `/api/export/json` for the same DB, including
  six user-facing tables and version metadata. Assert the public route remains
  protected by the global auth gate.
- Exercise binary backup and reopen the copy read-only; verify integrity,
  migrations journal, indexes, WAL-consistent data, and failure behavior for a
  missing/corrupt source or destination.
- Test session cleanup exactly before, at, and after 30-day expiry and 7-day
  revocation cutoffs; retain active and not-yet-eligible rows.
- Run version metadata generation against a representative changelog and
  assert version plus bullet list in `public/version.json`.

#### UI/PWA lane

- Mount the login flow and test only the state machine: user selection,
  no-PIN setup, error envelope display, 429 countdown, retry enablement, and
  user-switch reset. Do not assert class names or pixel layout.
- Mount `PwaUpdatePrompt` with install/update states and prove it waits for the
  user's activation action, handles dismissal, and does not appear when no
  update is waiting.
- Run a tiny production-preview browser test to verify version fetch is
  `no-store`, the service worker update path is usable, app-shell offline
  fallback works, and authenticated API responses are not exposed through
  shared offline cache entries.
- Mount the theme preference behavior and prove persistence across reload and
  independence from logout/user-data reset. Render the changelog fixture and
  assert release/version/bullet content.

### Expected additions, risks, and evidence

| Lane | Expected new scenarios | Main risk | Mitigation | Acceptance evidence |
| --- | ---: | --- | --- | --- |
| Accounts and balance contracts | 12–15 | Type-specific rules or archived/primary behavior diverge | One deterministic fixture per type, exact DB and paise assertions | `accounts/*` green and Accounts row closed |
| Transactions and categories | 18–22 | Overly broad fixtures hide authorization or merged-state bugs | Small two-user fixtures, endpoint matrix, reload after mutation | `transactions/*`, `categories/*` green |
| Dashboard and budget | 12–16 | Date timezone drift or aggregate rounding hides errors | Local-date fixtures, golden integer-paise totals, zero-fill assertion | `dashboard/*`, `budget/*` green |
| Backup and operations | 9–12 | Import tests accidentally use latest-shaped data | Immutable v1.0/v1.1/v1.2 fixtures and independent DB copies | `backup/*`, runtime/migration evidence green |
| PWA, preferences, changelog | 9–12 | Browser tests become visual, slow, or cache-order dependent | Small production-preview smoke set; behavior-only mounted tests | `pwa/*`, `preferences/*`, `changelog/*` green |
| **Estimated addition** | **60–75** |  |  | Full matrix, not just this lane, is the gate |

PR 3 does not close until every implemented matrix row is green, including
the PR 2 auth/security/migration rows and the 133 reorganized baseline. The
expected total after PR 3 is approximately 238–263 tests; the count is a
diagnostic for missing work, not the acceptance criterion.

## Anti-Patterns We Will Avoid

- **Constructing an old DB by migrating the latest schema and deleting tables.**
  Historical upgrade coverage must copy the frozen v1.5 pre-sessions fixture.
  Deleting current objects does not reproduce old migration journals, column
  order, defaults, or real historical data.
- **Duplicating production SQL in tests.** Use the real Drizzle migrations,
  schema, scripts, and route stack. Test setup may seed data, but must not
  reimplement the migration or production query being verified.
- **Calling a helper an “integration test” when it never crosses a boundary.**
  A pure function test is valuable and should be labeled pure; an integration
  claim requires the real file DB, runtime, HTTP, migration, or script boundary
  it purports to cover.
- **Adding a line-coverage gate.** Lines can execute while a user can still
  log in as the wrong user, lose paise, or restore an incomplete backup. The
  feature matrix is the gate.
- **Testing each implementation file rather than each capability.** A route,
  composable, and component may be covered together by one feature scenario;
  split files only when they represent distinct contracts or make ownership
  clearer.
- **Writing timezone-neutral date tests.** Use local calendar constructors and
  explicit timezone-sensitive boundaries; never silently rely on UTC or
  `toISOString().slice(0, 10)` for local day bucketing.
- **Sharing mutable singleton DB or limiter state across parallel tests.** Use
  unique file paths, isolated Nuxt processes/workers, deterministic cleanup,
  and explicit serial execution where module singletons require it.
- **Using snapshots as the financial oracle.** Snapshot the shape only where
  useful; assert exact paise totals, identity, authorization, and persisted
  rows explicitly.
- **Using a browser test for every page.** Reserve production-preview browser
  runs for PWA/cache/update behavior and use mounted UI tests only for
  behavior-heavy state machines.

## Execution Order and Gates

1. **PR 1 → PR 2 → PR 3.** Do not add boundary tests on top of ambiguous file
   ownership. PR 1 first preserves the 133-test baseline while making the
   matrix auditable.
2. Each PR must run `pnpm test:run` and `pnpm typecheck`. PR 1 additionally
   proves the count is still 133; PR 2 proves all auth/security/migration rows;
   PR 3 proves the entire matrix.
3. Fast pure/unit tests run on every change. File-backed DB and real HTTP tests
   run in isolated Node/runtime lanes. They must not share DB paths or mutable
   limiter state.
4. Run selective mounted UI tests when their feature changes. Run the small
   production-preview browser/PWA set for PWA, cache, changelog, or app-shell
   changes; do not turn the whole suite into browser tests.
5. CI runs the full Vitest suite, typecheck, and the selected browser smoke
   tests. Build/preview setup is part of the PWA/version evidence. No line
   threshold may fail CI.
6. A matrix row is closed only when its final evidence is green and the test
   asserts the user-visible contract at the appropriate boundary. A passing
   test count with an open `missing` or unjustified `partial` row is a failed
   gate.

## Deferred / Not Implemented

- **PIN recovery / Forget PIN**: not implemented; no live test should pretend
  it exists. Before PR 7/v1.6.1, define the recovery identity, threat model,
  token lifetime, rate limits, notification/recovery channel, session
  revocation rules, UI states, and error envelope. Then add feature-owned unit,
  HTTP, security, and UI scenarios.
- **Active sessions UI**: session storage/revocation backend behavior is in
  scope, but a user-facing list/revoke-sessions screen is not implemented.
  Add its plan only when the screen and API contract start.
- **Future functionality**: do not create speculative tests for roadmap items.
  When a feature is implemented, add its scenarios and final acceptance
  evidence to this matrix in the same change that introduces its tests.
