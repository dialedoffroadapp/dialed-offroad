#!/usr/bin/env bash
# scripts/dev-branch.sh — stand up (or refresh) the Supabase preview branch
# used for the 3.0 device pass. Production is never written: every remote
# call below carries the branch's own project ref or database URL, and the
# script refuses to continue if the branch ref ever resolves to prod.
#
# Requires: the Supabase org on the Pro plan (branching is a Pro feature;
# the Free plan returns 402 "entitlement_required"), supabase CLI >= 2.109
# logged in and linked to prod (urqpiwxapckaiorvdvfi), python3.
#
# Usage: scripts/dev-branch.sh [branch-name]     (default: dev-3-0)
#
# What it does, in order:
#   1. creates a PERSISTENT branch cloned WITH production data (schema, rows,
#      auth users, and the migration history table) in prod's region
#   2. waits until the branch database reports ACTIVE_HEALTHY
#   3. applies every migration missing from the branch's history, i.e. the
#      staged 3.0 batch, in file order (dry run printed first)
#   4. deploys ai-tune to the branch (the only edge function the reveal calls)
#      and lists the branch's secrets so a missing OPENAI_API_KEY is visible
#   5. writes .env.branch with the branch's EXPO_PUBLIC_SUPABASE_URL and
#      EXPO_PUBLIC_SUPABASE_ANON_KEY (swap it into .env to point the dev
#      client at the branch; keep .env.prod as the way back)
set -euo pipefail
NAME="${1:-dev-3-0}"
PROD_REF="urqpiwxapckaiorvdvfi"
REGION="us-west-1"
cd "$(dirname "$0")/.."
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

json_field() { python3 -c "import sys,json; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }

branch_id() {
  supabase branches list --output-format json \
    | json_field "next((b.get('id') for b in d.get('branches', []) if b.get('name') == '$NAME'), '')"
}

# 1. create once
ID="$(branch_id)"
if [ -z "$ID" ]; then
  echo "creating persistent data-cloned branch '$NAME' in $REGION"
  supabase branches create "$NAME" --persistent --with-data --region "$REGION" --size micro --yes
  ID="$(branch_id)"
fi
[ -n "$ID" ] || { echo "branch '$NAME' not found after create"; exit 1; }

# 2. wait for health. `branches get` answers "primary database not found"
#    while the branch is still provisioning (non-zero exit, which set -e
#    would turn into a silent abort), so poll the LIST endpoint by name and
#    read preview_project_status from it; call `get` only once healthy.
branch_row() {
  supabase branches list --output-format json \
    | json_field "__import__('json').dumps(next((b for b in d.get('branches', []) if b.get('name') == '$NAME'), {}))"
}
STATUS=""
for _ in $(seq 1 120); do
  ROW="$(branch_row || echo '{}')"
  STATUS="$(printf '%s' "$ROW" | json_field "d.get('preview_project_status') or d.get('status') or ''")"
  [ "$STATUS" = "ACTIVE_HEALTHY" ] && break
  echo "branch status: ${STATUS:-unknown} (waiting 10 s)"
  sleep 10
done
[ "$STATUS" = "ACTIVE_HEALTHY" ] || { echo "branch never became healthy (last: $STATUS)"; exit 1; }
BRANCH_REF="$(printf '%s' "$ROW" | json_field "d.get('project_ref', '')")"

# 3. connection details (key names vary by CLI version; match by pattern)
supabase branches get "$ID" -o env > "$SCRATCH/branch.env"
DB_URL="$(grep -E '^(POSTGRES_URL|DATABASE_URL|DB_URL)=' "$SCRATCH/branch.env" | head -1 | cut -d= -f2- | tr -d '"')"
API_URL="$(grep -E '^(SUPABASE_URL|API_URL)=' "$SCRATCH/branch.env" | head -1 | cut -d= -f2- | tr -d '"')"
ANON="$(grep -E '^(SUPABASE_ANON_KEY|ANON_KEY)=' "$SCRATCH/branch.env" | head -1 | cut -d= -f2- | tr -d '"')"
[ -n "$BRANCH_REF" ] && [ "$BRANCH_REF" != "$PROD_REF" ] || { echo "refusing: branch ref '$BRANCH_REF' is empty or equals prod"; exit 1; }
[ -n "$DB_URL" ] && [ -n "$API_URL" ] && [ -n "$ANON" ] || { echo "could not read branch env; raw keys were:"; cut -d= -f1 "$SCRATCH/branch.env"; exit 1; }
# The password the API hands back for a data-cloned branch does not authenticate
# at the pooler (observed 2026-09-04), and the direct host is IPv6-only. So the
# branch's real password lives in a gitignored local file (written after a
# branch-scoped Management API reset) or BRANCH_DB_PASSWORD, and is spliced
# into the pooler URL here. The pooler user is postgres.<branch ref>.
PW_FILE="supabase/.temp/$NAME-db-password"
[ -f "$PW_FILE" ] || PW_FILE="$HOME/.supabase/dialed-$NAME-db-password"
PW="${BRANCH_DB_PASSWORD:-}"
[ -n "$PW" ] || { [ -f "$PW_FILE" ] && PW="$(cat "$PW_FILE")"; }
if [ -n "$PW" ]; then
  DB_URL="$(printf '%s' "$DB_URL" | python3 -c "
import sys, re, urllib.parse
u = sys.stdin.read().strip(); pw = urllib.parse.quote(sys.argv[1], safe='')
print(re.sub(r'^(postgres(?:ql)?://[^:]+:)[^@]*(@)', lambda m: m.group(1) + pw + m.group(2), u))" "$PW")"
else
  echo "note: no $PW_FILE and no BRANCH_DB_PASSWORD; using the API-supplied password (may fail at the pooler)"
fi
# db push needs a SESSION-mode connection: the transaction pooler on 6543
# rejects the CLI's prepared statements ("prepared statement ... already
# exists", SQLSTATE 42P05, observed 2026-09-04). Same host and tenant user,
# port 5432.
DB_URL="$(printf '%s' "$DB_URL" | sed -E 's#(pooler\.supabase\.com):6543/#\1:5432/#')"
case "$DB_URL" in *"$PROD_REF"*) echo "refusing: db url points at prod"; exit 1;; esac

echo "== migration history on the branch (before)"
supabase migration list --db-url "$DB_URL"
echo "== dry run"
supabase db push --db-url "$DB_URL" --dry-run
echo "== applying"
supabase db push --db-url "$DB_URL" --yes
echo "== migration history on the branch (after)"
supabase migration list --db-url "$DB_URL"

# 4. edge function the reveal needs
supabase functions deploy ai-tune --project-ref "$BRANCH_REF" --use-api
echo "== branch secrets (set OPENAI_API_KEY here if it is missing: supabase secrets set OPENAI_API_KEY=... --project-ref $BRANCH_REF)"
supabase secrets list --project-ref "$BRANCH_REF"

# 5. env for the dev client
cat > .env.branch <<ENV
# Supabase preview branch '$NAME' (ref $BRANCH_REF). Generated by scripts/dev-branch.sh.
# To use: cp .env .env.prod && (grep -v '^EXPO_PUBLIC_SUPABASE_' .env.prod; cat .env.branch) > .env && npx expo start -c
EXPO_PUBLIC_SUPABASE_URL=$API_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY=$ANON
ENV
echo "wrote .env.branch (ref $BRANCH_REF, $API_URL)"
