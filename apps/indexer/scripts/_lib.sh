#!/usr/bin/env bash
# Shared helpers for AgenSea Phase 0 diagnostic probes.
# Loads .env, provides secret masking, address normalisation and rate limiting.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
OUT="$ROOT/apps/indexer/scripts/out"
mkdir -p "$OUT"

if [ -f "$ROOT/.env" ]; then
  set -a; . "$ROOT/.env"; set +a
fi

# BSC_RPC is the live-head RPC (Chainstack) and is required by every probe.
: "${BSC_RPC:?BSC_RPC not set - populate ~/agensea/.env}"

# ALCHEMY_BSC is the HISTORICAL source. Optional at load time so that a missing
# value is reported by P6 as a blocker rather than aborting the whole run.
: "${ALCHEMY_BSC:=}"

# BSCSCAN_KEY is retained only so an existing .env still loads. The BscScan /
# Etherscan path is RULED OUT (see p6_historical_host.sh); nothing reads this.
: "${BSCSCAN_KEY:=}"

# Known constants (verified from github.com/erc-8004/erc-8004-contracts).
# Checksummed forms are for display only. Every comparison, grouping and
# storage path uses the _LC forms - upstream casing is never trusted.
IDENTITY_REGISTRY=0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
REPUTATION_REGISTRY=0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
TOPIC_NEW_FEEDBACK=0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc
TOPIC_FEEDBACK_REVOKED=0x25156fd3288212246d8b008d5921fde376c71ed14ac2e072a506eb06fde6d09d
TOPIC_REGISTERED=0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a
TOPIC_URI_UPDATED=0x3a2c7fffc2cba7582c690e3b82c453ea02a308326a98a3ad7576c606336409fb

# lc <string> -> lowercased. The single normalisation point for addresses,
# topics and any other hex identifier. Rationale: the B402 Bazaar catalogue
# returns the SAME asset address in two different casings, so a case-sensitive
# sort -u or string compare silently double-counts. Normalise on the way IN.
lc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# lc_stream -> lowercase a whole stream (for piping jq output into sort -u).
lc_stream() { tr '[:upper:]' '[:lower:]'; }

# topic_to_addr <32-byte topic> -> lowercased 0x-prefixed 20-byte address.
# Event topics carry addresses right-aligned in 32 bytes.
topic_to_addr() {
  local t
  t="$(lc "${1#0x}")"
  printf '0x%s' "$(printf '%s' "$t" | sed 's/.*\(.\{40\}\)$/\1/')"
}

IDENTITY_REGISTRY_LC="$(lc "$IDENTITY_REGISTRY")"
REPUTATION_REGISTRY_LC="$(lc "$REPUTATION_REGISTRY")"

# mask <secret> -> first 30 chars then "...".
# Never emits the whole value: for inputs of 60 chars or fewer the prefix is
# capped at half the length, so a short secret is not fully revealed by
# a rule written for long ones.
mask() {
  local v="$1" n=30
  [ "${#v}" -le 60 ] && n=$(( ${#v} / 2 ))
  [ "$n" -lt 1 ] && n=1
  printf '%.*s...' "$n" "$v"
}
RPC_MASKED="$(mask "$BSC_RPC")"
KEY_MASKED="$(mask "$BSCSCAN_KEY")"
ALCHEMY_MASKED="$(mask "$ALCHEMY_BSC")"

# Redact any occurrence of a live secret from a stream. Belt and braces:
# nothing reaches a findings file without passing through this. The rule set is
# built only from values that are actually non-empty - an empty needle would
# make sed reuse the previous pattern and corrupt the stream.
REDACT_SED=''
_add_secret() { [ -n "$1" ] && REDACT_SED="${REDACT_SED}s|$1|$(mask "$1")|g;"; return 0; }
_add_secret "$BSC_RPC"
_add_secret "$ALCHEMY_BSC"
_add_secret "$BSCSCAN_KEY"
redact() { if [ -n "$REDACT_SED" ]; then sed -e "$REDACT_SED"; else cat; fi; }

# Rate limiting: <=5 req/s Chainstack, Alchemy free tier is CU/s budgeted and
# eth_getLogs is expensive, so it gets a wider spacing than a plain read.
rl_rpc()     { sleep 0.21; }
rl_alchemy() { sleep 0.30; }

# rpc <method> <params-json> -> raw JSON response body from BSC_RPC (live head)
rpc() {
  rl_rpc
  curl -s --max-time 30 -X POST "$BSC_RPC" \
    -H 'content-type: application/json' \
    --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":$2}"
}

# arpc <method> <params-json> -> raw JSON response body from ALCHEMY_BSC.
# Retries transient rate-limit responses; a substantive JSON-RPC error (range
# too wide, result set too large) is returned to the caller untouched so the
# probe can record the exact error text.
arpc() {
  local i BODY=''
  [ -z "$ALCHEMY_BSC" ] && { printf '%s' '{"error":{"code":0,"message":"ALCHEMY_BSC is not set"}}'; return 0; }
  for i in 1 2 3; do
    rl_alchemy
    BODY="$(curl -s --max-time 60 -X POST "$ALCHEMY_BSC" \
      -H 'content-type: application/json' \
      --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":$2}")"
    # Only back off on an explicit throughput rejection, never on a range error.
    if echo "$BODY" | grep -qiE '"code":[ ]*-?(429|32029)|exceeded its (compute|throughput)|rate limit'; then
      sleep 3; continue
    fi
    break
  done
  printf '%s' "$BODY"
}

hex() { printf '0x%x' "$1"; }

# A literal placeholder is not a credential. Distinguish it from a real key that
# is merely awaiting activation, so probes report the true cause instead of
# retrying a string that can never work.
is_placeholder() {
  echo "$1" | grep -qiE 'paste_|your_|_here|xxx|placeholder|changeme|example'
}
KEY_IS_PLACEHOLDER=no
is_placeholder "$BSCSCAN_KEY" && KEY_IS_PLACEHOLDER=yes

# get_head -> current block number, validated. Retries transient RPC failures
# and hard-fails rather than letting an empty value flow into arithmetic.
get_head() {
  local i h
  for i in 1 2 3 4 5; do
    rl_rpc
    h="$(cast block-number --rpc-url "$BSC_RPC" 2>/dev/null | tr -d '[:space:]')"
    if [[ "$h" =~ ^[0-9]+$ ]] && [ "$h" -gt 0 ]; then printf '%s' "$h"; return 0; fi
    sleep 1
  done
  echo "FATAL: could not read a valid block number after 5 attempts" >&2
  return 1
}

# blocks_30d -> the 30-day block span DERIVED from P4's measured block time.
# No constant is assumed: if P4 did not measure a block time this fails loudly
# rather than substituting a guess.
blocks_30d() {
  local b30 avg
  b30="$(cat "$OUT/p4_blocks30d.txt" 2>/dev/null | tr -d '[:space:]')"
  if [[ "$b30" =~ ^[0-9]+$ ]] && [ "$b30" -gt 0 ]; then printf '%s' "$b30"; return 0; fi
  avg="$(cat "$OUT/p4_blocktime.txt" 2>/dev/null | tr -d '[:space:]')"
  if [[ "$avg" =~ ^[0-9]*\.?[0-9]+$ ]]; then
    awk -v a="$avg" 'BEGIN{ if (a>0) printf "%.0f", 2592000/a }'
    return 0
  fi
  return 1
}

# alchemy_getlogs_chunked <addr> <topic0> <from> <to> <chunk> <outfile>
#
# Walks [from,to] in <chunk>-sized block windows against ALCHEMY_BSC and appends
# each returned log as one compact JSON line to <outfile>. The chunk size must
# come from P6's measured maximum accepted range - it is never guessed here.
#
# The address is lowercased before it goes on the wire and the returned
# log.address is lowercased before it is stored, so a mixed-casing upstream
# cannot produce two identities for one contract.
#
# Progress goes to stderr. Sets, in the caller's shell:
#   GL_CHUNKS - windows actually requested
#   GL_ERRORS - windows that returned a JSON-RPC error
#   GL_CAPPED - 1 if any window hit a provider result-size ceiling
#   GL_LAST_ERR - verbatim text of the last error seen
alchemy_getlogs_chunked() {
  local ADDR TOPIC FROM TO CHUNK OUTFILE
  ADDR="$(lc "$1")"; TOPIC="$(lc "$2")"; FROM="$3"; TO="$4"; CHUNK="$5"; OUTFILE="$6"
  GL_CHUNKS=0; GL_ERRORS=0; GL_CAPPED=0; GL_LAST_ERR=''
  : > "$OUTFILE"
  local S E RESP N EMSG ECODE
  S="$FROM"
  while [ "$S" -le "$TO" ]; do
    E=$(( S + CHUNK - 1 ))
    [ "$E" -gt "$TO" ] && E="$TO"
    RESP="$(arpc eth_getLogs "[{\"address\":\"$ADDR\",\"topics\":[\"$TOPIC\"],\"fromBlock\":\"$(hex $S)\",\"toBlock\":\"$(hex $E)\"}]")"
    GL_CHUNKS=$(( GL_CHUNKS + 1 ))
    if echo "$RESP" | jq -e 'has("error")' >/dev/null 2>&1; then
      ECODE="$(echo "$RESP" | jq -r '.error.code // "?"')"
      EMSG="$(echo "$RESP" | jq -r '.error.message // "?"' | redact)"
      GL_ERRORS=$(( GL_ERRORS + 1 )); GL_LAST_ERR="$EMSG"
      if echo "$EMSG" | grep -qiE 'more than .* results|response size exceeded|too many results|limit exceeded'; then
        GL_CAPPED=1
      fi
      echo "    blocks $S..$E -> ERROR $ECODE: $(echo "$EMSG" | head -c 160)" >&2
    else
      N="$(echo "$RESP" | jq -r 'if (.result|type)=="array" then (.result|length) else -1 end' 2>/dev/null || echo -1)"
      if [ "$N" -lt 0 ]; then
        GL_ERRORS=$(( GL_ERRORS + 1 ))
        GL_LAST_ERR="unparseable response"
        echo "    blocks $S..$E -> UNPARSEABLE" >&2
      else
        # Lowercase address and topics on the way in - never trust upstream casing.
        echo "$RESP" | jq -c '.result[] | .address |= ascii_downcase | .topics |= map(ascii_downcase)' >> "$OUTFILE"
        [ "$N" -gt 0 ] && echo "    blocks $S..$E -> $N logs" >&2
      fi
    fi
    S=$(( E + 1 ))
  done
  return 0
}

# nlines <file> -> number of non-empty lines, 0 for a missing/empty file.
# Replaces `grep -c . f || echo 0`, which emits TWO values when the file is
# empty: grep prints 0 and then exits 1, firing the || branch as well.
nlines() { awk 'NF{n++} END{print n+0}' "$1" 2>/dev/null || echo 0; }
