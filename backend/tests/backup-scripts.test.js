const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

test("production restore passes the target database through pg_restore --dbname", () => {
  const restoreScript = fs.readFileSync(
    path.join(__dirname, "../../ops/restore-production-backup.sh"),
    "utf8"
  );

  assert.match(restoreScript, /"\$pg_restore_bin" --dbname="\$restore_url"/);
  assert.doesNotMatch(restoreScript, /pg_restore "\$DIRECT_URL"/);
  assert.match(restoreScript, /--single-transaction/);
  assert.ok(
    restoreScript.indexOf('rsync -a --delete "$work_directory/$public_name/" "$public_stage/"') <
      restoreScript.indexOf('"$pg_restore_bin" --dbname="$restore_url"'),
    "file restore preflight must complete before the database is changed"
  );
  assert.ok(
    restoreScript.indexOf('swap_directory "$public_stage" "$resolved_upload_root"') <
      restoreScript.indexOf('"$pg_restore_bin" --dbname="$restore_url"'),
    "file activation must be rollback-guarded before the transactional database restore"
  );
  assert.match(restoreScript, /rollback_activated_directory/);
});

test("production backup wrapper locks before delegated two-pass snapshot", () => {
  const wrapperScript = fs.readFileSync(
    path.join(__dirname, "../../ops/backup-production.sh"),
    "utf8"
  );
  const implementationScript = fs.readFileSync(
    path.join(__dirname, "../../ops/backup-production-multi-remote.sh"),
    "utf8"
  );

  assert.match(wrapperScript, /flock -n 8/);
  assert.match(wrapperScript, /backup-production-multi-remote\.sh/);
  assert.match(implementationScript, /exec 9>"\$BACKUP_ROOT\/\.quest-backup\.lock"/);
  const firstUploadCopy = implementationScript.indexOf(
    'rsync -a "$resolved_upload_root/" "$work_directory/$public_name/"'
  );
  const databaseDump = implementationScript.indexOf('"$pg_dump_bin" "$DIRECT_URL"');
  const secondUploadCopy = implementationScript.indexOf(
    'rsync -a "$resolved_upload_root/" "$work_directory/$public_name/"',
    firstUploadCopy + 1
  );
  assert.ok(firstUploadCopy >= 0 && firstUploadCopy < databaseDump);
  assert.ok(secondUploadCopy > databaseDump);
  assert.match(implementationScript, /rclone check/);
  assert.match(implementationScript, /remote_label\\tstatus/);
});

test("backup freshness requires a recent encrypted archive and checksum on every remote", () => {
  const freshnessScript = fs.readFileSync(
    path.join(__dirname, "../../ops/check-backup-freshness.sh"),
    "utf8"
  );

  assert.match(freshnessScript, /BACKUP_MAX_AGE_MINUTES/);
  assert.match(freshnessScript, /quest-production-\*\.tar\.gz\.enc/);
  assert.match(freshnessScript, /candidate\.sha256/);
  assert.match(freshnessScript, /sha256sum --check --status/);
  assert.match(freshnessScript, /for remote_index in/);
  assert.match(freshnessScript, /rclone check/);
});

test("remote retention counts and safely deletes only complete recovery pairs", () => {
  const retentionScript = fs.readFileSync(
    path.join(__dirname, "../../ops/prune-production-backups.sh"),
    "utf8"
  );

  assert.match(retentionScript, /complete_count/);
  assert.match(retentionScript, /object_set\[\$\{object_name\}\.sha256\]/);
  assert.match(retentionScript, /rclone deletefile .*\$archive_name/);
  assert.match(retentionScript, /archive was removed but checksum cleanup failed/);
  assert.match(retentionScript, /RETENTION_CONFIRMATION/);
});

test("production backup dumps both schemas when the valorant schema exists", () => {
  const backupScript = fs.readFileSync(
    path.join(__dirname, "../../ops/backup-production-multi-remote.sh"),
    "utf8"
  );

  assert.match(backupScript, /pg_namespace/);
  assert.match(backupScript, /valorant_schema_exists/);
  assert.match(backupScript, /--schema=public\s+--schema=valorant/);
  assert.match(backupScript, /database_scope=application_public_and_valorant_schemas/);
  assert.match(backupScript, /printf 'valorant_schema_included=%s\\n' "\$valorant_schema_exists"/);
});

test("scheduled backup TLS client material is readable by deploy without weakening key protection", () => {
  const backupScript = fs.readFileSync(
    path.join(__dirname, "../../ops/backup-production-multi-remote.sh"),
    "utf8",
  );
  const service = fs.readFileSync(
    path.join(__dirname, "../../ops/systemd/quest-esports-backup.service"),
    "utf8",
  );
  const example = fs.readFileSync(
    path.join(__dirname, "../../ops/quest-esports-backup.env.example"),
    "utf8",
  );
  assert.match(backupScript, /client_mode.*== 640/);
  assert.match(backupScript, /0:\$\{backup_group_id\} 640/);
  assert.match(backupScript, /backup-client-ca\.crt/);
  assert.match(backupScript, /backup_client_tls_dir.*\/etc\/quest-esports-backup/);
  assert.match(service, /^User=deploy$/m);
  assert.match(service, /^Group=deploy$/m);
  assert.match(service, /\/etc\/quest-esports-backup.*0750/);
  assert.match(example, /root:deploy 0640/);
  assert.match(example, /^BACKUP_CLIENT_TLS_DIR=\/etc\/quest-esports-backup$/m);
  assert.match(example, /^POSTGRES_CA_FILE=\/etc\/quest-esports-backup\/backup-client-ca\.crt$/m);
  assert.doesNotMatch(example, /^POSTGRES_CA_FILE=\/etc\/quest-esports\/tls\//m);
});

test("pinned PostgreSQL server files match the UID/GID 999 readability contract", () => {
  const postgresReadme = fs.readFileSync(
    path.join(__dirname, "../../ops/docker/postgres/README.md"),
    "utf8",
  );
  const compose = fs.readFileSync(
    path.join(__dirname, "../../ops/docker/compose.production.yml"),
    "utf8",
  );
  const readabilityFixture = fs.readFileSync(
    path.join(__dirname, "../../ops/tests/postgres-container-readability.test.sh"),
    "utf8",
  );
  assert.match(postgresReadme, /quest-postgres\.crt.*root -g 999 -m 0640/s);
  assert.match(postgresReadme, /postgres-admin-password.*root -g 999 -m 0640/s);
  assert.match(compose, /user: "999:999"/);
  assert.match(compose, /quest-postgres\.crt:\/run\/postgresql\/tls\/server\.crt:ro/);
  assert.match(readabilityFixture, /--user 999:999/);
  assert.match(readabilityFixture, /test -r \/run\/postgresql\/tls\/server\.crt/);
  assert.match(readabilityFixture, /test -r \/run\/secrets\/postgres-admin-password/);
});

test("production restore reports restored table counts for both schemas", () => {
  const restoreScript = fs.readFileSync(
    path.join(__dirname, "../../ops/restore-production-backup.sh"),
    "utf8"
  );

  assert.match(restoreScript, /SELECT 'public=' \|\| count\(\*\)/);
  assert.match(restoreScript, /SELECT 'valorant=' \|\| count\(\*\)/);
});

test("shared release lock contract is documented for all writers", () => {
  const operationsReadme = fs.readFileSync(
    path.join(__dirname, "../../ops/README.md"),
    "utf8"
  );
  const recoveryDoc = fs.readFileSync(
    path.join(__dirname, "../../docs/backup-and-disaster-recovery.md"),
    "utf8"
  );
  const tmpfilesContract = fs.readFileSync(
    path.join(__dirname, "../../ops/systemd/quest-esports-release-lock.tmpfiles"),
    "utf8"
  );

  assert.match(operationsReadme, /Release, migration, backup, and name-audit jobs must acquire/);
  assert.match(recoveryDoc, /release, migration,\s+backup, or name-audit operation/);
  assert.match(tmpfilesContract, /^f \/var\/lock\/quest-esports-release\.lock 0660 root deploy -$/m);
});

test("all remote probes use exact unique per-label configurations", () => {
  for (const scriptName of [
    "backup-production-multi-remote.sh",
    "check-backup-freshness.sh",
    "prune-production-backups.sh",
  ]) {
    const script = fs.readFileSync(path.join(__dirname, "../../ops", scriptName), "utf8");
    assert.match(script, /config_by_resolved_path/);
    assert.match(script, /RCLONE_CONFIGS requires BACKUP_RCLONE_REMOTES/);
    assert.match(script, /BACKUP_RCLONE_CONFIGS must exactly match BACKUP_RCLONE_REMOTES/);
  }
});

test("backup CA bundle is the PostgreSQL server trust chain, not client identity", () => {
  const backupScript = fs.readFileSync(
    path.join(__dirname, "../../ops/backup-production-multi-remote.sh"),
    "utf8",
  );
  const hostValidator = fs.readFileSync(
    path.join(__dirname, "../../ops/deploy/validate-host.sh"),
    "utf8",
  );
  const environmentExample = fs.readFileSync(
    path.join(__dirname, "../../ops/quest-esports-backup.env.example"),
    "utf8",
  );
  const documentation = [
    fs.readFileSync(path.join(__dirname, "../../docs/backup-and-disaster-recovery.md"), "utf8"),
    fs.readFileSync(path.join(__dirname, "../../docs/production-runbook.md"), "utf8"),
    fs.readFileSync(path.join(__dirname, "../../ops/README.md"), "utf8"),
    fs.readFileSync(path.join(__dirname, "../../ops/docker/postgres/README.md"), "utf8"),
  ].join("\n");

  assert.match(environmentExample, /trust bundle/);
  assert.match(environmentExample, /issuer of \/etc\/quest-esports\/tls\/quest-postgres\.crt/);
  assert.match(backupScript, /trust bundle containing the issuer of quest-postgres\.crt/);
  assert.match(hostValidator, /openssl verify -purpose sslserver -CAfile "\$ca_file" "\$server_cert_file"/);
  assert.match(documentation, /If separate server\/client PKIs are used/);
  assert.match(documentation, /issuer of `quest-postgres\.crt`/);
  assert.match(documentation, /sslmode=verify-full/);
  assert.doesNotMatch(
    documentation,
    /(?:must|should)\s+(?:never|not)\s+(?:point at|use|be)\s+(?:the\s+)?server CA/i,
  );
});
