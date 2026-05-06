# setup-channel.ps1
# Joins the orderer + all peers to buyer-supplier-channel.
# Run after `docker compose up -d` and the network is healthy.

$ErrorActionPreference = "Stop"
$ChannelID   = "buyer-supplier-channel"
$FabricImage = "hyperledger/fabric-tools:2.5"
$ProjectRoot = Split-Path $PSScriptRoot -Parent

function Write-Step($msg) { Write-Host "`n[CHANNEL] $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "[OK]      $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "[ERR]     $msg" -ForegroundColor Red; exit 1 }

function Wait-ForContainer($name, $seconds = 10) {
    Write-Host "  Waiting ${seconds}s for $name..." -ForegroundColor Gray
    Start-Sleep -Seconds $seconds
}

# ─── Wait for orderer ─────────────────────────────────────────────────────────
Write-Step "Waiting for orderer to be ready..."
Wait-ForContainer "orderer.coconet.local" 8

# ─── Join orderer to channel via osnadmin ─────────────────────────────────────
Write-Step "Joining orderer to channel '$ChannelID'..."
docker exec coconet-cli osnadmin channel join `
    --channelID $ChannelID `
    --config-block /opt/channel-artifacts/buyer-supplier-channel.block `
    -o orderer.coconet.local:7053 `
    --ca-file /opt/crypto/ordererOrganizations/coconet.local/orderers/orderer.coconet.local/msp/tlscacerts/tlsca.coconet.local-cert.pem `
    --client-cert /opt/crypto/ordererOrganizations/coconet.local/orderers/orderer.coconet.local/tls/server.crt `
    --client-key /opt/crypto/ordererOrganizations/coconet.local/orderers/orderer.coconet.local/tls/server.key

if ($LASTEXITCODE -ne 0) { Write-Err "Orderer failed to join channel." }
Write-OK "Orderer joined channel."

# ─── Per-peer join helper ─────────────────────────────────────────────────────
function Join-Peer($orgMSP, $peerAddr, $cryptoPath, $adminPath) {
    Write-Step "Joining $peerAddr to channel..."
    docker exec `
        -e CORE_PEER_LOCALMSPID=$orgMSP `
        -e CORE_PEER_ADDRESS=$peerAddr `
        -e CORE_PEER_TLS_ROOTCERT_FILE="/opt/crypto/${cryptoPath}/tls/ca.crt" `
        -e CORE_PEER_MSPCONFIGPATH="/opt/crypto/${adminPath}" `
        coconet-cli `
        peer channel join -b /opt/channel-artifacts/buyer-supplier-channel.block

    if ($LASTEXITCODE -ne 0) { Write-Err "Failed to join $peerAddr." }
    Write-OK "$peerAddr joined."
}

# ─── Join all peers ───────────────────────────────────────────────────────────
Join-Peer "BuyerMSP" `
    "peer0.buyer.coconet.local:7051" `
    "peerOrganizations/buyer.coconet.local/peers/peer0.buyer.coconet.local" `
    "peerOrganizations/buyer.coconet.local/users/Admin@buyer.coconet.local/msp"

Join-Peer "SupplierMSP" `
    "peer0.supplier.coconet.local:8051" `
    "peerOrganizations/supplier.coconet.local/peers/peer0.supplier.coconet.local" `
    "peerOrganizations/supplier.coconet.local/users/Admin@supplier.coconet.local/msp"

Join-Peer "LenderMSP" `
    "peer0.lender.coconet.local:9051" `
    "peerOrganizations/lender.coconet.local/peers/peer0.lender.coconet.local" `
    "peerOrganizations/lender.coconet.local/users/Admin@lender.coconet.local/msp"

Join-Peer "PlatformMSP" `
    "peer0.platform.coconet.local:10051" `
    "peerOrganizations/platform.coconet.local/peers/peer0.platform.coconet.local" `
    "peerOrganizations/platform.coconet.local/users/Admin@platform.coconet.local/msp"

Join-Peer "AuditorMSP" `
    "peer0.auditor.coconet.local:11051" `
    "peerOrganizations/auditor.coconet.local/peers/peer0.auditor.coconet.local" `
    "peerOrganizations/auditor.coconet.local/users/Admin@auditor.coconet.local/msp"

# ─── Done ─────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Channel setup complete. All peers joined '$ChannelID'." -ForegroundColor Green
Write-Host "Next step: cd api && npm install && npm run dev" -ForegroundColor Cyan
