#!/bin/sh
# Restores an Nginx Proxy Manager backup created by backup.sh.
# Destructive: overwrites the npm database, /data and /etc/letsencrypt,
# and restarts the NPM container.
set -euo pipefail

ARCHIVE="${1:?usage: restore.sh <archive.tar.gz>}"
[ -f "$ARCHIVE" ] || { echo "ERROR: archive not found: $ARCHIVE"; exit 1; }

DB_HOST="${DB_HOST:-db}"
DB_PORT="${DB_PORT:-3306}"
DB_ROOT_PASSWORD="${DB_ROOT_PASSWORD:?DB_ROOT_PASSWORD is required}"
DB_NAME="${DB_NAME:-npm}"
APP_IMAGE="${APP_IMAGE:-jc21/nginx-proxy-manager:latest}"

TMPDIR=$(mktemp -d /tmp/restore.XXXXXX)
started=0
APP=""

log() { echo "[restore] $*"; }

cleanup() {
    if [ "$started" = 0 ] && [ -n "$APP" ]; then
        log "Restarting NPM container (restore failed)..."
        docker start "$APP" >/dev/null 2>&1 || true
    fi
    rm -rf "$TMPDIR"
}
trap cleanup EXIT

echo "[restore] Validating archive paths..."
if ! tar -tzf "$ARCHIVE" >/dev/null 2>&1; then
    echo "ERROR: cannot read archive (corrupt or not a tar.gz): $ARCHIVE"
    exit 1
fi
# Reject any entry that could escape the extraction dir (../ segments or
# absolute paths) before anything is written to disk.
if UNSAFE=$(tar -tzf "$ARCHIVE" 2>/dev/null | grep -E '(^|/)\.\.(/|$)|^/' || true) && [ -n "$UNSAFE" ]; then
    echo "ERROR: archive contains unsafe paths; refusing to extract:"
    echo "$UNSAFE" | head -n 20
    exit 1
fi

echo "[restore] Inspecting $ARCHIVE..."
tar -xzf "$ARCHIVE" -C "$TMPDIR"

[ -f "$TMPDIR/npm-db.sql.gz" ] || { echo "ERROR: archive is missing npm-db.sql.gz"; exit 1; }
[ -d "$TMPDIR/data" ]           || { echo "ERROR: archive is missing data/"; exit 1; }

find_app() {
    [ -n "${APP_CONTAINER:-}" ] && docker ps -q --filter "name=$APP_CONTAINER" | head -n1
    docker ps -q --filter "ancestor=$APP_IMAGE" | head -n1
}
APP=$(find_app)
[ -n "$APP" ] || { echo "ERROR: could not find the running NPM container ($APP_IMAGE)"; exit 1; }

log "Stopping NPM container ($APP)..."
docker stop "$APP" >/dev/null

log "Recreating database $DB_NAME..."
mysql --skip-ssl -h"$DB_HOST" -P"$DB_PORT" -uroot -p"$DB_ROOT_PASSWORD" \
    -e "DROP DATABASE IF EXISTS \`$DB_NAME\`; CREATE DATABASE \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" \
    || { echo "ERROR: failed to recreate database"; exit 1; }

log "Importing database dump..."
gunzip -c "$TMPDIR/npm-db.sql.gz" | mysql --skip-ssl -h"$DB_HOST" -P"$DB_PORT" -uroot -p"$DB_ROOT_PASSWORD" "$DB_NAME" \
    || { echo "ERROR: database import failed"; exit 1; }

log "Restoring /data..."
rm -rf /data/* /data/.[!.]* 2>/dev/null || true
cp -a "$TMPDIR/data/." /data/

if [ -d "$TMPDIR/letsencrypt" ]; then
    log "Restoring /etc/letsencrypt..."
    rm -rf /etc/letsencrypt/* /etc/letsencrypt/.[!.]* 2>/dev/null || true
    cp -a "$TMPDIR/letsencrypt/." /etc/letsencrypt/
fi

log "Starting NPM container..."
docker start "$APP" >/dev/null
started=1

log "Import complete. NPM restarted."