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
- No test suite exists. Verification is `pnpm typecheck` + manual `pnpm dev`.

## Commands cheat sheet

| Command | What it does |
|---|---|
| `pnpm dev` | Runs `predev` → regenerates `public/version.json` from CHANGELOG, then `nuxt dev`. |
| `pnpm build` | `prebuild` → `nuxt build`. Output goes to `.output/`. |
| `pnpm typecheck` | `nuxt typecheck` (the only static check). |
| `pnpm db:generate` | `drizzle-kit generate` — produces a new SQL file in `db/migrations/`. |
| `pnpm db:migrate` | Runs all `db/migrations/*.sql` against the DB. Idempotent. |
| `pnpm db:seed` | Inserts u_vimal, u_pavithra, and the default category tree. Idempotent. |
| `pnpm export` | `node scripts/export.mjs [out.json]` — JSON snapshot of all 4 tables. |
| `pnpm import <file>` | `tsx scripts/import.ts` — WIPES + re-inserts; requires typing `YES`. |
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
- **`DECISIONS.md` and `ROADMAP.md` are gitignored** (per v1.4.2). They are
  the user's personal scratch — don't read, edit, or commit them. The
  canonical release history is `CHANGELOG.md`.
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
