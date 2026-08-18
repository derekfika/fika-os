param([switch]$ValidateOnly)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName Microsoft.VisualBasic
[System.Windows.Forms.Application]::EnableVisualStyles()

$script:ToolDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:WorkspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $script:ToolDirectory "..\.."))
$script:ConfigPath = Join-Path $script:ToolDirectory "projects.json"
$script:IsRunning = $false

function Get-RelativeWorkspacePath {
  param([string]$FullPath)

  $rootUri = New-Object System.Uri(($script:WorkspaceRoot.TrimEnd('\') + '\'))
  $pathUri = New-Object System.Uri($FullPath)
  return [System.Uri]::UnescapeDataString($rootUri.MakeRelativeUri($pathUri).ToString()).Replace('/', '\')
}

function Read-ProjectConfig {
  if (-not (Test-Path -LiteralPath $script:ConfigPath)) {
    throw "Project configuration was not found: $script:ConfigPath"
  }
  $parsed = Get-Content -LiteralPath $script:ConfigPath -Raw | ConvertFrom-Json
  return @($parsed)
}

function Get-ReleaseProjects {
  $configured = @(Read-ProjectConfig)
  $projects = New-Object System.Collections.Generic.List[object]
  $knownPaths = @{}

  foreach ($entry in $configured) {
    $relativePath = [string]$entry.path
    $normalisedPath = $relativePath.Replace('/', '\').Trim('\')
    $knownPaths[$normalisedPath.ToLowerInvariant()] = $true
    $fullPath = Join-Path $script:WorkspaceRoot $normalisedPath
    $claspPath = Join-Path $fullPath ".clasp.json"
    $linked = Test-Path -LiteralPath $claspPath
    $scriptId = ""
    if ($linked) {
      try {
        $claspConfig = Get-Content -LiteralPath $claspPath -Raw | ConvertFrom-Json
        $scriptId = [string]$claspConfig.scriptId
      } catch {
        $scriptId = ""
      }
    }
    $projects.Add([pscustomobject]@{
      Name = [string]$entry.name
      Group = [string]$entry.group
      RelativePath = $normalisedPath
      FullPath = $fullPath
      ClaspUser = [string]$entry.claspUser
      ScriptId = $scriptId
      DeploymentId = [string]$entry.deploymentId
      Linked = $linked
      Configured = $true
    })
  }

  $ignoredRoots = @("node_modules", "archives", "Backups", ".codex-staging", ".git")
  $linkedFiles = Get-ChildItem -LiteralPath $script:WorkspaceRoot -Filter ".clasp.json" -File -Recurse -ErrorAction SilentlyContinue |
    Where-Object {
      $relative = Get-RelativeWorkspacePath -FullPath $_.FullName
      -not ($ignoredRoots | Where-Object { $relative -like ("{0}\*" -f $_) })
    }

  foreach ($file in $linkedFiles) {
    $folder = Split-Path -Parent $file.FullName
    $relativePath = (Get-RelativeWorkspacePath -FullPath $folder).Trim('\')
    if ($knownPaths.ContainsKey($relativePath.ToLowerInvariant())) { continue }

    $projects.Add([pscustomobject]@{
      Name = (Split-Path -Leaf $folder) + " (newly discovered)"
      Group = "Unconfigured"
      RelativePath = $relativePath
      FullPath = $folder
      ClaspUser = ""
      ScriptId = ""
      DeploymentId = ""
      Linked = $true
      Configured = $false
    })
  }

  return @($projects | Sort-Object Group, Name)
}

function Save-ProjectConfiguration {
  param(
    [string]$OriginalRelativePath,
    [string]$Name,
    [string]$Group,
    [string]$RelativePath,
    [string]$ClaspUser,
    [string]$ScriptId,
    [string]$DeploymentId
  )

  $normalisedPath = $RelativePath.Replace('/', '\').Trim('\')
  $fullPath = [System.IO.Path]::GetFullPath((Join-Path $script:WorkspaceRoot $normalisedPath))
  $workspacePrefix = $script:WorkspaceRoot.TrimEnd('\') + '\'
  if (-not $fullPath.StartsWith($workspacePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "The project folder must be inside the FIKA workspace."
  }
  if (-not (Test-Path -LiteralPath $fullPath -PathType Container)) {
    throw "The project folder does not exist: $normalisedPath"
  }
  if ([string]::IsNullOrWhiteSpace($Name)) { throw "Enter a project name." }
  if ([string]::IsNullOrWhiteSpace($Group)) { throw "Enter a project group." }
  if ([string]::IsNullOrWhiteSpace($ClaspUser)) { throw "Enter the clasp username/account alias." }

  $entries = New-Object System.Collections.Generic.List[object]
  $matched = $false
  $originalKey = [string]$OriginalRelativePath
  $configured = @(Read-ProjectConfig)

  foreach ($entry in $configured) {
    $entryPath = ([string]$entry.path).Replace('/', '\').Trim('\')
    if (-not $matched -and -not [string]::IsNullOrWhiteSpace($originalKey) -and
        $entryPath.Equals($originalKey.Replace('/', '\').Trim('\'), [System.StringComparison]::OrdinalIgnoreCase)) {
      $entries.Add([pscustomobject]@{
        name = $Name.Trim()
        group = $Group.Trim()
        path = $normalisedPath.Replace('\', '/')
        claspUser = $ClaspUser.Trim()
        deploymentId = $DeploymentId.Trim()
      })
      $matched = $true
    } else {
      $entries.Add($entry)
    }
  }

  if (-not $matched) {
    $duplicate = @($entries | Where-Object {
      ([string]$_.path).Replace('/', '\').Trim('\').Equals($normalisedPath, [System.StringComparison]::OrdinalIgnoreCase)
    })
    if ($duplicate.Count -gt 0) {
      throw "That project folder is already configured. Select it in the main list and choose Edit selected."
    }

    $entries.Add([pscustomobject]@{
      name = $Name.Trim()
      group = $Group.Trim()
      path = $normalisedPath.Replace('\', '/')
      claspUser = $ClaspUser.Trim()
      deploymentId = $DeploymentId.Trim()
    })
  }

  $claspPath = Join-Path $fullPath ".clasp.json"
  $claspObject = $null
  if (-not [string]::IsNullOrWhiteSpace($ScriptId)) {
    if (Test-Path -LiteralPath $claspPath) {
      try {
        $claspObject = Get-Content -LiteralPath $claspPath -Raw | ConvertFrom-Json
      } catch {
        throw "The existing .clasp.json file is not valid JSON: $claspPath"
      }
    }
    if ($null -eq $claspObject) {
      $claspObject = [pscustomobject]@{ scriptId = $ScriptId.Trim(); rootDir = "." }
    } elseif ($claspObject.PSObject.Properties.Name -contains "scriptId") {
      $claspObject.scriptId = $ScriptId.Trim()
    } else {
      $claspObject | Add-Member -NotePropertyName "scriptId" -NotePropertyValue $ScriptId.Trim()
    }
    if (-not ($claspObject.PSObject.Properties.Name -contains "rootDir")) {
      $claspObject | Add-Member -NotePropertyName "rootDir" -NotePropertyValue "."
    }
  }
  $entryArray = @($entries | ForEach-Object { $_ })
  $json = ConvertTo-Json -InputObject $entryArray -Depth 5
  [System.IO.File]::WriteAllText($script:ConfigPath, $json + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
  if ($null -ne $claspObject) {
    $claspJson = $claspObject | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText($claspPath, $claspJson + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
  }
}

function Set-ProjectDeploymentId {
  param(
    [string]$RelativePath,
    [string]$DeploymentId
  )

  if ([string]::IsNullOrWhiteSpace($DeploymentId)) {
    throw "A deployment ID was not supplied."
  }

  $normalisedPath = $RelativePath.Replace('\', '/').Trim('/')
  $entries = New-Object System.Collections.Generic.List[object]
  $matched = $false

  foreach ($entry in @(Read-ProjectConfig)) {
    if (([string]$entry.path).Replace('\', '/').Trim('/').Equals(
      $normalisedPath,
      [System.StringComparison]::OrdinalIgnoreCase
    )) {
      $entries.Add([pscustomobject]@{
        name = [string]$entry.name
        group = [string]$entry.group
        path = [string]$entry.path
        claspUser = [string]$entry.claspUser
        deploymentId = $DeploymentId.Trim()
      })
      $matched = $true
    } else {
      $entries.Add($entry)
    }
  }

  if (-not $matched) {
    throw "The project could not be found in projects.json: $RelativePath"
  }

  $entryArray = @($entries | ForEach-Object { $_ })
  $json = ConvertTo-Json -InputObject $entryArray -Depth 5
  [System.IO.File]::WriteAllText(
    $script:ConfigPath,
    $json + [Environment]::NewLine,
    (New-Object System.Text.UTF8Encoding($false))
  )
}

function Show-ProjectEditor {
  param([object]$Project)

  $isNew = $null -eq $Project
  $dialog = New-Object System.Windows.Forms.Form
  $dialog.Text = $(if ($isNew) { "Add release project" } else { "Edit release project" })
  $dialog.StartPosition = "CenterParent"
  $dialog.Size = New-Object System.Drawing.Size(650, 420)
  $dialog.MinimumSize = $dialog.Size
  $dialog.MaximumSize = $dialog.Size
  $dialog.FormBorderStyle = "FixedDialog"
  $dialog.MaximizeBox = $false
  $dialog.MinimizeBox = $false
  $dialog.Font = New-Object System.Drawing.Font("Segoe UI", 9)

  $fields = @(
    @{ Label = "Project name"; Key = "Name"; Value = $(if ($isNew) { "" } else { $Project.Name }) },
    @{ Label = "Group"; Key = "Group"; Value = $(if ($isNew) { "Other" } else { $Project.Group }) },
    @{ Label = "Project folder"; Key = "Path"; Value = $(if ($isNew) { "" } else { $Project.RelativePath }) },
    @{ Label = "Script ID"; Key = "ScriptId"; Value = $(if ($isNew) { "" } else { $Project.ScriptId }) },
    @{ Label = "Deployment ID"; Key = "DeploymentId"; Value = $(if ($isNew) { "" } else { $Project.DeploymentId }) },
    @{ Label = "Clasp username"; Key = "ClaspUser"; Value = $(if ($isNew) { "derek" } else { $Project.ClaspUser }) }
  )
  $textBoxes = @{}
  $top = 24

  foreach ($field in $fields) {
    $label = New-Object System.Windows.Forms.Label
    $label.Text = $field.Label
    $label.Location = New-Object System.Drawing.Point(22, ($top + 4))
    $label.Size = New-Object System.Drawing.Size(120, 22)
    $dialog.Controls.Add($label)

    $box = New-Object System.Windows.Forms.TextBox
    $box.Text = [string]$field.Value
    $box.Location = New-Object System.Drawing.Point(150, $top)
    $box.Size = New-Object System.Drawing.Size(450, 25)
    $dialog.Controls.Add($box)
    $textBoxes[$field.Key] = $box
    $top += 47
  }

  $browseButton = New-Object System.Windows.Forms.Button
  $browseButton.Text = "Browse..."
  $browseButton.Location = New-Object System.Drawing.Point(505, 112)
  $browseButton.Size = New-Object System.Drawing.Size(92, 27)
  $dialog.Controls.Add($browseButton)
  $textBoxes["Path"].Size = New-Object System.Drawing.Size(348, 25)

  $help = New-Object System.Windows.Forms.Label
  $help.Text = "Leave Script ID blank for a new project, then use Create Apps Script. Existing Script IDs are saved to .clasp.json; deployment IDs and usernames are saved to the release-project list."
  $help.Location = New-Object System.Drawing.Point(22, 310)
  $help.Size = New-Object System.Drawing.Size(575, 38)
  $help.ForeColor = [System.Drawing.Color]::FromArgb(90, 90, 90)
  $dialog.Controls.Add($help)

  $saveButton = New-Object System.Windows.Forms.Button
  $saveButton.Text = "Save project"
  $saveButton.Location = New-Object System.Drawing.Point(394, 350)
  $saveButton.Size = New-Object System.Drawing.Size(100, 30)
  $saveButton.DialogResult = "None"
  $dialog.Controls.Add($saveButton)

  $cancelButton = New-Object System.Windows.Forms.Button
  $cancelButton.Text = "Cancel"
  $cancelButton.Location = New-Object System.Drawing.Point(500, 350)
  $cancelButton.Size = New-Object System.Drawing.Size(100, 30)
  $cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
  $dialog.CancelButton = $cancelButton
  $dialog.Controls.Add($cancelButton)

  $browseButton.Add_Click({
    $picker = New-Object System.Windows.Forms.FolderBrowserDialog
    $picker.Description = "Choose an Apps Script project folder inside the FIKA workspace"
    $picker.SelectedPath = $script:WorkspaceRoot
    if ($picker.ShowDialog($dialog) -eq [System.Windows.Forms.DialogResult]::OK) {
      try {
        $textBoxes["Path"].Text = Get-RelativeWorkspacePath -FullPath $picker.SelectedPath
      } catch {
        [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "Invalid folder", "OK", "Warning") | Out-Null
      }
    }
  })

  $saveButton.Add_Click({
    try {
      Save-ProjectConfiguration `
        -OriginalRelativePath $(if ($isNew) { "" } else { $Project.RelativePath }) `
        -Name $textBoxes["Name"].Text `
        -Group $textBoxes["Group"].Text `
        -RelativePath $textBoxes["Path"].Text `
        -ClaspUser $textBoxes["ClaspUser"].Text `
        -ScriptId $textBoxes["ScriptId"].Text `
        -DeploymentId $textBoxes["DeploymentId"].Text
      $dialog.DialogResult = [System.Windows.Forms.DialogResult]::OK
      $dialog.Close()
    } catch {
      [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "Could not save project", "OK", "Warning") | Out-Null
    }
  })

  return $dialog.ShowDialog($form)
}

function Resolve-ClaspCommand {
  $clasp = Get-Command "clasp.cmd" -ErrorAction SilentlyContinue
  if ($clasp) {
    return [pscustomobject]@{ Command = $clasp.Source; Prefix = @() }
  }

  $npx = Get-Command "npx.cmd" -ErrorAction SilentlyContinue
  if ($npx) {
    return [pscustomobject]@{ Command = $npx.Source; Prefix = @("--yes", "@google/clasp") }
  }

  throw "Neither clasp.cmd nor npx.cmd is available. Install Node.js and clasp before releasing."
}

if ($ValidateOnly) {
  $validationProjects = @(Get-ReleaseProjects)
  if ($validationProjects.Count -eq 0) { throw "No release projects were found." }
  $invalidProjects = @($validationProjects | Where-Object {
    -not $_.Linked -or [string]::IsNullOrWhiteSpace($_.ScriptId)
  })
  Write-Output ("Release Manager validation passed: {0} projects, {1} fully linked." -f
    $validationProjects.Count,
    ($validationProjects.Count - $invalidProjects.Count))
  exit 0
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "FIKA Release Manager"
$form.StartPosition = "CenterScreen"
$form.Size = New-Object System.Drawing.Size(1080, 760)
$form.MinimumSize = New-Object System.Drawing.Size(900, 650)
$form.BackColor = [System.Drawing.Color]::FromArgb(246, 246, 243)
$form.Font = New-Object System.Drawing.Font("Segoe UI", 9)

$title = New-Object System.Windows.Forms.Label
$title.Text = "FIKA Release Manager"
$title.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 20)
$title.ForeColor = [System.Drawing.Color]::FromArgb(42, 42, 42)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(22, 16)
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = "Select projects, choose release actions, then review before anything is changed."
$subtitle.AutoSize = $true
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(95, 95, 95)
$subtitle.Location = New-Object System.Drawing.Point(26, 54)
$form.Controls.Add($subtitle)

$loginButton = New-Object System.Windows.Forms.Button
$loginButton.Text = "Login one profile"
$loginButton.Location = New-Object System.Drawing.Point(884, 24)
$loginButton.Size = New-Object System.Drawing.Size(154, 34)
$loginButton.Anchor = "Top,Right"
$loginButton.BackColor = [System.Drawing.Color]::FromArgb(255, 255, 255)
$loginButton.FlatStyle = "Flat"
$form.Controls.Add($loginButton)

$loginAllButton = New-Object System.Windows.Forms.Button
$loginAllButton.Text = "Login all profiles"
$loginAllButton.Location = New-Object System.Drawing.Point(718, 24)
$loginAllButton.Size = New-Object System.Drawing.Size(158, 34)
$loginAllButton.Anchor = "Top,Right"
$loginAllButton.BackColor = [System.Drawing.Color]::FromArgb(255, 255, 255)
$loginAllButton.FlatStyle = "Flat"
$form.Controls.Add($loginAllButton)

$grid = New-Object System.Windows.Forms.DataGridView
$grid.Location = New-Object System.Drawing.Point(24, 84)
$grid.Size = New-Object System.Drawing.Size(1014, 310)
$grid.Anchor = "Top,Left,Right"
$grid.AllowUserToAddRows = $false
$grid.AllowUserToDeleteRows = $false
$grid.AllowUserToResizeRows = $false
$grid.RowHeadersVisible = $false
$grid.MultiSelect = $false
$grid.SelectionMode = "FullRowSelect"
$grid.AutoGenerateColumns = $false
$grid.BackgroundColor = [System.Drawing.Color]::White
$grid.BorderStyle = "FixedSingle"

$selectColumn = New-Object System.Windows.Forms.DataGridViewCheckBoxColumn
$selectColumn.Name = "Selected"
$selectColumn.HeaderText = "Use"
$selectColumn.Width = 45
$grid.Columns.Add($selectColumn) | Out-Null

$nameColumn = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
$nameColumn.Name = "Project"
$nameColumn.HeaderText = "Project"
$nameColumn.ReadOnly = $true
$nameColumn.AutoSizeMode = "Fill"
$grid.Columns.Add($nameColumn) | Out-Null

$groupColumn = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
$groupColumn.Name = "Group"
$groupColumn.HeaderText = "Group"
$groupColumn.ReadOnly = $true
$groupColumn.Width = 145
$grid.Columns.Add($groupColumn) | Out-Null

$userColumn = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
$userColumn.Name = "User"
$userColumn.HeaderText = "Clasp user"
$userColumn.ReadOnly = $true
$userColumn.Width = 105
$grid.Columns.Add($userColumn) | Out-Null

$deployColumn = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
$deployColumn.Name = "Deployment"
$deployColumn.HeaderText = "Deployment"
$deployColumn.ReadOnly = $true
$deployColumn.Width = 135
$grid.Columns.Add($deployColumn) | Out-Null
$form.Controls.Add($grid)

$selectAllButton = New-Object System.Windows.Forms.Button
$selectAllButton.Text = "Select all"
$selectAllButton.Location = New-Object System.Drawing.Point(24, 402)
$selectAllButton.Size = New-Object System.Drawing.Size(80, 30)
$form.Controls.Add($selectAllButton)

$selectNoneButton = New-Object System.Windows.Forms.Button
$selectNoneButton.Text = "Select none"
$selectNoneButton.Location = New-Object System.Drawing.Point(110, 402)
$selectNoneButton.Size = New-Object System.Drawing.Size(80, 30)
$form.Controls.Add($selectNoneButton)

$configButton = New-Object System.Windows.Forms.Button
$configButton.Text = "Edit selected"
$configButton.Location = New-Object System.Drawing.Point(196, 402)
$configButton.Size = New-Object System.Drawing.Size(100, 30)
$form.Controls.Add($configButton)

$addProjectButton = New-Object System.Windows.Forms.Button
$addProjectButton.Text = "Add project"
$addProjectButton.Location = New-Object System.Drawing.Point(302, 402)
$addProjectButton.Size = New-Object System.Drawing.Size(90, 30)
$form.Controls.Add($addProjectButton)

$createProjectButton = New-Object System.Windows.Forms.Button
$createProjectButton.Text = "Create Apps Script"
$createProjectButton.Location = New-Object System.Drawing.Point(398, 402)
$createProjectButton.Size = New-Object System.Drawing.Size(140, 30)
$form.Controls.Add($createProjectButton)

$actionsGroup = New-Object System.Windows.Forms.GroupBox
$actionsGroup.Text = "Actions"
$actionsGroup.Location = New-Object System.Drawing.Point(550, 398)
$actionsGroup.Size = New-Object System.Drawing.Size(488, 66)
$actionsGroup.Anchor = "Top,Left,Right"
$form.Controls.Add($actionsGroup)

$pushCheck = New-Object System.Windows.Forms.CheckBox
$pushCheck.Text = "Push to Apps Script"
$pushCheck.Checked = $true
$pushCheck.AutoSize = $true
$pushCheck.Location = New-Object System.Drawing.Point(18, 28)
$actionsGroup.Controls.Add($pushCheck)

$deployCheck = New-Object System.Windows.Forms.CheckBox
$deployCheck.Text = "Deploy web app"
$deployCheck.Checked = $true
$deployCheck.AutoSize = $true
$deployCheck.Location = New-Object System.Drawing.Point(155, 28)
$actionsGroup.Controls.Add($deployCheck)

$commitCheck = New-Object System.Windows.Forms.CheckBox
$commitCheck.Text = "Git commit"
$commitCheck.Checked = $false
$commitCheck.AutoSize = $true
$commitCheck.Location = New-Object System.Drawing.Point(280, 28)
$actionsGroup.Controls.Add($commitCheck)

$gitPushCheck = New-Object System.Windows.Forms.CheckBox
$gitPushCheck.Text = "Git push"
$gitPushCheck.Checked = $false
$gitPushCheck.AutoSize = $true
$gitPushCheck.Location = New-Object System.Drawing.Point(370, 28)
$actionsGroup.Controls.Add($gitPushCheck)

$messageLabel = New-Object System.Windows.Forms.Label
$messageLabel.Text = "Release description"
$messageLabel.AutoSize = $true
$messageLabel.Location = New-Object System.Drawing.Point(24, 476)
$form.Controls.Add($messageLabel)

$messageBox = New-Object System.Windows.Forms.TextBox
$messageBox.Text = "Update selected FIKA projects"
$messageBox.Location = New-Object System.Drawing.Point(150, 472)
$messageBox.Size = New-Object System.Drawing.Size(708, 27)
$messageBox.Anchor = "Top,Left,Right"
$form.Controls.Add($messageBox)

$runButton = New-Object System.Windows.Forms.Button
$runButton.Text = "Review and run"
$runButton.Location = New-Object System.Drawing.Point(874, 469)
$runButton.Size = New-Object System.Drawing.Size(164, 34)
$runButton.Anchor = "Top,Right"
$runButton.BackColor = [System.Drawing.Color]::FromArgb(79, 52, 199)
$runButton.ForeColor = [System.Drawing.Color]::White
$runButton.FlatStyle = "Flat"
$form.Controls.Add($runButton)

$logBox = New-Object System.Windows.Forms.RichTextBox
$logBox.Location = New-Object System.Drawing.Point(24, 516)
$logBox.Size = New-Object System.Drawing.Size(1014, 170)
$logBox.Anchor = "Top,Bottom,Left,Right"
$logBox.ReadOnly = $true
$logBox.BackColor = [System.Drawing.Color]::FromArgb(31, 31, 31)
$logBox.ForeColor = [System.Drawing.Color]::FromArgb(235, 235, 235)
$logBox.Font = New-Object System.Drawing.Font("Consolas", 9)
$form.Controls.Add($logBox)

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Text = "Ready"
$statusLabel.AutoSize = $true
$statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(80, 80, 80)
$statusLabel.Location = New-Object System.Drawing.Point(24, 695)
$statusLabel.Anchor = "Bottom,Left"
$form.Controls.Add($statusLabel)

function Add-LogLine {
  param(
    [string]$Text,
    [System.Drawing.Color]$Colour = [System.Drawing.Color]::FromArgb(235, 235, 235)
  )

  $logBox.SelectionStart = $logBox.TextLength
  $logBox.SelectionLength = 0
  $logBox.SelectionColor = $Colour
  $logBox.AppendText($Text + [Environment]::NewLine)
  $logBox.SelectionColor = $logBox.ForeColor
  $logBox.ScrollToCaret()
  [System.Windows.Forms.Application]::DoEvents()
}

function Set-InterfaceEnabled {
  param([bool]$Enabled)

  $grid.Enabled = $Enabled
  $selectAllButton.Enabled = $Enabled
  $selectNoneButton.Enabled = $Enabled
  $configButton.Enabled = $Enabled
  $addProjectButton.Enabled = $Enabled
  $createProjectButton.Enabled = $Enabled
  $loginButton.Enabled = $Enabled
  $loginAllButton.Enabled = $Enabled
  $actionsGroup.Enabled = $Enabled
  $messageBox.Enabled = $Enabled
  $runButton.Enabled = $Enabled
}

function Load-ProjectGrid {
  $grid.Rows.Clear()
  $script:Projects = @(Get-ReleaseProjects)

  foreach ($project in $script:Projects) {
    if (-not $project.Linked) {
      $deploymentStatus = "Not linked"
    } elseif (-not $project.Configured -or [string]::IsNullOrWhiteSpace($project.ClaspUser)) {
      $deploymentStatus = "Needs setup"
    } elseif ([string]::IsNullOrWhiteSpace($project.DeploymentId)) {
      $deploymentStatus = "ID missing"
    } else {
      $deploymentStatus = "Ready"
    }

    $rowIndex = $grid.Rows.Add($false, $project.Name, $project.Group, $project.ClaspUser, $deploymentStatus)
    $grid.Rows[$rowIndex].Tag = $project
    $grid.Rows[$rowIndex].Cells["Project"].ToolTipText = "Script ID: " + $(if ([string]::IsNullOrWhiteSpace($project.ScriptId)) { "not set" } else { $project.ScriptId })
    $grid.Rows[$rowIndex].Cells["Deployment"].ToolTipText = $(if ([string]::IsNullOrWhiteSpace($project.DeploymentId)) { "Deployment ID not set" } else { $project.DeploymentId })

    if ($deploymentStatus -ne "Ready") {
      $grid.Rows[$rowIndex].DefaultCellStyle.BackColor = [System.Drawing.Color]::FromArgb(255, 247, 224)
    }
  }

  $readyCount = @($script:Projects | Where-Object { $_.Linked -and $_.Configured }).Count
  $statusLabel.Text = "$readyCount linked projects available"
}

function Get-SelectedProjects {
  $selected = New-Object System.Collections.Generic.List[object]
  $grid.EndEdit() | Out-Null
  foreach ($row in $grid.Rows) {
    if ([bool]$row.Cells["Selected"].Value) {
      $selected.Add($row.Tag)
    }
  }
  return @($selected | ForEach-Object { $_ })
}

function Invoke-NativeTool {
  param(
    [string]$Command,
    [string[]]$Arguments,
    [string]$WorkingDirectory
  )

  Add-LogLine ("> " + (Split-Path -Leaf $Command) + " " + ($Arguments -join " ")) ([System.Drawing.Color]::FromArgb(125, 239, 184))
  $outputLines = New-Object System.Collections.Generic.List[string]
  $exitCode = 0
  $previousErrorActionPreference = $ErrorActionPreference
  Push-Location -LiteralPath $WorkingDirectory
  try {
    # Native tools such as Git commonly write non-fatal warnings to stderr.
    # PowerShell 5 converts redirected stderr into ErrorRecord objects, and the
    # script-wide Stop preference would otherwise turn those warnings into
    # terminating exceptions before the native exit code can be checked.
    $ErrorActionPreference = "Continue"
    & $Command @Arguments 2>&1 | ForEach-Object {
      $line = [string]$_
      $outputLines.Add($line)
      Add-LogLine $line
    }
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
    Pop-Location
  }

  if ($null -eq $exitCode) { $exitCode = 0 }
  if ($exitCode -ne 0) {
    $combinedOutput = $outputLines -join " "
    if ($combinedOutput -match "invalid_grant|invalid_rapt|reauth") {
      throw "Google authorization has expired. Use Login one profile, complete Google verification, then retry."
    }
    throw "Command failed with exit code $exitCode."
  }

  return @($outputLines | ForEach-Object { $_ })
}

$selectAllButton.Add_Click({
  foreach ($row in $grid.Rows) {
    if ($row.Tag.Linked -and $row.Tag.Configured) {
      $row.Cells["Selected"].Value = $true
    }
  }
})

$selectNoneButton.Add_Click({
  foreach ($row in $grid.Rows) {
    $row.Cells["Selected"].Value = $false
  }
})

$configButton.Add_Click({
  if ($grid.SelectedRows.Count -eq 0) {
    [System.Windows.Forms.MessageBox]::Show("Select a project row to edit.", "Choose a project", "OK", "Information") | Out-Null
    return
  }
  $project = $grid.SelectedRows[0].Tag
  if ((Show-ProjectEditor -Project $project) -eq [System.Windows.Forms.DialogResult]::OK) {
    Load-ProjectGrid
  }
})

$addProjectButton.Add_Click({
  if ((Show-ProjectEditor -Project $null) -eq [System.Windows.Forms.DialogResult]::OK) {
    Load-ProjectGrid
  }
})

$createProjectButton.Add_Click({
  if ($script:IsRunning) { return }
  if ($grid.SelectedRows.Count -eq 0) {
    [System.Windows.Forms.MessageBox]::Show("Select the project row to create in Apps Script.", "Choose a project", "OK", "Information") | Out-Null
    return
  }

  $project = $grid.SelectedRows[0].Tag
  if (-not $project.Configured -or [string]::IsNullOrWhiteSpace($project.ClaspUser)) {
    [System.Windows.Forms.MessageBox]::Show("Configure the project name, folder and clasp username first.", "Project setup required", "OK", "Warning") | Out-Null
    return
  }
  if ($project.Linked) {
    [System.Windows.Forms.MessageBox]::Show("This project is already linked to Apps Script.", "Already linked", "OK", "Information") | Out-Null
    return
  }

  $answer = [System.Windows.Forms.MessageBox]::Show(
    "Create a new standalone Apps Script project for:`n`n" + $project.Name +
      "`n`nClasp profile: " + $project.ClaspUser +
      "`n`nThe new Script ID will be saved in this project folder.",
    "Create Apps Script project",
    "YesNo",
    "Warning"
  )
  if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { return }

  $script:IsRunning = $true
  Set-InterfaceEnabled -Enabled $false
  $statusLabel.Text = "Creating Apps Script project..."
  Add-LogLine ""
  Add-LogLine ("=== Create Apps Script: " + $project.Name + " ===") ([System.Drawing.Color]::FromArgb(255, 232, 0))

  try {
    $clasp = Resolve-ClaspCommand
    $manifestPath = Join-Path $project.FullPath "appsscript.json"
    $manifestBeforeCreate = $(if (Test-Path -LiteralPath $manifestPath) {
      Get-Content -LiteralPath $manifestPath -Raw
    } else {
      $null
    })
    $arguments = @($clasp.Prefix) + @(
      "--user", $project.ClaspUser,
      "create", "--type", "standalone",
      "--title", $project.Name,
      "--rootDir", "."
    )
    try {
      Invoke-NativeTool -Command $clasp.Command -Arguments $arguments -WorkingDirectory $project.FullPath | Out-Null
    } finally {
      if ($null -ne $manifestBeforeCreate) {
        [System.IO.File]::WriteAllText(
          $manifestPath,
          $manifestBeforeCreate,
          (New-Object System.Text.UTF8Encoding($false))
        )
      }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $project.FullPath ".clasp.json"))) {
      throw "Apps Script did not create the expected .clasp.json link file."
    }
    Load-ProjectGrid
    $statusLabel.Text = "Apps Script project created"
    [System.Windows.Forms.MessageBox]::Show(
      "The Apps Script project was created and linked. You can now push and deploy it.",
      "Project created",
      "OK",
      "Information"
    ) | Out-Null
  } catch {
    Add-LogLine ("CREATE FAILED: " + $_.Exception.Message) ([System.Drawing.Color]::FromArgb(255, 110, 110))
    $statusLabel.Text = "Project creation failed"
    [System.Windows.Forms.MessageBox]::Show(
      "The Apps Script project was not created.`n`n" + $_.Exception.Message + "`n`nSee the activity log for details.",
      "Creation failed",
      "OK",
      "Error"
    ) | Out-Null
  } finally {
    $script:IsRunning = $false
    Set-InterfaceEnabled -Enabled $true
  }
})

$loginButton.Add_Click({
  if ($script:IsRunning) { return }

  $suggestedUser = "derek"
  if ($grid.SelectedRows.Count -gt 0 -and $null -ne $grid.SelectedRows[0].Tag) {
    $selectedUser = [string]$grid.SelectedRows[0].Tag.ClaspUser
    if (-not [string]::IsNullOrWhiteSpace($selectedUser)) {
      $suggestedUser = $selectedUser
    }
  }

  $claspUser = [Microsoft.VisualBasic.Interaction]::InputBox(
    "Enter the clasp username/account alias to authorize (for example: derek, hospitality, mnk or cpu).`n`nGoogle sign-in will open in your browser. No password is entered or stored here.",
    "Clasp login",
    $suggestedUser
  ).Trim()
  if ([string]::IsNullOrWhiteSpace($claspUser)) { return }

  $script:IsRunning = $true
  Set-InterfaceEnabled -Enabled $false
  $statusLabel.Text = "Waiting for Google authorization..."
  Add-LogLine ""
  Add-LogLine ("=== Clasp login: " + $claspUser + " ===") ([System.Drawing.Color]::FromArgb(255, 232, 0))

  try {
    $clasp = Resolve-ClaspCommand
    $arguments = @($clasp.Prefix) + @("--user", $claspUser, "login")
    Invoke-NativeTool -Command $clasp.Command -Arguments $arguments -WorkingDirectory $script:WorkspaceRoot
    Add-LogLine ("Clasp login completed for alias '" + $claspUser + "'.") ([System.Drawing.Color]::FromArgb(117, 239, 184))
    $statusLabel.Text = "Clasp login completed"
    [System.Windows.Forms.MessageBox]::Show(
      "Clasp authorization completed for the '$claspUser' alias.",
      "Login complete",
      "OK",
      "Information"
    ) | Out-Null
  } catch {
    Add-LogLine ("CLASP LOGIN FAILED: " + $_.Exception.Message) ([System.Drawing.Color]::FromArgb(255, 110, 110))
    $statusLabel.Text = "Clasp login failed"
    [System.Windows.Forms.MessageBox]::Show(
      "Clasp login did not complete.`n`n" + $_.Exception.Message + "`n`nSee the activity log for details.",
      "Login failed",
      "OK",
      "Error"
    ) | Out-Null
  } finally {
    $script:IsRunning = $false
    Set-InterfaceEnabled -Enabled $true
  }
})

$loginAllButton.Add_Click({
  if ($script:IsRunning) { return }

  $aliases = @($script:Projects |
    Where-Object { $_.Linked -and -not [string]::IsNullOrWhiteSpace($_.ClaspUser) } |
    ForEach-Object { $_.ClaspUser.Trim() } |
    Sort-Object -Unique)

  if ($aliases.Count -eq 0) {
    [System.Windows.Forms.MessageBox]::Show("No configured clasp usernames were found.", "No profiles", "OK", "Information") | Out-Null
    return
  }

  $answer = [System.Windows.Forms.MessageBox]::Show(
    "Google authorization will run for these clasp profiles in sequence:`n`n" +
      (($aliases | ForEach-Object { "- " + $_ }) -join "`n") +
      "`n`nComplete each browser authorization before the next profile begins. Make sure you choose the matching Google account for each alias.`n`nContinue?",
    "Login all clasp profiles",
    "YesNo",
    "Information"
  )
  if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { return }

  $script:IsRunning = $true
  Set-InterfaceEnabled -Enabled $false
  $statusLabel.Text = "Authorizing clasp profiles..."
  Add-LogLine ""
  Add-LogLine ("=== Login all clasp profiles: " + ($aliases -join ", ") + " ===") ([System.Drawing.Color]::FromArgb(255, 232, 0))

  try {
    $clasp = Resolve-ClaspCommand
    $profileNumber = 0
    foreach ($claspUser in $aliases) {
      $profileNumber++
      $statusLabel.Text = "Authorizing $claspUser ($profileNumber of $($aliases.Count))..."
      Add-LogLine ""
      Add-LogLine ("--- Profile " + $profileNumber + " of " + $aliases.Count + ": " + $claspUser + " ---") ([System.Drawing.Color]::FromArgb(98, 186, 234))
      $arguments = @($clasp.Prefix) + @("--user", $claspUser, "login")
      Invoke-NativeTool -Command $clasp.Command -Arguments $arguments -WorkingDirectory $script:WorkspaceRoot
    }

    Add-LogLine ""
    Add-LogLine "All configured clasp profiles completed authorization." ([System.Drawing.Color]::FromArgb(117, 239, 184))
    $statusLabel.Text = "All clasp logins completed"
    [System.Windows.Forms.MessageBox]::Show(
      "Authorization completed for all configured clasp profiles.",
      "Logins complete",
      "OK",
      "Information"
    ) | Out-Null
  } catch {
    Add-LogLine ""
    Add-LogLine ("CLASP LOGIN SEQUENCE STOPPED: " + $_.Exception.Message) ([System.Drawing.Color]::FromArgb(255, 110, 110))
    $statusLabel.Text = "Clasp login sequence stopped"
    [System.Windows.Forms.MessageBox]::Show(
      "The login sequence stopped. Profiles completed before this error remain authorized.`n`n" +
        $_.Exception.Message + "`n`nSee the activity log for details.",
      "Login sequence stopped",
      "OK",
      "Error"
    ) | Out-Null
  } finally {
    $script:IsRunning = $false
    Set-InterfaceEnabled -Enabled $true
  }
})

$runButton.Add_Click({
  if ($script:IsRunning) { return }

  $selected = @(Get-SelectedProjects)
  if ($selected.Count -eq 0) {
    [System.Windows.Forms.MessageBox]::Show("Select at least one project.", "Nothing selected", "OK", "Information") | Out-Null
    return
  }

  if (-not ($pushCheck.Checked -or $deployCheck.Checked -or $commitCheck.Checked -or $gitPushCheck.Checked)) {
    [System.Windows.Forms.MessageBox]::Show("Choose at least one action.", "Nothing to run", "OK", "Information") | Out-Null
    return
  }

  $unlinked = @($selected | Where-Object { -not $_.Linked -or -not $_.Configured -or [string]::IsNullOrWhiteSpace($_.ClaspUser) })
  if (($pushCheck.Checked -or $deployCheck.Checked) -and $unlinked.Count -gt 0) {
    [System.Windows.Forms.MessageBox]::Show(
      "Some selected projects are not fully linked or configured:`n`n" + (($unlinked | ForEach-Object { $_.Name }) -join "`n"),
      "Project setup required",
      "OK",
      "Warning"
    ) | Out-Null
    return
  }

  $missingDeployments = @($selected | Where-Object { [string]::IsNullOrWhiteSpace($_.DeploymentId) })
  $actionNames = New-Object System.Collections.Generic.List[string]
  if ($pushCheck.Checked) { $actionNames.Add("Push to Apps Script") }
  if ($deployCheck.Checked) { $actionNames.Add("Deploy web apps") }
  if ($commitCheck.Checked) { $actionNames.Add("Git commit") }
  if ($gitPushCheck.Checked) { $actionNames.Add("Git push") }

  $summary = "Projects ($($selected.Count)):`n" + (($selected | ForEach-Object { "- " + $_.Name }) -join "`n") +
    "`n`nActions:`n" + (($actionNames | ForEach-Object { "- " + $_ }) -join "`n")

  if ($deployCheck.Checked -and $missingDeployments.Count -gt 0) {
    $summary += "`n`nA first web-app deployment will be created and its ID saved for:`n" +
      (($missingDeployments | ForEach-Object { "- " + $_.Name }) -join "`n")
  }

  $answer = [System.Windows.Forms.MessageBox]::Show(
    $summary + "`n`nContinue?",
    "Confirm release",
    "YesNo",
    "Warning"
  )
  if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { return }

  $description = $messageBox.Text.Trim()
  if ([string]::IsNullOrWhiteSpace($description)) {
    $description = "Update selected FIKA projects"
  }

  $script:IsRunning = $true
  Set-InterfaceEnabled -Enabled $false
  $statusLabel.Text = "Release in progress..."
  $logBox.Clear()
  Add-LogLine ("Release started at " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss")) ([System.Drawing.Color]::FromArgb(98, 186, 234))

  try {
    if ($pushCheck.Checked -or $deployCheck.Checked) {
      $clasp = Resolve-ClaspCommand
      foreach ($project in $selected) {
        Add-LogLine ""
        Add-LogLine ("=== " + $project.Name + " ===") ([System.Drawing.Color]::FromArgb(255, 232, 0))

        if ($pushCheck.Checked) {
          $arguments = @($clasp.Prefix) + @("--user", $project.ClaspUser, "push", "--force")
          Invoke-NativeTool -Command $clasp.Command -Arguments $arguments -WorkingDirectory $project.FullPath
        }

        if ($deployCheck.Checked) {
          if ([string]::IsNullOrWhiteSpace($project.DeploymentId)) {
            Add-LogLine "Creating the first web-app deployment..." ([System.Drawing.Color]::FromArgb(98, 186, 234))
            $arguments = @($clasp.Prefix) + @(
              "--user", $project.ClaspUser,
              "deploy", "--description", $description
            )
            $deployOutput = @(Invoke-NativeTool -Command $clasp.Command -Arguments $arguments -WorkingDirectory $project.FullPath)
            $deploymentMatch = [regex]::Match(($deployOutput -join "`n"), "AKfy[a-zA-Z0-9_-]+")
            if (-not $deploymentMatch.Success) {
              throw "The deployment was created, but its deployment ID could not be read from clasp output. Add the ID with Edit selected before deploying again."
            }
            $newDeploymentId = $deploymentMatch.Value
            Set-ProjectDeploymentId -RelativePath $project.RelativePath -DeploymentId $newDeploymentId
            $project.DeploymentId = $newDeploymentId
            Add-LogLine ("Saved new deployment ID: " + $newDeploymentId) ([System.Drawing.Color]::FromArgb(117, 239, 184))
          } else {
            $arguments = @($clasp.Prefix) + @(
              "--user", $project.ClaspUser,
              "redeploy", $project.DeploymentId,
              "--description", $description
            )
            Invoke-NativeTool -Command $clasp.Command -Arguments $arguments -WorkingDirectory $project.FullPath
          }
        }
      }
    }

    if ($commitCheck.Checked) {
      Add-LogLine ""
      Add-LogLine "=== Git commit ===" ([System.Drawing.Color]::FromArgb(255, 232, 0))
      $paths = @($selected | ForEach-Object { $_.RelativePath })
      Invoke-NativeTool -Command "git" -Arguments (@("add", "-A", "--") + $paths) -WorkingDirectory $script:WorkspaceRoot

      & git -C $script:WorkspaceRoot diff --cached --quiet
      $hasStagedChanges = ($LASTEXITCODE -ne 0)
      if ($hasStagedChanges) {
        Invoke-NativeTool -Command "git" -Arguments @("commit", "-m", $description) -WorkingDirectory $script:WorkspaceRoot
      } else {
        Add-LogLine "No selected project changes needed committing." ([System.Drawing.Color]::FromArgb(180, 180, 180))
      }
    }

    if ($gitPushCheck.Checked) {
      Add-LogLine ""
      Add-LogLine "=== Git push ===" ([System.Drawing.Color]::FromArgb(255, 232, 0))
      $branch = (& git -C $script:WorkspaceRoot branch --show-current).Trim()
      if ([string]::IsNullOrWhiteSpace($branch)) {
        throw "Git is not currently on a named branch."
      }
      Invoke-NativeTool -Command "git" -Arguments @("push", "origin", $branch) -WorkingDirectory $script:WorkspaceRoot
    }

    Add-LogLine ""
    Add-LogLine "Release completed successfully." ([System.Drawing.Color]::FromArgb(117, 239, 184))
    $statusLabel.Text = "Completed successfully"
    [System.Windows.Forms.MessageBox]::Show("The selected release actions completed successfully.", "Release complete", "OK", "Information") | Out-Null
  } catch {
    Add-LogLine ""
    Add-LogLine ("RELEASE STOPPED: " + $_.Exception.Message) ([System.Drawing.Color]::FromArgb(255, 110, 110))
    $statusLabel.Text = "Stopped after an error"
    [System.Windows.Forms.MessageBox]::Show(
      "The release stopped after an error. No later actions were run.`n`n" + $_.Exception.Message + "`n`nSee the activity log for details.",
      "Release stopped",
      "OK",
      "Error"
    ) | Out-Null
  } finally {
    $script:IsRunning = $false
    Set-InterfaceEnabled -Enabled $true
  }
})

$form.Add_Shown({
  try {
    Load-ProjectGrid
    Add-LogLine "Ready. Select one or more projects to begin." ([System.Drawing.Color]::FromArgb(180, 180, 180))
  } catch {
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "Could not load projects", "OK", "Error") | Out-Null
    $form.Close()
  }
})

$form.Add_FormClosing({
  param($sender, $eventArgs)
  if ($script:IsRunning) {
    $eventArgs.Cancel = $true
    [System.Windows.Forms.MessageBox]::Show("Wait for the current release action to finish before closing.", "Release in progress", "OK", "Information") | Out-Null
  }
})

[void]$form.ShowDialog()
