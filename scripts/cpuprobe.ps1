# CPU use of TopNotch's whole process tree over a window of time, as a
# percentage of one core. Companion to memprobe.ps1, for checking that a
# memory saving doesn't cost too much CPU.
#   powershell -ExecutionPolicy Bypass -File scripts/cpuprobe.ps1 [-Seconds 30] [-Label x]
param([int]$Seconds = 30, [string]$Label = 'cpu')
$ErrorActionPreference = 'Stop'

function Get-TreeIds {
    $all = Get-CimInstance Win32_Process
    $root = $all | Where-Object { $_.Name -eq 'TopNotch.exe' -and $_.CommandLine -notmatch '--type=' } | Select-Object -First 1
    if (-not $root) {
        $root = $all | Where-Object { $_.Name -eq 'electron.exe' -and $_.CommandLine -notmatch '--type=' -and $_.CommandLine -match 'electron\.exe"?(\s+--\S+)*\s+\.(\s|$)' } | Select-Object -First 1
    }
    if (-not $root) { throw 'TopNotch is not running.' }
    $ids = @([int]$root.ProcessId)
    $frontier = @([int]$root.ProcessId)
    while ($frontier.Count) {
        $next = @($all | Where-Object { $frontier -contains [int]$_.ParentProcessId } | ForEach-Object { [int]$_.ProcessId })
        $ids += $next
        $frontier = $next
    }
    return $ids
}

function Get-CpuSeconds($ids) {
    $total = 0.0
    foreach ($id in $ids) {
        $p = Get-Process -Id $id -ErrorAction SilentlyContinue
        if ($p) { $total += $p.TotalProcessorTime.TotalSeconds }
    }
    return $total
}

$ids = Get-TreeIds
$start = Get-CpuSeconds $ids
$clock = [System.Diagnostics.Stopwatch]::StartNew()
Start-Sleep -Seconds $Seconds
$used = (Get-CpuSeconds $ids) - $start
$percent = [math]::Round(100 * $used / $clock.Elapsed.TotalSeconds, 1)
"[$Label] CPU over $Seconds s: $percent% of one core"
