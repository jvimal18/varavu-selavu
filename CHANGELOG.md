# Changelog

All notable changes to VaravuSelavu are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/) · This project does not yet use SemVer for the app; release tags follow `vMAJOR.MINOR.PATCH`.

## [v1.6.0] - 2026-08-07

### Added
- **Vitest test suite (64 unit tests across 4 files + 8 backup integration tests = 72 total).** Pure-function unit tests for the highest-risk code in the repo: `tests/unit/money.test.ts` (paise conversions, `formatPaise` edge cases), `tests/unit/dates.test.ts` (`localISODate` for UTC+0, UTC+5:30, DST boundaries), `tests/unit/accountBalances.test.ts` (golden sums for `bank` / `credit_card` / `mutual_fund` across all four `transactions.type` values; archived accounts excluded from liquidity), `tests/unit/dashboardPeriods.test.ts` (the `since_last_salary` 4-branch fallback chain). `vitest.config.ts` (Node env, `~~` → repo root alias, `isolate: true`). `package.json` scripts: `test`, `test:run`, `test:watch`.
- **GitHub Actions CI with hosted-primary → self-hosted+Docker fallback.** Two workflows in `.github/workflows/`: `build-and-test.yml` (reusable, runs inside `container: image: node:22-bookworm`) and `ci.yml` (caller, two jobs — `hosted` on `ubuntu-latest`, `self-hosted` on `[self-hosted, linux, dev]` with `needs: hosted, if: failure()` so it only runs as a fallback). Triggers: `push` + `pull_request` to `main` **and** `phase1/**`, plus `workflow_dispatch` for manual re-runs. Concurrency: `cancel-in-progress: true` per ref. Branch protection on `main` should require the **"Build & Test (self-hosted fallback)"** check (it counts as `skipped` → passing when hosted succeeds, so normal merges stay unblocked).
- **`ROADMAP.md` is now tracked in the repository.** Previously gitignored (per v1.4.2) as "personal scratch", it's been reclassified as a project document — it carries the at-a-glance phase status, the per-PR plan, and "what's done / what to do next". `DECISIONS.md` stays gitignored; `ROADMAP.md` + `CHANGELOG.md` + `AGENTS.md` are the three docs.
- **Self-hosted runner registered as `vimal-dev`.** Pool `Default`, labels `self-hosted, Linux, X64, dev`. Lives at `/home/vimal/actions-runner` on `vimal-hp` (this machine). Not a deploy — purely for the CI fallback.
- **Binary SQLite backup as a second defense layer** (`scripts/backup-binary.mjs`). Full DB snapshot via `better-sqlite3`'s online backup API (`db.backup(destPath)`). Captures everything: user data, schema, WAL state, and `__drizzle_migrations` (so the backup survives schema changes — the JSON export drops anything not in its hardcoded table list, which is the bug below). Verifies via `PRAGMA integrity_check` on the copy; asserts the expected 5 user-facing tables are present. Module exports `runBackup()` for testability.
- **Daily binary backup on the Pi** (`systemd/budget-tracker-binary-backup.{service,timer}`). Runs at 03:00 daily, 1 hour after the JSON export at 02:00, as the `budget` user (`Type=oneshot`). Picked up by the existing `deploy.sh` systemd rsync step (the deploy script already globs `systemd/`).
- **Backup test suite** (`tests/server/backup.test.ts`, 8 integration tests): backup file has all 5 user-facing tables; backup is a valid SQLite file with the same data; binary captures `__drizzle_migrations`; `runBackup` throws if source DB missing; export produces a v1.1 snapshot with all 5 tables; export handles empty DBs; export + backup both pass `integrity_check`; failure path (corrupt backup) is detected.

### Fixed
- **Silent data loss in JSON backup (`scripts/export.mjs` / `scripts/import.ts`).** The export shipped in v1.0.0 hardcoded a 4-table list (`users`, `accounts`, `categories`, `transactions`) and silently dropped `user_settings` — added in v1.1.0 (migration `0001`). Any `budget.db` restored from a pre-v1.6.0 JSON snapshot lost the primary account, the monthly budget, and per-user preferences, with no warning. `scripts/export.mjs` now exports the 5th table (snapshot version bumped 1.0 → 1.1); `scripts/import.ts` accepts the new `userSettings` field, defaults to `[]` for v1.0 snapshots (backward compat), and the wipe + insert order is updated to respect the `user_settings → accounts` FK (`users` → `accounts` → `categories` → `user_settings` → `transactions`).
- **No `PRAGMA integrity_check` on the export path.** The export now opens the source DB with a separate `Database` instance, runs `integrity_check` before writing the JSON, and exits non-zero on `not ok`. A corrupt source DB no longer silently ships to Drive.

### Changed
- **`composables/useAccountBalances.ts`** — hoisted a `Map<id, account>` for O(1) type lookups (was O(n) per transaction). Refactor motivated by the `accountBalances.test.ts` golden-sums suite.
- **`utils/dates.ts`** — new file. `localISODate` + `localMonthKey` moved out of `server/api/dashboard.get.ts` (shared across server + client).
- **`server/utils/dashboardPeriods.ts`** — new module, extracted from `server/api/dashboard.get.ts`. The `since_last_salary` resolver now takes a `FindSalaryDate` callback so the chain is pure (no DB dependency in the unit test).
- **CI actions bumped to `@v5`.** `actions/checkout`, `pnpm/action-setup`, `actions/cache` all pin `using: node24` (the v4 versions were being force-upgraded to Node 24 by the runner and emitting "Node 20 is being deprecated" warnings). `pnpm/action-setup@v5` keeps the same `package_json_file` input we rely on.
- **`pnpm/action-setup` no longer takes an explicit `version`.** `package.json` pins `pnpm@9.12.0` via `packageManager`; passing both produces `ERR_PNPM_BAD_PM_VERSION`. Let the action read `packageManager` and stay single-source-of-truth.
- **CI triggers widened from just `main` to `main` + `phase1/**`.** Direct pushes to phase1 branches also run CI without needing a PR first.

### Operational
- **Action required post-deploy**: any pre-v1.6.0 JSON snapshot in the local exports directory or in Google Drive is now considered stale (missing `user_settings`). Re-export once after the v1.6.0 deploy lands; the new file is the authoritative backup.

## [v1.5.0] - 2026-08-03

### Added
- **PWA update prompt with version-aware changelog (Twitter / Starbucks / Pinterest pattern).** The PWA's `registerType` is now `'prompt'` (was `'autoUpdate'`): the new service worker installs in the background but waits; a small bottom-right toast appears with a manual **Refresh** button. The user controls the moment of activation, so we never wipe in-progress form input on a surprise reload. The toast shows the new version number (mono, terra-700), the first two changelog bullets (clamped to two lines, inline markdown stripped for readability), a primary **Refresh** button that calls `$pwa.updateServiceWorker()` (which posts `SKIP_WAITING`; the new SW activates and the page reloads via the `controlling` event — deliberately no manual `location.reload()`), a secondary **Later** button, a **View full changelog** link, and a generic fallback message if the version fetch fails. It also gets focus on appear, dismisses on Escape, and uses a skeleton state while loading. Mobile: `fixed left-4 right-20 bottom-20` (sits above the bottom nav, clear of the FAB at `right-4 bottom-20`). Desktop: `fixed bottom-4 right-4 max-w-sm`. `z-[60]` (above the modal layer).
- **`/changelog` page** (the "View full changelog" target). Renders the full `CHANGELOG.md` (imported as a raw string via Vite's `?raw` query), parsed by `utils/changelog.ts` and rendered with a minimal inline-markdown renderer (`**bold**`, `` `code` ``). Newest-first; each version gets a terra-700 mono heading, its date, and its bulleted changes grouped by subsection. The page is reachable directly via the URL and is the canonical release history (the `README.md` closing pointer now points here instead of the removed `DECISIONS.md`).
- **Version discovery via `public/version.json`.** The OLD app shell can't know the NEW version from its own baked-in `APP_VERSION`, so we ship a tiny static file generated at build time by the new `scripts/generate-version-json.mjs` (wired as `prebuild` + `predev` in `package.json`). The script parses the latest entry of `CHANGELOG.md` into `{ version, date, bullets }`. The new `composables/useAppUpdate.ts` fetches `/version.json` (always network — `cache: 'no-store'` + `Cache-Control: no-cache`; the workbox precache explicitly ignores it via `workbox.globIgnores: ['**/version.json']`), compares to `APP_VERSION`, and exposes `availableUpdate` to the toast. The build pipeline (deploy + dev) regenerates the file on every run, so the developer only needs to update `CHANGELOG.md` and the rest is automatic.
- **Hourly PWA update check.** `pwa.client.periodicSyncForUpdates: 3600` (seconds) — an installed PWA now learns about a new deploy within an hour even without a navigation, instead of only on the next page load.

### Changed
- **`pwa.registerType` switched from `'autoUpdate'` to `'prompt'`.** This is a one-way decision: users with the old autoUpdate SW keep the old behaviour until the new SW replaces theirs. The benefit is that the user controls the reload moment, which is the right default for a form-heavy app like a budget tracker.

## [v1.4.2] - 2026-08-03

### Added
- **Period selector: "Total spent" tile.** The period secondary row now shows three metrics instead of two: `Income` · `Total spent` · `Expense` (with the monthly-budget widget still below Expense). `Total spent` mirrors `periodExpense` (transfers are excluded) but is surfaced as its own tile so the period-total is explicit and reads naturally next to Income. Rounded to whole rupees via `Math.round(paise / 100).toLocaleString('en-IN')` for consistency with the v1.4.1 hero/period display fix. The mobile-vs-`sm` periodLabel suffix behaviour from v1.4.1 carries over (the suffix is already shown by the chips above on `<sm`).

### Removed
- **`DECISIONS.md` is no longer tracked in this repository.** The file has been added to `.gitignore` and the entire history (across all branches and tags) has been rewritten so that the file is gone from every commit and every tag on the remote. The local working copy at `DECISIONS.md` is preserved (it's still useful as personal scratch space) but is now treated as an untracked, local-only file. The three references to `DECISIONS.md` in `README.md` (the Node 22 gotcha note, the Forgot-PIN row in the troubleshooting table, and the closing "project bible" pointer) have been re-pointed: the gotcha note drops the parenthetical, the Forgot-PIN row drops the `§8 Q10` reference, and the closing pointer now points at `CHANGELOG.md` (the canonical release history).
- **Date column removed from `TransactionRow`.** Both the mobile-only inline date (visible below `sm`) and the `sm+` right-aligned date column have been removed. The consolidated period date is already shown by the surrounding list (the per-day header in `DashboardRecentTransactions` and the transactions page) so the per-row date is redundant noise. The now-unused `displayShortDate` import has been dropped from `TransactionRow.vue`; `displayShortDate` itself stays in `utils/dates.ts` because `pages/accounts/[id].vue` still uses it.

## [v1.4.1] - 2026-08-03

### Fixed
- **Dashboard hero overflow on mobile (Cash/Credit/Savings tiles).** The liquidity rupee values could be wider than a 2-col mobile tile and spilled past the card edge. The hero grid is now `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` (stacked on phones, 2-up from `sm`, 3-up from `lg`); the value containers get `min-w-0` and `break-words` as a safety.
- **Period selector secondary stats overflow on mobile.** The Income / Expense + budget row in `PeriodSelector` pushed content against the viewport's right edge (`"+ Set budget"` wrapped awkwardly, Expense value clipped). The period label suffix is now hidden below `sm` (it's already shown by the chips above), the Income/Expense blocks get `min-w-0` and wrap cleanly, the budget progress bar wraps with the label, and the budget editor (`+ Set budget` → input + Save + Cancel) wraps to a new line on narrow viewports and the input goes `w-full sm:w-36`.
- **Rupee values showed a single trailing decimal** (e.g. `₹14,46,150.6`) on the hero tiles and the period Income/Expense. The underlying paise is integer, but `(paise / 100).toLocaleString('en-IN')` drops trailing zeros (`…150.60` → `…150.6`), which is wrong for money. All five displays now round to the nearest whole rupee: `Math.round(paise / 100).toLocaleString('en-IN')`. No more stray decimals.
- **Page-level horizontal scroll on the dashboard (the "hides nav bar" symptom).** Two new sources of horizontal overflow (the hero + the period selector) made the body horizontally scrollable, which on mobile produced a horizontal scrollbar at the bottom and a confused scroll context that interfered with the fixed bottom nav. The two overflow fixes above are the root cause; as a belt-and-suspenders safeguard the dashboard page root is wrapped in `overflow-x-hidden` so the body can never horizontally scroll on `/`, matching the behaviour of the other pages.
- **Stale workbox dev service worker ENOENT.** `@vite-pwa/nuxt` was registering a dev SW whose hashed script (`dev-sw-dist/workbox-<hash>.js`) is invalidated on every code change, producing `ENOENT: no such file or directory … workbox-<hash>.js` in the dev console. `pwa.devOptions.enabled` is now `false` — the dev SW is no longer registered. Production service workers (the `pwa.workbox` block) are unaffected; PWA still ships in `nuxt build`.

## [v1.4.0] - 2026-08-03

### Changed
- **Dashboard hero replaced** with three lifetime-position tiles: **Cash Liquidity** (sum across `bank` + `cash` + `digital_wallet`), **Credit Liquidity** (total headroom across `credit_card` accounts, `creditLimit − outstanding`), **Savings** (sum across `mutual_fund` + `fixed_deposit` + `recurring_deposit`, i.e. RD/FD/MF). Each tile shows the value and a short subtitle (account type + count). Computed in `composables/useAccountBalances.ts` (`computeCashLiquidity`, `computeCreditLiquidity`, `computeSavingsLiquidity`) and surfaced via `GET /api/dashboard`. Net Worth is no longer in the dashboard payload; it is still available on the accounts page.
- **`other` account type is excluded from all three liquidity tiles** (per the "no clarity" decision). Accounts typed `other` are still listed on the accounts page but do not contribute to any of the lifetime tiles. Re-type them to one of the explicit types to include them.
- **Period-specific stats moved into the period selector** as a compact secondary row at the bottom of the card: period **Income** and period **Expense**, with the **monthly budget widget** (progress bar + `+ Set budget` inline editor) attached to the Expense stat. The period selector still owns period selection; the hero stays focused on the three lifetime tiles.
- Backend field rename: dashboard payload `netWorth` → three new paise fields `cashLiquidity`, `creditLiquidity`, `savingsLiquidity`. `periodIncome`, `periodExpense`, `monthBudget`, `monthBudgetSet` remain (now consumed by the period selector).

### Added
- Three new top-level expense categories (seeded idempotently on every deploy; visible in the categories page + transaction form):
  - **Loan Repayment** (`banknote`, amber `#D97706`)
  - **Plants & Gardening** (`leaf`, green `#16A34A`)
  - **Hobbies** (`palette`, indigo `#6366F1`)

## [v1.3.0] - 2026-08-03

### Added
- **Day-by-day spends chart on the dashboard.** New `DashboardDailySpendsChart` (echarts bars, terra-700) renders every day's expense total for the selected period, zero-filled so the chart is continuous. Card sits below the donut/cash-flow grid and shows the period label as a subtitle. Backend computes the series in `GET /api/dashboard`; `useDashboard` types updated.
- **Login rate limiting + progressive cooldown.** New `server/utils/rateLimit.ts` enforces, on every login attempt:
  - Per-IP endpoint throttle: 20 requests/min (all attempts).
  - Per-IP failed-login block: 5 FAILED attempts per 15 min.
  - Per-account cooldown on consecutive failures: 5 → 30s, 10 → 1 min, 15+ → 5 min. Reset on success.
  Limited requests return HTTP 429 with `error.data.retryAfter` (seconds) and a human message. The real client IP is read from `X-Forwarded-For` (first entry), which is trustworthy because the app binds `127.0.0.1:3000` and only Tailscale Funnel can connect. State is in-process; resets on service restart.
- **Login page cooldown UI.** The login form now reads the 429 `retryAfter`, shows a live "Try again in N seconds" countdown, disables the submit button + numpad + keyboard input while locked, and re-enables automatically when the timer hits zero.
- **Fail2Ban integration.** Failed logins emit `[auth-fail] ip=<ip> user=<id> reason=...` to the systemd journal. `fail2ban/budget-auth.conf` (filter) and `fail2ban/jail-budget-auth.conf` (journal backend, maxretry 5, findtime 15m, bantime 1h) are shipped and installed by `scripts/deploy.sh` to `/etc/fail2ban/filter.d/` and `/etc/fail2ban/jail.d/`. `fail2ban` is apt-installed on first deploy if missing. Note: with Tailscale Funnel the iptables ban can only block the loopback connection (real client IP enforcement is in-app); the jail still gives the standard logging/blocking structure.

## [v1.2.0] - 2026-08-03

### Changed
- **Savings tile removed from the dashboard.** The four-card hero strip is now Net Worth · Income · Expense, laid out as a 3-col grid on desktop (`grid-cols-2 lg:grid-cols-3`). The `periodSavingsAmount` field is dropped from the dashboard API, the `useDashboard` type, and the `HeroStats` props; the page no longer passes it. The savings widget was confusing on its own; the same number is implicit in `periodIncome − periodExpense` and can be re-introduced later as a derived card if useful.
- **App icon unified.** `public/favicon.svg`, `public/icon.svg`, and the generated `public/pwa-192.png` / `public/pwa-512.png` now use the same design as the title-bar logo: a terra-700 (`#C2410C`) rounded square with a white `lucide:trending-up` icon. The previous favicon/PWA artwork was a cream-background "A" monogram. No `nuxt.config.ts` changes were needed — the existing `pwa.manifest.icons` entries point at these paths.

## [v1.1.3] - 2026-08-03

### Fixed
- **Critical: SSR crash on every page** (`DevalueError: Cannot stringify arbitrary non-POJOs`). `useUserSettings` was fetching `/api/user-settings` during server-side rendering; the internal `$fetch` returned 401 (no auth cookie forwarding on server-to-self requests) and the raw `FetchError` was stored in `useState`, which devalue cannot serialize. Lazy fetch is now client-only and errors are stored as serializable strings.
- "Set as primary" button on account cards was occluded by the edit/archive hover overlay (desktop + mobile). Primary container now stacks above the overlay via z-index.

### Changed
- Removed the "Spent by" / "Received by" person selector from the QuickAdd modal. New transactions are auto-attributed to the logged-in user; editing preserves the original attribution.
- Settings → About now shows the deployed app version and build date (sourced from `composables/useAppVersion.ts`, bumped per release).

### Added
- `CHANGELOG.md` — this file, maintained per release.

## [v1.1.2] - 2026-08-03

### Changed
- Edit a transaction via the same `QuickAddModal` used for adding, with pre-filled data. The separate `/transactions/:id` edit page was removed. A "Delete transaction" button appears in the modal footer when in edit mode. Tap any transaction row to edit.

## [v1.1.1] - 2026-08-03

### Fixed
- Clicking a transaction row did nothing. `pages/transactions.vue` (list) and `pages/transactions/[id].vue` (edit) were a Nuxt parent/child pair without `<NuxtPage />`, so navigating to `/transactions/:id` re-rendered the list. Moved the list into `pages/transactions/index.vue` so the two routes are siblings.
- "BANK & WALLETS" summary card on `/accounts` clipped the trailing `.65` of the value. Summary grid breakpoint moved `sm` → `lg`; values use fluid `clamp()` sizing with `min-w-0` on cards.
- Dashboard `HeroStats` had the same overflow risk (`text-3xl` in a 4-col grid starting at `md`). Same fluid-clamp + grid fix applied preventively.

## [v1.1.0] - 2026-08-03

### Added
- **Edit transaction**: pencil discoverability on `TransactionRow` (hover desktop / always mobile); `requireUser` on PATCH/DELETE `/api/transactions/:id`.
- **Per-user primary account**: new `user_settings` table + migration `0001`; `GET/PUT /api/user-settings`; `useUserSettings` composable; "Primary" badge + "Set as primary" action on `AccountCard`, `CreditCardCard`, `accounts/[id]`; `QuickAddModal` pre-selects the primary account on open (transfer override preserved).
- **Dynamic monthly budget**: removed hardcoded `₹1.2L`; reads from `user_settings`; `monthBudgetSet` flag drives a "+ Set budget" empty state with inline editor on the dashboard.
- **Savings card redesign**: replaced `periodSavingsRate` with `periodSavingsAmount` (₹, compact format); terra for positive / danger for overspent; "Income − expense" or "Overspent by ₹X" subtitle.
- **Mobile responsiveness**: fluid `clamp()` balance sizing on account cards and hero balance; `flex-wrap` on transaction filter chips; fixed mobile bottom nav on the transactions page (FAB + bottom nav moved out of the inner flex column so `position: fixed` is not broken by the page's stacking context).

## [v1.0.0] - 2026-08-02

### Added
- First deployed release (Sprints 1–4):
  - Auth (single-user, bcrypt + httpOnly cookie)
  - Accounts, Categories, Transactions (income / expense / transfer / interest)
  - Dashboard: period selector, hero stats, spending donut, cash-flow chart, top categories, recent transactions, account cards
  - Filters: date range, account, category, person, type, search
  - CSV / JSON export
  - PWA support, dark mode (system / light / dark)
  - Settings page: profile, change password, theme, backup download
  - Deployment scripts (`scripts/setup-pi.sh`, `scripts/deploy.sh`) + systemd units
  - Drizzle ORM + better-sqlite3 (WAL mode) + idempotent migration runner (`scripts/migrate.mjs`) for Pi deploys
