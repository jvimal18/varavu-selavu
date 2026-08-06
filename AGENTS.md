# AGENTS.md — VaravuSelavu

Personal + household budget tracker for Vimal & Pavithra. Single-user app, no
multi-tenant concerns. This file is for OpenCode agents working in this repo.

## Stack (one-liner)

Nuxt 3 + TypeScript (strict) + Drizzle ORM + better-sqlite3 + Pinia + Tailwind
+ `@vite-pwa/nuxt` + ECharts. Deployed to a Raspberry Pi 4 (192.168.0.224)
behind Tailscale Funnel.

## One-time dev setup

```bash
nvm install 22 && nvm use 22      # better-sqlite3@12 has no prebuilt for Node 18
pnpm install
cp .env.example .env              # dev secret is fine, but DO use a real one in prod
pnpm db:migrate && pnpm db:seed   # creates ./data/dev.db with u_vimal / u_pavithra
pnpm dev                          # http://localhost:3000
```

- `pnpm db:reset` — wipes `$NUXT_DB_PATH` (defaults to `./data/dev.db`), then
  re-migrates + re-seeds. Local dev only; never run on the Pi.
- `pnpm test:run` for the Vitest suite (72 tests; 64 pure-function unit tests for
  the financial-math and dashboard-period code, plus 8 backup integration tests).
  `pnpm test` for watch mode.
  Pre-PR sanity check: `pnpm typecheck && pnpm test:run && pnpm build`.

## Commands cheat sheet

| Command | What it does |
|---|---|
| `pnpm dev` | Runs `predev` → regenerates `public/version.json` from CHANGELOG, then `nuxt dev`. |
| `pnpm build` | `prebuild` → `nuxt build`. Output goes to `.output/`. |
| `pnpm typecheck` | `nuxt typecheck`. |
| `pnpm test` | Vitest in watch mode. |
| `pnpm test:run` | Vitest one-shot. What CI runs. |
| `pnpm test:watch` | Alias for `pnpm test`. |
| `pnpm db:generate` | `drizzle-kit generate` — produces a new SQL file in `db/migrations/`. |
| `pnpm db:migrate` | Runs all `db/migrations/*.sql` against the DB. Idempotent. |
| `pnpm db:seed` | Inserts u_vimal, u_pavithra, and the default category tree. Idempotent. |
| `pnpm export` | `node scripts/export.mjs [out.json]` — JSON snapshot of all 5 tables (v1.1 snapshot; pre-v1.6.0 snapshots are missing `user_settings` and unsafe to restore). |
| `pnpm import <file>` | `tsx scripts/import.ts` — WIPES + re-inserts; requires typing `YES`. v1.0 snapshots still restore; `userSettings` defaults to `[]`. |
| `node scripts/backup-binary.mjs [out.db.bak]` | Full binary backup via `better-sqlite3`'s online backup API. Captures everything (data, schema, WAL, `__drizzle_migrations`). Runs `PRAGMA integrity_check` on the copy. On the Pi, the systemd timer (`budget-tracker-binary-backup.timer`) runs this at 03:00 daily. |
| `./scripts/deploy.sh` | Local → Pi: build, rsync, prod install, fix native better-sqlite3, migrate, restart. Idempotent. |
| `./scripts/setup-pi.sh` | One-time Pi provisioning (Node 24, pnpm, rclone, `budget` system user). |
| `./scripts/export.sh` | JSON export + rclone push to Google Drive. Works from dev machine or Pi. |

Required order: `db:generate` (after editing `server/db/schema.ts`) → commit the
new SQL file → `db:migrate` to apply. Never edit files in `db/migrations/`
after they're committed — write a new migration instead.

## Architecture

- **Entry**: `app.vue` → `layouts/default.vue` (or `auth.vue` for the login
  layout) → pages in `pages/`. Global client route guard is
  `middleware/auth.global.ts`; global server auth gate is
  `server/middleware/auth.ts` (allows `/api/auth/*` only, everything else 401).
- **API surface**: `server/api/**` — auto-routed. Resource groups: `auth/`,
  `accounts/` (and `[id]/`), `categories/`, `transactions/`, `users/`, `export/`,
  plus top-level `dashboard.get.ts`, `user-settings.{get,put}.ts`.
- **DB layer**: `server/db/{client,schema,migrate,seed}.ts`. `useDb()` is a
  module-level singleton — first call opens the file, applies
  `journal_mode=WAL`, `foreign_keys=ON`, `synchronous=NORMAL`.
- **State**: Pinia stores in `stores/` (`auth`, `ui`). Composables in
  `composables/` wrap API calls + derived state. Server-side balance math
  (cash/credit/savings liquidity, account balances) lives in
  `composables/useAccountBalances.ts` and is consumed by `server/api/dashboard.get.ts`.
- **Charts**: ECharts via `vue-echarts`. Donut, cash-flow, and daily-spends
  charts live in `components/dashboard/`.
- **PWA**: `@vite-pwa/nuxt` with `registerType: 'prompt'` — install happens in
  the background, activation waits on user action. The toast is
  `components/PwaUpdatePrompt.vue` and reads from `composables/useAppUpdate.ts`.
  Mounted inside `<ClientOnly>` in `app.vue` because `$pwa` is client-only.

## Repo conventions (not Nuxt defaults)

- **Money is integer paise.** `utils/money.ts` is the only place that touches
  rupees. `rupeesToPaise()` to convert in, `formatPaise()` to display. Never
  store floats.
- **Dates are `YYYY-MM-DD` strings** in DB and most code paths. Use
  `localISODate(d)` not `d.toISOString().slice(0, 10)` — the latter drifts by
  the UTC offset, which silently breaks day-bucketing for users east of UTC.
- **Tailwind palette is custom** (`tailwind.config.ts`): `cream`, `ink`, `terra`
  are the brand. Don't pull in `bg-blue-500`-style defaults; use the
  semantic tokens (`bg-cream-100`, `text-ink-900`, `text-terra-700`, etc.).
- **Round rupee displays** with `Math.round(paise / 100).toLocaleString('en-IN')`
  for whole-rupee tiles. Stray `.6` decimals on money is a regression —
  `Intl.NumberFormat` drops trailing zeros and the v1.4.1 fix set this
  convention.
- **Login error envelope** (consumed by `stores/auth.ts`): server returns
  `createError({ statusCode, statusMessage, message, data?: { retryAfter } })`.
  Client reads `e.data.message` (human text) and `e.data.data.retryAfter` for
  the 429 lockout. Do NOT read `e.statusMessage` or `e.message` for UI.
- **Auth** is bcrypt PIN (4-6 digits) + httpOnly session cookie
  `vs_session`, 30-day max age, `secure` flag follows request protocol. PIN
  setup requires `currentPin` if a PIN already exists.
- **Rate limiting** is in-process in `server/utils/rateLimit.ts`: 20/min
  per-IP throttle, 5 fails/15min per-IP block, progressive per-account
  cooldown (5→30s, 10→60s, 15+→300s). State resets on server restart, which
  is fine for a single-node Pi.

## Deploy (recurring)

```bash
./scripts/deploy.sh
```

Prerequisites (one-time): `scripts/.env` exists with `PI_HOST`/`PI_USER`/
`PI_APP_DIR`/`PI_SUDO`/`RCLONE_*` (defaults are in `scripts/env.example`),
`scripts/setup-pi.sh` has been run, rclone config is on the Pi at
`${PI_APP_DIR}/rclone.conf`.

The deploy script does, in order: `pnpm install --frozen-lockfile` → `pnpm build`
→ SSH check → `rsync .output/`, `package.json`+`pnpm-lock.yaml`, `scripts/`
(excludes `scripts/.env`), `db/migrations/`, `systemd/`, `fail2ban/` →
remote: prod install → **copy the pnpm-installed `better-sqlite3.node` over
the bundled one** (the `.output` was built on the dev machine's arch) →
`migrate.mjs` as user `budget` → install systemd units + fail2ban configs →
restart service. Verify via SSH curl to `127.0.0.1:3000/api/auth/me` (expect
401 — that proves the app is up; the dev box can't reach 127.0.0.1 on the Pi).

## Backup model (v1.6.0+)

There are two backup layers, both run on the Pi via systemd:

- **JSON snapshot** (`scripts/export.mjs` → `systemd/budget-tracker-export.{service,timer}` at 02:00 daily) — human-readable, 5 user-facing tables (`users`, `accounts`, `categories`, `user_settings`, `transactions`), pushed to Google Drive via `scripts/export.sh` (rclone with 30-day retention). Source DB is integrity-checked before writing.
- **Binary backup** (`scripts/backup-binary.mjs` → `systemd/budget-tracker-binary-backup.{service,timer}` at 03:00 daily, 1h after the JSON export) — full DB via `better-sqlite3`'s online backup API, captures `__drizzle_migrations` and WAL state so it survives schema changes. Integrity-checked, kept locally at `/var/lib/budget-tracker/exports/budget-${TODAY}.db.bak`. **Not** pushed to Drive.

Both scripts `process.exit(1)` on any failure including `PRAGMA integrity_check` returning `not ok`. The systemd units use `Type=oneshot` and surface failures via `journalctl -u budget-tracker-export` / `...-binary-backup`.

## Gotchas (things an agent would get wrong)

- **`public/version.json` is generated, not hand-edited.** The predev/prebuild
  hook parses the first `## [vX.Y.Z] - YYYY-MM-DD` section of `CHANGELOG.md`
  and the bullet list under it. To ship a new version: add a section to
  `CHANGELOG.md`; the build picks it up automatically. The file is explicitly
  excluded from workbox precache (`workbox.globIgnores`) and force-refreshed by
  the client (`cache: 'no-store'`) — don't change that, it's how the OLD app
  shell learns about the NEW version.
- **`PWA devOptions.enabled` is `false`.** Do not flip it; turning it on brings
  back the `ENOENT … workbox-<hash>.js` console noise in dev. Production SWs
  are unaffected.
- **`DECISIONS.md` is gitignored** (per v1.4.2). Personal scratch — don't read,
  edit, or commit it. `ROADMAP.md` is now tracked (reclassified in v1.6.0) and
  is fine to read/edit/commit. The three project docs are `AGENTS.md` (this
  file — agent-facing), `CHANGELOG.md` (canonical release history), and
  `ROADMAP.md` (at-a-glance phase status + per-PR plan + what's next).
- **`ROADMAP.md` is generated/curated, not auto-generated.** It carries real
  design intent (the per-PR rationale, the "ordering rationale" callouts,
  the at-a-glance status table) — when you ship a PR, update both the
  per-section status (`⏳`/`🔄`/`✅`) and the "Phase N — Implementation plan"
  row for the PR you just shipped, and add a corresponding `## [vX.Y.Z]`
  section at the top of `CHANGELOG.md`. The predev/prebuild hook only
  parses `CHANGELOG.md` for `public/version.json`; `ROADMAP.md` is
  hand-maintained.
- **CI chain: hosted primary, self-hosted+Docker fallback.** `.github/workflows/ci.yml`
  has two jobs: `hosted` (ubuntu-latest) and `self-hosted`
  (`[self-hosted, linux, dev]`, `needs: hosted, if: failure()`). The
  self-hosted runner is registered as `vimal-dev` (pool `Default`) and runs
  on `vimal-hp` (`/home/vimal/actions-runner`). The runner is online but
  can get stuck in long HTTP back-off if GitHub Actions' Azure East US
  endpoint (`run-actions-2-azure-eastus.actions.githubusercontent.com`) has
  outages — symptom is the runner going `offline` in the API while the
  listener process is still alive; fix is `sudo systemctl restart
  actions.runner.jvimal18-varavu-selavu.vimal-dev.service`. Don't switch
  to a hosted-only workflow to "fix" this — the chain is the whole point
  (during an outage hosted can't pick up jobs either).
- **Branch protection on `main` must require the `"Build & Test (self-hosted
  fallback)"` check** (not the hosted one). The fallback check is `skipped`
  during normal operation, which counts as passing for branch protection,
  so merges stay unblocked. During an outage the fallback actually runs and
  gates the merge.
- **`pnpm/action-setup` must NOT take an explicit `version` when
  `package.json` has `packageManager`.** `pnpm@9.12.0` is pinned via
  `packageManager` in `package.json`; passing both produces
  `ERR_PNPM_BAD_PM_VERSION` at setup time. The reusable workflow
  (`.github/workflows/build-and-test.yml`) relies on the action reading
  `packageManager` from `package.json` (default `package_json_file` input).
  If you ever need to override (e.g., a security bump), set the
  `packageManager` field, not the action's `version`.
- **CI actions are pinned to `@v5` (Node 24), not `@v4`.** `actions/checkout`,
  `pnpm/action-setup`, `actions/cache` v4 versions pin `using: node20` and
  GitHub is force-upgrading them to Node 24 with a deprecation warning in
  every job log. v5 pins `using: node24` and silences the noise. Don't
  downgrade to v4 even for "stability" — v5 is what every other project
  is on by now.
- **`data/`, `*.db`, `scripts/.env`, `exports/`, `.env` are all gitignored.**
  Local-only. `data/dev.db` is the dev DB; do not delete without also
  resetting the seed if you wanted a clean slate.
- **`account.type = 'other'` is excluded from all three dashboard liquidity
  tiles** by design (v1.4.0). Re-type to one of the explicit types to include.
- **`server/api/export/json.get.ts`** is a public route under the global auth
  gate — verify the gate still allows it after auth-related changes.
- **The app binds `127.0.0.1:3000` on the Pi.** Tailscale Funnel terminates
  TLS. Don't add a reverse proxy. `X-Forwarded-For` (first entry) is the real
  client IP and is the basis for rate limiting — Funnel is the only thing that
  can connect, so it's trustworthy.
- **Migrations directory is `db/migrations/`, not `server/db/migrations/`.**
  The Drizzle config points to `./db/migrations` for output, and the Pi
  migrator (`scripts/migrate.mjs`) reads from `./db/migrations/` (relative to
  `${PI_APP_DIR}`). Don't move it.
- **`scripts/migrate.mjs` and `server/db/migrate.ts` are separate but parallel.**
  `.mjs` is what runs on the Pi (uses only the deployed bundle's
  better-sqlite3, doesn't need the TS toolchain). `.ts` is for local dev /
  CI. If you change seed or migration logic, mirror it in both.
- **Fail2ban jail can only ban loopback** because Funnel terminates the
  external connection; in-app rate limiting is the real client-IP enforcement.
  Don't rely on fail2ban to block actual attackers — it's logging/structure.
- **The JSON export's table list is now derived from a single source of
  truth (the `userFacingTables` array in `scripts/export.mjs`).** The
  pre-v1.6.0 hardcoded 4-table list silently dropped `user_settings` for
  five releases; a DB restored from a pre-v1.6.0 JSON snapshot loses the
  primary account + monthly budget. If you add a new user-facing table,
  add it to that array AND to the import script's wipe/insert sequence,
  AND update the FK ordering comment in `scripts/import.ts`. Bump the
  snapshot version (1.1 → 1.2) and have `import.ts` accept the new field
  with a back-compat default for the prior version.
- **Import wipe/insert order respects FKs, not alphabetical.** The chain is
  `users` → `accounts` → `categories` → `user_settings` →
  `transactions` (and the same chain in the `DELETE FROM` calls, in
  reverse). Don't "clean this up" to alphabetical — `user_settings`
  references `accounts` (primary_account_id) and `users`; `transactions`
  references everything.
- **Binary backup holds a read lock for the copy duration.** `db.backup()`
  uses SQLite's online backup API (safe, non-blocking readers), but a
  killed-mid-copy leaves a partial file. `PRAGMA integrity_check` after
  copy catches this. The systemd unit runs as `User=budget` and
  `Type=oneshot`; failed runs surface in `journalctl -u
  budget-tracker-binary-backup`.
- **The binary backup captures `__drizzle_migrations`.** That's the point —
  a restore from a 6-month-old `*.db.bak` against a freshly-migrated live
  DB is safe because the backup replays its own migration journal first.
  The JSON export cannot do this (it has no concept of schema), which is
  why both layers exist.
- **Pre-v1.6.0 JSON snapshots are unsafe to restore** (missing
  `user_settings` rows). The `import.ts` default of `userSettings: []`
  lets v1.0 snapshots load without crashing, but you lose the primary
  account + budget. Re-export from the live DB after the v1.6.0 deploy
  to refresh the on-Drive copy.

## Useful entry points to read first

- `nuxt.config.ts` — modules, PWA config (intentional, with comments), runtime
  config keys.
- `server/db/schema.ts` — the 4 main tables + `user_settings`. Enum values on
  `accounts.type`, `categories.type`, `transactions.type` are the source of
  truth for those string domains.
- `server/utils/auth.ts` + `server/api/auth/login.post.ts` + `stores/auth.ts` —
  end-to-end picture of the auth flow + error envelope.
- `composables/useAccountBalances.ts` — the balance/liquidity math; the
  dashboard reads these directly from the server.
- `scripts/deploy.sh` — exact deploy sequence + the better-sqlite3 native
  module fix.
- `CHANGELOG.md` — the recent "what changed and why" narrative; useful before
  making changes in an area that has had recent churn (PWA prompt in v1.5.0,
  liquidity tiles in v1.4.0, rate limiting in v1.3.0).
- `ROADMAP.md` — at-a-glance phase status, per-PR plan, "what's next" backlog.
  Read this when picking up a new piece of work to understand where a change
  fits in the overall arc.
- `vitest.config.ts` + `tests/unit/*.test.ts` — how the test suite is wired.
  If you're touching `useAccountBalances`, `localISODate`, or
  `dashboardPeriods`, the matching test file is the cheapest way to verify
  the change.
- `.github/workflows/{ci,build-and-test}.yml` — the CI chain. Read both
  before changing anything in CI.
- `scripts/{export,import,backup-binary}.mjs` + `scripts/import.ts` — the
  two-layer backup model. JSON snapshot (5 tables, v1.1) for human-readable
  Drive backup; binary backup (full DB, `__drizzle_migrations` included) for
  schema-safe local backup. Both run `PRAGMA integrity_check` on the
  source/copy and `process.exit(1)` on `not ok`. `tests/server/backup.test.ts`
  exercises both.
- `systemd/budget-tracker-{export,binary-backup}.{service,timer}` — the
  two nightly backup schedules (JSON at 02:00, binary at 03:00). Both are
  `Type=oneshot`; failures surface in `journalctl -u <unit>`.
