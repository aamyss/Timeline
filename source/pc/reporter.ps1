# Work timeline - PC reporter
# Every few minutes: finds created / edited / renamed / deleted files in the watched folders and
# sends them to the timeline. Google's clock stamps each report on arrival.
# Works with Windows PowerShell 5.1 (built into Windows). Reads files only; never changes them.
param([string]$ConfigDir = (Join-Path $env:LOCALAPPDATA 'WorkTimeline'), [string]$TestPhoto = '')

$ErrorActionPreference = 'Stop'
$cfgPath = Join-Path $ConfigDir 'reporter.json'
$statePath = Join-Path $ConfigDir 'state.json'
$logPath = Join-Path $ConfigDir 'last-run.log'
$fmt = "yyyy-MM-dd'T'HH:mm:ss'Z'"
$maxHashBytes = 200MB
$batchSize = 200

function Write-Log($msg) {
  if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 1MB) { Remove-Item -LiteralPath $logPath }
  Add-Content -LiteralPath $logPath -Value ((Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + '  ' + $msg) -Encoding UTF8
}

# ---------- photo metadata (time taken + GPS), via Windows' own image codecs ----------
$photoExt = '\.(jpe?g|heic|heif)$'
$script:wic = $false
try { Add-Type -AssemblyName PresentationCore -ErrorAction Stop; $script:wic = $true } catch { }
$fakeExif = $null
if ($env:WT_FAKE_EXIF) { $fakeExif = Get-Content -LiteralPath $env:WT_FAKE_EXIF -Raw | ConvertFrom-Json }   # tests only

function Convert-Rational($v) {
  # WIC packs an EXIF rational as one 64-bit number: low 32 bits numerator, high 32 bits denominator.
  $d = [decimal]$v
  $den = [Math]::Floor($d / 4294967296)
  $num = $d - $den * 4294967296
  if ($den -eq 0) { return 0.0 }
  return [double]($num / $den)
}
function Convert-Dms($arr, $ref) {
  if ($null -eq $arr -or @($arr).Count -lt 3) { return $null }
  $a = @($arr)
  $deg = (Convert-Rational $a[0]) + (Convert-Rational $a[1]) / 60 + (Convert-Rational $a[2]) / 3600
  if ($ref -eq 'S' -or $ref -eq 'W') { $deg = -$deg }
  return [Math]::Round($deg, 6)
}
function Convert-ExifTime($text, $offset) {
  # "2026:11:05 14:20:31" + "+07:00" (iPhone writes the offset; assume Bangkok if missing) -> UTC ISO
  if (-not $text) { return $null }
  $m = [regex]::Match([string]$text, '^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})')
  if (-not $m.Success) { return $null }
  $off = '+07:00'
  if ($offset -and ([string]$offset) -match '^[+-]\d{2}:\d{2}$') { $off = [string]$offset }
  $iso = '{0}-{1}-{2}T{3}:{4}:{5}{6}' -f $m.Groups[1].Value, $m.Groups[2].Value, $m.Groups[3].Value, $m.Groups[4].Value, $m.Groups[5].Value, $m.Groups[6].Value, $off
  return ([DateTimeOffset]::Parse($iso, [Globalization.CultureInfo]::InvariantCulture)).UtcDateTime.ToString($fmt)
}
function Get-PhotoMeta($e) {
  # Online-only photos (OneDrive Files On-Demand) are opened anyway: OneDrive downloads just that photo.
  if ($e.rel -notmatch $photoExt) { return $null }
  if ($fakeExif) {
    $f = $fakeExif.($e.rel.Split('/')[-1]); if (-not $f) { return $null }
    return [pscustomobject]@{ taken = (Convert-ExifTime $f.taken $f.offset); lat = $f.lat; lon = $f.lon }
  }
  if (-not $script:wic) { return $null }
  $fs = $null
  try {
    $fs = [IO.File]::OpenRead($e.full)
    $dec = [Windows.Media.Imaging.BitmapDecoder]::Create($fs, [Windows.Media.Imaging.BitmapCreateOptions]::DelayCreation, [Windows.Media.Imaging.BitmapCacheOption]::None)
    $md = $dec.Frames[0].Metadata
    if (-not $md) { return $null }
    foreach ($pre in @('/app1/ifd', '/ifd')) {     # JPEG keeps EXIF under /app1, HEIC under /ifd
      $q = { param($path) try { $md.GetQuery($pre + $path) } catch { $null } }
      $taken = & $q '/exif/{ushort=36867}'
      if (-not $taken) { continue }
      $lat = Convert-Dms (& $q '/gps/{ushort=2}') (& $q '/gps/{ushort=1}')
      $lon = Convert-Dms (& $q '/gps/{ushort=4}') (& $q '/gps/{ushort=3}')
      return [pscustomobject]@{ taken = (Convert-ExifTime $taken (& $q '/exif/{ushort=36881}')); lat = $lat; lon = $lon }
    }
    return $null
  } catch { return $null } finally { if ($fs) { $fs.Dispose() } }
}

if ($TestPhoto) {
  # Check mode: show what can be read from one photo, send nothing.
  $t = [pscustomobject]@{ cloud = $false; rel = (Split-Path $TestPhoto -Leaf); full = $TestPhoto }
  $m = Get-PhotoMeta $t
  if (-not $m -and -not $script:wic) { Write-Host 'Windows image components are not available.' -ForegroundColor Red }
  elseif (-not $m) { Write-Host 'No time taken found in this photo (it may have no camera data).' -ForegroundColor Yellow }
  else {
    Write-Host ('Taken (UTC): ' + $m.taken) -ForegroundColor Green
    if ($null -ne $m.lat) { Write-Host ('GPS: ' + $m.lat + ', ' + $m.lon + '   https://maps.google.com/?q=' + $m.lat + ',' + $m.lon) -ForegroundColor Green }
    else { Write-Host 'GPS: none (location was off or removed when shared)' -ForegroundColor Yellow }
  }
  exit 0
}


# One run at a time.
$mutex = New-Object System.Threading.Mutex($false, 'Local\WorkTimelineReporter')
if (-not $mutex.WaitOne(0)) { exit 0 }

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $cfg = Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $sep = [IO.Path]::DirectorySeparatorChar
  if ($cfg.backfillFrom -is [datetime]) { $bf = $cfg.backfillFrom }
  else { $bf = [datetime]::ParseExact([string]$cfg.backfillFrom, 'yyyy-MM-dd', $null) }
  $backfillUtc = $bf.AddHours(-7).ToString($fmt)   # backfill date is Bangkok time

  $noiseName = '^(~\$|\.~lock|~WRL)|\.tmp$|^desktop\.ini$|^thumbs\.db$|^\.ds_store$'
  $noiseDirs = @('.ts', '.tagspaces')

  # ---------- previous state ----------
  $initial = -not (Test-Path -LiteralPath $statePath)
  $state = @{}
  if (-not $initial) {
    $raw = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($p in $raw.PSObject.Properties) { $state[$p.Name] = $p.Value }
  }

  # ---------- scan ----------
  $now = @{}           # key -> entry
  $scannedRoots = @{}  # roots that were readable this run (deletions only counted for these)
  foreach ($root in $cfg.roots) {
    $base = $root.path.TrimEnd('\', '/')
    if (-not (Test-Path -LiteralPath $base)) { Write-Log ("Not found, skipped: " + $base); continue }
    $scannedRoots[$root.label] = $true
    $skip = @($root.exclude) + $noiseDirs
    Get-ChildItem -LiteralPath $base -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object {
      $rel = $_.FullName.Substring($base.Length).TrimStart('\', '/')
      $segs = @($rel -split '[\\/]' | Where-Object { $_ -ne '' })
      foreach ($s in $segs) { if ($skip -contains $s) { return } }
      if (-not $_.PSIsContainer -and $_.Name -match $noiseName) { return }
      $attr = [int]$_.Attributes
      $now[$root.label + '|' + ($segs -join '/')] = [pscustomobject]@{
        root  = $root.label
        rel   = ($segs -join '/')
        full  = $_.FullName
        dir   = [bool]$_.PSIsContainer
        size  = $(if ($_.PSIsContainer) { 0 } else { [int64]$_.Length })
        m     = $_.LastWriteTimeUtc.ToString($fmt)
        mt    = [int64]$_.LastWriteTimeUtc.Ticks   # exact, for change detection
        c     = $_.CreationTimeUtc.ToString($fmt)
        cloud = (($attr -band 0x441000) -ne 0)   # OneDrive "online-only": don't open (would download)
      }
    }
  }

  function Get-Sha($e) {
    if ($e.dir -or $e.cloud -or $e.size -gt $maxHashBytes) { return '' }
    try { return (Get-FileHash -LiteralPath $e.full -Algorithm SHA256).Hash.ToLower() } catch { return '' }
  }
  function New-Ev($kind, $e, $time, $sha, $from) {
    return [pscustomobject]@{ kind = $kind; root = $e.root; path = $e.rel; time = $time; size = $e.size;
      sha256 = $sha; from = $from; cloud = $e.cloud }
  }

  function New-Apply($key, $st) {
    $l = New-Object System.Collections.ArrayList
    [void]$l.Add($key); [void]$l.Add($st)
    return ,$l
  }

  # ---------- compare ----------
  $events = New-Object System.Collections.ArrayList   # what to send
  $applies = New-Object System.Collections.ArrayList  # state change to save once that event is accepted
  $newState = @{}
  foreach ($k in $state.Keys) { $newState[$k] = $state[$k] }
  $created = @{}  # sha -> index of a file_created event (for rename detection)

  foreach ($k in $now.Keys) {
    $e = $now[$k]; $old = $state[$k]
    if ($e.dir) {
      $st = [pscustomobject]@{ d = 1 }
      if (-not $old) {
        if (-not $initial -or $e.c -ge $backfillUtc) {
          [void]$events.Add((New-Ev 'folder_created' $e $e.c '' $null)); [void]$applies.Add((New-Apply $k $st))
        } else { $newState[$k] = $st }
      }
      continue
    }
    if (-not $old) {
      $report = (-not $initial) -or ($e.c -ge $backfillUtc) -or ($e.m -ge $backfillUtc)
      $sha = ''
      if ($report) { $sha = Get-Sha $e }
      $st = [pscustomobject]@{ s = $e.size; mt = $e.mt; h = $sha }
      if (-not $report) { $newState[$k] = $st; continue }
      if ($initial -and $e.c -lt $backfillUtc) {
        [void]$events.Add((New-Ev 'file_modified' $e $e.m $sha $null)); [void]$applies.Add((New-Apply $k $st))
        continue
      }
      if ($sha) { $created[$sha] = $events.Count }
      [void]$events.Add((New-Ev 'file_created' $e $e.c $sha $null)); [void]$applies.Add((New-Apply $k $st))
      $gap = ([datetime]$e.m - [datetime]$e.c).TotalMinutes
      if ($gap -gt 5 -and $e.m -ge $backfillUtc) {
        [void]$events.Add((New-Ev 'file_modified' $e $e.m $sha $null)); [void]$applies.Add((New-Apply $k $st))
      }
    } elseif ($old.d) {
      continue
    } elseif ([int64]$old.s -ne $e.size -or [int64]$old.mt -ne $e.mt) {
      $sha = Get-Sha $e
      $st = [pscustomobject]@{ s = $e.size; mt = $e.mt; h = $sha }
      [void]$events.Add((New-Ev 'file_modified' $e $e.m $sha $null)); [void]$applies.Add((New-Apply $k $st))
    }
  }

  # Deleted: in the old state, gone now, and its root was readable this run.
  $detectedAt = (Get-Date).ToUniversalTime().ToString($fmt)
  foreach ($k in @($state.Keys)) {
    if ($now.ContainsKey($k)) { continue }
    $parts = $k.Split('|', 2)
    if (-not $scannedRoots.ContainsKey($parts[0])) { continue }
    $old = $state[$k]
    $gone = [pscustomobject]@{ root = $parts[0]; rel = $parts[1]; size = $(if ($old.d) { 0 } else { [int64]$old.s }); cloud = $false; dir = [bool]$old.d }
    $h = $(if ($old.d) { '' } else { [string]$old.h })
    if ($h -and $created.ContainsKey($h)) {
      # Same content appeared under a new name: a rename or move, not delete + create.
      $i = $created[$h]
      $events[$i].kind = 'file_renamed'
      $events[$i].from = $parts[1]
      $events[$i].time = $detectedAt
      $created.Remove($h)
      [void]$applies[$i].Add($k)   # also drop the old key when accepted
      continue
    }
    $kind = $(if ($old.d) { 'folder_deleted' } else { 'file_deleted' })
    [void]$events.Add((New-Ev $kind $gone $detectedAt $h $null)); [void]$applies.Add((New-Apply $k $null))
  }

  # Photos: read when (and where) each was taken from the photo itself, once per photo.
  # Also covers photos that arrived before this feature existed (their state has no "p" flag yet).
  $photos = 0
  $photoPass = 3   # bump to re-read every photo once (3 = re-send after the 6 Nov script update; the script skips duplicates)
  $pending = @{}
  for ($i = 0; $i -lt $applies.Count; $i++) { if ($null -ne $applies[$i][1]) { $pending[$applies[$i][0]] = $i } }
  $photoKeys = $(if ($script:wic -or $fakeExif) { @($now.Keys) } else { @() })   # can't read: try again next run
  foreach ($k in $photoKeys) {
    $e = $now[$k]
    if ($e.dir -or $e.rel -notmatch $photoExt) { continue }
    $cur = $(if ($pending.ContainsKey($k)) { $applies[$pending[$k]][1] } else { $newState[$k] })
    if ($null -eq $cur -or ($cur.p -and $cur.p -ge $photoPass)) { continue }
    $done = [pscustomobject]@{ s = $cur.s; mt = $cur.mt; h = $cur.h; p = $photoPass }
    $meta = Get-PhotoMeta $e
    if ($meta -and $meta.taken -and $meta.taken -ge $backfillUtc) {
      $pe = [pscustomobject]@{ kind = 'photo_taken'; root = $e.root; path = $e.rel; time = $meta.taken; size = $e.size;
        sha256 = [string]$cur.h; from = $null; cloud = $false; lat = $meta.lat; lon = $meta.lon }
      [void]$events.Add($pe); [void]$applies.Add((New-Apply $k $done))
      if ($pending.ContainsKey($k)) { $applies[$pending[$k]][1] = $done }
      $photos++
    } elseif ($pending.ContainsKey($k)) {
      $applies[$pending[$k]][1] = $done
    } else {
      $newState[$k] = $done
    }
  }

  # ---------- send ----------
  $sent = 0
  for ($i = 0; $i -lt $events.Count; $i += $batchSize) {
    $last = [Math]::Min($i + $batchSize, $events.Count) - 1
    $batch = @($events[$i..$last])
    $body = @{ token = $cfg.token; device = $env:COMPUTERNAME; deviceNow = (Get-Date).ToUniversalTime().ToString($fmt);
      initial = $initial; events = $batch }
    $json = ConvertTo-Json -InputObject $body -Depth 6 -Compress
    $resp = Invoke-RestMethod -Uri $cfg.endpoint -Method Post -ContentType 'application/json; charset=utf-8' `
      -Body ([Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 90
    if (-not $resp.ok) { throw ('Timeline refused the report: ' + $resp.error) }
    for ($j = $i; $j -le $last; $j++) {
      $a = $applies[$j]
      if ($null -eq $a[1]) { $newState.Remove($a[0]) } else { $newState[$a[0]] = $a[1] }
      for ($x = 2; $x -lt $a.Count; $x++) { $newState.Remove($a[$x]) }
    }
    $sent += $batch.Count
    # Save after every accepted batch, so a failure later never re-sends what was already logged.
    ConvertTo-Json -InputObject $newState -Depth 3 -Compress | Set-Content -LiteralPath $statePath -Encoding UTF8
  }
  if ($events.Count -eq 0) {
    ConvertTo-Json -InputObject $newState -Depth 3 -Compress | Set-Content -LiteralPath $statePath -Encoding UTF8
  }
  Write-Log ("OK: " + $now.Count + " items scanned, " + $sent + " changes sent" + $(if ($photos) { ', ' + $photos + ' photo time(s) read' } else { '' }) +
    $(if (-not $script:wic -and -not $fakeExif) { ' (photo reading unavailable)' } else { '' }) + $(if ($initial) { ' (first scan)' } else { '' }))
} catch {
  Write-Log ("ERROR: " + $_.Exception.Message)
  exit 1
} finally {
  $mutex.ReleaseMutex()
}
