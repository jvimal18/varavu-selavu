# VaravuSelavu

Personal + household budget tracker for Vimal & Pavithra. Nuxt 3 + TypeScript +
Drizzle + better-sqlite3, stored in INR paise. Runs on a Raspberry Pi 4 at home,
exposed publicly via Tailscale Funnel.

---

## 1. Dev machine setup (one-time)

On Linux Mint (or similar), install **Node 22 via nvm** — `better-sqlite3@11` has
no prebuilt binary for Node 18:

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
./scripts/setup-pi.sh                 # provisions Node 24, pnpm, rclone, budget user, dirs
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
./scripts/export.sh    # generate JSON on the Pi + push to Google Drive (rclone)
pnpm export            # JSON only: node scripts/export.mjs [output-file]
```

- `scripts/export.sh` SSHes to the Pi (or runs locally when invoked by the
  systemd timer) and generates the snapshot with `scripts/export.mjs`, then
  pushes it to Drive via rclone with 30-day retention.
- `pnpm export` (i.e. `node scripts/export.mjs`) writes a full snapshot of all
  4 tables (users, accounts, categories, transactions) to
  `exports/budget-YYYY-MM-DD.json` (or the path given as an argument). DB path
  comes from `$NUXT_DB_PATH`, else `./budget.db`.

**Restore:** import a JSON snapshot back into the DB with `scripts/import.ts`:

```bash
pnpm import <snapshot.json>
```

It wipes the 4 tables and re-inserts from the snapshot inside a single
transaction (requires typing `YES` to confirm). Alternatively, restore the
SQLite file itself by copying a backup of `budget.db`.

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| Service won't start | `ssh vimal@192.168.0.224 "sudo journalctl -u budget-tracker -n 100 --no-pager"` |
| DB locked | Usually better-sqlite3 being hammered — `sudo systemctl restart budget-tracker` |
| Deploy fails on rsync/ssh | Check `ssh vimal@192.168.0.224` works; confirm `scripts/.env` host/user |
| App OK but rclone push fails | Run `sudo -u budget RCLONE_CONFIG=/var/lib/budget-tracker/rclone.conf rclone lsd gdrive:` on the Pi (see docs/rclone-setup.md) |
| Forgot PIN | No recovery flow yet — requires reseeding the DB (nuclear option) |

## 6. Tailscale Funnel (one-time, on the Pi)

```bash
tailscale funnel --bg 3000
tailscale funnel status    # shows the public URL
```

The app binds `127.0.0.1:3000`; Tailscale Funnel handles TLS + public exposure.
Do not configure any other proxy — Funnel already terminates TLS.

---

See **CHANGELOG.md** for the release history and design notes per version.
