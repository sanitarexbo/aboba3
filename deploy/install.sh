#!/usr/bin/env bash
# Usage: sudo bash deploy/install.sh crm.example.com
set -euo pipefail
if [[ "$(id -u)" != 0 ]]; then echo 'Запустите через sudo'; exit 1; fi
DOMAIN="${1:-}"
if [[ ! "$DOMAIN" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])$ ]] || [[ "$DOMAIN" != *.* ]]; then
  echo 'Укажите домен: sudo bash deploy/install.sh crm.example.com'; exit 1
fi
SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
apt-get update
apt-get install -y ca-certificates curl gnupg nginx certbot python3-certbot-nginx rsync ufw
NODE_VERSION="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [[ "$NODE_VERSION" -lt 22 ]]; then
  echo 'Установка Node.js 24 из NodeSource (проверьте официальный источник перед использованием)...'
  curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/finesse-nodesource.sh
  bash /tmp/finesse-nodesource.sh
  apt-get install -y nodejs
fi
node -e "if(Number(process.versions.node.split('.')[0])<22){process.exit(1)}"
id finesse &>/dev/null || useradd --system --user-group --home-dir /var/lib/finesse-crm --shell /usr/sbin/nologin finesse
mkdir -p /opt/finesse-crm /var/lib/finesse-crm/backups
# Keep the persistent data directory outside the deployed code.
rsync -a --delete --exclude 'node_modules' --exclude 'data' --exclude '.git' --exclude 'dist' "$SOURCE/" /opt/finesse-crm/
cd /opt/finesse-crm
npm install --no-audit --no-fund
npm run build
chown -R root:root /opt/finesse-crm
chown -R finesse:finesse /var/lib/finesse-crm
chmod 700 /var/lib/finesse-crm /var/lib/finesse-crm/backups
install -m 644 deploy/finesse-crm.service /etc/systemd/system/finesse-crm.service
install -m 644 deploy/finesse-backup.service /etc/systemd/system/finesse-backup.service
install -m 644 deploy/finesse-backup.timer /etc/systemd/system/finesse-backup.timer
sed "s/YOUR_DOMAIN/$DOMAIN/g" deploy/finesse.nginx.conf >/etc/nginx/sites-available/finesse-crm
ln -sfn /etc/nginx/sites-available/finesse-crm /etc/nginx/sites-enabled/finesse-crm
nginx -t
systemctl daemon-reload
systemctl enable --now finesse-crm
systemctl enable --now finesse-backup.timer
systemctl enable --now nginx
systemctl reload nginx
printf '\nГотово: http://%s (HTTPS подключите после настройки DNS)\n' "$DOMAIN"
printf 'Статус: '; curl -fsS http://127.0.0.1:8080/health || true
printf '\nСоздайте владельца: sudo bash /opt/finesse-crm/deploy/create-owner.sh\n'
printf 'SSL: sudo certbot --nginx -d %s --redirect\n' "$DOMAIN"
