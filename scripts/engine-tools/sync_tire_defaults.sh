#!/usr/bin/env bash
# The tire pressure table lives server-side (supabase/functions/ai-tune/
# tire_defaults.json, the single source of truth). The client's offline
# fallback imports a GENERATED copy; run this after editing the server file.
# __tests__/tirePlan.test.ts fails when the two drift.
set -euo pipefail
cd "$(dirname "$0")/../.."
cp supabase/functions/ai-tune/tire_defaults.json lib/generated/tireDefaults.json
echo "lib/generated/tireDefaults.json synced from supabase/functions/ai-tune/tire_defaults.json"
