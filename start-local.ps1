$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$nodePath = (Get-Command node).Source
$runtimeDirectory = Join-Path $projectRoot 'private'
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
$localVariables = Join-Path $projectRoot '.dev.vars'
if (-not (Test-Path -LiteralPath $localVariables)) { Set-Content -LiteralPath $localVariables -Value 'DEV_AUTH=local-only' }
$services = @(
    @{ Name = 'worker'; Port = 8790; Script = 'node_modules\wrangler\bin\wrangler.js'; Arguments = @('dev', '--ip', '127.0.0.1', '--port', '8790') },
    @{ Name = 'frontend'; Port = 5174; Script = 'node_modules\vite\bin\vite.js'; Arguments = @('--host', '127.0.0.1', '--port', '5174') }
)
foreach ($service in $services) {
    $portInUse = Get-NetTCPConnection -LocalPort $service.Port -State Listen -ErrorAction SilentlyContinue
    if ($portInUse) { Write-Output "$($service.Name): already listening on $($service.Port)"; continue }
    $scriptPath = Join-Path $projectRoot $service.Script
    $arguments = @('"' + $scriptPath + '"') + $service.Arguments
    $process = Start-Process -FilePath $nodePath -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDirectory "$($service.Name).log") -RedirectStandardError (Join-Path $runtimeDirectory "$($service.Name).error.log")
    Set-Content -LiteralPath (Join-Path $runtimeDirectory "$($service.Name).pid") -Value $process.Id
    Write-Output "$($service.Name): started (PID $($process.Id))"
}
Write-Output 'Local template: http://127.0.0.1:5174/'
