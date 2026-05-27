# make-key.ps1 -- generate Free key, input hcode only
# Usage:  .\make-key.ps1 05097

param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$Hcode
)

$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$keyFile = Join-Path $dir '.service-role-key'

# First time: ask for service_role key, save to file
if (-not (Test-Path $keyFile)) {
    Write-Host ""
    Write-Host "[Setup] Need Supabase service_role key (one-time)" -ForegroundColor Yellow
    Write-Host "Get from: https://supabase.com/dashboard/project/fzlzmrwkueonabpwuhma/settings/api"
    Write-Host "(click Reveal under 'service_role secret')"
    Write-Host ""
    $sk = Read-Host "Paste service_role key (long JWT starts with eyJ...)"
    $sk = $sk.Trim()
    if ([string]::IsNullOrWhiteSpace($sk)) {
        Write-Host "[X] Empty input" -ForegroundColor Red
        exit 1
    }
    # Validate: must be JWT (3 parts split by dot, starts with eyJ)
    if (-not ($sk.StartsWith('eyJ')) -or ($sk.Split('.').Count -ne 3) -or ($sk.Length -lt 100)) {
        Write-Host "[X] Not a valid JWT" -ForegroundColor Red
        Write-Host "    service_role key must look like: eyJhbGc...<long string>...xxx"
        Write-Host "    Found: $($sk.Substring(0, [Math]::Min(40, $sk.Length)))..."
        exit 1
    }
    [System.IO.File]::WriteAllText($keyFile, $sk)
    Write-Host "[OK] Saved to $keyFile" -ForegroundColor Green
    Write-Host ""
}

$env:SUPABASE_SERVICE_ROLE_KEY = [System.IO.File]::ReadAllText($keyFile).Trim()

# Check gen_license.js
$genJs = Join-Path $dir 'gen_license.js'
if (-not (Test-Path $genJs)) {
    Write-Host "[X] gen_license.js not found" -ForegroundColor Red
    exit 1
}

# Install deps if needed
if (-not (Test-Path (Join-Path $dir 'node_modules'))) {
    Write-Host "[Setup] Installing dependencies..." -ForegroundColor Yellow
    Push-Location $dir
    npm install 2>&1 | Out-Null
    Pop-Location
}

# Run gen_license
Push-Location $dir
$output = & node 'gen_license.js' --hcode $Hcode --plan free 2>&1
$exit = $LASTEXITCODE
Pop-Location

if ($exit -ne 0) {
    Write-Host ""
    Write-Host "[X] Failed:" -ForegroundColor Red
    $output | ForEach-Object { Write-Host "   $_" }
    exit 1
}

# Extract key + expires
$key = $null
$exp = $null
foreach ($line in $output) {
    if ($line -match 'license_key:\s+(\S+)') { $key = $matches[1] }
    if ($line -match 'expires_at:\s+(\S+)')   { $exp = $matches[1] }
}

if ([string]::IsNullOrWhiteSpace($key)) {
    Write-Host "[!] No key found in output:" -ForegroundColor Yellow
    $output | ForEach-Object { Write-Host "   $_" }
    exit 1
}

Write-Host ""
Write-Host $key -ForegroundColor Green
$key | Set-Clipboard
Write-Host "(copied to clipboard)" -ForegroundColor DarkGray
if ($exp) {
    try {
        $dt = [DateTime]::Parse($exp).ToLocalTime()
        Write-Host ("expires: " + $dt.ToString('dd/MM/yyyy HH:mm')) -ForegroundColor DarkGray
    } catch {}
}
Write-Host ""
