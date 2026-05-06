# network-down.ps1
# Tears down the compose stack and cleans volumes.
# Pass -KeepVolumes to preserve ledger data.

param([switch]$KeepVolumes)

$ProjectRoot = Split-Path $PSScriptRoot -Parent
Set-Location $ProjectRoot

Write-Host "[DOWN] Stopping CocoNet network..." -ForegroundColor Yellow

if ($KeepVolumes) {
    docker compose down
} else {
    docker compose down -v
    Write-Host "[DOWN] Volumes removed." -ForegroundColor Yellow
}

Write-Host "[DOWN] Done." -ForegroundColor Green
