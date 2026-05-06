# generate-artifacts.ps1
# Generates all Fabric crypto material and channel artifacts.
# Run once before the first `docker compose up`.
# Requires Docker Desktop running.

param(
    [switch]$Force  # pass -Force to regenerate even if artifacts already exist
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path $PSScriptRoot -Parent
$FabricNetDir = Join-Path $ProjectRoot "fabric-network"
$CryptoDir    = Join-Path $FabricNetDir "crypto-config"
$ArtifactsDir = Join-Path $FabricNetDir "channel-artifacts"
$ConfigDir    = Join-Path $FabricNetDir "config"

$FabricImage = "hyperledger/fabric-tools:2.5"
$ChannelID   = "buyer-supplier-channel"

function Write-Step($msg) { Write-Host "`n[SETUP] $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "[OK]    $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "[ERR]   $msg" -ForegroundColor Red; exit 1 }

# ─── Guard ────────────────────────────────────────────────────────────────────
if ((Test-Path $CryptoDir) -and -not $Force) {
    Write-Host "[INFO] crypto-config already exists. Use -Force to regenerate." -ForegroundColor Yellow
    exit 0
}

# ─── Cleanup ──────────────────────────────────────────────────────────────────
Write-Step "Cleaning old artifacts..."
if (Test-Path $CryptoDir)    { Remove-Item $CryptoDir    -Recurse -Force }
if (Test-Path $ArtifactsDir) { Remove-Item $ArtifactsDir -Recurse -Force }

New-Item -ItemType Directory -Path $ArtifactsDir -Force | Out-Null
Write-OK "Directories prepared."

# ─── Pull fabric-tools image ──────────────────────────────────────────────────
Write-Step "Pulling $FabricImage..."
docker pull $FabricImage
if ($LASTEXITCODE -ne 0) { Write-Err "Failed to pull $FabricImage. Is Docker running?" }
Write-OK "Image ready."

# Docker volume mount path must use forward slashes for Linux containers
$MountProject = $ProjectRoot.Replace('\', '/')
# Windows absolute paths for Docker need /c/... format on Git Bash;
# with Docker Desktop on Windows, use the native Windows path — Docker Desktop translates it.
$DockerMount = "${ProjectRoot}:/workspace"

# ─── Step 1: Generate crypto material with cryptogen ─────────────────────────
Write-Step "Generating crypto material (cryptogen)..."
docker run --rm `
    -v "${DockerMount}" `
    -w /workspace/fabric-network `
    $FabricImage `
    cryptogen generate --config=./config/crypto-config.yaml --output=./crypto-config

if ($LASTEXITCODE -ne 0) { Write-Err "cryptogen failed." }
Write-OK "Crypto material generated at fabric-network/crypto-config/"

# ─── Step 2: Generate channel genesis block (configtxgen) ────────────────────
Write-Step "Generating channel genesis block for '$ChannelID'..."
docker run --rm `
    -v "${DockerMount}" `
    -w /workspace/fabric-network `
    -e FABRIC_CFG_PATH=/workspace/fabric-network/config `
    $FabricImage `
    configtxgen `
        -profile BuyerSupplierChannel `
        -outputBlock ./channel-artifacts/buyer-supplier-channel.block `
        -channelID $ChannelID

if ($LASTEXITCODE -ne 0) { Write-Err "configtxgen (genesis block) failed." }
Write-OK "Genesis block created at fabric-network/channel-artifacts/buyer-supplier-channel.block"

# ─── Done ─────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Artifacts generated successfully." -ForegroundColor Green
Write-Host "Next step: docker compose up -d" -ForegroundColor Cyan
Write-Host "Then run: .\scripts\setup-channel.ps1" -ForegroundColor Cyan
