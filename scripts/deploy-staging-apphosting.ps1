# Compatibility entry point; governed tooling owns all target/approval checks.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet("integration-hub","hospitality-booking","menu-planning","cpu-production","delivered-in","logistics")][string]$App,
  [string]$Sha,
  [switch]$Execute
)
$ErrorActionPreference = "Stop"
$aliases = @{ "integration-hub"="hub"; "hospitality-booking"="hospitality"; "menu-planning"="menu"; "cpu-production"="cpu"; "delivered-in"="delivered-in"; "logistics"="logistics" }
$entry = Join-Path $PSScriptRoot "../tools/workflow/cli.mjs"
$arguments = @($entry,"deploy",$aliases[$App],"--staging")
if ($Sha) { $arguments += @("--sha",$Sha) }
if ($Execute) {
  $arguments += @("--execute")
}
Write-Host "Using governed selected-app release tooling. Dry-run unless -Execute is supplied."
& node @arguments
exit $LASTEXITCODE
