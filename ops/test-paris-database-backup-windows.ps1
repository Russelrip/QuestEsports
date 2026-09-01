[CmdletBinding()]
param(
  [string]$BackupPath,
  [string]$BackupRoot = "D:\Work\QuestEsports-backups\paris-database",
  [string]$RecoveryRoot = "D:\Work\QuestEsports-backup-recovery",
  [string]$PostgresBin = "C:\Program Files\PostgreSQL\17\bin"
)

$ErrorActionPreference = "Stop"

if (-not $BackupPath) {
  $latestBackup = Get-ChildItem -LiteralPath $BackupRoot -File -Filter 'quest-paris-database-*.tar.gz.age' |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
  if (-not $latestBackup) {
    throw "No encrypted Paris database backup was found in $BackupRoot"
  }
  $BackupPath = $latestBackup.FullName
}

$BackupPath = [IO.Path]::GetFullPath($BackupPath)
$checksumPath = "$BackupPath.sha256"
$identityFile = Join-Path $RecoveryRoot "quest-esports-production-age-identity.txt"
$pgRestore = Join-Path $PostgresBin "pg_restore.exe"
$psql = Join-Path $PostgresBin "psql.exe"
foreach ($requiredPath in @($BackupPath, $checksumPath, $identityFile, $pgRestore, $psql)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "Required restore-drill input is missing: $requiredPath"
  }
}

$expectedHash = ((Get-Content -LiteralPath $checksumPath -Raw).Trim() -split '\s+')[0]
$actualHash = (Get-FileHash -LiteralPath $BackupPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($expectedHash -ne $actualHash) {
  throw "Backup checksum verification failed."
}

$resolvedBackupRoot = [IO.Path]::GetFullPath($BackupRoot).TrimEnd('\')
$timestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$workDirectory = Join-Path $resolvedBackupRoot ".restore-drill-$timestamp-$([Guid]::NewGuid().ToString('N'))"
$containerName = "quest-paris-restore-drill-$($timestamp.ToLowerInvariant())-$([Guid]::NewGuid().ToString('N').Substring(0,8))"
$restorePassword = [Guid]::NewGuid().ToString('N')
New-Item -ItemType Directory -Path $workDirectory | Out-Null

try {
  docker run --rm `
    -v "${RecoveryRoot}:/keys:ro" `
    -v "${resolvedBackupRoot}:/backups:ro" `
    -v "${workDirectory}:/restore" `
    alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce sh -lc "apk add --no-cache age=1.2.1-r0 >/dev/null && age --decrypt --identity /keys/quest-esports-production-age-identity.txt /backups/$([IO.Path]::GetFileName($BackupPath)) | tar -xzf - -C /restore"
  if ($LASTEXITCODE -ne 0) {
    throw "Could not decrypt and extract the backup."
  }

  $dumpPath = Join-Path $workDirectory "database.dump"
  $manifestPath = Join-Path $workDirectory "manifest.txt"
  if (-not (Test-Path -LiteralPath $dumpPath -PathType Leaf) -or -not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "The backup is missing database.dump or manifest.txt."
  }
  & $pgRestore --list $dumpPath | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "pg_restore could not read the extracted dump."
  }

  $existingContainer = docker ps -a --filter "name=^/$containerName$" --format '{{.Names}}'
  if ($existingContainer) {
    throw "Refusing to reuse an existing Docker container: $containerName"
  }
  # Use the approved multi-architecture PostgreSQL 17 Bookworm index. Any
  # platform child digest is explanatory only; this index is the release
  # contract and must remain the image passed to Docker.
  docker run --name $containerName `
    -e POSTGRES_USER=quest_restore `
    -e POSTGRES_PASSWORD=$restorePassword `
    -e POSTGRES_DB=quest_restore `
    -p 127.0.0.1::5432 `
    -d postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Could not start the disposable PostgreSQL container."
  }

  $ready = $false
  for ($attempt = 1; $attempt -le 60; $attempt++) {
    docker exec $containerName pg_isready -U quest_restore -d quest_restore *> $null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) {
    throw "Disposable PostgreSQL did not become ready."
  }

  $portLine = docker port $containerName 5432/tcp
  if ($portLine -notmatch ':(\d+)$') {
    throw "Could not determine the disposable PostgreSQL port."
  }
  $restorePort = $Matches[1]
  $env:PGHOST = "127.0.0.1"
  $env:PGPORT = $restorePort
  $env:PGDATABASE = "quest_restore"
  $env:PGUSER = "quest_restore"
  $env:PGPASSWORD = $restorePassword
  try {
    & $pgRestore --clean --if-exists --no-owner --no-acl --exit-on-error --dbname=quest_restore $dumpPath
    if ($LASTEXITCODE -ne 0) {
      throw "The disposable database restore failed."
    }
    $tableCount = (& $psql --no-psqlrc --tuples-only --no-align --command "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';").Trim()
    $migrationCount = (& $psql --no-psqlrc --tuples-only --no-align --command 'SELECT count(*) FROM public."_prisma_migrations";').Trim()
    # The VALORANT schema is verified too, or a backup that silently stopped
    # capturing match and rating history would still pass this drill.
    $valorantTableCount = (& $psql --no-psqlrc --tuples-only --no-align --command "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'valorant';").Trim()
    if ($LASTEXITCODE -ne 0 -or [int]$tableCount -le 0 -or [int]$migrationCount -le 0 -or [int]$valorantTableCount -le 0) {
      throw "The restored database failed the table/migration verification."
    }
  }
  finally {
    Remove-Item Env:PGHOST, Env:PGPORT, Env:PGDATABASE, Env:PGUSER, Env:PGPASSWORD -ErrorAction SilentlyContinue
  }

  Write-Output "Restore drill passed: $tableCount public tables, $valorantTableCount valorant tables, and $migrationCount migration records restored."
}
finally {
  $matchingContainer = docker ps -a --filter "name=^/$containerName$" --format '{{.Names}}' 2>$null
  if ($matchingContainer -eq $containerName) {
    docker rm -f $containerName *> $null
  }
  if (Test-Path -LiteralPath $workDirectory) {
    $resolvedWorkDirectory = [IO.Path]::GetFullPath($workDirectory)
    $expectedPrefix = "$resolvedBackupRoot\.restore-drill-"
    if (-not $resolvedWorkDirectory.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing unsafe restore-drill cleanup: $resolvedWorkDirectory"
    }
    Remove-Item -LiteralPath $resolvedWorkDirectory -Recurse -Force
  }
}
