#!/usr/bin/env bash
# Run as root: sudo bash deploy/create-owner.sh
set -euo pipefail
read -rp 'Email владельца: ' EMAIL
read -rp 'Имя владельца: ' NAME
read -rsp 'Пароль (минимум 12 символов, ввод скрыт): ' PASSWORD
printf '\n'
read -rsp 'Повторите пароль: ' CONFIRM
printf '\n'
if [[ "$PASSWORD" != "$CONFIRM" ]]; then echo 'Пароли не совпадают'; exit 1; fi
if [[ "${#PASSWORD}" -lt 12 ]]; then echo 'Слишком короткий пароль'; exit 1; fi
cd /opt/finesse-crm
sudo -u finesse env FINESSE_DB=/var/lib/finesse-crm/finesse.sqlite3 FINESSE_OWNER_EMAIL="$EMAIL" FINESSE_OWNER_NAME="$NAME" FINESSE_OWNER_PASSWORD="$PASSWORD" /usr/bin/node --experimental-strip-types server/src/index.ts create-owner
unset PASSWORD CONFIRM
