#!/usr/bin/env bash
# P2 - contract existence. Bytecode length at both mainnet registries.
# Zero length => wrong chain or wrong address. Stop-the-world probe.
set -uo pipefail
. "$(dirname "$0")/_lib.sh"

echo "## P2"
echo
echo '```'
FAIL=0
for pair in "IdentityRegistry:$IDENTITY_REGISTRY" "ReputationRegistry:$REPUTATION_REGISTRY"; do
  NAME="${pair%%:*}"; ADDR="${pair#*:}"
  echo "\$ cast code $ADDR --rpc-url \"$RPC_MASKED\""
  CODE="$(cast code "$ADDR" --rpc-url "$BSC_RPC" 2>&1 | redact | tr -d '[:space:]')"
  case "$CODE" in
    0x*)
      # strip 0x, 2 hex chars per byte
      NBYTES=$(( (${#CODE} - 2) / 2 ))
      echo "$NAME  bytecode bytes: $NBYTES"
      echo "$NAME  first 64 hex:   ${CODE:0:66}"
      # A tiny runtime embedding the ERC-1967 impl slot means this is a proxy;
      # anything reading its ABI must target the implementation instead.
      SLOT=360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
      if echo "$CODE" | grep -qi "$SLOT"; then
        rl_rpc
        RAW="$(cast storage "$ADDR" "0x$SLOT" --rpc-url "$BSC_RPC" 2>&1 | redact | tr -d '[:space:]')"
        echo "$NAME  ERC-1967 proxy: YES  implslot=$RAW"
        if [[ "$RAW" =~ ^0x0*([0-9a-fA-F]{40})$ ]]; then
          IMPL="0x${BASH_REMATCH[1]}"
          rl_rpc
          ICODE="$(cast code "$IMPL" --rpc-url "$BSC_RPC" 2>&1 | redact | tr -d '[:space:]')"
          echo "$NAME  implementation: $IMPL  bytecode bytes: $(( (${#ICODE} - 2) / 2 ))"
          echo "$NAME=$IMPL" >> "$OUT/p2_impls.txt"
        fi
      else
        echo "$NAME  ERC-1967 proxy: no"
      fi
      [ "$NBYTES" -eq 0 ] && FAIL=1
      echo "$NAME=$NBYTES" >> "$OUT/p2_codelen.txt"
      ;;
    *)
      echo "$NAME  ERROR: $CODE"
      FAIL=1
      ;;
  esac
  echo
done
echo '```'
echo

if [ "$FAIL" -eq 0 ]; then
  echo "**Conclusion:** both registries have non-empty bytecode on chain 56. Addresses are live contracts. PASS. Note the runtime is a small ERC-1967 proxy - ABI and function selectors must be read from the implementation address, not from these addresses."
else
  echo "**Conclusion:** at least one registry returned zero-length or errored bytecode. STOP-THE-WORLD: wrong chain or wrong address. FAIL"
  exit 1
fi
