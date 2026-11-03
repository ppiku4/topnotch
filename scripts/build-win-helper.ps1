# Builds the Windows system helper (electron/system-helper.cs) into
# build/win/topnotch-helper.exe, so the app can start it directly instead of
# hosting PowerShell and compiling the source on every launch.
# Uses the C# compiler that ships with the .NET Framework; no SDK needed.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'build\win'
New-Item -ItemType Directory -Force $out | Out-Null

$framework = [System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
$csc = Join-Path $framework 'csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe not found in $framework" }

# Same references as system-helper.ps1.
$refs = @(
    'System.dll',
    'System.Core.dll',
    'System.Management.dll',
    (Join-Path $framework 'System.Runtime.WindowsRuntime.dll'),
    (Join-Path $framework 'System.Runtime.InteropServices.WindowsRuntime.dll'),
    (Join-Path $framework 'System.Runtime.dll'),
    (Join-Path $env:WINDIR 'System32\WinMetadata\Windows.Foundation.winmd'),
    (Join-Path $env:WINDIR 'System32\WinMetadata\Windows.Media.winmd'),
    (Join-Path $env:WINDIR 'System32\WinMetadata\Windows.Storage.winmd'),
    (Join-Path $env:WINDIR 'System32\WinMetadata\Windows.Devices.winmd'),
    (Join-Path $framework 'WPF\UIAutomationClient.dll'),
    (Join-Path $framework 'WPF\UIAutomationTypes.dll'),
    (Join-Path $framework 'WPF\WindowsBase.dll')
)

$entry = Join-Path $out 'helper-main.cs'
@'
// Entry point for the precompiled helper (MTA, UTF-8 out, like the PowerShell host).
static class HelperMain {
    [System.MTAThread]
    static void Main() {
        System.Console.OutputEncoding = new System.Text.UTF8Encoding(false);
        TopNotch.Helper.Run();
    }
}
'@ | Set-Content -Encoding UTF8 $entry

$exe = Join-Path $out 'topnotch-helper.exe'
$cscArgs = @('/nologo', '/target:exe', '/platform:anycpu', '/optimize+', "/out:$exe")
$cscArgs += $refs | ForEach-Object { "/reference:$_" }
$cscArgs += @((Join-Path $root 'electron\system-helper.cs'), $entry)
& $csc @cscArgs
if ($LASTEXITCODE -ne 0) { throw "csc failed with exit code $LASTEXITCODE" }
Remove-Item $entry
Write-Host "Built $exe"
