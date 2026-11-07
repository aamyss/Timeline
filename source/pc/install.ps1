# Work timeline: installs the PC reporter (runs every 5 minutes and at sign-in, hidden).
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$dir = Join-Path $env:LOCALAPPDATA 'WorkTimeline'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

Write-Host 'Work timeline - PC reporter setup' -ForegroundColor Cyan
Write-Host 'In the Google Sheet: Work timeline > Links and PC setup code. Copy the PC setup code.'
$cfgPath = Join-Path $dir 'reporter.json'
$code = (Read-Host 'Paste the PC setup code here (or press Enter to keep the current one)').Trim()
if (-not $code -and (Test-Path -LiteralPath $cfgPath)) {
  $old = Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $code = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -Compress -InputObject @{ u = $old.endpoint; t = $old.token })))
}
try { $cfgIn = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($code)) | ConvertFrom-Json }
catch { Write-Host 'That code is not valid. Copy it again from the sheet.' -ForegroundColor Red; exit 1 }
if (-not $cfgIn.u -or -not $cfgIn.t) { Write-Host 'That code is incomplete. Copy it again from the sheet.' -ForegroundColor Red; exit 1 }

$od = $env:OneDriveConsumer
if (-not $od) { $od = $env:OneDrive }
if (Test-Path -LiteralPath $cfgPath) {
  $cfg = Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json   # keep your folder list
  $cfg.endpoint = $cfgIn.u; $cfg.token = $cfgIn.t
} else {
  $cfg = [pscustomobject]@{
    endpoint = $cfgIn.u
    token = $cfgIn.t
    backfillFrom = '2026-10-01'
    roots = @(
      [pscustomobject]@{ label = '#Police'; path = (Join-Path $od '#Police'); exclude = @('Work Timeline', 'Inquiry Copilot Mirror') },
      [pscustomobject]@{ label = 'Inquiry Copilot'; path = 'D:\Inquiry_Copilot_Storage\profiles'; exclude = @('__temp__') }
    )
  }
}
ConvertTo-Json -InputObject $cfg -Depth 5 | Set-Content -LiteralPath $cfgPath -Encoding UTF8
Copy-Item -Force (Join-Path $PSScriptRoot 'reporter.ps1') $dir
Copy-Item -Force (Join-Path $PSScriptRoot 'run-reporter.vbs') $dir

# Test the connection with an empty report.
Write-Host 'Checking the connection...'
$body = ConvertTo-Json -Compress -InputObject @{ token = $cfg.token; device = $env:COMPUTERNAME;
  deviceNow = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'"); events = @() }
try {
  $resp = Invoke-RestMethod -Uri $cfg.endpoint -Method Post -ContentType 'application/json; charset=utf-8' `
    -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 60
} catch { Write-Host ('Could not reach the timeline: ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }
if (-not $resp.ok) { Write-Host ('The timeline refused: ' + $resp.error) -ForegroundColor Red; exit 1 }
Write-Host ('Connected. Google time: ' + $resp.receipt) -ForegroundColor Green

# Remove the earlier copy task if it was installed.
Unregister-ScheduledTask -TaskName 'Work timeline - Inquiry Copilot copy' -Confirm:$false -ErrorAction SilentlyContinue

$name = 'Work timeline - PC reporter'
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + (Join-Path $dir 'run-reporter.vbs') + '"')
$every5 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
# Windows needs the full account name (PC-NAME\user), especially for Microsoft-account sign-ins.
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
try {
  $logon = New-ScheduledTaskTrigger -AtLogOn -User $user
  Register-ScheduledTask -TaskName $name -Action $action -Trigger @($every5, $logon) -Settings $settings `
    -Principal $principal -Force -ErrorAction Stop | Out-Null
} catch {
  # Fallback: every 5 minutes only ("run when available" still catches up after sign-in).
  Write-Host ('Sign-in trigger not accepted (' + $_.Exception.Message.Trim() + '); using the 5-minute schedule only.') -ForegroundColor Yellow
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $every5 -Settings $settings `
    -Principal $principal -Force -ErrorAction Stop | Out-Null
}
Start-ScheduledTask -TaskName $name

Write-Host ''
Write-Host 'Installed. The first scan is running now (it can take a few minutes).' -ForegroundColor Green
Write-Host 'Watching:'
foreach ($r in $cfg.roots) { Write-Host ('  ' + $r.label + '  ->  ' + $r.path) }
Write-Host ('Log: ' + (Join-Path $dir 'last-run.log'))
