#!/bin/sh
# Container entrypoint: installs the scheduled-backup crontab, starts crond,
# then runs the web server in the foreground.
set -eu

SCHEDULE="${CRON_SCHEDULE:-0 2 * * *}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_RETENTION="${BACKUP_RETENTION:-7}"

mkdir -p "$BACKUP_DIR"

# Single-quote a value for use in a crontab line
q() {
    case "$1" in
        *"'"*) echo "ERROR: value '$1' contains a single quote, cannot use in crontab" >&2; exit 1 ;;
        *)     printf "'%s' " "$1" ;;
    esac
}

if [ -n "$SCHEDULE" ]; then
    {
        echo "# Nightly NPM settings backup (written by start.sh)"
        echo "$SCHEDULE DB_HOST=$(q "$DB_HOST") DB_PORT=$(q "$DB_PORT") DB_USER=$(q "$DB_USER") DB_PASSWORD=$(q "$DB_PASSWORD") DB_NAME=$(q "$DB_NAME") BACKUP_DIR=$(q "$BACKUP_DIR") BACKUP_RETENTION=$(q "$BACKUP_RETENTION") /srv/backup.sh >> /var/log/backup-cron.log 2>&1"
    } > /etc/crontabs/root
    echo "[start] scheduled backups: $SCHEDULE (retention: $BACKUP_RETENTION, dir: $BACKUP_DIR)"
    /usr/sbin/crond -b -l 8
    echo "[start] crond started"
else
    echo "[start] scheduled backups disabled (CRON_SCHEDULE empty)"
    : > /etc/crontabs/root
fi

exec python3 /srv/server.py