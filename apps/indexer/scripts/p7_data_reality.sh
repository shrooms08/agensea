#!/usr/bin/env bash
# P7 - data reality check. NewFeedback + FeedbackRevoked on ReputationRegistry,
#      read from ALCHEMY_BSC via chunked eth_getLogs. Zero is a valid finding.
#
# Coverage window: 30 days DERIVED from P4's measured block time, walked
# backwards from head in chunks of P6's measured maximum accepted range, under
# a request budget. Whatever is actually covered is stated explicitly - the
# window is never silently narrowed.
set -uo pipefail
. "$(dirname "$0")/_lib.sh"

MAX_CHUNKS="${P7_MAX_CHUNKS:-300}"   # request budget; see coverage note below

echo "## P7"
echo

HOST="$(cat "$OUT/p6_working_host.txt" 2>/dev/null | tr -d '[:space:]' || echo none)"
MAXSPAN="$(cat "$OUT/p6_maxspan.txt" 2>/dev/null | tr -d '[:space:]' || echo 0)"

if [ "$HOST" != "alchemy" ] || [ "${MAXSPAN:-0}" -le 0 ]; then
  echo '```'
  echo "skipped: P6 established no usable historical source"
  echo "  p6 working host : ${HOST:-none}"
  echo "  p6 max span     : ${MAXSPAN:-0} blocks"
  echo '```'
  echo
  echo "0" > "$OUT/p7_span.txt"
  echo "0" > "$OUT/p7_distinct_agents.txt"
  : > "$OUT/p7_agentids.txt"
  echo "**Conclusion:** cannot run - P7 depends on a working historical source and P6 found none. BLOCKED on P6."
  exit 1
fi

HEAD="$(get_head)" || exit 1
B30="$(blocks_30d)" || {
  echo '```'; echo "P4 produced no measured block time - refusing to assume one"; echo '```'
  echo; echo "0" > "$OUT/p7_span.txt"; echo "0" > "$OUT/p7_distinct_agents.txt"
  echo "**Conclusion:** the 30-day window must be DERIVED from P4's measured block time and P4 produced none. BLOCKED on P4."
  exit 1
}
AVG="$(cat "$OUT/p4_blocktime.txt" 2>/dev/null | tr -d '[:space:]')"

# Chunks needed for a full 30 days, versus what the request budget allows.
NEEDED=$(( (B30 + MAXSPAN - 1) / MAXSPAN ))
CHUNKS=$NEEDED
[ "$CHUNKS" -gt "$MAX_CHUNKS" ] && CHUNKS=$MAX_CHUNKS
SPAN=$(( CHUNKS * MAXSPAN ))
[ "$SPAN" -gt "$B30" ] && SPAN=$B30
TO=$HEAD; FROM=$(( HEAD - SPAN + 1 ))   # inclusive range of exactly SPAN blocks
PCT="$(awk -v s="$SPAN" -v b="$B30" 'BEGIN{printf "%.1f", (b>0? 100*s/b : 0)}')"
HOURS="$(awk -v s="$SPAN" -v a="${AVG:-0}" 'BEGIN{printf "%.1f", (a>0? s*a/3600 : 0)}')"

echo '```'
echo "source          : ALCHEMY_BSC ($ALCHEMY_MASKED)"
echo "contract        : $REPUTATION_REGISTRY_LC  (lowercased for the wire and for storage)"
echo "chunk size      : $MAXSPAN blocks   <- P6 measured maximum accepted range"
echo "30d target      : $B30 blocks       <- DERIVED from P4's measured ${AVG:-?}s/block"
echo "chunks needed   : $NEEDED for a full 30 days   budget: $MAX_CHUNKS   chunks used: $CHUNKS"
if [ "$NEEDED" -gt "$MAX_CHUNKS" ]; then
  echo "                  ^ a full 30-day backfill needs $NEEDED sequential requests at this"
  echo "                    chunk size. That is the binding constraint, not this budget."
fi
echo
echo "COVERAGE WINDOW : $SPAN blocks  ($FROM .. $TO)"
echo "                  = ${PCT}% of the 30-day target, ~${HOURS}h of chain history"
echo
echo "\$ curl -s -X POST \"$ALCHEMY_MASKED\" -d '{\"method\":\"eth_getLogs\",\"params\":[{\"address\":\"$REPUTATION_REGISTRY_LC\",\"topics\":[\"$TOPIC_NEW_FEEDBACK\"],\"fromBlock\":\"...\",\"toBlock\":\"...\"}]}'   # x$CHUNKS chunks"
echo

echo "-- NewFeedback --"
alchemy_getlogs_chunked "$REPUTATION_REGISTRY_LC" "$TOPIC_NEW_FEEDBACK" "$FROM" "$TO" "$MAXSPAN" "$OUT/p7_newfeedback.ndjson"
NF_CHUNKS=$GL_CHUNKS; NF_ERRORS=$GL_ERRORS; NF_CAPPED=$GL_CAPPED; NF_ERR="$GL_LAST_ERR"
echo "  chunks=$NF_CHUNKS errors=$NF_ERRORS"

echo "-- FeedbackRevoked --"
alchemy_getlogs_chunked "$REPUTATION_REGISTRY_LC" "$TOPIC_FEEDBACK_REVOKED" "$FROM" "$TO" "$MAXSPAN" "$OUT/p7_revoked.ndjson"
RV_CHUNKS=$GL_CHUNKS; RV_ERRORS=$GL_ERRORS; RV_CAPPED=$GL_CAPPED; RV_ERR="$GL_LAST_ERR"
echo "  chunks=$RV_CHUNKS errors=$RV_ERRORS"

TOTAL_NF=$(nlines "$OUT/p7_newfeedback.ndjson")
TOTAL_RV=$(nlines "$OUT/p7_revoked.ndjson")

# topic1 = agentId (uint256), topic2 = clientAddress (address, right-aligned).
# Both are lowercased before sort -u: identical values in different casings
# must collapse to one group, never two.
jq -r '.topics[1] // empty' "$OUT/p7_newfeedback.ndjson" 2>/dev/null \
  | lc_stream | sort -u > "$OUT/p7_agentids.txt"
DISTINCT_AGENTS=$(nlines "$OUT/p7_agentids.txt")

jq -r '.topics[2] // empty' "$OUT/p7_newfeedback.ndjson" 2>/dev/null \
  | lc_stream | sed 's/^0x0*\(.\{40\}\)$/0x\1/' | sort -u > "$OUT/p7_clients.txt"
DISTINCT_CLIENTS=$(nlines "$OUT/p7_clients.txt")

# Sanity: every stored log must carry the lowercased contract address we asked for.
BADADDR=$(jq -r '.address' "$OUT/p7_newfeedback.ndjson" 2>/dev/null | grep -v "^$REPUTATION_REGISTRY_LC$" | awk 'END{print NR+0}')

echo
echo "total NewFeedback events   : $TOTAL_NF"
echo "distinct agentId (topic1)  : $DISTINCT_AGENTS"
echo "distinct client  (topic2)  : $DISTINCT_CLIENTS"
echo "total FeedbackRevoked      : $TOTAL_RV"
echo "logs with unexpected addr  : $BADADDR  (address normalisation check)"
echo "chunk errors               : NewFeedback=$NF_ERRORS  FeedbackRevoked=$RV_ERRORS"
[ -n "$NF_ERR" ] && echo "last NewFeedback error     : $NF_ERR"
[ -n "$RV_ERR" ] && echo "last Revoked error         : $RV_ERR"
echo "provider result cap hit    : NewFeedback=$([ "$NF_CAPPED" -eq 1 ] && echo YES || echo no)  FeedbackRevoked=$([ "$RV_CAPPED" -eq 1 ] && echo YES || echo no)"
echo '```'
echo

echo "$DISTINCT_AGENTS" > "$OUT/p7_distinct_agents.txt"
echo "$SPAN"            > "$OUT/p7_span.txt"
echo "$FROM"            > "$OUT/p7_from.txt"
echo "$TO"              > "$OUT/p7_to.txt"

BOUND="exact for this window"
{ [ "$NF_CAPPED" -eq 1 ] || [ "$RV_CAPPED" -eq 1 ]; } && BOUND="LOWER BOUNDS - a provider result-size ceiling was hit inside at least one chunk"
{ [ "$NF_ERRORS" -gt 0 ] || [ "$RV_ERRORS" -gt 0 ]; } && BOUND="$BOUND; $(( NF_ERRORS + RV_ERRORS )) chunk(s) errored so some blocks in the window went unread"

COVNOTE="This window is ${PCT}% of the 30-day target ($SPAN of $B30 blocks, ~${HOURS}h of chain history) - the $MAXSPAN-block provider cap means full 30-day coverage would need $NEEDED sequential requests."
[ "$SPAN" -ge "$B30" ] && COVNOTE="This window covers the full 30-day target ($B30 blocks, derived from P4's measured ${AVG:-?}s/block)."

echo "**Conclusion:** over a **$SPAN-block** window ($FROM .. $TO), read from ALCHEMY_BSC in $CHUNKS chunks of $MAXSPAN blocks: **$TOTAL_NF NewFeedback** events from **$DISTINCT_AGENTS distinct agentIds** and **$DISTINCT_CLIENTS distinct clients**, plus **$TOTAL_RV FeedbackRevoked**. $COVNOTE Counts are $BOUND. All addresses and topics were lowercased before grouping."
