param(
  [switch]$NoBrowser,
  [switch]$NoEmulator
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$hub = Join-Path $root "apps\integration-hub"
$firebase = Join-Path $hub "node_modules\.bin\firebase.cmd"

function Test-Port([int]$port) {
  return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Start-Tab($title, $directory, $command) {
  $path = Join-Path $root $directory
  if (!(Test-Path (Join-Path $path "package.json"))) { Write-Warning "$title skipped: package.json not found"; return }
  $safe = $path.Replace('"', '""')
  $windowCommand = 'title ' + $title + ' && cd /d "' + $safe + '" && ' + $command
  Start-Process -FilePath $env:ComSpec -ArgumentList "/d", "/k", $windowCommand -WorkingDirectory $path | Out-Null
  Write-Host "Started $title"
}

function Wait-ForPorts([int[]]$ports, [int]$timeoutSeconds = 60) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  do {
    $ready = @($ports | Where-Object { Test-Port $_ }).Count -eq $ports.Count
    if ($ready) { return $true }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)
  return $false
}

if (!$NoEmulator) {
  if (!(Test-Port 8085) -and !(Test-Port 9099)) {
    if (!(Test-Path $firebase)) { throw "Firebase CLI not found at $firebase. Run npm install in apps/integration-hub first." }
    $importArg = @()
    $pointer = Join-Path $root "FIKA-RESTORED-DATA.json"
    if (Test-Path $pointer) {
      $config = Get-Content $pointer -Raw | ConvertFrom-Json
      if ($config.restoredDataPath -and (Test-Path $config.restoredDataPath)) { $importArg = @("--import", $config.restoredDataPath) }
    }
    $emulatorCommand = 'title FIKA OS Firebase Emulator && cd /d "' + $hub + '" && "' + $firebase + '" emulators:start --only auth,firestore --config firebase.json --project fika-os-local ' + ($importArg -join ' ')
    Start-Process -FilePath $env:ComSpec -ArgumentList "/d", "/k", $emulatorCommand -WorkingDirectory $hub | Out-Null
    Write-Host "Started Firebase emulator"
  } else { Write-Host "Firebase emulator already appears to be running" }
}

if (!$NoEmulator) {
  Write-Host "Waiting for Firebase Auth/Firestore emulators..."
  if (!(Wait-ForPorts @(8085, 9099))) {
    Write-Warning "Firebase emulators were not ready after 60 seconds; launcher will still be started."
  } else {
    Write-Host "Firebase emulators are ready"
  }
} else {
  Start-Sleep -Seconds 1
}

if (!(Test-Port 3100)) {
  Start-Tab "FIKA OS Launcher" "tools\launcher" "npm.cmd run start"
} else { Write-Host "FIKA OS Launcher already appears to be running on 3100" }

if (!$NoBrowser) {
  if (Wait-ForPorts @(3100) 10) { Start-Process "http://localhost:3100" }
}

Write-Host "`nFIKA OS local workspace started.`n"
Write-Host "Launcher http://localhost:3100"
Write-Host "Firebase emulator UI http://127.0.0.1:4005"
Write-Host "Apps are started from the launcher. Use Stop-FIKA-OS-All.ps1 to stop reserved local processes."
