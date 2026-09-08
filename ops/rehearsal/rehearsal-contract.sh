#!/usr/bin/env bash

rehearsal_looks_production() {
  local value="${1,,}"
  case "$value" in
    *questesports*|*supabase*|*production*|*/prod/*|*"/prod"|*paris*|*/var/www/quest-esports*|*/srv/quest-esports*|*quest-prod*) return 1 ;;
  esac
  return 0
}

rehearsal_safe_path() {
  local path="$1" current=/ part
  [[ "$path" == /* && "$path" != / && "$path" != *[[:space:]]* && "$path" =~ ^/[A-Za-z0-9._/@%+=:.-]+$ ]] || return 1
  while IFS= read -r part; do
    [[ -z "$part" ]] && continue
    [[ "$part" != . && "$part" != .. ]] || return 1
    current="${current%/}/$part"
    [[ ! -L "$current" ]] || return 1
  done < <(printf '%s\n' "$path" | tr / '\n')
}

rehearsal_safe_hook_path() {
  local path="$1"
  rehearsal_safe_path "$path" || return 1
  rehearsal_looks_production "$path" || return 1
  [[ -f "$path" && -x "$path" && ! -L "$path" ]]
}

rehearsal_failure_endpoint_id() {
  case "$1" in
    bad_checksum) printf '%s' 'archive-checksum' ;;
    bad_decryption) printf '%s' 'archive-decryption' ;;
    wrong_ca|blocked_network|failed_service_health) printf '%s' 'valorant-health' ;;
    attempted_mutation_callback) printf '%s' 'quest-api' ;;
    *) return 1 ;;
  esac
}

rehearsal_runtime_role() {
  case "$1" in
    public) printf '%s' 'quest_runtime' ;;
    valorant) printf '%s' 'val_runtime' ;;
    *) return 1 ;;
  esac
}

rehearsal_runtime_policy_name() {
  local table="$2"
  [[ "$table" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || return 1
  printf '%s_runtime_all' "$table"
}

rehearsal_live_gate_token() {
  printf '%s' 'owner_deployment_host_evidence_required'
}

rehearsal_canonical_acl_rows() {
  # Verified against production and against the canonical bootstrap SQL.
  #
  # Sequences are 'rU', not 'rwU': the bootstrap grants USAGE, SELECT ON
  # SEQUENCES, so the previous 'w' described a privilege nothing ever granted.
  #
  # No quest_backup rows, even though production has them. The restore runs
  # pg_restore with --no-acl and re-derives every default privilege from the
  # canonical bootstrap, so this describes what a restore guarantees rather than
  # what production happens to hold. Production's extra quest_backup defaults do
  # not survive a recovery -- see docs/backup-and-disaster-recovery.md.
  printf '%s\n' \
    'quest_migrator|public|r|quest_runtime=arwd/quest_migrator' \
    'quest_migrator|public|S|quest_runtime=rU/quest_migrator' \
    'quest_migrator|public|f|quest_migrator=X/quest_migrator' \
    'quest_migrator|public|T|quest_migrator=U/quest_migrator' \
    'val_migrator|valorant|r|val_runtime=arwd/val_migrator' \
    'val_migrator|valorant|S|val_runtime=rU/val_migrator' \
    'val_migrator|valorant|f|val_migrator=X/val_migrator' \
    'val_migrator|valorant|T|val_migrator=U/val_migrator' \
    'quest_migrator|<global>|f|quest_migrator=X/quest_migrator' \
    'quest_migrator|<global>|T|quest_migrator=U/quest_migrator' \
    'val_migrator|<global>|f|val_migrator=X/val_migrator' \
    'val_migrator|<global>|T|val_migrator=U/val_migrator'
}
