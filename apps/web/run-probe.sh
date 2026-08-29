#!/usr/bin/env bash
# Boot the probe with SUPABASE_URL / SUPABASE_ANON_KEY from the repo-root .env.
# The service key is deliberately NOT exported.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export SUPABASE_URL=$(grep '^SUPABASE_URL=' "$ROOT/.env" | cut -d= -f2-)
export SUPABASE_ANON_KEY=$(grep '^SUPABASE_ANON_KEY=' "$ROOT/.env" | cut -d= -f2-)
exec "$@"
