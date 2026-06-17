#!/usr/bin/env bash
# generate-artifacts.sh
# Generates all Fabric crypto material and channel artifacts.
# Run once before the first `docker compose up`.
# Requires Docker Desktop running.
#
# Usage:
#   ./scripts/generate-artifacts.sh           # no-op if crypto-config already exists
#   ./scripts/generate-artifacts.sh --force   # regenerate even if artifacts exist

set -euo pipefail

FORCE=0
for arg in "$@"; do
    case "$arg" in
        --force|-f) FORCE=1 ;;
        *) echo "Unknown argument: $arg" >&2; exit 1 ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FABRIC_NET_DIR="$PROJECT_ROOT/fabric-network"
CRYPTO_DIR="$FABRIC_NET_DIR/crypto-config"
ARTIFACTS_DIR="$FABRIC_NET_DIR/channel-artifacts"

FABRIC_IMAGE="hyperledger/fabric-tools:2.5"
CHANNEL_ID="buyer-supplier-channel"

write_step() { printf '\n[SETUP] %s\n' "$1"; }
write_ok()   { printf '[OK]    %s\n' "$1"; }
write_err()  { printf '[ERR]   %s\n' "$1" >&2; exit 1; }

# ─── Guard ────────────────────────────────────────────────────────────────────
if [[ -d "$CRYPTO_DIR" && "$FORCE" -eq 0 ]]; then
    echo "[INFO] crypto-config already exists. Use --force to regenerate."
    exit 0
fi

# ─── Cleanup ──────────────────────────────────────────────────────────────────
write_step "Cleaning old artifacts..."
rm -rf "$CRYPTO_DIR" "$ARTIFACTS_DIR"
mkdir -p "$ARTIFACTS_DIR"
write_ok "Directories prepared."

# ─── Pull fabric-tools image ──────────────────────────────────────────────────
write_step "Pulling $FABRIC_IMAGE..."
docker pull "$FABRIC_IMAGE" || write_err "Failed to pull $FABRIC_IMAGE. Is Docker running?"
write_ok "Image ready."

DOCKER_MOUNT="$PROJECT_ROOT:/workspace"

# ─── Step 1: Generate crypto material with cryptogen ─────────────────────────
write_step "Generating crypto material (cryptogen)..."
docker run --rm \
    -v "$DOCKER_MOUNT" \
    -w /workspace/fabric-network \
    "$FABRIC_IMAGE" \
    cryptogen generate --config=./config/crypto-config.yaml --output=./crypto-config \
    || write_err "cryptogen failed."
write_ok "Crypto material generated at fabric-network/crypto-config/"

# ─── Step 2: Generate channel genesis block (configtxgen) ────────────────────
write_step "Generating channel genesis block for '$CHANNEL_ID'..."
docker run --rm \
    -v "$DOCKER_MOUNT" \
    -w /workspace/fabric-network \
    -e FABRIC_CFG_PATH=/workspace/fabric-network/config \
    "$FABRIC_IMAGE" \
    configtxgen \
        -profile BuyerSupplierChannel \
        -outputBlock ./channel-artifacts/buyer-supplier-channel.block \
        -channelID "$CHANNEL_ID" \
    || write_err "configtxgen (genesis block) failed."
write_ok "Genesis block created at fabric-network/channel-artifacts/buyer-supplier-channel.block"

# ─── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "Artifacts generated successfully."
echo "Next step: docker compose up -d"
echo "Then run: ./scripts/setup-channel.sh"
