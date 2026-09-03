[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("integration-hub", "menu-planning", "cpu-production", "delivered-in")]
  [string]$App
)

$ErrorActionPreference = "Stop"
$repoRoot = (git rev-parse --show-toplevel).Trim()
$expectedRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([IO.Path]::GetFullPath($repoRoot) -ne [IO.Path]::GetFullPath($expectedRoot)) {
  throw "Run this deployment wrapper from the repository containing the script; resolved git root was '$repoRoot'."
}

$dirty = @(git status --porcelain)
if ($dirty.Count -gt 0) { throw "Refusing staging rollout from a dirty worktree:`n$($dirty -join "`n")" }

$sha = (git rev-parse HEAD).Trim()
if ($sha -notmatch '^[0-9a-fA-F]{40}$') { throw "Refusing staging rollout because HEAD is not a full commit SHA: '$sha'." }

$backends = @{
  "integration-hub" = "fika-os-staging"
  "menu-planning" = "fika-menu-planning-staging"
  "cpu-production" = "fika-cpu-production-staging"
  "delivered-in" = "fika-delivered-in-staging"
}
$backend = $backends[$App]
Write-Host "Creating App Hosting staging rollout for $App ($backend) at git SHA $sha"
& firebase apphosting:rollouts:create $backend --project=fika-os-dev --git-commit $sha --force
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
