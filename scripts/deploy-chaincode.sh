#!/usr/bin/env bash
# deploy-chaincode.sh
# Fabric 2.5 chaincode lifecycle: build → package → install (5 peers) → approve (5 orgs) → commit
#
# Usage:
#   ./scripts/deploy-chaincode.sh                                          # onboarding-cc v1.0 (default)
#   ./scripts/deploy-chaincode.sh --name onboarding-cc --dir onboarding-cc --version 1.1 --sequence 2
#
# Pre-reqs:
#   1. docker compose up -d (network healthy)
#   2. ./scripts/setup-channel.sh (all peers joined buyer-supplier-channel)

set -euo pipefail

# ─── Defaults ─────────────────────────────────────────────────────────────────
CC_NAME="onboarding-cc"
CC_DIR="onboarding-cc"
VERSION="1.0"
SEQUENCE=1
CHANNEL="buyer-supplier-channel"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --name)     CC_NAME="$2";   shift 2 ;;
        --dir)      CC_DIR="$2";    shift 2 ;;
        --version)  VERSION="$2";   shift 2 ;;
        --sequence) SEQUENCE="$2";  shift 2 ;;
        --channel)  CHANNEL="$2";   shift 2 ;;
        *) echo "Unknown argument: $1" >&2; exit 1 ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LABEL="${CC_NAME}_${VERSION}"
PACKAGE_FILE="${CC_NAME}.tar.gz"
ORDERER_CA="/opt/crypto/ordererOrganizations/coconet.local/orderers/orderer.coconet.local/msp/tlscacerts/tlsca.coconet.local-cert.pem"

write_step() { printf '\n[CC] %s\n' "$1"; }
write_ok()   { printf '[OK] %s\n' "$1"; }
write_err()  { printf '[ERR] %s\n' "$1" >&2; exit 1; }

# ─── Org table: name|msp|port|domain ──────────────────────────────────────────
ORGS=(
    "buyer|BuyerMSP|7051|buyer.coconet.local"
    "supplier|SupplierMSP|8051|supplier.coconet.local"
    "lender|LenderMSP|9051|lender.coconet.local"
    "platform|PlatformMSP|10051|platform.coconet.local"
    "auditor|AuditorMSP|11051|auditor.coconet.local"
)

# Populates the global PEER_ENV array with -e KEY=VAL pairs for the given org spec.
peer_env() {
    local spec="$1"
    IFS='|' read -r name msp port domain <<< "$spec"
    local crypto="/opt/crypto/peerOrganizations/$domain"
    PEER_ENV=(
        -e "CORE_PEER_LOCALMSPID=$msp"
        -e "CORE_PEER_ADDRESS=peer0.$domain:$port"
        -e "CORE_PEER_TLS_ROOTCERT_FILE=$crypto/peers/peer0.$domain/tls/ca.crt"
        -e "CORE_PEER_MSPCONFIGPATH=$crypto/users/Admin@$domain/msp"
    )
}

# ─── 1. Build chaincode (host-side) ───────────────────────────────────────────
write_step "Building $CC_DIR on host..."
( cd "$PROJECT_ROOT/chaincodes/$CC_DIR" && npm run build ) || write_err "Chaincode build failed."
write_ok "Build complete (dist/ produced)."

# ─── 2. Stage clean package directory ─────────────────────────────────────────
write_step "Staging clean package directory..."
STAGE="$PROJECT_ROOT/chaincodes/.build/$CC_DIR"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -R "$PROJECT_ROOT/chaincodes/$CC_DIR/dist"         "$STAGE/dist"
cp    "$PROJECT_ROOT/chaincodes/$CC_DIR/package.json" "$STAGE/package.json"
write_ok "Staged at chaincodes/.build/$CC_DIR"

# ─── 3. Package chaincode (from cli container) ────────────────────────────────
write_step "Packaging $LABEL..."
docker exec coconet-cli peer lifecycle chaincode package "/opt/chaincodes/$PACKAGE_FILE" \
    --path "/opt/chaincodes/.build/$CC_DIR" \
    --lang node \
    --label "$LABEL" \
    || write_err "Package failed."
write_ok "Packaged → /opt/chaincodes/$PACKAGE_FILE"

# ─── 4. Install on every peer (tolerates "already installed") ─────────────────
for spec in "${ORGS[@]}"; do
    IFS='|' read -r name _ _ domain <<< "$spec"
    write_step "Installing on peer0.$domain..."
    peer_env "$spec"
    set +e
    output="$(docker exec "${PEER_ENV[@]}" coconet-cli sh -c "peer lifecycle chaincode install /opt/chaincodes/$PACKAGE_FILE 2>&1")"
    exit=$?
    set -e
    if [[ "$exit" -ne 0 ]]; then
        if grep -q "chaincode already successfully installed" <<< "$output"; then
            write_ok "Already installed on $name - skipping."
        else
            printf '%s\n' "$output" >&2
            write_err "Install failed on $name."
        fi
    else
        write_ok "Installed on $name."
    fi
done

# ─── 5. Capture package ID ────────────────────────────────────────────────────
write_step "Querying package ID..."
peer_env "${ORGS[0]}"
ENV_BUYER=("${PEER_ENV[@]}")
installed="$(docker exec "${ENV_BUYER[@]}" coconet-cli peer lifecycle chaincode queryinstalled)"
pkg_line="$(grep "Package ID: $LABEL" <<< "$installed" | head -n 1 || true)"
[[ -n "$pkg_line" ]] || write_err "Package ID for $LABEL not found in queryinstalled output."
PKG_ID="$(sed -E 's/.*Package ID: ([^,]+),.*/\1/' <<< "$pkg_line" | xargs)"
write_ok "Package ID: $PKG_ID"

# ─── 6. Approve from every org ────────────────────────────────────────────────
for spec in "${ORGS[@]}"; do
    IFS='|' read -r _ msp _ _ <<< "$spec"
    write_step "Approving from $msp..."
    peer_env "$spec"
    docker exec "${PEER_ENV[@]}" coconet-cli peer lifecycle chaincode approveformyorg \
        --channelID "$CHANNEL" \
        --name "$CC_NAME" \
        --version "$VERSION" \
        --package-id "$PKG_ID" \
        --sequence "$SEQUENCE" \
        --orderer orderer.coconet.local:7050 \
        --tls \
        --cafile "$ORDERER_CA" \
        || write_err "Approve failed for $msp."
    write_ok "Approved by $msp."
done

# ─── 7. Check commit readiness ────────────────────────────────────────────────
write_step "Checking commit readiness..."
docker exec "${ENV_BUYER[@]}" coconet-cli peer lifecycle chaincode checkcommitreadiness \
    --channelID "$CHANNEL" \
    --name "$CC_NAME" \
    --version "$VERSION" \
    --sequence "$SEQUENCE" \
    --tls \
    --cafile "$ORDERER_CA" \
    --output json \
    || write_err "Commit readiness check failed."

# ─── 8. Commit (needs --peerAddresses for every endorsing org) ────────────────
write_step "Committing $LABEL to channel '$CHANNEL'..."
PEER_ARGS=()
for spec in "${ORGS[@]}"; do
    IFS='|' read -r _ _ port domain <<< "$spec"
    PEER_ARGS+=(--peerAddresses "peer0.$domain:$port")
    PEER_ARGS+=(--tlsRootCertFiles "/opt/crypto/peerOrganizations/$domain/peers/peer0.$domain/tls/ca.crt")
done

docker exec "${ENV_BUYER[@]}" coconet-cli peer lifecycle chaincode commit \
    --channelID "$CHANNEL" \
    --name "$CC_NAME" \
    --version "$VERSION" \
    --sequence "$SEQUENCE" \
    --orderer orderer.coconet.local:7050 \
    --tls \
    --cafile "$ORDERER_CA" \
    "${PEER_ARGS[@]}" \
    || write_err "Commit failed."
write_ok "Committed $LABEL to channel."

# ─── 9. Verify committed ──────────────────────────────────────────────────────
write_step "Verifying committed chaincode..."
docker exec "${ENV_BUYER[@]}" coconet-cli peer lifecycle chaincode querycommitted \
    --channelID "$CHANNEL" \
    --name "$CC_NAME"

echo ""
echo "Chaincode '$CC_NAME' v$VERSION (sequence $SEQUENCE) live on '$CHANNEL'."
echo "Smoke-test:"
echo "  docker exec coconet-cli peer chaincode query -C $CHANNEL -n $CC_NAME -c '{\"function\":\"getOrganization\",\"Args\":[\"tata-001\"]}'"
