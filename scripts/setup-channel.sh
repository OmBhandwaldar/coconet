#!/usr/bin/env bash
# setup-channel.sh
# Joins the orderer + all peers to buyer-supplier-channel.
# Run after `docker compose up -d` and the network is healthy.

set -euo pipefail

CHANNEL_ID="buyer-supplier-channel"

write_step() { printf '\n[CHANNEL] %s\n' "$1"; }
write_ok()   { printf '[OK]      %s\n' "$1"; }
write_err()  { printf '[ERR]     %s\n' "$1" >&2; exit 1; }

wait_for_container() {
    local name="$1" seconds="${2:-10}"
    printf '  Waiting %ss for %s...\n' "$seconds" "$name"
    sleep "$seconds"
}

# ─── Wait for orderer ─────────────────────────────────────────────────────────
write_step "Waiting for orderer to be ready..."
wait_for_container "orderer.coconet.local" 8

# ─── Join orderer to channel via osnadmin ─────────────────────────────────────
write_step "Joining orderer to channel '$CHANNEL_ID'..."
docker exec coconet-cli osnadmin channel join \
    --channelID "$CHANNEL_ID" \
    --config-block /opt/channel-artifacts/buyer-supplier-channel.block \
    -o orderer.coconet.local:7053 \
    --ca-file /opt/crypto/ordererOrganizations/coconet.local/orderers/orderer.coconet.local/msp/tlscacerts/tlsca.coconet.local-cert.pem \
    --client-cert /opt/crypto/ordererOrganizations/coconet.local/orderers/orderer.coconet.local/tls/server.crt \
    --client-key /opt/crypto/ordererOrganizations/coconet.local/orderers/orderer.coconet.local/tls/server.key \
    || write_err "Orderer failed to join channel."
write_ok "Orderer joined channel."

# ─── Per-peer join helper ─────────────────────────────────────────────────────
join_peer() {
    local org_msp="$1" peer_addr="$2" crypto_path="$3" admin_path="$4"
    write_step "Joining $peer_addr to channel..."
    docker exec \
        -e CORE_PEER_LOCALMSPID="$org_msp" \
        -e CORE_PEER_ADDRESS="$peer_addr" \
        -e CORE_PEER_TLS_ROOTCERT_FILE="/opt/crypto/${crypto_path}/tls/ca.crt" \
        -e CORE_PEER_MSPCONFIGPATH="/opt/crypto/${admin_path}" \
        coconet-cli \
        peer channel join -b /opt/channel-artifacts/buyer-supplier-channel.block \
        || write_err "Failed to join $peer_addr."
    write_ok "$peer_addr joined."
}

# ─── Join all peers ───────────────────────────────────────────────────────────
join_peer "BuyerMSP" \
    "peer0.buyer.coconet.local:7051" \
    "peerOrganizations/buyer.coconet.local/peers/peer0.buyer.coconet.local" \
    "peerOrganizations/buyer.coconet.local/users/Admin@buyer.coconet.local/msp"

join_peer "SupplierMSP" \
    "peer0.supplier.coconet.local:8051" \
    "peerOrganizations/supplier.coconet.local/peers/peer0.supplier.coconet.local" \
    "peerOrganizations/supplier.coconet.local/users/Admin@supplier.coconet.local/msp"

join_peer "LenderMSP" \
    "peer0.lender.coconet.local:9051" \
    "peerOrganizations/lender.coconet.local/peers/peer0.lender.coconet.local" \
    "peerOrganizations/lender.coconet.local/users/Admin@lender.coconet.local/msp"

join_peer "PlatformMSP" \
    "peer0.platform.coconet.local:10051" \
    "peerOrganizations/platform.coconet.local/peers/peer0.platform.coconet.local" \
    "peerOrganizations/platform.coconet.local/users/Admin@platform.coconet.local/msp"

join_peer "AuditorMSP" \
    "peer0.auditor.coconet.local:11051" \
    "peerOrganizations/auditor.coconet.local/peers/peer0.auditor.coconet.local" \
    "peerOrganizations/auditor.coconet.local/users/Admin@auditor.coconet.local/msp"

# ─── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "Channel setup complete. All peers joined '$CHANNEL_ID'."
echo "Next step: cd api && npm install && npm run dev"
