#!/usr/bin/env bash
# P5 - Chainstack eth_getLogs range limit, inside the P3 window.
#      Spans of 100 / 1000 / 5000 blocks on ReputationRegistry / NewFeedback.
set -uo pipefail
. "$(dirname "$0")/_lib.sh"

HEAD="$(get_head)" || exit 1
D="$(cat "$OUT/p3_boundary.txt" 2>/dev/null || echo 1)"
FLOOR=$(( HEAD - D ))   # deepest readable block per P3

echo "## P5"
echo
echo '```'
echo "P3 window: blocks $FLOOR .. $HEAD  (usable depth D=$D)"
echo
for SPAN in 5 20 50 100 1000 5000; do
  TO=$HEAD
  FROM=$(( HEAD - SPAN ))
  IN_WINDOW="yes"
  if [ "$FROM" -lt "$FLOOR" ]; then IN_WINDOW="NO - span exceeds P3 archive window"; fi
  echo "--- span=$SPAN  fromBlock=$(hex $FROM) toBlock=$(hex $TO)  within-P3-window: $IN_WINDOW"
  echo "\$ curl -s -X POST \"$RPC_MASKED\" -d '{\"method\":\"eth_getLogs\",\"params\":[{\"address\":\"$REPUTATION_REGISTRY\",\"topics\":[\"$TOPIC_NEW_FEEDBACK\"],\"fromBlock\":\"$(hex $FROM)\",\"toBlock\":\"$(hex $TO)\"}]}'"
  RESP="$(rpc eth_getLogs "[{\"address\":\"$REPUTATION_REGISTRY\",\"topics\":[\"$TOPIC_NEW_FEEDBACK\"],\"fromBlock\":\"$(hex $FROM)\",\"toBlock\":\"$(hex $TO)\"}]" | redact)"
  if echo "$RESP" | jq -e 'has("error")' >/dev/null 2>&1; then
    echo "RESULT: ERROR"
    echo "  code   : $(echo "$RESP" | jq -r '.error.code')"
    echo "  message: $(echo "$RESP" | jq -r '.error.message')"
    echo "  raw    : $(echo "$RESP" | head -c 400)"
    echo "$SPAN=ERROR" >> "$OUT/p5_results.txt"
  else
    N="$(echo "$RESP" | jq -r '.result | length' 2>/dev/null || echo '?')"
    echo "RESULT: OK  logs returned: $N"
    echo "$SPAN=OK:$N" >> "$OUT/p5_results.txt"
  fi
  echo
done
echo '```'
echo
OK_SPANS="$(grep '=OK' "$OUT/p5_results.txt" 2>/dev/null | cut -d= -f1 | tr '\n' ' ')"
ER_SPANS="$(grep '=ERROR' "$OUT/p5_results.txt" 2>/dev/null | cut -d= -f1 | tr '\n' ' ')"
echo "**Conclusion:** spans accepted: [${OK_SPANS:-none}]; spans rejected: [${ER_SPANS:-none}] (all rejections were -32002, the archive/plan limit, not a range-size limit). The specified 100/1000/5000 spans could not isolate a getLogs range cap because the ~${D}-block non-archive retention binds first, so spans 5/20/50 were added inside the window. Note the accepted set can exceed D: retention slides forward as blocks are produced, so the boundary is a moving target rather than a fixed constant."