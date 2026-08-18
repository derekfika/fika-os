@echo off
setlocal

rem Run the PowerShell section embedded at the end of this BAT file.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command ^
  "$source = Get-Content -LiteralPath '%~f0' -Raw; $script = ($source -split '(?m)^# POWERSHELL START\r?$', 2)[1]; & ([scriptblock]::Create($script)) -RepoRoot '%~dp0'"

set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo Packaging failed. No source files were changed.
  pause
)
exit /b %EXIT_CODE%

# POWERSHELL START
param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot
)

$ErrorActionPreference = 'Stop'
$RepoRoot = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd('\')
$timestamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$zipName = "FIKA-for-Codex-$timestamp.zip"
$zipPath = Join-Path $RepoRoot $zipName
$stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("FIKA-Codex-Package-" + [guid]::NewGuid().ToString('N'))

# Generated, downloaded, historical, IDE and runtime folders that Codex does
# not need when reviewing the live source.
$excludedDirectoryNames = @(
    '.git',
    '.codex-staging',
    '.next',
    '.nuxt',
    '.output',
    '.turbo',
    '.cache',
    '.parcel-cache',
    '.vercel',
    '.firebase',
    '.idea',
    '.vscode',
    '.venv',
    'venv',
    '__pycache__',
    'node_modules',
    'bower_components',
    'coverage',
    'dist',
    'build',
    'out',
    'target',
    'logs',
    'tmp',
    'temp',
    'backups',
    'archives',
    '.generated-drink-images',
    '.generated-individual-drink-images',
    'emulator-data',
    'firebase-data'
)

# Source, configuration, tests, documentation and design assets worth reviewing.
$includedExtensions = @(
    '.bat', '.cmd', '.ps1', '.sh',
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.gs', '.html', '.htm', '.css', '.scss', '.sass', '.less',
    '.json', '.jsonc', '.yaml', '.yml', '.toml', '.xml',
    '.md', '.mdx', '.txt', '.diff', '.patch',
    '.sql', '.prisma', '.graphql', '.gql',
    '.py', '.java', '.kt', '.kts', '.cs', '.go', '.rs',
    '.csv', '.tsv',
    '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
    '.woff', '.woff2', '.ttf', '.otf'
)

$includedExtensionlessNames = @(
    'Dockerfile',
    'LICENSE',
    'LICENCE',
    'Makefile',
    'Procfile'
)

# Never package local credentials, deployment identifiers or machine-specific
# environment files. Template/example environment files are allowed below.
$excludedFileNames = @(
    '.clasp.json',
    '.deployment-id',
    '.runtimeconfig.json',
    'credentials.json',
    'token.json',
    'service-account.json',
    'serviceAccountKey.json'
)

$excludedFilePatterns = @(
    '*.log',
    '*.tmp',
    '*.temp',
    '*.bak',
    '*.old',
    '*.zip',
    '*.7z',
    '*.rar',
    '*.tar',
    '*.gz',
    '*.pem',
    '*.key',
    '*.p12',
    '*.pfx',
    '*credentials*.json',
    '*service-account*.json',
    '*serviceAccount*.json',
    '*firebase-adminsdk*.json'
)

function Test-IsExcludedDirectory {
    param([string]$FullName)

    $relative = $FullName.Substring($RepoRoot.Length).TrimStart('\')
    if ([string]::IsNullOrWhiteSpace($relative)) {
        return $false
    }

    foreach ($part in ($relative -split '[\\/]')) {
        if ($excludedDirectoryNames -contains $part) {
            return $true
        }
    }
    return $false
}

function Test-IsSecretEnvironmentFile {
    param([string]$Name)

    if ($Name -eq '.env.example' -or
        $Name -eq '.env.sample' -or
        $Name -eq '.env.template') {
        return $false
    }

    return ($Name -eq '.env' -or $Name.StartsWith('.env.'))
}

function Test-MatchesAnyPattern {
    param(
        [string]$Name,
        [string[]]$Patterns
    )

    foreach ($pattern in $Patterns) {
        if ($Name -like $pattern) {
            return $true
        }
    }
    return $false
}

function Get-SafelyFilteredFiles {
    # Traverse manually so excluded trees such as node_modules are never
    # enumerated in the first place.
    $pendingDirectories = [System.Collections.Generic.Stack[string]]::new()
    $pendingDirectories.Push($RepoRoot)

    while ($pendingDirectories.Count -gt 0) {
        $currentDirectory = $pendingDirectories.Pop()

        foreach ($directory in Get-ChildItem -LiteralPath $currentDirectory -Directory -Force -ErrorAction SilentlyContinue) {
            if (($directory.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                continue
            }
            if (-not (Test-IsExcludedDirectory -FullName $directory.FullName)) {
                $pendingDirectories.Push($directory.FullName)
            }
        }

        foreach ($file in Get-ChildItem -LiteralPath $currentDirectory -File -Force -ErrorAction SilentlyContinue) {
            if ($file.FullName -eq $zipPath) {
                continue
            }
            if ($excludedFileNames -contains $file.Name) {
                continue
            }
            if (Test-IsSecretEnvironmentFile -Name $file.Name) {
                continue
            }
            if (Test-MatchesAnyPattern -Name $file.Name -Patterns $excludedFilePatterns) {
                continue
            }
            if (
                -not ($includedExtensions -contains $file.Extension.ToLowerInvariant()) -and
                -not ($includedExtensionlessNames -contains $file.Name)
            ) {
                continue
            }
            if ($file.Length -gt 25MB) {
                continue
            }

            Write-Output $file
        }
    }
}

Write-Host ''
Write-Host 'Creating a lightweight FIKA source package for Codex...'
Write-Host "Source: $RepoRoot"

try {
    New-Item -ItemType Directory -Path $stageRoot | Out-Null

    $files = @(Get-SafelyFilteredFiles)

    $copiedCount = 0
    $copiedBytes = [int64]0

    foreach ($file in $files) {
        $relativePath = $file.FullName.Substring($RepoRoot.Length).TrimStart('\')
        $destination = Join-Path $stageRoot $relativePath
        $destinationDirectory = Split-Path -Parent $destination

        if (-not (Test-Path -LiteralPath $destinationDirectory)) {
            New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
        }

        Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
        $copiedCount++
        $copiedBytes += $file.Length
    }

    if ($copiedCount -eq 0) {
        throw 'No eligible source files were found.'
    }

    # Add a short manifest so the recipient knows exactly how this package was
    # produced and which broad categories were intentionally excluded.
    $manifest = @"
FIKA source package
Created: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')
Repository: $RepoRoot
Files included: $copiedCount
Uncompressed size: $([math]::Round($copiedBytes / 1MB, 2)) MB

Includes:
- Live source code and tests
- Package/configuration files and lockfiles
- FIKA platform specifications and documentation
- Relevant app images and fonts up to 25 MB per file
- Uncommitted source files that match the safe file types

Intentionally excludes:
- node_modules and other downloaded dependencies
- Build outputs, caches and coverage
- .git history and .codex-staging history
- Emulator data, logs, archives and backups
- Local environment files, credentials, private keys and deployment IDs
"@
    Set-Content -LiteralPath (Join-Path $stageRoot 'PACKAGE-CONTENTS.txt') -Value $manifest -Encoding UTF8

    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }

    $tar = Get-Command tar.exe -ErrorAction SilentlyContinue
    if ($null -ne $tar) {
        & $tar.Source -a -c -f $zipPath -C $stageRoot .
        if ($LASTEXITCODE -ne 0) {
            throw "tar.exe exited with code $LASTEXITCODE."
        }
    }
    else {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::CreateFromDirectory(
            $stageRoot,
            $zipPath,
            [System.IO.Compression.CompressionLevel]::Optimal,
            $false
        )
    }

    $zipSize = (Get-Item -LiteralPath $zipPath).Length
    Write-Host ''
    Write-Host 'Done.'
    Write-Host "Included: $copiedCount files"
    Write-Host "Uncompressed: $([math]::Round($copiedBytes / 1MB, 2)) MB"
    Write-Host "ZIP size: $([math]::Round($zipSize / 1MB, 2)) MB"
    Write-Host "Created: $zipPath"
    Write-Host ''
    Write-Host 'You can now upload that ZIP to ChatGPT.'
    Write-Host ''
    Read-Host 'Press Enter to close'
}
finally {
    if (Test-Path -LiteralPath $stageRoot) {
        Remove-Item -LiteralPath $stageRoot -Recurse -Force
    }
}
