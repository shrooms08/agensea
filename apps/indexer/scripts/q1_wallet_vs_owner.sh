#!/usr/bin/env bash
# Side question 1: does getAgentWallet ever differ from ownerOf?
# 500 ids spread across the range. Sequential, 5 req/s. eth_call only.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
set -a; . "$ROOT/.env"; set +a
IDENTITY=0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
CEIL="${1:-297307}"
N=500
lc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
SAME=0; DIFF=0; ERR=0; ZERO=0
: > /tmp/q1_diffs.txt
for i in $(seq 1 $N); do
  ID=$(( CEIL * i / N )); [ "$ID" -lt 1 ] && ID=1
  sleep 0.2
  O="$(lc "$(cast call $IDENTITY "ownerOf(uint256)(address)" $ID --rpc-url "$ALCHEMY_BSC" 2>&1 | head -1 | tr -d '[:space:]')")"
  sleep 0.2
  W="$(lc "$(cast call $IDENTITY "getAgentWallet(uint256)(address)" $ID --rpc-url "$ALCHEMY_BSC" 2>&1 | head -1 | tr -d '[:space:]')")"
  if [[ ! "$O" =~ ^0x[0-9a-f]{40}$ ]] || [[ ! "$W" =~ ^0x[0-9a-f]{40}$ ]]; then
    ERR=$((ERR+1)); echo "id=$ID ERR owner=$(echo $O|cut -c1-50) wallet=$(echo $W|cut -c1-50)" >> /tmp/q1_diffs.txt; continue
  fi
  if [ "$W" = "0x0000000000000000000000000000000000000000" ]; then ZERO=$((ZERO+1)); fi
  if [ "$O" = "$W" ]; then SAME=$((SAME+1)); else
    DIFF=$((DIFF+1)); echo "id=$ID owner=$O wallet=$W" >> /tmp/q1_diffs.txt; fi
  if [ $(( i % 100 )) -eq 0 ]; then echo "  ...$i/$N  same=$SAME diff=$DIFF zero_wallet=$ZERO err=$ERR" >&2; fi
done
echo
echo "=== Q1 RESULT over $N spread ids (ceiling $CEIL) ==="
echo "  identical (wallet == owner) : $SAME"
echo "  DIFFERENT                   : $DIFF"
echo "  wallet == zero address      : $ZERO"
echo "  errors/reverts              : $ERR"
echo
if [ "$DIFF" -gt 0 ]; then
  echo "  sample of divergences:"; head -10 /tmp/q1_diffs.txt | sed 's/^/    /'
fi
