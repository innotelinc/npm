#!/bin/sh
# Creates a full settings backup of Nginx Proxy Manager:
#   - logical MySQL dump of the npm database
#   - /data (nginx configs, keys.json, custom SSL, ...)
#   - /etc/letsencrypt (certificates)
# Runtime logs under /data/logs are excluded - they are not settings.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
DB_HOST="${DB_HOST:-db}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-nginxpm}"
DB_PASSWORD="${DB_PASSWORD:?DB_PASSWORD is required}"
DB_NAME="${DB_NAME:-npm}"

TS=$(date +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/npm-backup-$TS.tar.gz"
TMP=$(mktemp -d /tmp/backup.XXXXXX)
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$BACKUP_DIR"

DUMP="mariadb-dump"
command -v "$DUMP" >/dev/null 2>&1 || DUMP="mysqldump"

echo "[backup] Dumping database ($DB_NAME)..."
"$DUMP" -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASSWORD" \
    --skip-ssl --single-transaction --routines --triggers "$DB_NAME" \
    | gzip > "$TMP/npm-db.sql.gz"

echo "[backup] Copying /data..."
mkdir -p "$TMP/data"
cp -a /data/. "$TMP/data/"
# Runtime logs only - drop them from the archive
rm -rf "$TMP/data/logs"

echo "[backup] Copying /etc/letsencrypt..."
mkdir -p "$TMP/letsencrypt"
cp -a /etc/letsencrypt/. "$TMP/letsencrypt/"

echo "[backup] Compressing $OUT..."
tar -czf "$OUT" -C "$TMP" npm-db.sql.gz data letsencrypt

# Rolling retention: keep only the newest BACKUP_RETENTION archives
RETENTION="${BACKUP_RETENTION:-7}"
if [ "$RETENTION" -gt 0 ] 2>/dev/null; then
    count=0
    for f in $(find "$BACKUP_DIR" -maxdepth 1 -name 'npm-backup-*.tar.gz' 2>/dev/null | sort -r); do
        count=$((count + 1))
        if [ "$count" -gt "$RETENTION" ]; then
            echo "[backup] pruning old backup: $(basename "$f")"
            rm -f "$f"
        fi
    done
fi

echo "[backup] Done: $OUT"