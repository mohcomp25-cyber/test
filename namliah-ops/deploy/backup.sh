#!/usr/bin/env bash
# نسخة احتياطية آمنة لقاعدة بيانات نملية (تعمل والخادم شغّال بفضل .backup)
# التركيب في كرون: 0 4 * * * /opt/namliah-ops/deploy/backup.sh
set -euo pipefail

APP_DIR="/opt/namliah-ops"
DB="$APP_DIR/data/namliah.db"
DEST="/opt/namliah-backups"
KEEP_DAYS=30

mkdir -p "$DEST"
STAMP="$(date +%F_%H%M)"
sqlite3 "$DB" ".backup '$DEST/namliah-$STAMP.db'"
gzip -f "$DEST/namliah-$STAMP.db"

# احذف النسخ الأقدم من KEEP_DAYS يوماً
find "$DEST" -name 'namliah-*.db.gz' -mtime +$KEEP_DAYS -delete
echo "backup done: $DEST/namliah-$STAMP.db.gz"
