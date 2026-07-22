param(
  [string]$ProjectId = "workcontrol-53b1d",
  [switch]$Apply
)

$ErrorActionPreference = "Stop"

if ($ProjectId -ne "workcontrol-53b1d") {
  throw "Project ID neasteptat: $ProjectId"
}

$targets = @("diagnosticSamples", "diagnosticEvents")
$commands = $targets | ForEach-Object {
  "gcloud firestore fields ttls update expiresAt --collection-group=$($_) --enable-ttl --project=$ProjectId"
}

if (-not $Apply) {
  Write-Host "DRY RUN. Nu se modifica Firebase. Comenzi planificate:"
  $commands | ForEach-Object { Write-Host "  $_" }
  exit 0
}

foreach ($collectionGroup in $targets) {
  Write-Host "Activez TTL pentru $collectionGroup.expiresAt..."
  & gcloud firestore fields ttls update expiresAt `
    --collection-group=$collectionGroup `
    --enable-ttl `
    --project=$ProjectId `
    --quiet
  if ($LASTEXITCODE -ne 0) {
    throw "Activarea TTL a esuat pentru $collectionGroup."
  }
}

Write-Host "Politicile TTL configurate:"
& gcloud firestore fields ttls list --project=$ProjectId
if ($LASTEXITCODE -ne 0) {
  throw "Nu am putut verifica politicile TTL."
}
