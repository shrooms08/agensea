#!/usr/bin/env bash
# PHASE 1b STEP 1 - ERC-8004 enumeration probe. READ-ONLY, eth_call only.
# No eth_getLogs anywhere in this script.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
set -a; . "$ROOT/.env"; set +a
: "${ALCHEMY_BSC:?ALCHEMY_BSC not set}"

IDENTITY=0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
REPUTATION=0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
IMPL_IDENTITY=0x7274e874ca62410a93bd8bf61c69d8045e399c02
IMPL_REPUTATION=0x16e0fa7f7c56b9a767e34b192b51f921be31da34
MULTICALL3=0xcA11bde05977b3631167028862bE2a173976CA11

RPC="$ALCHEMY_BSC"
MASK="$(printf '%.30s...' "$ALCHEMY_BSC")"
redact() { sed -e "s|$ALCHEMY_BSC|$MASK|g"; }

# 5 req/s cap. The counter lives in a file: call() runs inside $( ), so a
# shell-variable increment would be discarded with the subshell.
CALLFILE="$(mktemp)"; echo 0 > "$CALLFILE"
rl() { sleep 0.2; echo $(( $(cat "$CALLFILE") + 1 )) > "$CALLFILE"; }
calls() { cat "$CALLFILE"; }

lc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# call <addr> <sig> [args...] -> stdout result; returns non-zero on revert
call() {
  local addr="$1" sig="$2"; shift 2
  rl
  cast call "$addr" "$sig" "$@" --rpc-url "$RPC" 2>&1 | redact
}

echo "==================================================================="
echo "PHASE 1b STEP 1 - probe (eth_call only, no getLogs)"
echo "  RPC          : $MASK"
echo "  IdentityReg  : $IDENTITY"
echo "  ReputationReg: $REPUTATION"
echo "==================================================================="
echo

# --- (b) Multicall3 -------------------------------------------------------
echo "### (b) Multicall3 availability"
echo
echo "canonical address from github.com/mds1/multicall3 README: $MULTICALL3"
rl
MC_CODE="$(cast code "$MULTICALL3" --rpc-url "$RPC" 2>&1 | redact | tr -d '[:space:]')"
if [[ "$MC_CODE" =~ ^0x[0-9a-fA-F]+$ ]] && [ "${#MC_CODE}" -gt 2 ]; then
  MC_BYTES=$(( (${#MC_CODE} - 2) / 2 ))
  echo "cast code -> $MC_BYTES bytes  => CONFIRMED deployed on chain 56"
  echo "$MULTICALL3" > /tmp/p1b_multicall.txt
else
  MC_BYTES=0
  echo "cast code -> $(echo "$MC_CODE" | head -c 200)"
  echo "=> NOT CONFIRMED"
  echo "" > /tmp/p1b_multicall.txt
fi
# Sanity: also confirm the pinned implementations still carry code.
for pair in "IdentityImpl:$IMPL_IDENTITY" "ReputationImpl:$IMPL_REPUTATION"; do
  L="${pair%%:*}"; A="${pair##*:}"
  rl
  C="$(cast code "$A" --rpc-url "$RPC" 2>/dev/null | tr -d '[:space:]')"
  echo "  $L $A -> $(( (${#C} - 2) / 2 )) bytes"
done
echo

# --- (a) highest minted agentId ------------------------------------------
echo "### (a) Highest minted agentId (binary search on ownerOf)"
echo
BS_CALLS_START=$(calls)
minted() {
  local id="$1" out
  out="$(call "$IDENTITY" "ownerOf(uint256)(address)" "$id")"
  if echo "$out" | grep -qiE 'error|revert|panic|reverted'; then
    LAST_OWNER=""; return 1
  fi
  LAST_OWNER="$(lc "$(echo "$out" | head -1 | tr -d '[:space:]')")"
  return 0
}

LO=1; HI=2000000
echo "bounds check:"
if minted "$LO"; then echo "  ownerOf($LO) -> $LAST_OWNER  (minted)"; else
  echo "  ownerOf($LO) REVERTED - id 1 is not minted, binary search invariant broken"; fi
if minted "$HI"; then
  echo "  ownerOf($HI) -> $LAST_OWNER  (minted) - ceiling is at or above the search bound"
  CEIL=$HI
else
  echo "  ownerOf($HI) reverted (unminted) - proceeding"
  echo
  echo "binary search trace:"
  while [ $(( HI - LO )) -gt 1 ]; do
    MID=$(( (LO + HI) / 2 ))
    if minted "$MID"; then echo "  id=$MID  minted    -> lo=$MID"; LO=$MID
    else                   echo "  id=$MID  unminted  -> hi=$MID"; HI=$MID; fi
  done
  CEIL=$LO
fi
BS_CALLS=$(( $(calls) - BS_CALLS_START ))
echo
echo "CEILING (highest minted agentId): $CEIL"
echo "eth_call count for (a): $BS_CALLS"
echo "$CEIL" > /tmp/p1b_ceiling.txt
echo
echo "NOTE: binary search assumes ids are minted contiguously from 1. If minting"
echo "      ever skips ids, this returns a lower bound on the true maximum."
echo

# --- (c) read-path smoke test --------------------------------------------
echo "### (c) Read-path smoke test (3 agentIds near the ceiling)"
echo
SUMMARY_FORM="undetermined"
for OFFSET in 0 1 2; do
  ID=$(( CEIL - OFFSET ))
  echo "--- agentId $ID"
  echo "  ownerOf        : $(call "$IDENTITY" "ownerOf(uint256)(address)" "$ID" | head -2 | tr '\n' ' ')"
  echo "  getAgentWallet : $(call "$IDENTITY" "getAgentWallet(uint256)(address)" "$ID" | head -2 | tr '\n' ' ')"
  echo "  tokenURI       : $(call "$IDENTITY" "tokenURI(uint256)(string)" "$ID" | head -2 | cut -c1-120 | tr '\n' ' ')"
  echo "  getClients     : $(call "$REPUTATION" "getClients(uint256)(address[])" "$ID" | head -3 | tr '\n' ' ')"
  echo "  getSummary([]) : $(call "$REPUTATION" "getSummary(uint256,address[],string,string)(uint64,int128,uint8)" "$ID" "[]" "" "" | head -2 | cut -c1-160 | tr '\n' ' ')"
  echo
done

# The three ceiling agents have no clients, and the contract rejects an empty
# client list outright ("clientAddresses required"). So the empty-vs-explicit
# question cannot be settled on them - find an agent that HAS clients.
echo "--- searching for an agent with a non-empty getClients (needed to settle the getSummary form)"
WITH_CLIENTS=""; WITH_CLIENTS_LIST=""
SEARCH_IDS="$(seq 1 20; for i in $(seq 1 40); do echo $(( CEIL * i / 40 )); done)"
SEARCHED=0
for ID in $SEARCH_IDS; do
  [ -n "$WITH_CLIENTS" ] && break
  SEARCHED=$((SEARCHED+1))
  CL="$(call "$REPUTATION" "getClients(uint256)(address[])" "$ID" | head -1 | tr -d '[:space:]')"
  case "$CL" in
    ''|'[]') continue ;;
    *error*|*Error*|*revert*) continue ;;
    *) WITH_CLIENTS="$ID"; WITH_CLIENTS_LIST="$CL"; echo "  agentId $ID has clients: $CL" ;;
  esac
done

if [ -z "$WITH_CLIENTS" ]; then
  echo "  no agent with clients found in $SEARCHED sampled ids"
  echo "  -> getSummary form CANNOT be determined: the contract reverts with"
  echo "     'clientAddresses required' for an empty array, and no sampled agent"
  echo "     has a non-empty client list to pass instead."
  SUMMARY_FORM="UNDETERMINED - no agent with clients found in $SEARCHED sampled ids"
else
  echo
  echo "  getSummary(empty array) on agent $WITH_CLIENTS:"
  SE="$(call "$REPUTATION" "getSummary(uint256,address[],string,string)(uint64,int128,uint8)" "$WITH_CLIENTS" "[]" "" "")"
  echo "$SE" | sed 's/^/    /' | cut -c1-200 | head -4
  echo "  getSummary(explicit client list) on agent $WITH_CLIENTS:"
  SL="$(call "$REPUTATION" "getSummary(uint256,address[],string,string)(uint64,int128,uint8)" "$WITH_CLIENTS" "$WITH_CLIENTS_LIST" "" "")"
  echo "$SL" | sed 's/^/    /' | cut -c1-200 | head -4
  if ! echo "$SE" | grep -qiE 'error|revert|panic'; then
    SUMMARY_FORM="empty array (means all clients)"
  elif ! echo "$SL" | grep -qiE 'error|revert|panic'; then
    SUMMARY_FORM="explicit client list from getClients (empty array reverts)"
  else
    SUMMARY_FORM="NEITHER form worked"
  fi
fi
echo
echo "getSummary form that worked: $SUMMARY_FORM"
echo

# --- (d) overlap test -----------------------------------------------------
echo "### (d) CRITICAL - do B402 payees hold ERC-8004 identities?"
echo
echo "payTo set read live from Supabase bazaar_accepts (not hardcoded):"
NONZERO=0; TOTAL_PAYEES=0
while read -r P; do
  [ -z "$P" ] && continue
  TOTAL_PAYEES=$((TOTAL_PAYEES+1))
  B="$(call "$IDENTITY" "balanceOf(address)(uint256)" "$P" | head -1 | tr -d '[:space:]')"
  BAL="$(echo "$B" | grep -oE '^[0-9]+' || echo "ERR")"
  printf '  %s  balanceOf = %s\n' "$P" "${BAL:-$B}"
  if [[ "$BAL" =~ ^[0-9]+$ ]] && [ "$BAL" -gt 0 ]; then NONZERO=$((NONZERO+1)); fi
done < /tmp/payto.txt
echo
echo "payees checked: $TOTAL_PAYEES   with non-zero ERC-8004 balance: $NONZERO"
echo "$NONZERO" > /tmp/p1b_nonzero.txt
echo

# --- (e) tokenURI host concentration -------------------------------------
echo "### (e) tokenURI host distribution across 20 spread agentIds"
echo
: > /tmp/p1b_hosts.txt
FAILED=0
for i in $(seq 1 20); do
  ID=$(( CEIL * i / 20 )); [ "$ID" -lt 1 ] && ID=1
  RAW="$(call "$IDENTITY" "tokenURI(uint256)(string)" "$ID")"
  if echo "$RAW" | grep -qiE 'error|revert|panic'; then
    printf '  id=%-8s CALL REVERTED: %s\n' "$ID" "$(echo "$RAW" | tr '\n' ' ' | cut -c1-90)"
    FAILED=$((FAILED+1)); echo "<call reverted>" >> /tmp/p1b_hosts.txt; continue
  fi
  U="$(echo "$RAW" | head -1 | sed 's/^"//; s/"$//')"
  if [ -z "$U" ]; then
    printf '  id=%-8s EMPTY tokenURI (call succeeded, returned empty string)\n' "$ID"
    FAILED=$((FAILED+1)); echo "<empty tokenURI>" >> /tmp/p1b_hosts.txt; continue
  fi
  # Classify by scheme first: a data: URI is inline metadata with no host at all.
  case "$U" in
    data:*)
      printf '  id=%-8s INLINE data: URI (%d bytes, no host)\n' "$ID" "${#U}"
      echo "(inline data: URI)" >> /tmp/p1b_hosts.txt
      continue ;;
    ipfs://*)
      HOST="ipfs"; FETCH="https://ipfs.io/ipfs/${U#ipfs://}" ;;
    http://*|https://*)
      HOST="$(printf '%s' "$U" | sed -E 's|^[a-zA-Z]+://||' | cut -d/ -f1 | tr '[:upper:]' '[:lower:]')"
      FETCH="$U" ;;
    *)
      printf '  id=%-8s UNRECOGNISED scheme: %s\n' "$ID" "$(echo "$U" | cut -c1-60)"
      echo "(unrecognised scheme)" >> /tmp/p1b_hosts.txt
      FAILED=$((FAILED+1)); continue ;;
  esac
  CODE="$(curl -sL --max-time 5 -o /dev/null -w '%{http_code}' "$FETCH" 2>/dev/null)"
  [ -z "$CODE" ] && CODE="000"
  printf '  id=%-8s host=%-52s http=%s\n' "$ID" "$HOST" "$CODE"
  echo "$HOST" >> /tmp/p1b_hosts.txt
  [ "$CODE" = "000" ] && FAILED=$((FAILED+1))
done
echo
echo "host distribution:"
sort /tmp/p1b_hosts.txt | uniq -c | sort -rn | sed 's/^/  /'
echo
echo "failed to resolve: $FAILED of 20"
echo
echo "==================================================================="
echo "total eth_call requests issued: $(calls)"
echo "==================================================================="
