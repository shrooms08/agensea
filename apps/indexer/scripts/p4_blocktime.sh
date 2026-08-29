#!/usr/bin/env bash
# P4 - average block time, measured. No constant is assumed anywhere.
#
# Primary method: sample (blockNumber, timestamp) pairs from block HEADERS at
# intervals. Each read targets a block safely inside the P3 archive window at
# the moment it is taken, but the ENDPOINTS of the collected series span far
# more blocks than the window itself - which is how a >500-block sample is
# obtained from a node that only retains ~98 blocks of state.
#
# Header timestamps are preferred over polling eth_blockNumber because the RPC
# is load-balanced across nodes that can sit at slightly different heights;
# head-polling deltas carry that skew, block headers do not.
set -uo pipefail
. "$(dirname "$0")/_lib.sh"

ROUNDS="${P4_ROUNDS:-6}"
GAP="${P4_GAP:-50}"

echo "## P4"
echo
echo '```'
echo "method: $ROUNDS header samples spaced ${GAP}s apart; block time = timestamp delta"
echo "        between the first and last sample, divided by their block delta."
echo

FIRST_B=""; FIRST_T=""; LAST_B=""; LAST_T=""
for i in $(seq 1 "$ROUNDS"); do
  H="$(get_head)" || { echo "head read failed on round $i"; break; }
  B=$(( H - 2 ))   # 2 blocks back: safely inside the window, avoids reorg tip
  rl_rpc
  T="$(cast block "$B" --field timestamp --rpc-url "$BSC_RPC" 2>&1 | redact | tr -d '[:space:]')"
  if [[ "$T" =~ ^[0-9]+$ ]]; then
    echo "  sample $i: block=$B timestamp=$T"
    [ -z "$FIRST_B" ] && { FIRST_B=$B; FIRST_T=$T; }
    LAST_B=$B; LAST_T=$T
  else
    echo "  sample $i: block=$B FAILED $(echo "$T" | cut -c1-120)"
  fi
  [ "$i" -lt "$ROUNDS" ] && sleep "$GAP"
done
echo

if [ -z "$FIRST_B" ] || [ -z "$LAST_B" ] || [ "$LAST_B" -le "$FIRST_B" ]; then
  echo "insufficient samples to measure block time"
  echo '```'
  echo
  echo "**Conclusion:** block time could NOT be measured. No value is assumed. FAIL"
  exit 1
fi

SPAN=$(( LAST_B - FIRST_B )); ELAPSED=$(( LAST_T - FIRST_T ))
AVG="$(awk -v e="$ELAPSED" -v s="$SPAN" 'BEGIN{printf "%.3f", e/s}')"
read -r BPD B30 <<<"$(awk -v avg="$AVG" 'BEGIN{printf "%.0f %.0f", 86400/avg, 2592000/avg}')"

echo "first sample : block=$FIRST_B t=$FIRST_T"
echo "last  sample : block=$LAST_B t=$LAST_T"
echo "block span   : $SPAN blocks"
echo "elapsed      : ${ELAPSED}s (from block headers, not wall clock)"
echo "avg s/block  : $AVG"
echo "blocks/day   : $BPD"
echo "blocks/30d   : $B30"
echo '```'
echo
echo "$AVG" > "$OUT/p4_blocktime.txt"
echo "$B30" > "$OUT/p4_blocks30d.txt"

if [ "$SPAN" -lt 500 ]; then
  NOTE=" **APPROXIMATE - sample span is only $SPAN blocks (<500).**"
else
  NOTE=" Sample span is $SPAN blocks (>=500), so this is not flagged approximate."
fi
echo "**Conclusion:** measured block time is **${AVG}s/block**, from block-header timestamps across a ${SPAN}-block span. At that measured rate 30 days spans **~${B30} blocks**.${NOTE} No assumed constant was used at any point."
