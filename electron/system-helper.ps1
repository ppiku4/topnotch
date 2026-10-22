param([Parameter(Mandatory = $true)][string]$SourcePath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$SourcePath = (Resolve-Path -LiteralPath $SourcePath).Path

function Fail($message) {
    $clean = ($message -replace '[\r\n"\\]', ' ')
    [Console]::Out.WriteLine('{"type":"error","fatal":true,"message":"' + $clean + '"}')
    exit 1
}

# Compile against the Windows metadata that ships with Windows; no SDK needed.
# Add-Type cannot take .winmd references, so drive the compiler directly.
$framework = [System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
$refs = @(
    'System.dll',
    'System.Core.dll',
    'System.Management.dll',
    (Join-Path $framework 'System.Runtime.WindowsRuntime.dll'),
    (Join-Path $framework 'System.Runtime.InteropServices.WindowsRuntime.dll'),
    (Join-Path $framework 'System.Runtime.dll'),
    (Join-Path $env:WINDIR 'System32\WinMetadata\Windows.Foundation.winmd'),
    (Join-Path $env:WINDIR 'System32\WinMetadata\Windows.Media.winmd'),
    (Join-Path $env:WINDIR 'System32\WinMetadata\Windows.Devices.winmd'),
    (Join-Path $framework 'WPF\UIAutomationClient.dll'),
    (Join-Path $framework 'WPF\UIAutomationTypes.dll'),
    (Join-Path $framework 'WPF\WindowsBase.dll')
)

try {
    [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
    [Windows.Devices.Bluetooth.BluetoothDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime] | Out-Null
    [Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType = WindowsRuntime] | Out-Null
    $compiler = New-Object Microsoft.CSharp.CSharpCodeProvider
    $options = New-Object System.CodeDom.Compiler.CompilerParameters
    $options.GenerateInMemory = $true
    $options.ReferencedAssemblies.AddRange([string[]]$refs)
    $result = $compiler.CompileAssemblyFromFile($options, @($SourcePath))
    $errors = @($result.Errors | Where-Object { -not $_.IsWarning })
    if ($errors.Count -gt 0) {
        Fail ('compile: ' + (($errors | Select-Object -First 3 | ForEach-Object { "line $($_.Line): $($_.ErrorText)" }) -join '; '))
    }
    $helper = $result.CompiledAssembly.GetType('TopNotch.Helper')
} catch {
    Fail ('compile: ' + $_.Exception.Message)
}

$helper.GetMethod('Run').Invoke($null, @())
