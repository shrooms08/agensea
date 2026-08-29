#!/usr/bin/env bash
# P6 - historical log source. CRITICAL: establishes whether ALCHEMY_BSC can
#      serve eth_getLogs over historical block ranges, and what the maximum
#      accepted range is.
#
# The BscScan / Etherscan REST path is RULED OUT and is NOT probed here. It is
# recorded below as a negative result with the exact rejection strings observed.
# Do not reintroduce it as a primary path.
set -uo pipefail
. "$(dirname "$0")/_lib.sh"

echo "## P6"
echo

# --- ruled-out sources, recorded not re-probed -------------------------------
echo "### Ruled-out historical sources"
echo
echo "These were probed in earlier runs and are recorded here as negative results."
echo "They are NOT retried: each failure is a plan/policy rejection, not a transient."
echo
echo '```'
cat <<'RULED'
api.bscscan.com (V1 REST)
  -> NOTOK; V1 is deprecated and returns a migration message.

api.etherscan.io/v2 (chainid=56)
  -> NOTOK; "Free API access is not supported for this chain."
     BSC is paywalled on the free Etherscan plan.

Free public BSC RPCs, historical eth_getLogs:
  bsc-rpc.publicnode.com          -> archive requires an Allnodes token
  bsc.drpc.org                    -> public rate limit
  bsc.blockrazor.xyz              -> "log query range must not exceed 25 blocks"
  1rpc.io/bnb                     -> "eth_getLogs is limited to 0 - 50 blocks range"
  bsc-mainnet.public.blastapi.io  -> Alchemy public rate limit
RULED
echo '```'
echo

# --- credential present? -----------------------------------------------------
echo "### ALCHEMY_BSC"
echo
if [ -z "$ALCHEMY_BSC" ]; then
  echo '```'
  echo "ALCHEMY_BSC is not set in $ROOT/.env"
  echo
  echo "Keys currently present in .env:"
  awk -F= 'NF && $0 !~ /^[[:space:]]*#/ {printf "  %s\n", $1}' "$ROOT/.env" 2>/dev/null
  echo
  echo "No request was sent: there is no endpoint URL to send it to."
  echo '```'
  echo
  echo "none" > "$OUT/p6_working_host.txt"
  echo "0"    > "$OUT/p6_maxspan.txt"
  echo "**Conclusion:** P6 could not run - \`ALCHEMY_BSC\` is absent from \`.env\`. Every other historical source is ruled out above, so there is currently NO usable historical-log source. BLOCKED on populating \`ALCHEMY_BSC\` with a BNB Smart Chain mainnet endpoint URL."
  exit 1
fi

if is_placeholder "$ALCHEMY_BSC"; then
  echo '```'
  echo "ALCHEMY_BSC in .env is the literal placeholder \"$ALCHEMY_MASKED\" - not an endpoint."
  echo "No request was sent."
  echo '```'
  echo
  echo "none" > "$OUT/p6_working_host.txt"
  echo "0"    > "$OUT/p6_maxspan.txt"
  echo "**Conclusion:** P6 could not run - \`ALCHEMY_BSC\` is an unfilled placeholder. BLOCKED."
  exit 1
fi

echo '```'
echo "endpoint (masked): $ALCHEMY_MASKED"
echo

# --- chain identity: never trust an endpoint to be the chain we think --------
CID_RAW="$(arpc eth_chainId '[]' | redact)"
CID_HEX="$(echo "$CID_RAW" | jq -r '.result // empty' 2>/dev/null)"
CID_DEC=""
[ -n "$CID_HEX" ] && CID_DEC="$(printf '%d' "$CID_HEX" 2>/dev/null || echo '')"
echo "\$ curl -s -X POST \"$ALCHEMY_MASKED\" -d '{\"method\":\"eth_chainId\"}'"
echo "  raw: $(echo "$CID_RAW" | tr -d '\n' | head -c 200)"
echo "  chainId: ${CID_DEC:-UNPARSEABLE} (expected 56 = BNB Smart Chain mainnet)"
if [ "${CID_DEC:-0}" != "56" ]; then
  echo
  echo "endpoint is not BSC mainnet - aborting before any range probe"
  echo '```'
  echo
  echo "none" > "$OUT/p6_working_host.txt"
  echo "0"    > "$OUT/p6_maxspan.txt"
  echo "**Conclusion:** \`ALCHEMY_BSC\` responds but reports chainId **${CID_DEC:-unparseable}**, not 56. It is not a BNB Smart Chain mainnet endpoint, so its logs would describe the wrong chain. BLOCKED."
  exit 1
fi
echo

# --- head + 30-day anchor, derived from P4's MEASURED block time -------------
AHEAD_RAW="$(arpc eth_blockNumber '[]' | redact)"
AHEAD_HEX="$(echo "$AHEAD_RAW" | jq -r '.result // empty' 2>/dev/null)"
if [ -z "$AHEAD_HEX" ]; then
  echo "eth_blockNumber failed on ALCHEMY_BSC: $(echo "$AHEAD_RAW" | tr -d '\n' | head -c 300)"
  echo '```'
  echo
  echo "none" > "$OUT/p6_working_host.txt"; echo "0" > "$OUT/p6_maxspan.txt"
  echo "**Conclusion:** \`ALCHEMY_BSC\` could not return a block number. BLOCKED."
  exit 1
fi
AHEAD="$(printf '%d' "$AHEAD_HEX")"

B30="$(blocks_30d)" || {
  echo "P4 did not produce a measured block time - refusing to assume one"
  echo '```'
  echo
  echo "none" > "$OUT/p6_working_host.txt"; echo "0" > "$OUT/p6_maxspan.txt"
  echo "**Conclusion:** the 30-day anchor must be DERIVED from P4's measured block time, and P4 produced none. No constant is substituted. BLOCKED on P4."
  exit 1
}
AVG="$(cat "$OUT/p4_blocktime.txt" 2>/dev/null | tr -d '[:space:]')"
ANCHOR=$(( AHEAD - B30 ))

echo "alchemy head : $AHEAD"
echo "P4 block time: ${AVG:-?} s/block (MEASURED, not assumed)"
echo "30d span     : $B30 blocks  (2592000s / ${AVG:-?}s)"
echo "anchor block : $ANCHOR  (head - 30d) - all range probes start here, so"
echo "               they test genuinely HISTORICAL access, not just the tip."
echo

# --- doubling search for the maximum accepted eth_getLogs range --------------
# Ladder is fixed and ascending; the first failure stops the search and its
# exact error text is recorded verbatim.
echo "--- eth_getLogs range ladder (address=ReputationRegistry, topic0=NewFeedback) ---"
: > "$OUT/p6_ladder.txt"
MAXSPAN=0
FIRST_FAIL_SPAN=""
FIRST_FAIL_TEXT=""
FIRST_FAIL_CODE=""

for SPAN in 100 500 1000 5000 10000 50000; do
  F=$ANCHOR
  T=$(( F + SPAN - 1 ))   # inclusive: SPAN blocks, matching the chunker's slicing
  RESP="$(arpc eth_getLogs "[{\"address\":\"$REPUTATION_REGISTRY_LC\",\"topics\":[\"$TOPIC_NEW_FEEDBACK\"],\"fromBlock\":\"$(hex $F)\",\"toBlock\":\"$(hex $T)\"}]" | redact)"
  if echo "$RESP" | jq -e 'has("error")' >/dev/null 2>&1; then
    ECODE="$(echo "$RESP" | jq -r '.error.code // "?"')"
    EMSG="$(echo "$RESP"  | jq -r '.error.message // "?"')"
    echo "span=$SPAN  blocks $F..$T  -> ERROR code=$ECODE"
    echo "           message: $EMSG"
    echo "$SPAN=ERROR:$ECODE:$EMSG" >> "$OUT/p6_ladder.txt"
    FIRST_FAIL_SPAN="$SPAN"; FIRST_FAIL_TEXT="$EMSG"; FIRST_FAIL_CODE="$ECODE"
    break
  fi
  N="$(echo "$RESP" | jq -r 'if (.result|type)=="array" then (.result|length) else "n/a" end' 2>/dev/null || echo 'n/a')"
  if [ "$N" = "n/a" ]; then
    echo "span=$SPAN  blocks $F..$T  -> UNPARSEABLE: $(echo "$RESP" | tr -d '\n' | head -c 300)"
    echo "$SPAN=UNPARSEABLE" >> "$OUT/p6_ladder.txt"
    FIRST_FAIL_SPAN="$SPAN"; FIRST_FAIL_TEXT="unparseable response"; FIRST_FAIL_CODE="n/a"
    break
  fi
  echo "span=$SPAN  blocks $F..$T  -> OK  logs=$N"
  echo "$SPAN=OK:$N" >> "$OUT/p6_ladder.txt"
  MAXSPAN=$SPAN
done


# The ascending ladder starts at 100. If even that is rejected, the provider
# still accepts SOMETHING - the brief requires the coverage window be set to
# whatever that is. Probe downward and MEASURE it rather than parsing the size
# out of the provider's error message.
if [ "$MAXSPAN" -eq 0 ]; then
  echo
  echo "--- lowest ladder rung rejected; descending probe for the range that IS accepted ---"
  for SPAN in 50 25 10 5 1; do
    F=$ANCHOR
    T=$(( F + SPAN - 1 ))
    RESP="$(arpc eth_getLogs "[{\"address\":\"$REPUTATION_REGISTRY_LC\",\"topics\":[\"$TOPIC_NEW_FEEDBACK\"],\"fromBlock\":\"$(hex $F)\",\"toBlock\":\"$(hex $T)\"}]" | redact)"
    if echo "$RESP" | jq -e 'has("error")' >/dev/null 2>&1; then
      echo "span=$SPAN  blocks $F..$T  -> ERROR $(echo "$RESP" | jq -r '.error.code // "?"'): $(echo "$RESP" | jq -r '.error.message // "?"' | head -c 140)"
      echo "$SPAN=ERROR" >> "$OUT/p6_ladder.txt"
      continue
    fi
    N="$(echo "$RESP" | jq -r 'if (.result|type)=="array" then (.result|length) else -1 end' 2>/dev/null || echo -1)"
    if [ "$N" -ge 0 ]; then
      echo "span=$SPAN  blocks $F..$T  -> OK  logs=$N"
      echo "$SPAN=OK:$N" >> "$OUT/p6_ladder.txt"
      MAXSPAN=$SPAN
      break
    fi
  done
fi

echo
echo "max accepted span: $MAXSPAN blocks"
if [ -n "$FIRST_FAIL_SPAN" ]; then
  echo "first failing span: $FIRST_FAIL_SPAN"
  echo "first failure code: $FIRST_FAIL_CODE"
  echo "first failure text (verbatim):"
  echo "  $FIRST_FAIL_TEXT"
else
  echo "no span in the ladder was rejected - the true cap is at or above 50000"
fi
echo '```'
echo

if [ "$MAXSPAN" -gt 0 ]; then
  echo "alchemy" > "$OUT/p6_working_host.txt"
else
  echo "none"    > "$OUT/p6_working_host.txt"
fi
echo "$MAXSPAN" > "$OUT/p6_maxspan.txt"

# Requests needed to walk a full 30 days at the accepted range - the number that
# decides whether backfill is feasible at all.
REQ30="n/a"
[ "$MAXSPAN" -gt 0 ] && REQ30="$(awk -v b="$B30" -v m="$MAXSPAN" 'BEGIN{printf "%d", (b+m-1)/m}')"
echo "$REQ30" > "$OUT/p6_req30d.txt"

if [ "$MAXSPAN" -eq 0 ]; then
  echo "**Conclusion:** \`ALCHEMY_BSC\` is a valid chain-56 endpoint but REFUSED every probed historical range, down to a single block, at block $ANCHOR with code $FIRST_FAIL_CODE: \"$FIRST_FAIL_TEXT\". Every alternative source is ruled out above. No historical backfill is possible. BLOCKED - and per the run brief no further provider hunt is performed."
elif [ "$MAXSPAN" -lt 100 ]; then
  echo "**Conclusion:** \`ALCHEMY_BSC\` is a valid chain-56 endpoint and DOES serve historical logs, but the free tier caps \`eth_getLogs\` at a **$MAXSPAN-block** range: 100 blocks is rejected with code $FIRST_FAIL_CODE - \"$FIRST_FAIL_TEXT\" - and $MAXSPAN blocks is the largest span that succeeded on the descending probe. At that cap a full 30-day backfill ($B30 blocks, derived from P4's measured ${AVG:-?}s/block) needs **$REQ30 sequential requests**, which is not feasible on the free tier. This is a BLOCKER for 30-day coverage. Per the run brief no further provider hunt is performed; P7/P8 proceed against the $MAXSPAN-block range that IS accepted and state their true coverage explicitly."
elif [ -n "$FIRST_FAIL_SPAN" ]; then
  echo "**Conclusion:** \`ALCHEMY_BSC\` serves historical logs. Maximum accepted eth_getLogs range is **$MAXSPAN blocks**; $FIRST_FAIL_SPAN blocks is rejected with code $FIRST_FAIL_CODE: \"$FIRST_FAIL_TEXT\". Historical backfill must chunk requests at <= $MAXSPAN blocks. The BscScan/Etherscan REST path stays ruled out."
else
  echo "**Conclusion:** \`ALCHEMY_BSC\` serves historical logs and accepted every probed range up to **$MAXSPAN blocks** without error, so the true cap is at or above 50000. Historical backfill must still chunk at <= $MAXSPAN blocks, the largest span actually demonstrated. The BscScan/Etherscan REST path stays ruled out."
fi

# The host works, but a sub-100-block cap blocks 30-day coverage outright.
# Exit non-zero so run_all records it in Blockers; P7/P8 still run against the
# range that IS accepted (run_all only halts on stop-the-world probes).
if [ "$MAXSPAN" -gt 0 ] && [ "$MAXSPAN" -lt 100 ]; then exit 1; fi
exit 0
