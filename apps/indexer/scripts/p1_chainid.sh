#!/usr/bin/env bash
# P1 - chainId assertion. MUST be 56 (BSC mainnet). Stop-the-world probe.
set -uo pipefail
. "$(dirname "$0")/_lib.sh"

echo "## P1"
echo
echo '```'
echo "\$ cast chain-id --rpc-url \"$RPC_MASKED\""
CHAIN_ID="$(cast chain-id --rpc-url "$BSC_RPC" 2>&1 | redact)"
echo "$CHAIN_ID"
echo '```'
echo

if [ "$CHAIN_ID" = "56" ]; then
  echo "**Conclusion:** chainId is 56 (BSC mainnet) - RPC points at the correct chain, registry addresses are trustworthy. PASS"
  echo "$CHAIN_ID" > "$OUT/chainid.txt"
  exit 0
else
  echo "**Conclusion:** chainId is \`$CHAIN_ID\`, NOT 56. STOP-THE-WORLD: vanity registry addresses are reused across chains, so any data read from this RPC would be plausible but wrong. FAIL"
  exit 1
fi
