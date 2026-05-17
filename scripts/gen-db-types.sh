#!/usr/bin/env bash
# Generate TypeScript types from your Supabase schema.
#
# Steps:
#   1. Get your access token at: https://supabase.com/dashboard/account/tokens
#   2. Set it: export SUPABASE_ACCESS_TOKEN=<your-token>
#   3. Run: bash scripts/gen-db-types.sh
#
# The output goes to lib/supabase/database.types.ts
# Then update lib/supabase/client.ts, server.ts, route.ts, admin.ts to use:
#   createBrowserClient<Database>(url, key)
#   createServerClient<Database>(url, key, ...)

set -e

PROJECT_ID="fcttmxwyojeemigdjsmz"
OUT="lib/supabase/database.types.ts"

if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
  echo "Error: SUPABASE_ACCESS_TOKEN is not set."
  echo "Get one at: https://supabase.com/dashboard/account/tokens"
  exit 1
fi

echo "Generating types for project $PROJECT_ID..."
npx supabase gen types typescript --project-id "$PROJECT_ID" > "$OUT"
echo "Done → $OUT"
