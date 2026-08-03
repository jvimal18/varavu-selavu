# Changelog

All notable changes to VaravuSelavu are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/) · This project does not yet use SemVer for the app; release tags follow `vMAJOR.MINOR.PATCH`.

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
