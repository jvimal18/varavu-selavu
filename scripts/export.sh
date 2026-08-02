#!/usr/bin/env bash
# scripts/export.sh — one-shot JSON export + Google Drive backup.
#
# Two use cases:
#   A. Manual run from the dev machine — SSHes to the Pi to generate the JSON,
#      then pushes it to Google Drive via rclone (run on the Pi).
#   B. Nightly run on the Pi by systemd (budget-tracker-export.timer ->
#      budget-tracker-export.service). Detects it is already on the Pi and
#      runs everything locally.
#
# NOTE: uses scripts/export.mjs (deployed to ${PI_APP_DIR}/scripts/) to write
# ${PI_APP_DIR}/exports/budget-YYYY-MM-DD.json, then pushes it to Google Drive
# via rclone.
#
# Prerequisites:
#   - rclone configured (docs/rclone-setup.md); the 'budget' user reads its
#     config from ${RCLONE_CONFIG:-${PI_APP_DIR}/rclone.conf} (budget has no
#     home dir, so the config is deployed to the app dir).
#   - scripts/.env configured on whichever machine runs it.
#
# Run manually:  ./scripts/export.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/.."   # project root (== ${PI_APP_DIR} when run on the Pi)

# --- config (override via scripts/.env or environment) ---
if [ -f "scripts/.env" ]; then set -a; source "scripts/.env"; set +a; fi
PI_HOST="${PI_HOST:-192.168.0.224}"
PI_USER="${PI_USER:-vimal}"
PI_SSH_OPTS="${PI_SSH_OPTS:-}"
PI_APP_DIR="${PI_APP_DIR:-/var/lib/budget-tracker}"
PI_SUDO="${PI_SUDO:-sudo}"
RCLONE_REMOTE="${RCLONE_REMOTE:-gdrive:budget-tracker-backups/}"
RCLONE_MAX_AGE="${RCLONE_MAX_AGE:-30d}"

SSH_TARGET="${PI_USER}@${PI_HOST}"
TODAY="$(date +%F)"
FILE="${PI_APP_DIR}/exports/budget-${TODAY}.json"

# rclone config path for the 'budget' user (system user, no home dir)
export RCLONE_CONFIG="${RCLONE_CONFIG:-${PI_APP_DIR}/rclone.conf}"

# Are we already on the Pi (systemd timer)?  vs  running from the dev machine.
if [ -d "${PI_APP_DIR}/exports" ]; then
  ON_PI=1
  echo "[export] on-Pi mode (running locally)"
else
  ON_PI=0
  echo "[export] dev-machine mode (running via ssh)"
fi

# --- 1) Generate the JSON export ---
if [ "${ON_PI}" -eq 1 ]; then
  echo "[export] generating ${FILE} ..."
  if [ "$(id -un)" = "budget" ]; then
    node "${PI_APP_DIR}/scripts/export.mjs" "${FILE}"
  else
    ${PI_SUDO} -u budget node "${PI_APP_DIR}/scripts/export.mjs" "${FILE}"
  fi
else
  echo "[export] generating (on Pi) ${FILE} ..."
  ssh ${PI_SSH_OPTS} "${SSH_TARGET}" \
    "cd ${PI_APP_DIR} && ${PI_SUDO} -u budget node scripts/export.mjs '${FILE}'"
fi

# --- 2) rclone push + retention (runs where the JSON file lives) ---
if [ "${ON_PI}" -eq 1 ]; then
  echo "[export] pushing ${FILE} -> ${RCLONE_REMOTE}"
  if [ "$(id -un)" = "budget" ]; then
    rclone copy "${FILE}" "${RCLONE_REMOTE}"
    rclone delete "${RCLONE_REMOTE}" --max-age "${RCLONE_MAX_AGE}"
  else
    ${PI_SUDO} -u budget rclone copy "${FILE}" "${RCLONE_REMOTE}"
    ${PI_SUDO} -u budget rclone delete "${RCLONE_REMOTE}" --max-age "${RCLONE_MAX_AGE}"
  fi
else
  echo "[export] pushing (on Pi) ${FILE} -> ${RCLONE_REMOTE}"
  ssh ${PI_SSH_OPTS} "${SSH_TARGET}" \
    "${PI_SUDO} -u budget rclone copy '${FILE}' '${RCLONE_REMOTE}' && ${PI_SUDO} -u budget rclone delete '${RCLONE_REMOTE}' --max-age '${RCLONE_MAX_AGE}'"
fi

SIZE="$(du -h "${FILE}" 2>/dev/null | cut -f1 || echo '?')"
echo "Export ✓  ${FILE} (${SIZE}) -> ${RCLONE_REMOTE}"
