# Sums TopNotch's memory over its whole process tree: the main process, every
# Electron child (renderers, GPU, utility), and everything it spawned (system
# helper, media worker, tools). Private bytes is the success metric; working
# set is printed for diagnosis only (it counts shared DLL pages per process).
#
#   powershell -ExecutionPolicy Bypass -File scripts/memprobe.ps1 [-Label idle] [-Samples 5] [-Interval 2] [-Json out.json]
#
# Finds the installed TopNotch.exe, or a dev run (electron.exe .) from this repo.
param(
    [string]$Label = 'sample',
    [int]$Samples = 5,
    [int]$Interval = 2,
    [string]$Json = ''
)
$ErrorActionPreference = 'Stop'

function Get-Root {
    $all = Get-CimInstance Win32_Process
    $root = $all | Where-Object { $_.Name -eq 'TopNotch.exe' -and $_.CommandLine -notmatch '--type=' } | Select-Object -First 1
    if (-not $root) {
        $root = $all | Where-Object {
            $_.Name -eq 'electron.exe' -and $_.CommandLine -notmatch '--type=' -and $_.CommandLine -match 'electron\.exe"?(\s+--\S+)*\s+\.(\s|$)'
        } | Select-Object -First 1
    }
    if (-not $root) { throw 'TopNotch is not running.' }
    return @{ Root = $root; All = $all }
}

function Get-Tree($root, $all) {
    $byParent = @{}
    foreach ($p in $all) {
        $key = [int]$p.ParentProcessId
        if (-not $byParent.ContainsKey($key)) { $byParent[$key] = @() }
        $byParent[$key] += $p
    }
    $out = @($root)
    $queue = [System.Collections.Queue]::new()
    $queue.Enqueue([int]$root.ProcessId)
    while ($queue.Count -gt 0) {
        $id = $queue.Dequeue()
        foreach ($child in @($byParent[$id])) {
            if ($null -eq $child -or [int]$child.ProcessId -eq $id) { continue }
            $out += $child
            $queue.Enqueue([int]$child.ProcessId)
        }
    }
    return $out
}

function Get-Role($p) {
    $cmd = [string]$p.CommandLine
    if ($cmd -match '--type=([a-z-]+)') {
        $role = $matches[1]
        if ($cmd -match '--utility-sub-type=([^\s]+)') { $role += ':' + ($matches[1] -replace '\.mojom\..*$', '') }
        return $role
    }
    if ($cmd -match 'system-helper|topnotch-helper') { return 'system-helper' }
    if ($cmd -match 'media-worker') { return 'media-worker' }
    if ($p.Name -match '^(TopNotch|electron)\.exe$') { return 'main' }
    return $p.Name -replace '\.exe$', ''
}

$runs = @()
for ($i = 0; $i -lt $Samples; $i++) {
    if ($i -gt 0) { Start-Sleep -Seconds $Interval }
    $found = Get-Root
    $rows = foreach ($p in (Get-Tree $found.Root $found.All)) {
        $proc = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
        if (-not $proc) { continue }
        [pscustomobject]@{
            Role = Get-Role $p
            Pid = [int]$p.ProcessId
            PrivateMB = [math]::Round($proc.PrivateMemorySize64 / 1MB, 1)
            WorkingMB = [math]::Round($proc.WorkingSet64 / 1MB, 1)
        }
    }
    $runs += , $rows
}

# Median over samples, per role (roles can repeat, e.g. two renderers).
function Median($values) {
    $sorted = @($values | Sort-Object)
    if ($sorted.Count -eq 0) { return 0 }
    return $sorted[[int][math]::Floor(($sorted.Count - 1) / 2)]
}
$last = $runs[-1]
$summary = foreach ($row in $last) {
    $privs = foreach ($run in $runs) { ($run | Where-Object { $_.Pid -eq $row.Pid }).PrivateMB }
    $works = foreach ($run in $runs) { ($run | Where-Object { $_.Pid -eq $row.Pid }).WorkingMB }
    [pscustomobject]@{ Role = $row.Role; Pid = $row.Pid; PrivateMB = (Median $privs); WorkingMB = (Median $works) }
}
$summary = $summary | Sort-Object PrivateMB -Descending
$totals = foreach ($run in $runs) { ($run | Measure-Object PrivateMB -Sum).Sum }
$totalPrivate = [math]::Round((Median $totals), 1)
$workTotals = foreach ($run in $runs) { ($run | Measure-Object WorkingMB -Sum).Sum }
$totalWorking = [math]::Round((Median $workTotals), 1)

"[$Label] $Samples samples, median"
$summary | Format-Table -AutoSize | Out-String -Width 120
"TOTAL private: $totalPrivate MB   working: $totalWorking MB"

if ($Json) {
    [pscustomobject]@{
        label = $Label; samples = $Samples; at = (Get-Date).ToString('s')
        totalPrivateMB = $totalPrivate; totalWorkingMB = $totalWorking; processes = $summary
    } | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 $Json
}
