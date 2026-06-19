#!/usr/bin/env bash
# One-command database backup. Dumps the whole DB (custom format: structure +
# all data, incl. auth.users) to a timestamped file you keep OFF Supabase.
#
# Usage:
#   DB_URL='postgresql://postgres.<ref>:<pw>@aws-1-eu-central-1.pooler.supabase.com:5432/postgres' \
#   bash scripts/backup-db.sh [OUTPUT_DIR]
#
# Defaults OUTPUT_DIR to ./db-backups. Keeps the newest 30 backups, prunes older.
# Schedule it: Windows Task Scheduler -> run
#   "C:\Program Files\Git\bin\bash.exe" -lc "DB_URL='...' bash /c/BizManager/BizManager/scripts/backup-db.sh"
# Restore a backup with:  pg_restore --clean --if-exists --no-owner -d "<DB_URL>" <file>
set -euo pipefail

PGBIN="/c/Program Files/PostgreSQL/17/bin"
[ -x "$PGBIN/pg_dump.exe" ] && export PATH="$PATH:$PGBIN"

: "${DB_URL:?Set DB_URL to your Supabase Postgres connection string (session pooler, port 5432)}"
OUT_DIR="${1:-./db-backups}"
KEEP="${KEEP:-30}"

mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$OUT_DIR/bizmanager-$STAMP.dump"

echo "Backing up -> $FILE"
pg_dump "$DB_URL" -Fc --no-owner --quote-all-identifiers -f "$FILE"

SIZE="$(du -h "$FILE" | cut -f1)"
echo "Done: $FILE ($SIZE)"

# Prune: keep the newest $KEEP .dump files.
COUNT="$(ls -1t "$OUT_DIR"/bizmanager-*.dump 2>/dev/null | wc -l)"
if [ "$COUNT" -gt "$KEEP" ]; then
  ls -1t "$OUT_DIR"/bizmanager-*.dump | tail -n +"$((KEEP + 1))" | while read -r old; do
    echo "Pruning old backup: $old"
    rm -f "$old"
  done
fi
