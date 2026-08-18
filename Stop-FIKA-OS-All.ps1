$ports = @(3200, 3300, 3400, 3500, 3600, 3700, 8085, 9099)
$processIds = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $ports -contains $_.LocalPort } |
  Select-Object -ExpandProperty OwningProcess -Unique
foreach ($processId in $processIds) {
  if ($processId -and $processId -ne $PID) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    Write-Host "Stopped local process $processId"
  }
}
Write-Host "FIKA OS local workspace stopped."

