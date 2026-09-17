#!/usr/bin/env bash
# Tiered off-site retention for every backup family on every configured remote.
#
# Dry run by default. RETENTION_CONFIRMATION=PRUNE_QUEST_PRODUCTION moves the
# expired recovery pairs to the remote's trash; TRASH_CONFIRMATION=EMPTY_QUEST_BACKUP_TRASH
# is a separate, later run that permanently removes trashed backup pairs so Drive
# quota is actually released. The two confirmations are never accepted together.
set -euo pipefail
umask 077

BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/quest-esports-backup.env}"
if [[ ! -r "$BACKUP_ENV_FILE" ]]; then
  echo "Backup configuration is not readable." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$BACKUP_ENV_FILE"
set +a

release_lock_path="${BACKUP_RELEASE_LOCK_PATH:-/var/lock/quest-esports-release.lock}"
if [[ "$release_lock_path" != /* || "$release_lock_path" == "/" ]]; then
  echo "BACKUP_RELEASE_LOCK_PATH must be an absolute non-root path." >&2
  exit 1
fi
if ! exec 8>"$release_lock_path" || ! flock -n 8; then
  echo "Another release operation is already running." >&2
  exit 1
fi

if [[ -n "${BACKUP_REMOTE_RETENTION_DAYS:-}" ]]; then
  echo "BACKUP_REMOTE_RETENTION_DAYS is no longer used; configure the tiered BACKUP_RETAIN_* settings instead." >&2
  exit 1
fi
if [[ -n "${RETENTION_CONFIRMATION:-}" && -n "${TRASH_CONFIRMATION:-}" ]]; then
  echo "RETENTION_CONFIRMATION and TRASH_CONFIRMATION are separate runs; set only one." >&2
  exit 1
fi
if [[ -n "${RETENTION_CONFIRMATION:-}" && "$RETENTION_CONFIRMATION" != PRUNE_QUEST_PRODUCTION ]]; then
  echo "RETENTION_CONFIRMATION must be exactly PRUNE_QUEST_PRODUCTION." >&2
  exit 1
fi
if [[ -n "${TRASH_CONFIRMATION:-}" && "$TRASH_CONFIRMATION" != EMPTY_QUEST_BACKUP_TRASH ]]; then
  echo "TRASH_CONFIRMATION must be exactly EMPTY_QUEST_BACKUP_TRASH." >&2
  exit 1
fi

: "${BACKUP_RETAIN_DATABASE_ALL_DAYS:=35}"
: "${BACKUP_RETAIN_DATABASE_WEEKLY_DAYS:=90}"
: "${BACKUP_RETAIN_MEDIA_DAILY:=7}"
: "${BACKUP_RETAIN_MEDIA_WEEKLY:=4}"
: "${BACKUP_RETAIN_RELEASE_DAYS:=14}"
: "${BACKUP_RETAIN_REHEARSAL_BOUND:=3}"
if [[ -z "${BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS:-}" ]]; then
  echo "Missing required retention setting: BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS" >&2
  exit 1
fi
if [[ ! "$BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS" =~ ^[0-9]+$ || "$BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS" -lt 2 ]]; then
  echo "BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS must be an integer of at least 2." >&2
  exit 1
fi
for name in BACKUP_RETAIN_DATABASE_ALL_DAYS BACKUP_RETAIN_DATABASE_WEEKLY_DAYS BACKUP_RETAIN_MEDIA_DAILY \
    BACKUP_RETAIN_MEDIA_WEEKLY BACKUP_RETAIN_RELEASE_DAYS BACKUP_RETAIN_REHEARSAL_BOUND; do
  if [[ ! "${!name}" =~ ^[0-9]+$ || "${!name}" -lt 1 ]]; then
    echo "$name must be a positive integer." >&2
    exit 1
  fi
done
if (( BACKUP_RETAIN_DATABASE_WEEKLY_DAYS < BACKUP_RETAIN_DATABASE_ALL_DAYS )); then
  echo "BACKUP_RETAIN_DATABASE_WEEKLY_DAYS must not be shorter than BACKUP_RETAIN_DATABASE_ALL_DAYS." >&2
  exit 1
fi
# Archives named by a signed restore rehearsal are the audit record that authorised
# a release; deleting one makes that evidence unverifiable. Fail closed if the
# evidence cannot be read rather than silently protecting nothing.
evidence_root="${BACKUP_REHEARSAL_EVIDENCE_ROOT:-}"
if [[ "$evidence_root" != /* || ! -d "$evidence_root" || ! -r "$evidence_root" || ! -x "$evidence_root" ]]; then
  echo "BACKUP_REHEARSAL_EVIDENCE_ROOT must be a readable absolute directory (run as root on the production host)." >&2
  exit 1
fi
for command in date flock grep mktemp realpath rclone sort; do
  command -v "$command" >/dev/null || { echo "$command is required." >&2; exit 1; }
done

if [[ -n "${BACKUP_RETENTION_NOW:-}" ]]; then
  [[ "$BACKUP_RETENTION_NOW" =~ ^([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z$ ]] || {
    echo "BACKUP_RETENTION_NOW must be a UTC timestamp like 20260917T000000Z." >&2
    exit 1
  }
  now_epoch="$(date -u -d "${BASH_REMATCH[1]}-${BASH_REMATCH[2]}-${BASH_REMATCH[3]} ${BASH_REMATCH[4]}:${BASH_REMATCH[5]}:${BASH_REMATCH[6]}" +%s)"
else
  now_epoch="$(date -u +%s)"
fi

# Prints "family epoch day week" for a recognised archive name (never a sidecar).
classify_archive() {
  local name="$1" family stamp
  if [[ "$name" =~ ^quest-pg17-([0-9]{8}T[0-9]{6}Z)\.dump\.age$ ]]; then
    family=database
  elif [[ "$name" =~ ^quest-media-([0-9]{8}T[0-9]{6}Z)\.tar\.gz\.age$ ]]; then
    family=media
  elif [[ "$name" =~ ^quest-production-([0-9]{8}T[0-9]{6}Z)\.tar\.gz\.enc$ ]]; then
    family=release
  elif [[ "$name" =~ ^quest-adoption-[0-9a-f]{40}-([0-9]{8}T[0-9]{6}Z)\.(dump|media\.tar\.gz)\.age$ ]]; then
    family=cutover
  elif [[ "$name" =~ ^quest-legacy-media-([0-9]{8}T[0-9]{6}Z)\.tar\.gz\.enc$ ]]; then
    family=cutover
  else
    return 1
  fi
  stamp="${BASH_REMATCH[1]}"
  local parsed
  parsed="$(date -u -d "${stamp:0:4}-${stamp:4:2}-${stamp:6:2} ${stamp:9:2}:${stamp:11:2}:${stamp:13:2}" '+%s %G-W%V' 2>/dev/null)" || return 1
  printf '%s %s %s %s\n' "$family" "${parsed% *}" "${stamp:0:8}" "${parsed#* }"
}

declare -A pin_until=()
if [[ -n "${BACKUP_RETENTION_PINS:-}" ]]; then
  while IFS= read -r pin_entry || [[ -n "$pin_entry" ]]; do
    [[ -z "$pin_entry" ]] && continue
    if [[ ! "$pin_entry" =~ ^([A-Za-z0-9._-]+)\ until=([0-9]{4}-[0-9]{2}-[0-9]{2})$ ]]; then
      echo "BACKUP_RETENTION_PINS contains an invalid entry." >&2
      exit 1
    fi
    pin_name="${BASH_REMATCH[1]}"
    pin_date="${BASH_REMATCH[2]}"
    if ! classify_archive "$pin_name" >/dev/null; then
      echo "BACKUP_RETENTION_PINS contains an invalid entry." >&2
      exit 1
    fi
    # A pin holds through the whole UTC day it names.
    pin_epoch="$(date -u -d "$pin_date 23:59:59" +%s 2>/dev/null)" || {
      echo "BACKUP_RETENTION_PINS contains an invalid date." >&2
      exit 1
    }
    pin_until["$pin_name"]="$pin_epoch"
  done <<< "$BACKUP_RETENTION_PINS"
fi

declare -A rehearsal_bound=()
shopt -s nullglob
evidence_directories=("$evidence_root"/rehearsal-evidence*/)
shopt -u nullglob
if (( ${#evidence_directories[@]} > 0 )); then
  evidence_names="$(mktemp)"
  if ! { grep -rhoIE 'quest-production-[0-9]{8}T[0-9]{6}Z\.tar\.gz\.enc' "${evidence_directories[@]}" || [[ $? -eq 1 ]]; } > "$evidence_names"; then
    rm -f -- "$evidence_names"
    echo "Rehearsal evidence could not be read." >&2
    exit 1
  fi
  while IFS= read -r bound_name; do
    rehearsal_bound["$bound_name"]=1
  done < <(sort -u "$evidence_names" | sort -r | head -n "$BACKUP_RETAIN_REHEARSAL_BOUND")
  rm -f -- "$evidence_names"
fi

declare -a remote_labels=()
declare -a remote_values=()
declare -a remote_configs=()
declare -A config_by_label=()
declare -A config_by_resolved_path=()
if [[ -n "${BACKUP_RCLONE_CONFIGS:-}" ]]; then
  while IFS= read -r config_entry || [[ -n "$config_entry" ]]; do
    [[ -z "$config_entry" ]] && continue
    config_label="${config_entry%%=*}"
    config_path="${config_entry#*=}"
    if [[ "$config_entry" != *=* || -z "$config_label" || -z "$config_path" ||
          ! "$config_label" =~ ^[A-Za-z0-9._-]+$ ]]; then
      echo "BACKUP_RCLONE_CONFIGS contains an invalid entry." >&2
      exit 1
    fi
    if [[ -n "${config_by_label[$config_label]+x}" ]]; then
      echo "BACKUP_RCLONE_CONFIGS contains a duplicate label." >&2
      exit 1
    fi
    resolved_config_path="$(realpath "$config_path" 2>/dev/null)" || {
      echo "Rclone configuration is unavailable for remote label: $config_label" >&2
      exit 1
    }
    if [[ ! -r "$resolved_config_path" || -n "${config_by_resolved_path[$resolved_config_path]+x}" ]]; then
      echo "Rclone configuration paths must be readable and unique." >&2
      exit 1
    fi
    config_by_label["$config_label"]="$resolved_config_path"
    config_by_resolved_path["$resolved_config_path"]="$config_label"
  done <<< "$BACKUP_RCLONE_CONFIGS"
fi
remote_entries=''
if [[ -n "${BACKUP_RCLONE_REMOTES+x}" ]]; then
  remote_entries="$BACKUP_RCLONE_REMOTES"
elif [[ -n "${BACKUP_RCLONE_REMOTE:-}" ]]; then
  remote_entries="legacy=${BACKUP_RCLONE_REMOTE}"
  if [[ -n "${BACKUP_RCLONE_CONFIGS:-}" ]]; then
    echo "BACKUP_RCLONE_CONFIGS requires BACKUP_RCLONE_REMOTES." >&2
    exit 1
  fi
  if [[ -z "${RCLONE_CONFIG:-}" ]]; then
    echo "Missing required retention setting: RCLONE_CONFIG" >&2
    exit 1
  fi
  config_by_label[legacy]="$RCLONE_CONFIG"
fi
if [[ -z "$remote_entries" ]]; then
  echo "Missing required retention setting: BACKUP_RCLONE_REMOTES" >&2
  exit 1
fi
while IFS= read -r remote_entry || [[ -n "$remote_entry" ]]; do
  [[ -z "$remote_entry" ]] && continue
  remote_label="${remote_entry%%=*}"
  remote_value="${remote_entry#*=}"
  if [[ "$remote_entry" != *=* || -z "$remote_label" ||
        ! "$remote_label" =~ ^[A-Za-z0-9._-]+$ ||
        ! "$remote_value" =~ ^[A-Za-z0-9._-]+:.+[^/]$ ]]; then
    echo "BACKUP_RCLONE_REMOTES contains an invalid entry." >&2
    exit 1
  fi
  for existing_label in "${remote_labels[@]}"; do
    [[ "$existing_label" == "$remote_label" ]] && {
      echo "BACKUP_RCLONE_REMOTES contains a duplicate label." >&2
      exit 1
    }
  done
  remote_config="${config_by_label[$remote_label]:-}"
  if [[ -z "$remote_config" || ! -r "$remote_config" ]]; then
    echo "Rclone configuration is unavailable for remote label: $remote_label" >&2
    exit 1
  fi
  remote_labels+=("$remote_label")
  remote_values+=("$remote_value")
  remote_configs+=("$remote_config")
done <<< "$remote_entries"
if (( ${#remote_labels[@]} == 0 )); then
  echo "At least one backup remote is required." >&2
  exit 1
fi
if [[ -n "${BACKUP_RCLONE_REMOTES+x}" ]]; then
  for configured_label in "${!config_by_label[@]}"; do
    configured_remote=false
    for remote_label in "${remote_labels[@]}"; do
      [[ "$configured_label" == "$remote_label" ]] && configured_remote=true
    done
    if [[ "$configured_remote" != true ]]; then
      echo "BACKUP_RCLONE_CONFIGS must exactly match BACKUP_RCLONE_REMOTES." >&2
      exit 1
    fi
  done
fi

state_directory="$(mktemp -d)"
trap 'rm -rf -- "$state_directory"' EXIT

gib() { awk -v bytes="$1" 'BEGIN { printf "%.2f GiB", bytes / 1073741824 }'; }

# Lists "size|name" for top-level files; extra arguments select trash views.
list_remote() {
  local remote="$1" config="$2" output="$3"
  shift 3
  rclone lsf "${remote%/}" --config "$config" --files-only --max-depth 1 \
    --format sp --separator '|' "$@" > "$output" 2>/dev/null
}

# Permanently removes trashed backup pairs. A name that is also live is skipped,
# which also makes this a no-op on a backend without a trash (both views match).
empty_backup_trash() {
  local label="$1" remote="$2" config="$3" index="$4"
  local live_listing="$state_directory/live-$index" trash_listing="$state_directory/trash-$index"
  if ! list_remote "$remote" "$config" "$live_listing" ||
     ! list_remote "$remote" "$config" "$trash_listing" --drive-trashed-only; then
    echo "Could not inspect configured backup remote label: $label" >&2
    return 1
  fi
  local -A live=()
  local line name size purged=0 purged_bytes=0 failed=0
  while IFS='|' read -r size name; do [[ -n "$name" ]] && live["$name"]=1; done < "$live_listing"
  while IFS='|' read -r size name; do
    [[ -n "$name" && -z "${live[$name]:-}" ]] || continue
    classify_archive "${name%.sha256}" >/dev/null || continue
    # Never strand a live archive without its checksum.
    [[ "$name" == *.sha256 && -n "${live[${name%.sha256}]:-}" ]] && continue
    if ! rclone deletefile "${remote%/}/$name" --config "$config" \
        --drive-trashed-only --drive-use-trash=false >/dev/null 2>&1; then
      printf 'Could not permanently remove a trashed object for label %s: %s\n' "$label" "$name" >&2
      failed=1
      continue
    fi
    purged=$((purged + 1))
    purged_bytes=$((purged_bytes + size))
  done < "$trash_listing"
  printf 'Permanently removed %s trashed backup objects (%s) for label %s.\n' "$purged" "$(gib "$purged_bytes")" "$label"
  return "$failed"
}

operation_failure=0
policy_failure=0
if [[ -n "${TRASH_CONFIRMATION:-}" ]]; then
  for remote_index in "${!remote_labels[@]}"; do
    empty_backup_trash "${remote_labels[$remote_index]}" "${remote_values[$remote_index]}" \
      "${remote_configs[$remote_index]}" "$remote_index" || operation_failure=1
  done
  exit "$operation_failure"
fi

declare -a plan_files=()
for remote_index in "${!remote_labels[@]}"; do
  label="${remote_labels[$remote_index]}"
  remote="${remote_values[$remote_index]}"
  config="${remote_configs[$remote_index]}"
  listing="$state_directory/listing-$remote_index"
  if ! list_remote "$remote" "$config" "$listing"; then
    echo "Could not inspect configured backup remote label: $label" >&2
    operation_failure=1
    continue
  fi

  declare -A object_size=()
  while IFS='|' read -r size name; do
    [[ -n "$name" ]] && object_size["$name"]="$size"
  done < "$listing"

  records="$state_directory/records-$remote_index"
  : > "$records"
  unrecognised=0
  for name in "${!object_size[@]}"; do
    if [[ "$name" == *.sha256 ]]; then
      if [[ -z "${object_size[${name%.sha256}]+x}" ]]; then
        printf 'Retained a checksum without its archive for label %s: %s\n' "$label" "$name"
      fi
      continue
    fi
    if ! classification="$(classify_archive "$name")"; then
      unrecognised=$((unrecognised + 1))
      continue
    fi
    if [[ -z "${object_size[$name.sha256]+x}" ]]; then
      printf 'Retained an archive without its checksum for label %s: %s\n' "$label" "$name"
      continue
    fi
    read -r family epoch day week <<< "$classification"
    archive_bytes="${object_size[$name]}"
    checksum_bytes="${object_size[$name.sha256]}"
    printf '%s %s %s %s %s %s\n' "$family" "$epoch" "$day" "$week" "$name" \
      "$((archive_bytes + checksum_bytes))" >> "$records"
  done
  (( unrecognised == 0 )) || printf 'Retained %s unrecognised objects for label %s.\n' "$unrecognised" "$label"

  plan="$state_directory/plan-$remote_index"
  : > "$plan"
  declare -A family_seen=() family_kept=() family_deleted=() family_freed=() family_total=()
  declare -A media_days=() media_weeks=() database_weeks=()
  media_day_count=0
  media_week_count=0
  while read -r family epoch day week name bytes; do
    family_seen["$family"]=$(( ${family_seen[$family]:-0} + 1 ))
    family_position="${family_seen[$family]}"
    family_total["$family"]=$(( ${family_total[$family]:-0} + bytes ))
    age_days=$(( (now_epoch - epoch) / 86400 ))
    reasons=()
    pinned_until="${pin_until[$name]:-}"
    if [[ -n "$pinned_until" ]] && (( now_epoch <= pinned_until )); then
      reasons+=("pinned")
    fi
    [[ -n "${rehearsal_bound[$name]:-}" ]] && reasons+=("rehearsal-bound")
    if [[ "$family" != cutover ]] && (( family_position <= BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS )); then
      reasons+=("minimum-recovery-point")
    fi
    case "$family" in
      database)
        if (( age_days < BACKUP_RETAIN_DATABASE_ALL_DAYS )); then
          reasons+=("database-recent")
        elif (( age_days < BACKUP_RETAIN_DATABASE_WEEKLY_DAYS )) && [[ -z "${database_weeks[$week]:-}" ]]; then
          reasons+=("database-weekly")
        fi
        database_weeks["$week"]=1
        ;;
      media)
        if [[ -z "${media_days[$day]:-}" ]]; then
          media_days["$day"]=1
          media_day_count=$((media_day_count + 1))
          (( media_day_count <= BACKUP_RETAIN_MEDIA_DAILY )) && reasons+=("media-daily")
        fi
        if [[ -z "${media_weeks[$week]:-}" ]]; then
          media_weeks["$week"]=1
          media_week_count=$((media_week_count + 1))
          (( media_week_count <= BACKUP_RETAIN_MEDIA_WEEKLY )) && reasons+=("media-weekly")
        fi
        ;;
      release)
        (( age_days < BACKUP_RETAIN_RELEASE_DAYS )) && reasons+=("release-recent")
        ;;
    esac
    if (( ${#reasons[@]} > 0 )); then
      family_kept["$family"]=$(( ${family_kept[$family]:-0} + 1 ))
      printf 'keep %s %s %s\n' "$family" "$name" "$(IFS=,; printf '%s' "${reasons[*]}")" >> "$plan"
    else
      family_deleted["$family"]=$(( ${family_deleted[$family]:-0} + 1 ))
      family_freed["$family"]=$(( ${family_freed[$family]:-0} + bytes ))
      printf 'delete %s %s\n' "$family" "$name" >> "$plan"
    fi
  done < <(sort -k2,2nr -k5,5r "$records")

  printf 'Inspected remote label %s.\n' "$label"
  for family in database media release cutover; do
    [[ -n "${family_seen[$family]:-}" ]] || continue
    printf '  %-8s pairs=%-3s keep=%-3s delete=%-3s frees=%s of %s\n' "$family" "${family_seen[$family]}" \
      "${family_kept[$family]:-0}" "${family_deleted[$family]:-0}" \
      "$(gib "${family_freed[$family]:-0}")" "$(gib "${family_total[$family]}")"
  done
  for family in database media release; do
    kept="${family_kept[$family]:-0}"
    seen="${family_seen[$family]:-0}"
    if (( seen >= BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS && kept < BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS )); then
      echo "Refusing retention for remote label $label: $family would fall below the minimum recovery points." >&2
      policy_failure=1
    fi
  done
  plan_files[$remote_index]="$plan"
  unset object_size family_seen family_kept family_deleted family_freed family_total media_days media_weeks database_weeks
done

if (( policy_failure > 0 || operation_failure > 0 )); then
  exit 1
fi

for remote_index in "${!remote_labels[@]}"; do
  label="${remote_labels[$remote_index]}"
  remote="${remote_values[$remote_index]}"
  config="${remote_configs[$remote_index]}"
  plan="${plan_files[$remote_index]}"
  if [[ "${RETENTION_CONFIRMATION:-}" != PRUNE_QUEST_PRODUCTION ]]; then
    while read -r action family name reasons; do
      if [[ "$action" == keep ]]; then
        printf 'Would keep recovery pair for label %s: %s (%s)\n' "$label" "$name" "$reasons"
      else
        printf 'Would delete recovery pair for label %s: %s and checksum\n' "$label" "$name"
      fi
    done < "$plan"
    continue
  fi
  while read -r action family name reasons; do
    [[ "$action" == delete ]] || continue
    if ! rclone deletefile "${remote%/}/$name" --config "$config" --drive-use-trash=true >/dev/null 2>&1; then
      printf 'Remote retention deletion was incomplete for label %s; the recovery pair was retained: %s\n' "$label" "$name" >&2
      operation_failure=1
      continue
    fi
    if ! rclone deletefile "${remote%/}/$name.sha256" --config "$config" --drive-use-trash=true >/dev/null 2>&1; then
      printf 'Remote retention deletion was incomplete for label %s; the archive was removed but checksum cleanup failed: %s\n' "$label" "$name" >&2
      operation_failure=1
    fi
  done < "$plan"
done

if (( operation_failure > 0 )); then
  exit 1
fi
if [[ "${RETENTION_CONFIRMATION:-}" == PRUNE_QUEST_PRODUCTION ]]; then
  echo "Remote retention completed. Expired pairs are in the remote trash; verify, then run with TRASH_CONFIRMATION=EMPTY_QUEST_BACKUP_TRASH to release the space."
else
  echo "Dry run only. Set RETENTION_CONFIRMATION=PRUNE_QUEST_PRODUCTION for an intentional deletion."
fi
