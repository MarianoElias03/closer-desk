#!/usr/bin/env bash
# Build here, ship to a Proxmox LXC container, restart. Data in /var/lib/closer-desk is untouched.
# Usage: CT_ID=100 ./deploy/deploy.sh
set -euo pipefail
CT_ID="${CT_ID:-100}"
cd "$(dirname "$0")/.."
npx vite build >/dev/null
# the commit this build came from, shown to MCP clients (with -dirty if there were uncommitted edits)
echo "$(git rev-parse --short HEAD 2>/dev/null || echo unknown)$(git diff --quiet HEAD 2>/dev/null || echo -dirty)" > build/VERSION
tar czf /tmp/closer-desk.tgz build package.json package-lock.json scripts src/lib/server/db.js deploy/closer-desk.service
pct push "$CT_ID" /tmp/closer-desk.tgz /tmp/closer-desk.tgz
pct exec "$CT_ID" -- bash -c '
  set -e
  mkdir -p /opt/closer-desk /var/lib/closer-desk
  cd /opt/closer-desk && rm -rf build && tar xzf /tmp/closer-desk.tgz && rm /tmp/closer-desk.tgz
  PATH=/usr/local/bin:$PATH npm ci --omit=dev --silent
  cp deploy/closer-desk.service /etc/systemd/system/
  systemctl daemon-reload && systemctl enable --now closer-desk >/dev/null 2>&1 && systemctl restart closer-desk
'
rm -f /tmp/closer-desk.tgz
echo deployed
