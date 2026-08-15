const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

test("production restore passes the target database through pg_restore --dbname", () => {
  const restoreScript = fs.readFileSync(
    path.join(__dirname, "../../ops/restore-production-backup.sh"),
    "utf8"
  );

  assert.match(restoreScript, /pg_restore --dbname="\$DIRECT_URL"/);
  assert.doesNotMatch(restoreScript, /pg_restore "\$DIRECT_URL"/);
  assert.match(restoreScript, /--single-transaction/);
  assert.ok(
    restoreScript.indexOf('rsync -a --delete "$work_directory/$public_name/" "$public_stage/"') <
      restoreScript.indexOf('pg_restore --dbname="$DIRECT_URL"'),
    "file restore preflight must complete before the database is changed"
  );
  assert.ok(
    restoreScript.indexOf('swap_directory "$public_stage" "$resolved_upload_root"') <
      restoreScript.indexOf('pg_restore --dbname="$DIRECT_URL"'),
    "file activation must be rollback-guarded before the transactional database restore"
  );
  assert.match(restoreScript, /rollback_activated_directory/);
});

test("production backup prevents overlap and snapshots uploads around the database dump", () => {
  const backupScript = fs.readFileSync(
    path.join(__dirname, "../../ops/backup-production.sh"),
    "utf8"
  );

  assert.match(backupScript, /flock -n 9/);
  const firstUploadCopy = backupScript.indexOf(
    'rsync -a "$resolved_upload_root/" "$work_directory/$public_name/"'
  );
  const databaseDump = backupScript.indexOf('pg_dump "$DIRECT_URL"');
  const secondUploadCopy = backupScript.indexOf(
    'rsync -a "$resolved_upload_root/" "$work_directory/$public_name/"',
    firstUploadCopy + 1
  );
  assert.ok(firstUploadCopy >= 0 && firstUploadCopy < databaseDump);
  assert.ok(secondUploadCopy > databaseDump);
  assert.match(backupScript, /rclone check/);
});

test("backup freshness requires a recent encrypted archive and checksum", () => {
  const freshnessScript = fs.readFileSync(
    path.join(__dirname, "../../ops/check-backup-freshness.sh"),
    "utf8"
  );

  assert.match(freshnessScript, /BACKUP_MAX_AGE_MINUTES/);
  assert.match(freshnessScript, /quest-production-\*\.tar\.gz\.enc/);
  assert.match(freshnessScript, /candidate\.sha256/);
  assert.match(freshnessScript, /sha256sum --check --status/);
  assert.match(freshnessScript, /rclone check/);
});

test("remote retention counts and deletes only complete recovery pairs", () => {
  const retentionScript = fs.readFileSync(
    path.join(__dirname, "../../ops/prune-production-backups.sh"),
    "utf8"
  );

  assert.match(retentionScript, /complete_archives/);
  assert.match(retentionScript, /object_set\[\$sidecar_name\]/);
  assert.match(retentionScript, /rclone deletefile "\$remote\/\$archive_name\.sha256"/);
  assert.match(retentionScript, /RETENTION_CONFIRMATION/);
});

test("production backup dumps both schemas when the valorant schema exists", () => {
  const backupScript = fs.readFileSync(
    path.join(__dirname, "../../ops/backup-production.sh"),
    "utf8",
  );

  assert.match(backupScript, /pg_namespace/);
  assert.match(backupScript, /valorant_schema_exists/);
  assert.match(backupScript, /--schema=public \\\n\s+--schema=valorant/);
  assert.match(backupScript, /database_scope=application_public_and_valorant_schemas/);
  assert.match(backupScript, /valorant_schema_included=\$valorant_schema_exists/);
});

test("production restore reports restored table counts for both schemas", () => {
  const restoreScript = fs.readFileSync(
    path.join(__dirname, "../../ops/restore-production-backup.sh"),
    "utf8",
  );

  assert.match(restoreScript, /SELECT 'public=' \|\| count\(\*\)/);
  assert.match(restoreScript, /SELECT 'valorant=' \|\| count\(\*\)/);
});
