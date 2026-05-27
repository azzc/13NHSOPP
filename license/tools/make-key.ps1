# make-key.ps1 — สร้าง Free key ง่ายๆ ใส่ hcode อย่างเดียว
#
# ใช้งาน:
#   .\make-key.ps1 05097
#
# Output:
#   PP-A7K2-9XQH-M3PD-V8FN
#   (copy ลง clipboard แล้ว)

param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$Hcode
)

$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$keyFile = Join-Path $dir '.service-role-key'

# --- ครั้งแรก: ขอ service_role key แล้ว save ไว้ ---
if (-not (Test-Path $keyFile)) {
    Write-Host ""
    Write-Host "🔧 ครั้งแรก — ตั้ง Supabase service_role key" -ForegroundColor Yellow
    Write-Host "   หาที่: https://supabase.com/dashboard/project/fzlzmrwkueonabpwuhma/settings/api"
    Write-Host "   (กด Reveal ใต้ 'service_role secret')"
    Write-Host ""
    $sk = Read-Host "วาง service_role key"
    if ([string]::IsNullOrWhiteSpace($sk)) { Write-Host "❌ ว่าง" -ForegroundColor Red; exit 1 }
    $sk.Trim() | Out-File $keyFile -Encoding ascii -NoNewline
    Write-Host "✓ บันทึกแล้ว ที่ $keyFile" -ForegroundColor Green
    Write-Host ""
}

$env:SUPABASE_SERVICE_ROLE_KEY = (Get-Content $keyFile -Raw).Trim()

# --- check node + gen_license.js ---
$genJs = Join-Path $dir 'gen_license.js'
if (-not (Test-Path $genJs)) { Write-Host "❌ ไม่พบ gen_license.js" -ForegroundColor Red; exit 1 }

# --- check dependencies ---
if (-not (Test-Path (Join-Path $dir 'node_modules'))) {
    Write-Host "📦 ติดตั้ง dependencies ครั้งแรก..." -ForegroundColor Yellow
    Push-Location $dir
    npm install 2>&1 | Out-Null
    Pop-Location
}

# --- รัน gen_license ---
Push-Location $dir
$output = & node 'gen_license.js' --hcode $Hcode --plan free 2>&1
$exit = $LASTEXITCODE
Pop-Location

if ($exit -ne 0) {
    Write-Host ""
    Write-Host "❌ ไม่สำเร็จ:" -ForegroundColor Red
    $output | ForEach-Object { Write-Host "   $_" }
    exit 1
}

# --- ดึง key + expires_at จาก output ---
$key = ($output | Select-String 'license_key:\s+(\S+)').Matches | ForEach-Object { $_.Groups[1].Value } | Select-Object -First 1
$exp = ($output | Select-String 'expires_at:\s+(\S+)').Matches | ForEach-Object { $_.Groups[1].Value } | Select-Object -First 1

if ([string]::IsNullOrWhiteSpace($key)) {
    Write-Host "⚠️ ไม่เจอ key ใน output:" -ForegroundColor Yellow
    $output | ForEach-Object { Write-Host "   $_" }
    exit 1
}

# --- print key + copy ลง clipboard ---
Write-Host ""
Write-Host $key -ForegroundColor Green
$key | Set-Clipboard
Write-Host "(copy ลง clipboard แล้ว)" -ForegroundColor DarkGray
if ($exp) {
    # แปลง ISO timestamp → date format ไทย
    try {
        $dt = [DateTime]::Parse($exp).ToLocalTime()
        Write-Host "หมดอายุ: $($dt.ToString('dd/MM/yyyy HH:mm'))" -ForegroundColor DarkGray
    } catch {}
}
Write-Host ""
