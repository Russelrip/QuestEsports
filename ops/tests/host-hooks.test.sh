#!/usr/bin/env bash
# Contract test for the production host adapter.
#
# The release controller dispatches by absolute path into /usr/local/sbin, and
# host-hooks.sh dispatches on its own basename. Nothing at runtime proves the
# two halves agree, so a drifted alias would only surface mid-release. This test
# pins the three-way agreement between release.env.example, the alias list, and
# the dispatcher, and exercises the dispatcher's fail-closed guards.
set -Eeuo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
source_hooks="$repository_root/ops/deploy/host-hooks.sh"
source_aliases="$repository_root/ops/deploy/host-hooks.aliases"
source_example="$repository_root/ops/deploy/release.env.example"
failures=0

fail() { printf 'not ok: %s\n' "$*" >&2; failures=$((failures + 1)); }
pass() { printf 'ok: %s\n' "$*"; }

for file in "$source_hooks" "$source_aliases" "$source_example"; do
  [[ -f "$file" ]] || { printf 'missing required file: %s\n' "$file" >&2; exit 1; }
done

sandbox="$(mktemp -d)"
trap 'rm -rf -- "$sandbox"' EXIT

# Work on line-ending-normalised copies so a CRLF checkout cannot mask drift.
for name in hooks aliases example; do
  case "$name" in
    hooks) source_file="$source_hooks" ;;
    aliases) source_file="$source_aliases" ;;
    example) source_file="$source_example" ;;
  esac
  tr -d '\r' < "$source_file" > "$sandbox/$name"
done
hooks="$sandbox/hooks"
aliases="$sandbox/aliases"
example="$sandbox/example"
dispatch="$(sed -n '/^case "\$wrapper" in$/,/^esac$/p' "$hooks")"

bash -n "$hooks" || fail 'host-hooks.sh is not valid bash'

setting_value() { grep -E "^$1=" "$example" | head -n1 | cut -d= -f2- || true; }

# 1. Every alias is dispatched, and every dispatched name is a declared alias.
declared="$(grep -oE '^quest-release-[a-z0-9-]+' "$aliases" | sort -u)"
dispatched="$(grep -oE '^  quest-release-[a-z0-9|-]+\)' <<< "$dispatch" \
  | sed -E 's/^  //; s/\)$//' | tr '|' '\n' | sort -u)"
[[ -n "$declared" ]] || fail 'the alias list is empty'
[[ -n "$dispatched" ]] || fail 'no dispatch branches were found'

missing="$(comm -23 <(printf '%s\n' "$declared") <(printf '%s\n' "$dispatched"))"
[[ -z "$missing" ]] || fail "aliases without a dispatch branch: $(tr '\n' ' ' <<< "$missing")"
extra="$(comm -13 <(printf '%s\n' "$declared") <(printf '%s\n' "$dispatched"))"
[[ -z "$extra" ]] || fail "dispatch branches without a declared alias: $(tr '\n' ' ' <<< "$extra")"
(( failures == 0 )) && pass 'the alias list and dispatcher agree'

# 2. Every alias is reachable from a documented release setting, and the setting
#    named in the alias comment is the one release.env.example actually binds.
bound=0
while read -r alias setting; do
  [[ -n "$setting" ]] || { fail "alias $alias documents no release setting"; continue; }
  configured="$(setting_value "$setting")"
  if [[ -z "$configured" ]]; then
    fail "$setting is not configured in release.env.example"
  elif [[ "$configured" != "/usr/local/sbin/$alias" ]]; then
    fail "$setting points at '$configured', not '/usr/local/sbin/$alias'"
  else
    bound=$((bound + 1))
  fi
done < <(grep -E '^quest-release-[a-z0-9-]+[[:space:]]+#' "$aliases" \
  | sed -E 's/^([a-z0-9-]+)[[:space:]]+#[[:space:]]*//; s/^/&/' \
  | paste -d' ' <(grep -oE '^quest-release-[a-z0-9-]+' "$aliases") -)
(( bound > 0 )) || fail 'no alias was bound to a release setting'
(( failures == 0 )) && pass "every alias is bound to its documented release setting ($bound)"

# 3. Settings the alias list marks unimplemented must have no dispatch branch,
#    so a host that configures one fails closed instead of acting silently.
while read -r unimplemented; do
  configured="$(setting_value "$unimplemented")"
  [[ -n "$configured" ]] || continue
  candidate="$(basename "$configured")"
  if grep -qE "^  ${candidate}[)|]" <<< "$dispatch"; then
    fail "$unimplemented is documented as unimplemented but $candidate is dispatched"
  fi
done < <(sed -n '/Deliberately unimplemented/,$p' "$aliases" | grep -oE '^#   [A-Z][A-Z0-9_]+' | awk '{print $2}')
(( failures == 0 )) && pass 'unimplemented settings have no dispatch branch'

# 4. The dispatcher refuses to run outside its root-owned, canonical contract.
install -m 0755 "$source_hooks" "$sandbox/quest-release-database-health"
output="$(RELEASE_ENV_FILE="$sandbox/release.env" "$sandbox/quest-release-database-health" 2>&1)" && status=0 || status=$?
# Unprivileged runners (CI) stop at the root guard; a root runner reaches the
# canonical-environment guard. Either is a correct fail-closed refusal, but the
# refusal must come from a guard and not from an unrelated error.
if [[ "$(id -u)" == 0 ]]; then expected_guard='canonical release environment'; else expected_guard='root is required'; fi
if (( status == 0 )); then
  fail 'the dispatcher ran with a non-canonical release environment'
elif ! grep -q "$expected_guard" <<< "$output"; then
  fail "the non-canonical release environment was rejected for the wrong reason: $output"
else
  pass "a non-canonical release environment is rejected ($expected_guard)"
fi

install -m 0755 "$source_hooks" "$sandbox/quest-release-unknown-hook"
if RELEASE_ENV_FILE="$sandbox/release.env" "$sandbox/quest-release-unknown-hook" >/dev/null 2>&1; then
  fail 'an unknown hook name was accepted'
else
  pass 'an unknown hook name is rejected'
fi

# 5. Acknowledgements the controller compares byte-for-byte must not drift.
while IFS= read -r acknowledgement; do
  [[ -n "$acknowledgement" ]] || continue
  grep -Fq "$acknowledgement" "$hooks" || fail "the acknowledgement drifted: $acknowledgement"
done <<'ACKS'
ready target=quest-postgres schemas=public,valorant
started-frozen-read-only group=quest
started-frozen-read-only group=valorant
captured evidence_bundle=%s
migrated image=%s target=quest-postgres schema=%s repository=%s
verified-complete release_sha=%s schemas=verified:public,valorant uploads=verified:public,private archive=verified checksum=verified remote=verified
target=quest-postgres schema=public repository=quest
target=quest-postgres schema=valorant repository=valorant
ACKS
for token in frozen-read-only security-verified admitted stopped armed acknowledged validation off; do
  grep -Fq "'%s\\n' $token" "$hooks" || fail "the acknowledgement token is not emitted: $token"
done
(( failures == 0 )) && pass 'controller acknowledgements are intact'

# 6. The migration-status hooks must always exit zero once they have decided,
#    because the controller treats a non-zero exit as a hook failure rather than
#    as pending migrations.
for branch in quest-release-quest-migration-status quest-release-valorant-migration-status; do
  body="$(awk -v want="  $branch)" '$0 == want { capture = 1; next } capture && /^    ;;$/ { exit } capture' <<< "$dispatch")"
  [[ -n "$body" ]] || { fail "$branch has no dispatch body"; continue; }
  if grep -qE '^\s*\[\[ "\$state" == none \]\]\s*$' <<< "$body"; then
    fail "$branch exits non-zero when migrations are pending"
  fi
done
(( failures == 0 )) && pass 'migration status hooks report pending without failing'

if (( failures > 0 )); then
  printf '%s host hook contract check(s) failed.\n' "$failures" >&2
  exit 1
fi
printf 'host hook contracts passed.\n'
