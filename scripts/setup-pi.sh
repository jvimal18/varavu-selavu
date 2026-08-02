#!/usr/bin/env bash
# scripts/setup-pi.sh — ONE-TIME Raspberry Pi provisioning.
#
# Runs from the dev machine and configures a fresh Pi (Raspberry Pi OS
# Bookworm 64-bit) to host the budget tracker:
#   - Node 24 (NodeSource) + pnpm + rclone + build tools
#   - system user "budget" (no shell, no home)
#   - app directories under ${PI_APP_DIR}, owned by budget
#
# Prerequisites:
#   - The Pi is reachable at ${PI_USER}@${PI_HOST} (see scripts/.env).
#   - The Pi user has sudo access (password prompts appear during the run).
#
# Idempotent: safe to re-run; steps that are already satisfied are skipped.
#
# Run manually (not by CI):
#   ./scripts/setup-pi.sh
# Then continue with docs/rclone-setup.md and ./scripts/deploy.sh.
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

echo "==> VaravuSelavu Pi setup"
echo "    target: ${SSH_TARGET}   app dir: ${PI_APP_DIR}"

# 1) SSH connectivity check
echo "==> Checking SSH connectivity..."
ssh ${PI_SSH_OPTS} -o ConnectTimeout=5 "${SSH_TARGET}" true
echo "    OK — ${SSH_TARGET} reachable."

# 2) Node 24 (skip if an existing install is already >= 24)
echo "==> Ensuring Node >= 24..."
if ssh ${PI_SSH_OPTS} "${SSH_TARGET}" \
  "command -v node >/dev/null 2>&1 && [ \$(node --version | sed 's/^v//; s/\\..*//') -ge 24 ]"; then
  echo "    Node >= 24 already installed. Skipping."
else
  echo "    Installing Node 24 via NodeSource..."
  ssh ${PI_SSH_OPTS} "${SSH_TARGET}" \
    "curl -fsSL https://deb.nodesource.com/setup_24.x | ${PI_SUDO} -E bash - && ${PI_SUDO} apt install -y nodejs"
  echo "    Installing build tools (native fallback for better-sqlite3)..."
  ssh ${PI_SSH_OPTS} "${SSH_TARGET}" "${PI_SUDO} apt install -y build-essential python3"
fi

# 3) pnpm (global)
echo "==> Ensuring pnpm..."
if ssh ${PI_SSH_OPTS} "${SSH_TARGET}" "command -v pnpm >/dev/null 2>&1"; then
  echo "    pnpm already installed. Skipping."
else
  ssh ${PI_SSH_OPTS} "${SSH_TARGET}" "${PI_SUDO} npm install -g pnpm"
fi

# 4) rclone
echo "==> Ensuring rclone..."
if ssh ${PI_SSH_OPTS} "${SSH_TARGET}" "command -v rclone >/dev/null 2>&1"; then
  echo "    rclone already installed. Skipping."
else
  ssh ${PI_SSH_OPTS} "${SSH_TARGET}" "${PI_SUDO} apt update && ${PI_SUDO} apt install -y rclone"
fi

# 5) "budget" system user (no shell, no home — runs the app + export timer)
echo "==> Ensuring 'budget' system user..."
if ssh ${PI_SSH_OPTS} "${SSH_TARGET}" "id budget >/dev/null 2>&1"; then
  echo "    'budget' user exists. Skipping."
else
  ssh ${PI_SSH_OPTS} "${SSH_TARGET}" \
    "${PI_SUDO} useradd --system --no-create-home --shell /usr/sbin/nologin budget"
fi

# 6) App directories (owned by budget so the service can write budget.db + exports)
echo "==> Creating app directories..."
ssh ${PI_SSH_OPTS} "${SSH_TARGET}" \
  "${PI_SUDO} mkdir -p ${PI_APP_DIR}/exports ${PI_APP_DIR}/logs"
ssh ${PI_SSH_OPTS} "${SSH_TARGET}" "${PI_SUDO} chown -R budget:budget ${PI_APP_DIR}"

# 7) Next-step instructions
cat <<EOF

==> Pi setup complete ✓

Next steps (run from the dev machine):
  1. Google Drive backups (one-time): follow docs/rclone-setup.md.
     Then place the config on the Pi for the 'budget' user (no home dir):
       scp ~/.config/rclone/rclone.conf ${SSH_TARGET}:~/
       ssh ${SSH_TARGET} "${PI_SUDO} mv ~/rclone.conf ${PI_APP_DIR}/rclone.conf && ${PI_SUDO} chown budget:budget ${PI_APP_DIR}/rclone.conf"
  2. First deploy:
       ./scripts/deploy.sh
  3. Enable the nightly export timer (once):
       ssh ${SSH_TARGET} "${PI_SUDO} systemctl enable --now budget-tracker-export.timer"
EOF
