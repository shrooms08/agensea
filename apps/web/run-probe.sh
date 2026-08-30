#!/usr/bin/env bash
# Boot the probe with SUPABASE_URL / SUPABASE_ANON_KEY from the repo-root .env.
# The service key is deliberately NOT exported.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export SUPABASE_URL=$(grep '^SUPABASE_URL=' "$ROOT/.env" | cut -d= -f2-)
export ALCHEMY_BSC=$(grep '^ALCHEMY_BSC=' "$ROOT/.env" | cut -d= -f2-)
export SUPABASE_ANON_KEY=$(grep '^SUPABASE_ANON_KEY=' "$ROOT/.env" | cut -d= -f2-)
export DEMO_BUYER_KEY=$(tr -d '[:space:]' < "$ROOT/.secrets/buyer.key")
export DEMO_SESSION_KEY_2012=$(tr -d '[:space:]' < "$ROOT/.secrets/agent1-session.key")
export DEMO_SESSION_KEY_2013=$(tr -d '[:space:]' < "$ROOT/.secrets/agent2-session.key")
export DEMO_SESSION_KEY_2014=$(tr -d '[:space:]' < "$ROOT/.secrets/agent3-session.key")
export DEMO_SESSION_KEY_2015=$(tr -d '[:space:]' < "$ROOT/.secrets/agent4-session.key")
exec "$@"
