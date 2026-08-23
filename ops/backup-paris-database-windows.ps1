[CmdletBinding()]
param(
  [string]$EnvironmentFile = (Join-Path $PSScriptRoot "..\backend\.env"),
  [string]$BackupRoot = "D:\Work\QuestEsports-backups\paris-database",
  [string]$RecoveryRoot = "D:\Work\QuestEsports-backup-recovery",
  [string]$PostgresBin = "C:\Program Files\PostgreSQL\17\bin"
)

$ErrorActionPreference = "Stop"

$recipientFile = Join-Path $RecoveryRoot "quest-esports-production-age-recipient.txt"
$identityFile = Join-Path $RecoveryRoot "quest-esports-production-age-identity.txt"
$pgDump = Join-Path $PostgresBin "pg_dump.exe"
$pgRestore = Join-Path $PostgresBin "pg_restore.exe"

foreach ($requiredPath in @($EnvironmentFile, $recipientFile, $identityFile, $pgDump, $pgRestore)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "Required backup input is missing: $requiredPath"
  }
}

$directLine = Get-Content -LiteralPath $EnvironmentFile |
  Where-Object { $_ -match '^DIRECT_URL=' } |
  Select-Object -First 1
if (-not $directLine) {
  throw "DIRECT_URL is missing from $EnvironmentFile"
}

$directUrl = ($directLine -replace '^DIRECT_URL=', '').Trim().Trim('"').Trim("'")
$databaseUri = [Uri]$directUrl
if ($databaseUri.Host -notmatch 'eu-west-3\.pooler\.supabase\.com$') {
  throw "Refusing to back up a non-Paris database host: $($databaseUri.Host)"
}

$userInfo = $databaseUri.UserInfo.Split(':', 2)
if ($userInfo.Count -ne 2) {
  throw "DIRECT_URL credentials could not be parsed safely."
}
$databaseUser = [Uri]::UnescapeDataString($userInfo[0])
$databasePassword = [Uri]::UnescapeDataString($userInfo[1])
$databaseName = $databaseUri.AbsolutePath.Trim('/')
if (-not $databaseName) {
  $databaseName = "postgres"
}

New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls $BackupRoot /inheritance:r /grant:r "${currentIdentity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Could not restrict the backup directory ACL."
}

$timestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$finalBase = "quest-paris-database-$timestamp"
$encryptedPath = Join-Path $BackupRoot "$finalBase.tar.gz.age"
$checksumPath = "$encryptedPath.sha256"
if ((Test-Path -LiteralPath $encryptedPath) -or (Test-Path -LiteralPath $checksumPath)) {
  throw "Refusing to overwrite an existing backup."
}

$resolvedBackupRoot = [IO.Path]::GetFullPath($BackupRoot).TrimEnd('\')
$workDirectory = Join-Path $resolvedBackupRoot ".staging-$timestamp-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $workDirectory | Out-Null

try {
  $dumpPath = Join-Path $workDirectory "database.dump"
  $manifestPath = Join-Path $workDirectory "manifest.txt"

  $env:PGHOST = $databaseUri.Host
  $env:PGPORT = if ($databaseUri.Port -gt 0) { [string]$databaseUri.Port } else { "5432" }
  $env:PGDATABASE = $databaseName
  $env:PGUSER = $databaseUser
  $env:PGPASSWORD = $databasePassword
  $env:PGSSLMODE = "require"
  try {
    # Both Quest-owned schemas. `public` is Prisma's; `valorant` belongs to the
    # sibling FastAPI service and holds match, series, and rating history that
    # exists nowhere else. Dumping only `public` silently loses it.
    & $pgDump --format=custom --schema=public --schema=valorant --no-owner --no-acl --file=$dumpPath
    if ($LASTEXITCODE -ne 0) {
      throw "pg_dump failed with exit code $LASTEXITCODE."
    }
    & $pgRestore --list $dumpPath | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "pg_restore could not read the generated dump."
    }
  }
  finally {
    Remove-Item Env:PGHOST, Env:PGPORT, Env:PGDATABASE, Env:PGUSER, Env:PGPASSWORD, Env:PGSSLMODE -ErrorAction SilentlyContinue
  }

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllLines($manifestPath, @(
    "created_at_utc=$timestamp",
    "source_region=eu-west-3",
    "source_host=$($databaseUri.Host)",
    "database=$databaseName",
    "database_format=postgres_custom",
    "scope=quest_owned_schemas",
    "schemas_included=public,valorant",
    "supabase_managed_schemas_included=false",
    "vps_uploads_included=false"
  ), $utf8NoBom)

  docker run --rm `
    -v "${workDirectory}:/stage:ro" `
    -v "${RecoveryRoot}:/keys:ro" `
    -v "${resolvedBackupRoot}:/out" `
    alpine:3.22 sh -lc "apk add --no-cache age >/dev/null && tar -C /stage -czf /tmp/payload.tar.gz database.dump manifest.txt && age --recipients-file /keys/quest-esports-production-age-recipient.txt --output /out/$finalBase.tar.gz.age /tmp/payload.tar.gz"
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $encryptedPath -PathType Leaf)) {
    throw "Encryption did not create the expected backup archive."
  }

  docker run --rm `
    -v "${RecoveryRoot}:/keys:ro" `
    -v "${resolvedBackupRoot}:/out:ro" `
    alpine:3.22 sh -lc "apk add --no-cache age >/dev/null && age --decrypt --identity /keys/quest-esports-production-age-identity.txt /out/$finalBase.tar.gz.age | tar -tzf - | grep -Fx database.dump >/dev/null && age --decrypt --identity /keys/quest-esports-production-age-identity.txt /out/$finalBase.tar.gz.age | tar -tzf - | grep -Fx manifest.txt >/dev/null"
  if ($LASTEXITCODE -ne 0) {
    throw "Encrypted backup validation failed."
  }

  $hash = (Get-FileHash -LiteralPath $encryptedPath -Algorithm SHA256).Hash.ToLowerInvariant()
  # LF, not CRLF: `sha256sum -c` treats a trailing CR as part of the filename
  # and reports the archive as missing, which during a recovery reads as a
  # corrupt backup at the worst possible moment.
  [IO.File]::WriteAllText($checksumPath, "$hash  $([IO.Path]::GetFileName($encryptedPath))`n", [Text.Encoding]::ASCII)

  foreach ($backupFile in @($encryptedPath, $checksumPath)) {
    icacls $backupFile /inheritance:r /grant:r "${currentIdentity}:F" '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Could not restrict the ACL for $backupFile"
    }
  }

  Get-Item -LiteralPath $encryptedPath, $checksumPath |
    Select-Object FullName, Length, LastWriteTime
  Write-Output "Paris database backup completed and encrypted validation passed."
}
finally {
  if (Test-Path -LiteralPath $workDirectory) {
    $resolvedWorkDirectory = [IO.Path]::GetFullPath($workDirectory)
    $expectedPrefix = "$resolvedBackupRoot\.staging-"
    if (-not $resolvedWorkDirectory.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing unsafe staging cleanup: $resolvedWorkDirectory"
    }
    Remove-Item -LiteralPath $resolvedWorkDirectory -Recurse -Force
  }
}
