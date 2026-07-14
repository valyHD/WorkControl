param(
  [string]$ProjectId = "workcontrol-53b1d",
  [string]$Account = "ionut.matura30@gmail.com"
)

$ErrorActionPreference = "Stop"
$token = (gcloud auth print-access-token --account $Account).Trim()
$headers = @{ Authorization = "Bearer $token" }
$now = [DateTime]::UtcNow
$start = $now.AddMinutes(-75)

function Get-MonitoringSeries {
  param(
    [string]$MetricType,
    [string]$Aligner = "ALIGN_SUM",
    [string]$Reducer = "REDUCE_SUM"
  )

  $params = @{
    filter = "metric.type=`"$MetricType`""
    "interval.startTime" = $start.ToString("o")
    "interval.endTime" = $now.ToString("o")
    "aggregation.alignmentPeriod" = "60s"
    "aggregation.perSeriesAligner" = $Aligner
    view = "FULL"
  }
  if ($Reducer) { $params["aggregation.crossSeriesReducer"] = $Reducer }
  $query = ($params.GetEnumerator() | ForEach-Object {
    "$([uri]::EscapeDataString($_.Key))=$([uri]::EscapeDataString([string]$_.Value))"
  }) -join "&"
  $uri = "https://monitoring.googleapis.com/v3/projects/$ProjectId/timeSeries?$query"
  return (Invoke-RestMethod -Headers $headers -Uri $uri -Method Get).timeSeries
}

function Get-PointValue($point) {
  if ($null -ne $point.value.int64Value) { return [double]$point.value.int64Value }
  if ($null -ne $point.value.doubleValue) { return [double]$point.value.doubleValue }
  return 0
}

function Get-WindowSum($series, [int]$minutes) {
  $cutoff = $now.AddMinutes(-$minutes)
  $sum = 0
  foreach ($item in @($series)) {
    foreach ($point in @($item.points)) {
      if ([DateTime]::Parse($point.interval.endTime).ToUniversalTime() -ge $cutoff) {
        $sum += Get-PointValue $point
      }
    }
  }
  return [math]::Round($sum, 2)
}

function Get-WindowAverage($series, [int]$minutes) {
  $cutoff = $now.AddMinutes(-$minutes)
  $values = @()
  foreach ($item in @($series)) {
    foreach ($point in @($item.points)) {
      if ([DateTime]::Parse($point.interval.endTime).ToUniversalTime() -ge $cutoff) {
        $values += Get-PointValue $point
      }
    }
  }
  if (-not $values.Count) { return 0 }
  return [math]::Round(($values | Measure-Object -Average).Average, 2)
}

$reads = Get-MonitoringSeries "firestore.googleapis.com/document/read_ops_count"
$writes = Get-MonitoringSeries "firestore.googleapis.com/document/write_ops_count"
$listeners = Get-MonitoringSeries "firestore.googleapis.com/network/snapshot_listeners" "ALIGN_MEAN"
$connections = Get-MonitoringSeries "firestore.googleapis.com/network/active_connections" "ALIGN_MEAN"
$functionRequests = Get-MonitoringSeries "run.googleapis.com/request_count" "ALIGN_SUM" ""

$rows = foreach ($minutes in 5, 15, 30, 60) {
  $readCount = Get-WindowSum $reads $minutes
  $writeCount = Get-WindowSum $writes $minutes
  [pscustomobject]@{
    WindowMinutes = $minutes
    Reads = $readCount
    ReadsPerMinute = [math]::Round($readCount / $minutes, 2)
    Writes = $writeCount
    WritesPerMinute = [math]::Round($writeCount / $minutes, 2)
    EstimatedEgressMiB = [math]::Round($readCount * 3.78 / 1024, 2)
    SnapshotListeners = Get-WindowAverage $listeners $minutes
    ActiveConnections = Get-WindowAverage $connections $minutes
    FunctionRequests = Get-WindowSum $functionRequests $minutes
  }
}

$rows | Format-Table -AutoSize

$functionRows = foreach ($minutes in 15, 30, 60) {
  $cutoff = $now.AddMinutes(-$minutes)
  $byService = @{}
  foreach ($series in @($functionRequests)) {
    $serviceName = [string]$series.resource.labels.service_name
    if (-not $serviceName) { $serviceName = "unknown" }
    if (-not $byService.ContainsKey($serviceName)) { $byService[$serviceName] = 0 }
    foreach ($point in @($series.points)) {
      if ([DateTime]::Parse($point.interval.endTime).ToUniversalTime() -ge $cutoff) {
        $byService[$serviceName] += Get-PointValue $point
      }
    }
  }
  foreach ($entry in $byService.GetEnumerator()) {
    if ($entry.Value -le 0) { continue }
    [pscustomobject]@{
      WindowMinutes = $minutes
      Function = $entry.Key
      Requests = [math]::Round($entry.Value, 2)
      RequestsPerHour = [math]::Round($entry.Value * 60 / $minutes, 2)
    }
  }
}

Write-Output "Functions by service"
$functionRows | Sort-Object WindowMinutes, @{ Expression = "Requests"; Descending = $true } | Format-Table -AutoSize
Write-Output "MeasuredAtUtc=$($now.ToString('o'))"
