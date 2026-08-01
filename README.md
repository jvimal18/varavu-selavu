# VaravuSelavu

Personal + household budget tracker for Vimal & Pavithra. Nuxt 3 + TypeScript +
Drizzle + better-sqlite3, stored in INR paise. Runs on a Raspberry Pi 4 at home,
exposed publicly via Tailscale Funnel.

---

## 1. Dev machine setup (one-time)

On Linux Mint (or similar), install **Node 22 via nvm** — `better-sqlite3@11` has
no prebuilt binary for Node 18 (see DECISIONS.md gotchas):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 22
nvm use 22

pnpm install
pnpm db:migrate && pnpm db:seed     # creates ./data/dev.db with seed users/categories
pnpm dev                            # http://localhost:3000
```

> `pnpm db:reset` wipes and reseeds the local dev DB (`data/dev.db`).

## 2. First-time deploy to Pi (one-time)

```bash
cp scripts/env.example scripts/.env   # edit values (host, user, paths)
./scripts/setup-pi.sh                 # provisions Node 20, pnpm, rclone, budget user, dirs
```

Then configure Google Drive backups (interactive, needs a browser):

- Follow **docs/rclone-setup.md**, then place the config on the Pi.

Then deploy:

```bash
./scripts/deploy.sh                   # build locally, sync, restart service
```

Enable the nightly export timer (once):

```bash
ssh vimal@192.168.0.224 "sudo systemctl enable --now budget-tracker-export.timer"
```

## 3. Recurring deploy (after code changes)

```bash
./scripts/deploy.sh
```

That's it — build, sync, prod install, service restart.

## 4. Backup & restore

**Nightly (automatic):** the Pi exports the full DB as JSON at 02:00
(`budget-tracker-export.timer` → `export.sh`), writes it to
`/var/lib/budget-tracker/exports/budget-YYYY-MM-DD.json`, and rclone pushes it
to `gdrive:budget-tracker-backups/` with a **30-day** retention
(`RCLONE_MAX_AGE`).

**Manual export:**

```bash
./scripts/export.sh
```

> The Pi-side generator (`scripts/export.mjs`) is **not implemented yet** —
> `export.sh` currently prints a warning and exits 0. See the TODO in
> `package.json` (`export:json` → `server/scripts/export.ts`).

**Restore:** copy a JSON export back and import it. No importer exists yet —
either implement `scripts/import.ts` (mirror of the export shape) or restore
the SQLite file itself by copying a backup of `budget.db` (TODO).

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| Service won't start | `ssh vimal@192.168.0.224 "sudo journalctl -u budget-tracker -n 100 --no-pager"` |
| DB locked | Usually better-sqlite3 being hammered — `sudo systemctl restart budget-tracker` |
| Deploy fails on rsync/ssh | Check `ssh vimal@192.168.0.224` works; confirm `scripts/.env` host/user |
| App OK but rclone push fails | Run `sudo -u budget RCLONE_CONFIG=/var/lib/budget-tracker/rclone.conf rclone lsd gdrive:` on the Pi (see docs/rclone-setup.md) |
| Forgot PIN | No recovery flow yet (DECISIONS.md §8 Q10) — requires reseeding the DB (nuclear option) |

## 6. Tailscale Funnel (one-time, on the Pi)

```bash
tailscale funnel --bg 3000
tailscale funnel status    # shows the public URL
```

The app binds `127.0.0.1:3000`; Tailscale Funnel handles TLS + public exposure.
Do not configure any other proxy — Funnel already terminates TLS.

---

See **DECISIONS.md** for the full project bible (decisions, schema, runbook
history).
