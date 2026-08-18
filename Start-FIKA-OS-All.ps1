param(
  [switch]$NoBrowser,
  [switch]$NoEmulator
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$hub = Join-Path $root "apps\integration-hub"
$firebase = Join-Path $hub "node_modules\.bin\firebase.cmd"

$apps = @(
  @{ Name = "Integration Hub"; Directory = "apps\integration-hub"; Port = 3200; Command = "npm.cmd run dev" },
  @{ Name = "MNK Hospitality"; Directory = "apps\hospitality-booking"; Port = 3300; Command = "npm.cmd run dev" },
  @{ Name = "CPU Production"; Directory = "apps\cpu-production"; Port = 3400; Command = "npm.cmd run dev" },
  @{ Name = "Menu Planning"; Directory = "apps\menu-planning"; Port = 3500; Command = "npm.cmd run dev" },
  @{ Name = "Beverage Innovation"; Directory = "apps\beverage-innovation"; Port = 3600; Command = "npm.cmd run dev" },
  # These commands run through cmd.exe, so use cmd syntax rather than PowerShell
  # environment-variable syntax. The explicit PORT keeps Events deterministic
  # when its Next.js defaults change.
  @{ Name = "Events Dashboard"; Directory = "apps\events-dashboard"; Port = 3700; Command = 'set "PORT=3700" && npm.cmd run dev' }
)

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
    Write-Warning "Firebase emulators were not ready after 60 seconds; apps will still be started."
  } else {
    Write-Host "Firebase emulators are ready"
  }
} else {
  Start-Sleep -Seconds 1
}
foreach ($app in $apps) {
  if (Test-Port $app.Port) { Write-Host "$($app.Name) already appears to be running on $($app.Port)" }
  else { Start-Tab $app.Name $app.Directory $app.Command }
}

if (!$NoBrowser) {
  Start-Process "http://localhost:3200"
  Start-Process "http://localhost:3300/mnk"
  Start-Process "http://localhost:3400"
}

Write-Host "`nFIKA OS local workspace started.`n"
Write-Host "Hub  http://localhost:3200"
Write-Host "MNK  http://localhost:3300/mnk"
Write-Host "CPU  http://localhost:3400"
Write-Host "Menu http://localhost:3500"
Write-Host "Drinks http://localhost:3600"
Write-Host "Events http://localhost:3700"
Write-Host "Emulator UI http://127.0.0.1:4005"
Write-Host "Use Stop-FIKA-OS-All.ps1 to stop only these local processes."
