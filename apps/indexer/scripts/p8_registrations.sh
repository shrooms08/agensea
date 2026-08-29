#!/usr/bin/env bash
# P8 - registration volume. Registered events on IdentityRegistry, read from
#      ALCHEMY_BSC over the exact same window P7 used, so the ratio is
#      like-for-like. Ratio vs P7's distinct agent count.
set -uo pipefail
. "$(dirname "$0")/_lib.sh"

echo "## P8"
echo

HOST="$(cat "$OUT/p6_working_host.txt" 2>/dev/null | tr -d '[:space:]' || echo none)"
MAXSPAN="$(cat "$OUT/p6_maxspan.txt"   2>/dev/null | tr -d '[:space:]' || echo 0)"
SPAN="$(cat "$OUT/p7_span.txt"         2>/dev/null | tr -d '[:space:]' || echo 0)"
FROM="$(cat "$OUT/p7_from.txt"         2>/dev/null | tr -d '[:space:]' || echo 0)"
TO="$(cat   "$OUT/p7_to.txt"           2>/dev/null | tr -d '[:space:]' || echo 0)"
AGENTS="$(cat "$OUT/p7_distinct_agents.txt" 2>/dev/null | tr -d '[:space:]' || echo 0)"

if [ "$HOST" != "alchemy" ] || [ "${SPAN:-0}" -le 0 ] || [ "${MAXSPAN:-0}" -le 0 ]; then
  echo '```'
  echo "skipped: no usable historical source from P6, or no window from P7"
  echo "  p6 working host : ${HOST:-none}"
  echo "  p6 max span     : ${MAXSPAN:-0} blocks"
  echo "  p7 window span  : ${SPAN:-0} blocks"
  echo '```'
  echo
  : > "$OUT/p8_agentids.txt"
  echo "**Conclusion:** cannot run - depends on P6 (historical source) and P7 (coverage window). BLOCKED."
  exit 1
fi

AVG="$(cat "$OUT/p4_blocktime.txt" 2>/dev/null | tr -d '[:space:]')"
B30="$(blocks_30d || echo 0)"
PCT="$(awk -v s="$SPAN" -v b="$B30" 'BEGIN{printf "%.1f", (b>0? 100*s/b : 0)}')"

echo '```'
echo "source          : ALCHEMY_BSC ($ALCHEMY_MASKED)"
echo "contract        : $IDENTITY_REGISTRY_LC  (lowercased for the wire and for storage)"
echo "chunk size      : $MAXSPAN blocks   <- P6 measured maximum accepted range"
echo "COVERAGE WINDOW : $SPAN blocks  ($FROM .. $TO)   <- identical to P7"
echo "                  = ${PCT}% of the 30-day target ($B30 blocks at P4's measured ${AVG:-?}s/block)"
echo "requests for 30d: $(cat "$OUT/p6_req30d.txt" 2>/dev/null || echo n/a) at this chunk size"
echo
echo "\$ curl -s -X POST \"$ALCHEMY_MASKED\" -d '{\"method\":\"eth_getLogs\",\"params\":[{\"address\":\"$IDENTITY_REGISTRY_LC\",\"topics\":[\"$TOPIC_REGISTERED\"],\"fromBlock\":\"...\",\"toBlock\":\"...\"}]}'"
echo
echo "-- Registered --"
alchemy_getlogs_chunked "$IDENTITY_REGISTRY_LC" "$TOPIC_REGISTERED" "$FROM" "$TO" "$MAXSPAN" "$OUT/p8_registered.ndjson"
RG_CHUNKS=$GL_CHUNKS; RG_ERRORS=$GL_ERRORS; RG_CAPPED=$GL_CAPPED; RG_ERR="$GL_LAST_ERR"
echo "  chunks=$RG_CHUNKS errors=$RG_ERRORS"

TOTAL=$(nlines "$OUT/p8_registered.ndjson")

# topic1 = agentId. Lowercased before sort -u so one id in two casings is one group.
jq -r '.topics[1] // empty' "$OUT/p8_registered.ndjson" 2>/dev/null \
  | lc_stream | sort -u > "$OUT/p8_agentids.txt"
DISTINCT_REG=$(nlines "$OUT/p8_agentids.txt")

BADADDR=$(jq -r '.address' "$OUT/p8_registered.ndjson" 2>/dev/null | grep -v "^$IDENTITY_REGISTRY_LC$" | awk 'END{print NR+0}')

# Overlap is computed on the lowercased id sets from both probes.
OVERLAP=0
if [ -s "$OUT/p7_agentids.txt" ] && [ -s "$OUT/p8_agentids.txt" ]; then
  OVERLAP=$(comm -12 "$OUT/p7_agentids.txt" "$OUT/p8_agentids.txt" | awk 'NF{n++} END{print n+0}')
fi

if [ "${AGENTS:-0}" -gt 0 ]; then
  RATIO="$(awk -v r="$TOTAL" -v a="$AGENTS" 'BEGIN{printf "%.3f", r/a}')"
else
  RATIO="undefined (P7 distinct agent count is 0)"
fi

echo
echo "total Registered events        : $TOTAL"
echo "distinct agentId in Registered : $DISTINCT_REG"
echo "P7 distinct agents w/ feedback : $AGENTS"
echo "agentIds in BOTH P7 and P8     : $OVERLAP"
echo "ratio registrations : P7 agents = $RATIO"
echo "logs with unexpected addr      : $BADADDR  (address normalisation check)"
echo "chunk errors                   : $RG_ERRORS"
[ -n "$RG_ERR" ] && echo "last error                     : $RG_ERR"
echo "provider result cap hit        : $([ "$RG_CAPPED" -eq 1 ] && echo YES || echo no)"
echo '```'
echo

NOTE=""
[ "$RG_CAPPED" -eq 1 ] && NOTE=" Count is a LOWER BOUND - a provider result-size ceiling was hit."
[ "$RG_ERRORS" -gt 0 ] && NOTE="$NOTE $RG_ERRORS chunk(s) errored, so some blocks in the window went unread."

echo "**Conclusion:** **$TOTAL Registered** events (**$DISTINCT_REG distinct agentIds**) over the same **$SPAN-block** window ($FROM .. $TO), against **$AGENTS** agents that received feedback in P7 - ratio **$RATIO**, with **$OVERLAP** agentIds appearing in both sets. A high ratio means most registered agents have no reputation activity.${NOTE} All agentIds were lowercased before grouping and set comparison."
