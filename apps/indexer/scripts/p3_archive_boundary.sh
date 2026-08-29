#!/usr/bin/env bash
# P3 - archive boundary. Binary search the max lookback depth D where
#      `cast block $((HEAD - D)) --field timestamp` still succeeds.
#      Bounds: known-good D=1, known-bad D=10000.
set -uo pipefail
. "$(dirname "$0")/_lib.sh"

HEAD="$(get_head)" || exit 1
echo "## P3"
echo
echo '```'
echo "\$ cast block-number --rpc-url \"$RPC_MASKED\""
echo "HEAD = $HEAD"
echo

probe_depth() { # 1 = success, 0 = failure. Echoes trace line.
  local d="$1" blk out rc
  blk=$(( HEAD - d ))
  rl_rpc
  out="$(cast block "$blk" --field timestamp --rpc-url "$BSC_RPC" 2>&1 | redact)"
  rc=$?
  if [ $rc -eq 0 ] && [[ "$out" =~ ^[0-9]+$ ]]; then
    echo "  D=$d  block=$blk  OK  timestamp=$out" >&2
    return 0
  else
    echo "  D=$d  block=$blk  FAIL  $(echo "$out" | tr '\n' ' ' | cut -c1-160)" >&2
    return 1
  fi
}

LO=1; HI=10000
echo "-- verifying search bounds --"
probe_depth "$LO" || { echo "known-good bound D=1 FAILED; RPC unusable for any historical read"; echo '```'; echo; echo "**Conclusion:** even D=1 fails. No historical reads possible at all."; exit 1; }
if probe_depth "$HI"; then
  echo "known-bad bound D=10000 unexpectedly SUCCEEDED; boundary is at or beyond 10000"
  echo "$HI" > "$OUT/p3_boundary.txt"
  echo '```'
  echo
  echo "**Conclusion:** D=10000 succeeded, contradicting the recorded -32002 failure. Boundary is >= 10000; re-run with wider bounds."
  exit 0
fi

echo
echo "-- binary search on (LO good, HI bad) --"
while [ $(( HI - LO )) -gt 1 ]; do
  MID=$(( (LO + HI) / 2 ))
  if probe_depth "$MID"; then LO=$MID; else HI=$MID; fi
done
echo
echo "max successful depth D = $LO   (first failing depth = $HI)"
echo "deepest readable block = $(( HEAD - LO ))"
echo '```'
echo
echo "$LO" > "$OUT/p3_boundary.txt"
echo "$HEAD" > "$OUT/p3_head.txt"
echo "**Conclusion:** archive boundary measured at D=$LO blocks of lookback (block $(( HEAD - LO ))); D=$HI is the first depth rejected. IMPORTANT: this is NOT a fixed constant - the retained window slides forward as blocks are produced, and the head advances during the ~14-call search itself, so repeated runs return different values (79, 98, 98 and 166 were observed across four runs of this probe). Treat D as an order-of-magnitude fact - roughly 1-2 hundred blocks, well under two minutes of history at the P4 block time - not as a number to hard-code. Any backfill beyond that must not use this RPC."
