#!/usr/bin/env bash
# network-down.sh
# Tears down the compose stack and cleans volumes.
# Pass --keep-volumes to preserve ledger data.

set -euo pipefail

KEEP_VOLUMES=0
for arg in "$@"; do
    case "$arg" in
        --keep-volumes|-k) KEEP_VOLUMES=1 ;;
        *) echo "Unknown argument: $arg" >&2; exit 1 ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

echo "[DOWN] Stopping CocoNet network..."

if [[ "$KEEP_VOLUMES" -eq 1 ]]; then
    docker compose down
else
    docker compose down -v
    echo "[DOWN] Volumes removed."
fi

echo "[DOWN] Done."
