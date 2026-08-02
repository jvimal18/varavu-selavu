#!/usr/bin/env bash
# scripts/deploy.sh — recurring deploy from the dev machine to the Pi.
#
# Builds locally, then:
#   - rsyncs .output/, package.json, pnpm-lock.yaml, db/migrations/, scripts/, systemd/ to the Pi
#   - installs prod deps on the Pi (better-sqlite3 prebuild is copied over the
#     dev-arch one so the native module matches the Pi's CPU)
#   - runs migrations + seed (scripts/migrate.mjs, idempotent) as the budget user
#   - installs the systemd units, reloads systemd, restarts budget-tracker
#
# Safe to re-run — do this after every code change.
#
# Prerequisites:
#   - One-time setup done: ./scripts/setup-pi.sh
#   - scripts/.env configured (or env vars set) — see scripts/env.example
#   - Pi reachable at ${PI_USER}@${PI_HOST}; Pi user has sudo (prompts as needed)
#
# Run manually (not by CI):
#   ./scripts/deploy.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/.."   # project root

# --- config (override via scripts/.env or environment) ---
if [ -f "scripts/.env" ]; then set -a; source "scripts/.env"; set +a; fi
PI_HOST="${PI_HOST:-192.168.0.224}"
PI_USER="${PI_USER:-vimal}"
PI_SSH_OPTS="${PI_SSH_OPTS:-}"
PI_APP_DIR="${PI_APP_DIR:-/var/lib/budget-tracker}"
PI_SUDO="${PI_SUDO:-sudo}"

SSH_TARGET="${PI_USER}@${PI_HOST}"
# The app dir is owned by 'budget'; push as root so writes succeed.
# (When PI_SUDO is empty, plain rsync is used — see scripts/env.example.)
RSYNC_PATH=()
[ -n "${PI_SUDO}" ] && RSYNC_PATH=(--rsync-path="${PI_SUDO} rsync")

echo "==> VaravuSelavu deploy -> ${SSH_TARGET}:${PI_APP_DIR}"

# 1) local install + build
echo "==> Installing + building (local)..."
pnpm install --frozen-lockfile
pnpm build

# 2) pre-flight reachability (refuse to proceed if the Pi is unreachable)
echo "==> Pre-flight SSH check..."
ssh ${PI_SSH_OPTS} -o ConnectTimeout=5 "${SSH_TARGET}" "echo ok"

# 3) sync build output (--delete removes stale files on the Pi)
echo "==> Syncing .output/ ..."
rsync -avz --delete "${RSYNC_PATH[@]}" \
  --exclude='.env' --exclude='*.db' --exclude='exports/' \
  .output/ "${SSH_TARGET}:${PI_APP_DIR}/.output/"

# 4) sync package manifests (for remote prod install)
echo "==> Syncing package.json + pnpm-lock.yaml ..."
rsync -avz "${RSYNC_PATH[@]}" \
  package.json pnpm-lock.yaml "${SSH_TARGET}:${PI_APP_DIR}/"

# 5) sync helper scripts (export.sh is used by the systemd export timer).
#    No --delete here, and scripts/.env is excluded (secrets stay local).
echo "==> Syncing scripts/ ..."
rsync -avz "${RSYNC_PATH[@]}" --exclude='.env' \
  scripts/ "${SSH_TARGET}:${PI_APP_DIR}/scripts/"

# 5b) sync DB migrations (migrate.mjs runs these on the Pi at deploy time)
echo "==> Syncing db/migrations/ ..."
ssh ${PI_SSH_OPTS} "${SSH_TARGET}" "${PI_SUDO} mkdir -p ${PI_APP_DIR}/db"
rsync -avz "${RSYNC_PATH[@]}" \
  db/migrations/ "${SSH_TARGET}:${PI_APP_DIR}/db/migrations/"

# 6) sync systemd units to a tmp dir on the Pi
echo "==> Syncing systemd units ..."
rsync -avz "${RSYNC_PATH[@]}" \
  systemd/ "${SSH_TARGET}:/tmp/budget-systemd/"

# 7) remote: prod install + install units + reload + restart
#    Native module fix: better-sqlite3 is built for the dev machine's arch and
#    shipped inside .output/. After pnpm install on the Pi (which downloads the
#    correct prebuild), copy that binary over the bundled one so the server
#    doesn't die with ERR_DLOPEN_FAILED on ARM.
#    Migrations + seed run via scripts/migrate.mjs (idempotent) as the 'budget'
#    user so budget.db stays owned by the service user.
echo "==> Installing prod deps + fixing native module + migrating + restarting on the Pi..."
ssh ${PI_SSH_OPTS} "${SSH_TARGET}" \
  "cd ${PI_APP_DIR} && \
   ${PI_SUDO} pnpm install --prod --frozen-lockfile && \
   if [ -f node_modules/better-sqlite3/build/Release/better_sqlite3.node ]; then \
     ${PI_SUDO} cp -fL node_modules/better-sqlite3/build/Release/better_sqlite3.node .output/server/node_modules/better-sqlite3/build/Release/better_sqlite3.node; \
   else \
     (cd .output/server && ${PI_SUDO} npm rebuild better-sqlite3); \
   fi && \
   ${PI_SUDO} -u budget env NUXT_DB_PATH=${PI_APP_DIR}/budget.db node ${PI_APP_DIR}/scripts/migrate.mjs && \
   ${PI_SUDO} cp /tmp/budget-systemd/*.service /tmp/budget-systemd/*.timer /etc/systemd/system/ && \
   ${PI_SUDO} systemctl daemon-reload && \
   (${PI_SUDO} systemctl enable budget-tracker >/dev/null 2>&1 || true) && \
   ${PI_SUDO} systemctl restart budget-tracker"

# 8) status — informational only, don't fail the deploy on a degraded state
echo "==> Service status:"
ssh ${PI_SSH_OPTS} "${SSH_TARGET}" "${PI_SUDO} systemctl status budget-tracker --no-pager" || true

# 9) verify the app responds. Run curl on the Pi: the app binds 127.0.0.1:3000
#    (Tailscale Funnel terminates TLS), so the dev machine can't reach it directly.
#    /api/auth/me without a cookie returns 401 — that still proves the app is up.
echo "==> Verifying deployment..."
sleep 2
HTTP_CODE="$(ssh ${PI_SSH_OPTS} "${SSH_TARGET}" "curl -sS --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/auth/me" || true)"
if [ "${HTTP_CODE}" = "200" ] || [ "${HTTP_CODE}" = "401" ]; then
  echo "✓ App is up (auth endpoint responding, HTTP ${HTTP_CODE})"
else
  echo "✗ App not responding (HTTP ${HTTP_CODE:-none}) — check: ssh ${SSH_TARGET} \"${PI_SUDO} journalctl -u budget-tracker -n 50 --no-pager\""
  exit 1
fi

echo
echo "Deployed ✓"
echo "Check logs:  ssh ${SSH_TARGET} \"${PI_SUDO} journalctl -u budget-tracker -n 50 --no-pager\""
