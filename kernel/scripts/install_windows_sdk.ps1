# Provision only a disposable hosted runner; local machines are never modified.
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$Reports)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted') {
    throw 'Windows SDK provisioning is only for disposable GitHub-hosted runners'
}
if (-not $IsWindows) { throw 'Windows SDK provisioning requires Windows' }

$release = '10.0.28000.2270'
$kitVersion = '10.0.28000.0'
# Fixed June 2026 installer from Microsoft's Windows SDK downloads page.
$url = 'https://download.microsoft.com/download/78b533c3-6724-4e28-a984-b9fa93265781/KIT_BUNDLE_WINDOWSSDK_MEDIACREATION/winsdksetup.exe'
$sha256 = 'e9f1bde566381355e594e2f90daf4f714eb5c7ef2c45c501ce236afe2abea300'
$kit = Join-Path ([Environment]::GetEnvironmentVariable('ProgramFiles(x86)')) 'Windows Kits/10'
$requiredFiles = @(
    "Include/$kitVersion/um/Windows.h",
    "Include/$kitVersion/ucrt/stdio.h",
    "Lib/$kitVersion/um/x64/kernel32.lib",
    "Lib/$kitVersion/ucrt/x64/ucrt.lib",
    "bin/$kitVersion/x64/rc.exe",
    'Debuggers/x64/cdb.exe'
)
function Test-RequiredSdk {
    foreach ($relative in $requiredFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $kit $relative) -PathType Leaf)) { return $false }
    }
    $debugger = Get-Item -LiteralPath (Join-Path $kit 'Debuggers/x64/cdb.exe')
    return $debugger.VersionInfo.FileVersionRaw -ge [version]'10.0.26100.3323'
}

New-Item -ItemType Directory -Force -Path $Reports | Out-Null
$report = [ordered]@{
    release = $release
    kitVersion = $kitVersion
    installerUrl = $url
    installerSha256 = $sha256
    status = 'running'
    installed = $false
}
try {
    if (-not (Test-RequiredSdk)) {
        $installer = Join-Path $Reports 'winsdksetup.exe'
        Invoke-WebRequest -Uri $url -OutFile $installer -MaximumRedirection 0
        $actualHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualHash -cne $sha256) { throw 'Microsoft SDK installer hash differs from the pinned release' }
        $signature = Get-AuthenticodeSignature -LiteralPath $installer
        if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or
            $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) -cne 'Microsoft Corporation') {
            throw 'Windows SDK installer requires a valid Microsoft Authenticode signature'
        }
        $report.signer = $signature.SignerCertificate.Subject
        $log = Join-Path $Reports 'windows-sdk-install.log'
        $arguments = @('/quiet', '/norestart', '/ceip', 'off', '/features',
            'OptionId.DesktopCPPx86', 'OptionId.DesktopCPPx64',
            'OptionId.UWPCPP', 'OptionId.WindowsDesktopDebuggers',
            '/log', ('"{0}"' -f $log))
        $process = Start-Process -FilePath $installer -ArgumentList $arguments -PassThru -Wait
        $report.exitCode = $process.ExitCode
        if ($process.ExitCode -notin @(0, 3010)) {
            throw "Windows SDK installation failed with exit code $($process.ExitCode); see windows-sdk-install.log"
        }
        $report.installed = $true
    }
    if (-not (Test-RequiredSdk)) { throw 'Required SDK headers, libraries, rc.exe or debugging tools are unavailable after setup' }
    $report.debuggerVersion = (Get-Item -LiteralPath (Join-Path $kit 'Debuggers/x64/cdb.exe')).VersionInfo.FileVersion
    $report.resourceCompilerVersion = (Get-Item -LiteralPath (Join-Path $kit "bin/$kitVersion/x64/rc.exe")).VersionInfo.FileVersion
    $report.status = 'passed'
    Write-Output "Verified Windows SDK $kitVersion and compatible x64 debugging tools"
} catch {
    $report.status = 'failed'
    $report.error = $_.Exception.Message
    throw
} finally {
    $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $Reports 'windows-sdk.json') -Encoding utf8
}
