#!/usr/bin/env bash
# demo-reset.sh — bring the whole stack up from zero for a clean demo run.
# Tears down (drops ledger volumes), restarts, rejoins the channel, redeploys all
# 3 chaincodes and 3 Polygon contracts. Crypto material + channel artifacts persist
# on the host (generated once via generate-artifacts.sh), so they are not regenerated.
#
# After this completes:
#   Terminal 1:  npm run dev          # API + bridge
#   Terminal 2:  npm run demo         # the end-to-end flow

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

step() { printf '\n\033[36m[RESET] %s\033[0m\n' "$1"; }

if [[ ! -d "fabric-network/crypto-config" ]]; then
  echo "[RESET] crypto-config missing — run ./scripts/generate-artifacts.sh first." >&2
  exit 1
fi

step "Tearing down (ledger volumes dropped)..."
bash scripts/network-down.sh || true

step "Scrubbing leftover ledger state for a true clean slate..."
# Named volumes can linger after `down -v`; remove them explicitly.
docker volume rm -f \
  coconet_orderer.coconet.local \
  coconet_peer0.buyer.coconet.local coconet_peer0.supplier.coconet.local \
  coconet_peer0.lender.coconet.local coconet_peer0.platform.coconet.local \
  coconet_peer0.auditor.coconet.local 2>/dev/null || true
# The orderer bind-mounts channel-artifacts as its production dir, so its channel
# ledger persists on the host across `down -v` (old chaincode-commit blocks would
# otherwise resurface as a private-data version mismatch). Keep only the genesis block.
find fabric-network/channel-artifacts -mindepth 1 -maxdepth 1 ! -name '*.block' -exec rm -rf {} + 2>/dev/null || true

step "Starting stack (Fabric + Hardhat + Mongo + MinIO)..."
docker compose up -d

step "Waiting for the network to settle..."
sleep 12

step "Joining the channel..."
bash scripts/setup-channel.sh

step "Deploying chaincodes (fresh channel → sequence 1)..."
bash scripts/deploy-chaincode.sh --name onboarding-cc --dir onboarding-cc --version 1.0 --sequence 1
bash scripts/deploy-chaincode.sh --name trade-doc-cc  --dir trade-doc-cc  --version 1.3 --sequence 1
bash scripts/deploy-chaincode.sh --name finance-cc    --dir finance-cc    --version 1.0 --sequence 1

step "Deploying Polygon contracts (USDC + EscrowVault + EscrowFactory)..."
( cd contracts && npm run deploy:local )

step "Done. The deployed contract addresses are in contracts/deployments.local.json"
echo "      (deterministic on a fresh Hardhat node — they match .env)."
echo ""
echo "Next:  npm run dev   (Terminal 1)   then   npm run demo   (Terminal 2)"
