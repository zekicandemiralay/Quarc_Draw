#!/usr/bin/env bash
# ============================================================
#  Quarc Draw — Data Backup
#  Run from the project directory:
#    bash backup.sh
#
#  Creates: ./backup_YYYYMMDD_HHMMSS/
#    data/  — every account's documents (data/users/<id>/docs/*.qdraw and index.json)
#    .env   — all secrets and config (the JWT_SECRET must stay the same)
# ============================================================
set -e

BACKUP_DIR="./backup_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "Backing up to $BACKUP_DIR ..."

BACKEND=$(docker ps -q --filter "label=com.docker.compose.service=backend" | head -1)
if [ -z "$BACKEND" ]; then
  echo "ERROR: backend container not running. Start it first: docker compose up -d backend"
  exit 1
fi

echo "  · Exporting the documents (this can take a while) ..."
docker cp "$BACKEND:/app/data" "$BACKUP_DIR/data"

echo "  · Copying .env ..."
cp .env "$BACKUP_DIR/.env"

echo ""
echo "Backup complete: $BACKUP_DIR"
echo "  data/ : $(du -sh "$BACKUP_DIR/data" | awk '{print $1}')"
echo ""
echo "Next: copy this folder to the new server."
echo "  scp -r $BACKUP_DIR user@new-server:~/Quarc_Draw/"
echo "The backup holds .env, so keep it private."
