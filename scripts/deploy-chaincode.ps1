# deploy-chaincode.ps1
# Fabric 2.5 chaincode lifecycle: build → package → install (5 peers) → approve (5 orgs) → commit
#
# Usage:
#   .\scripts\deploy-chaincode.ps1                            # deploys onboarding-cc v1.0 (default)
#   .\scripts\deploy-chaincode.ps1 -CcName onboarding -Version 1.1 -Sequence 2
#
# Pre-reqs:
#   1. docker compose up -d (network healthy)
#   2. .\scripts\setup-channel.ps1 (all peers joined buyer-supplier-channel)

param(
    [string]$CcName   = "onboarding",
    [string]$CcDir    = "onboarding-cc",
    [string]$Version  = "1.0",
    [int]$Sequence    = 1,
    [string]$Channel  = "buyer-supplier-channel"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path $PSScriptRoot -Parent
$Label       = "${CcName}_${Version}"
$PackageFile = "${CcName}.tar.gz"
$OrdererCA   = "/opt/crypto/ordererOrganizations/coconet.local/orderers/orderer.coconet.local/msp/tlscacerts/tlsca.coconet.local-cert.pem"

function Write-Step($msg) { Write-Host "`n[CC] $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "[ERR] $msg" -ForegroundColor Red; exit 1 }

# ─── Org table ────────────────────────────────────────────────────────────────
$Orgs = @(
    @{ Name="buyer";    MSP="BuyerMSP";    Port=7051;  Domain="buyer.coconet.local"    },
    @{ Name="supplier"; MSP="SupplierMSP"; Port=8051;  Domain="supplier.coconet.local" },
    @{ Name="lender";   MSP="LenderMSP";   Port=9051;  Domain="lender.coconet.local"   },
    @{ Name="platform"; MSP="PlatformMSP"; Port=10051; Domain="platform.coconet.local" },
    @{ Name="auditor";  MSP="AuditorMSP";  Port=11051; Domain="auditor.coconet.local"  }
)

function Get-PeerEnv($org) {
    $crypto = "/opt/crypto/peerOrganizations/$($org.Domain)"
    return @(
        "-e", "CORE_PEER_LOCALMSPID=$($org.MSP)",
        "-e", "CORE_PEER_ADDRESS=peer0.$($org.Domain):$($org.Port)",
        "-e", "CORE_PEER_TLS_ROOTCERT_FILE=$crypto/peers/peer0.$($org.Domain)/tls/ca.crt",
        "-e", "CORE_PEER_MSPCONFIGPATH=$crypto/users/Admin@$($org.Domain)/msp"
    )
}

# ─── 1. Build chaincode (host-side) ───────────────────────────────────────────
Write-Step "Building $CcDir on host..."
Push-Location "$ProjectRoot\chaincodes\$CcDir"
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Err "Chaincode build failed." }
Pop-Location
Write-OK "Build complete (dist/ produced)."

# ─── 2. Stage clean package directory ─────────────────────────────────────────
Write-Step "Staging clean package directory..."
$Stage = "$ProjectRoot\chaincodes\.build\$CcDir"
if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Path $Stage -Force | Out-Null
Copy-Item "$ProjectRoot\chaincodes\$CcDir\dist"         "$Stage\dist"         -Recurse
Copy-Item "$ProjectRoot\chaincodes\$CcDir\package.json" "$Stage\package.json"
Write-OK "Staged at chaincodes\.build\$CcDir"

# ─── 3. Package chaincode (from cli container) ────────────────────────────────
Write-Step "Packaging $Label..."
docker exec coconet-cli peer lifecycle chaincode package "/opt/chaincodes/$PackageFile" `
    --path "/opt/chaincodes/.build/$CcDir" `
    --lang node `
    --label $Label
if ($LASTEXITCODE -ne 0) { Write-Err "Package failed." }
Write-OK "Packaged → /opt/chaincodes/$PackageFile"

# ─── 4. Install on every peer ─────────────────────────────────────────────────
foreach ($org in $Orgs) {
    Write-Step "Installing on peer0.$($org.Domain)..."
    $env = Get-PeerEnv $org
    docker exec @env coconet-cli peer lifecycle chaincode install "/opt/chaincodes/$PackageFile"
    if ($LASTEXITCODE -ne 0) { Write-Err "Install failed on $($org.Name)." }
    Write-OK "Installed on $($org.Name)."
}

# ─── 5. Capture package ID ────────────────────────────────────────────────────
Write-Step "Querying package ID..."
$envBuyer = Get-PeerEnv $Orgs[0]
$installed = docker exec @envBuyer coconet-cli peer lifecycle chaincode queryinstalled
$pkgLine = $installed | Select-String -Pattern "Package ID: $Label" | Select-Object -First 1
if (-not $pkgLine) { Write-Err "Package ID for $Label not found in queryinstalled output." }
$PkgId = ($pkgLine -split "Package ID: ")[1] -split "," | Select-Object -First 1
$PkgId = $PkgId.Trim()
Write-OK "Package ID: $PkgId"

# ─── 6. Approve from every org ────────────────────────────────────────────────
foreach ($org in $Orgs) {
    Write-Step "Approving from $($org.MSP)..."
    $env = Get-PeerEnv $org
    docker exec @env coconet-cli peer lifecycle chaincode approveformyorg `
        --channelID $Channel `
        --name $CcName `
        --version $Version `
        --package-id $PkgId `
        --sequence $Sequence `
        --orderer orderer.coconet.local:7050 `
        --tls `
        --cafile $OrdererCA
    if ($LASTEXITCODE -ne 0) { Write-Err "Approve failed for $($org.MSP)." }
    Write-OK "Approved by $($org.MSP)."
}

# ─── 7. Check commit readiness ────────────────────────────────────────────────
Write-Step "Checking commit readiness..."
docker exec @envBuyer coconet-cli peer lifecycle chaincode checkcommitreadiness `
    --channelID $Channel `
    --name $CcName `
    --version $Version `
    --sequence $Sequence `
    --tls `
    --cafile $OrdererCA `
    --output json
if ($LASTEXITCODE -ne 0) { Write-Err "Commit readiness check failed." }

# ─── 8. Commit (needs --peerAddresses for every endorsing org) ────────────────
Write-Step "Committing $Label to channel '$Channel'..."
$peerArgs = @()
foreach ($org in $Orgs) {
    $peerArgs += "--peerAddresses"
    $peerArgs += "peer0.$($org.Domain):$($org.Port)"
    $peerArgs += "--tlsRootCertFiles"
    $peerArgs += "/opt/crypto/peerOrganizations/$($org.Domain)/peers/peer0.$($org.Domain)/tls/ca.crt"
}

docker exec @envBuyer coconet-cli peer lifecycle chaincode commit `
    --channelID $Channel `
    --name $CcName `
    --version $Version `
    --sequence $Sequence `
    --orderer orderer.coconet.local:7050 `
    --tls `
    --cafile $OrdererCA `
    @peerArgs
if ($LASTEXITCODE -ne 0) { Write-Err "Commit failed." }
Write-OK "Committed $Label to channel."

# ─── 9. Verify committed ──────────────────────────────────────────────────────
Write-Step "Verifying committed chaincode..."
docker exec @envBuyer coconet-cli peer lifecycle chaincode querycommitted `
    --channelID $Channel `
    --name $CcName

Write-Host ""
Write-Host "Chaincode '$CcName' v$Version (sequence $Sequence) live on '$Channel'." -ForegroundColor Green
Write-Host "Smoke-test:" -ForegroundColor Cyan
Write-Host "  docker exec coconet-cli peer chaincode query -C $Channel -n $CcName -c '{\"function\":\"getOrganization\",\"Args\":[\"tata-001\"]}'" -ForegroundColor Gray
