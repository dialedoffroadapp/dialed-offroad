#!/bin/bash
# scripts/engine-tools/pull_captured.sh
# Pull every captured baseline call (input + gpt-4o-mini output) from the
# dev-3-0 preview branch (a prod data clone) into results/captured_baselines.json
# for shadow_compare.ts (the permanent baseline regression script). Read-only. The file holds rider free text and coarse
# locations: it stays under results/ (untracked) and is never committed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PW_FILE="${BRANCH_DB_PASSWORD_FILE:-$HOME/.supabase/dialed-dev-3-0-db-password}"
PW="${BRANCH_DB_PASSWORD:-$(cat "$PW_FILE")}"
mkdir -p "$HERE/results"
PGPASSWORD="$PW" /opt/homebrew/opt/libpq/bin/psql \
  "host=aws-0-us-west-1.pooler.supabase.com port=5432 dbname=postgres user=postgres.rxbagshvbavrqtirprdz sslmode=require" \
  -A -t -c "select coalesce(json_agg(json_build_object('id', id, 'created_at', created_at, 'input', input, 'output', output) order by id), '[]'::json) from public.tune_calls where mode = 'zero_baseline_v1' and input is not null and output is not null;" \
  > "$HERE/results/captured_baselines.json"
python3 -c "import json,sys; d=json.load(open('$HERE/results/captured_baselines.json')); print(f'{len(d)} captured baselines written')"
