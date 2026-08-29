#!/usr/bin/env bash
# Independently verify an AgenSea ERC-8183 deliverable using ONLY a public RPC.
#
#   usage: bash scripts/verify_deliverable.sh <jobId> [--legacy]
#
# --legacy: for jobs submitted before the non-ASCII canonicalisation fix
#           (jobs 748, 750, 752, 754, 757), which were hashed with raw UTF-8
#           instead of \uXXXX escapes. Uses ensure_ascii=False to reproduce.
set -uo pipefail
JOB="${1:?usage: verify_deliverable.sh <jobId> [--legacy]}"
LEGACY="${2:-}"
RPC="${RPC:-https://bsc-testnet-rpc.publicnode.com}"
COMMERCE=0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE
POLICY=0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA

echo "chain: $(cast chain-id --rpc-url "$RPC")  (must be 97)"

# 1. on-chain deliverable hash
ONCHAIN=$(cast call "$COMMERCE" \
  "getJob(uint256)((uint256,address,address,address,string,uint256,uint256,uint8,address,uint256,bytes32))" \
  "$JOB" --rpc-url "$RPC" | tr ',' '\n' | tail -1 | tr -d ' )')
echo "on-chain job.deliverable : $ONCHAIN"

# 2. recover the manifest from the policy's event log (optParams carries it)
H=$(cast block-number --rpc-url "$RPC")
curl -s -X POST "$RPC" -H 'content-type: application/json' \
 -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getLogs\",\"params\":[{\"address\":\"$POLICY\",\"fromBlock\":\"$(printf '0x%x' $((H-45000)))\",\"toBlock\":\"$(printf '0x%x' $H)\"}]}" \
 > /tmp/vlogs.json

ENSURE=$([ "$LEGACY" = "--legacy" ] && echo False || echo True)
python3 - "$JOB" "$ENSURE" <<'PY' > /tmp/vcanon.txt
import sys, json, base64
job, ensure = int(sys.argv[1]), sys.argv[2] == 'True'
for l in json.load(open('/tmp/vlogs.json'))['result']:
    txt = bytes.fromhex(l['data'][2:]).decode('utf8', 'ignore')
    if 'deliverable_url' not in txt: continue
    j = json.loads(txt[txt.index('{'):txt.rindex('}')+1])
    m = json.loads(base64.b64decode(j['deliverable_url'].split(',', 1)[1]))
    if m['job_id'] != job: continue
    sys.stdout.write(json.dumps(m, sort_keys=True, separators=(',', ':'), ensure_ascii=ensure))
    break
PY

if [ ! -s /tmp/vcanon.txt ]; then echo "manifest for job $JOB not found in the last 45k blocks"; exit 1; fi
echo "canonical manifest bytes : $(wc -c < /tmp/vcanon.txt | tr -d ' ')"
RECOMPUTED=$(cast keccak "$(cat /tmp/vcanon.txt)")
echo "recomputed keccak256     : $RECOMPUTED"
if [ "$RECOMPUTED" = "$ONCHAIN" ]; then echo "RESULT: MATCH — deliverable is authentic"; exit 0
else echo "RESULT: MISMATCH"; exit 1; fi
