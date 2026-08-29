#!/usr/bin/env bash
# P9 - sample agent metadata resolution. Up to 5 distinct agentIds from P7
#      (fallback P8). Detect which of agentURI(uint256) / tokenURI(uint256) the
#      IdentityRegistry actually exposes, resolve each URI over HTTP (5s
#      timeout), report shape only.
#
# The registry read is a CURRENT-STATE call at head, so it uses BSC_RPC. Only
# the agentId discovery upstream of it needs the historical source.
set -uo pipefail
. "$(dirname "$0")/_lib.sh"

echo "## P9"
echo
echo '```'

# --- resolve proxy -> implementation before scanning selectors ---
# P2 showed both registries are 130-byte contracts embedding the ERC-1967
# implementation slot, i.e. proxies. Scanning proxy bytecode for a function
# selector is a guaranteed false negative; the selectors live in the impl.
ERC1967_IMPL_SLOT=0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
rl_rpc
SLOT_RAW="$(lc "$(cast storage "$IDENTITY_REGISTRY_LC" "$ERC1967_IMPL_SLOT" --rpc-url "$BSC_RPC" 2>&1 | redact | tr -d '[:space:]')")"
echo "IdentityRegistry: $IDENTITY_REGISTRY_LC  (lowercased)"
echo "ERC-1967 implementation slot read:"
echo "  slot  $ERC1967_IMPL_SLOT"
echo "  value $SLOT_RAW"
TARGET="$IDENTITY_REGISTRY_LC"; TARGET_KIND="proxy (impl unresolved)"
if [[ "$SLOT_RAW" =~ ^0x0*([0-9a-f]{40})$ ]]; then
  IMPL="$(lc "0x${BASH_REMATCH[1]}")"
  if [ "$IMPL" != "0x0000000000000000000000000000000000000000" ]; then
    TARGET="$IMPL"; TARGET_KIND="implementation behind ERC-1967 proxy"
    echo "  -> implementation: $IMPL"
  else
    echo "  -> slot is zero: not an ERC-1967 proxy, or a different proxy pattern"
    TARGET_KIND="non-ERC1967"
  fi
else
  echo "  -> slot did not decode to an address"
fi
echo "selector scan target: $TARGET  ($TARGET_KIND)"
echo
CODE="$(lc "$(cast code "$TARGET" --rpc-url "$BSC_RPC" 2>/dev/null | tr -d '[:space:]')")"
echo "target bytecode bytes: $(( (${#CODE} - 2) / 2 ))"
SIG_AGENT="$(lc "$(cast sig 'agentURI(uint256)' 2>/dev/null)")"
SIG_TOKEN="$(lc "$(cast sig 'tokenURI(uint256)' 2>/dev/null)")"
HAS_AGENT=no; HAS_TOKEN=no
echo "$CODE" | grep -q "${SIG_AGENT#0x}" && HAS_AGENT=yes
echo "$CODE" | grep -q "${SIG_TOKEN#0x}" && HAS_TOKEN=yes
echo "selector scan of IdentityRegistry implementation runtime bytecode:"
echo "  agentURI(uint256) $SIG_AGENT  present: $HAS_AGENT"
echo "  tokenURI(uint256) $SIG_TOKEN  present: $HAS_TOKEN"

# Try the getter the bytecode actually advertises first.
if [ "$HAS_AGENT" = "yes" ]; then ORDER="agentURI tokenURI"; else ORDER="tokenURI agentURI"; fi
echo "  call order: $ORDER"
echo

# --- pick up to 5 agentIds (already lowercased by P7/P8) ---
SRC=P7
IDFILE="$OUT/p7_agentids.txt"
if [ ! -s "$IDFILE" ]; then SRC=P8; IDFILE="$OUT/p8_agentids.txt"; fi
if [ ! -s "$IDFILE" ]; then
  SPAN="$(cat "$OUT/p7_span.txt" 2>/dev/null | tr -d '[:space:]' || echo 0)"
  echo "no agentIds available from P7 or P8 - nothing to resolve"
  echo "  P7 coverage window was: ${SPAN:-0} blocks"
  echo '```'
  echo
  if [ "${SPAN:-0}" -gt 0 ]; then
    echo "**Conclusion:** no agentIds appear in the ${SPAN}-block coverage window, so metadata resolvability is UNKNOWN. This is a coverage limit, not evidence that no agents exist. BLOCKED on a wider window."
  else
    echo "**Conclusion:** no agentIds were discovered upstream, so metadata resolvability is UNKNOWN. BLOCKED on P7/P8."
  fi
  exit 1
fi
SPAN="$(cat "$OUT/p7_span.txt" 2>/dev/null | tr -d '[:space:]' || echo 0)"
echo "agentId source: $SRC  (from a $SPAN-block coverage window; ids lowercased)"
echo "distinct ids available: $(nlines "$IDFILE")  -> sampling up to 5"
echo

RESOLVED=0; ATTEMPTED=0
while read -r TOPIC; do
  [ -z "$TOPIC" ] && continue
  ATTEMPTED=$(( ATTEMPTED + 1 ))
  ID="$(cast to-dec "$TOPIC" 2>/dev/null || echo "$TOPIC")"
  echo "--- agentId $ID (topic1 $TOPIC)"
  URI=""
  for FN in $ORDER; do
    rl_rpc
    R="$(cast call "$IDENTITY_REGISTRY_LC" "$FN(uint256)(string)" "$ID" --rpc-url "$BSC_RPC" 2>&1 | redact)"
    if [ -n "$R" ] && ! echo "$R" | grep -qi 'error\|revert\|panic'; then
      echo "  \$ cast call $IDENTITY_REGISTRY_LC \"$FN(uint256)(string)\" $ID --rpc-url \"$RPC_MASKED\""
      URI="$(echo "$R" | head -1 | sed 's/^"//; s/"$//')"
      echo "  $FN -> $URI"
      break
    else
      echo "  $FN -> failed: $(echo "$R" | tr '\n' ' ' | cut -c1-120)"
    fi
  done

  if [ -z "$URI" ]; then
    echo "  RESULT: no resolvable URI getter"
    echo; continue
  fi
  RESOLVED=$(( RESOLVED + 1 ))

  # Scheme detection is case-insensitive: a URI may arrive as HTTPS:// or IPFS://.
  URI_LC="$(lc "$URI")"
  case "$URI_LC" in
    https://*) SCHEME=https ;;
    http://*)  SCHEME=http  ;;
    ipfs://*)  SCHEME=ipfs  ;;
    data:*)    SCHEME=data  ;;
    ar://*)    SCHEME=arweave ;;
    *)         SCHEME=other ;;
  esac
  echo "  scheme: $SCHEME"

  FETCH="$URI"
  if [ "$SCHEME" = "ipfs" ]; then
    FETCH="https://ipfs.io/ipfs/$(printf '%s' "$URI" | sed 's|^[Ii][Pp][Ff][Ss]://||')"
    echo "  gateway: https://ipfs.io/ipfs/..."
  fi

  if [ "$SCHEME" = "data" ]; then
    if echo "$URI" | grep -q ';base64'; then
      PAYLOAD="$(printf '%s' "${URI#*,}" | base64 -d 2>/dev/null || echo '')"
    else
      PAYLOAD="${URI#*,}"
    fi
    HTTP_CODE="n/a (inline data URI)"
  else
    BODY="$(curl -sL --max-time 5 -w '\n__HTTP__%{http_code}' "$FETCH" 2>/dev/null || printf '\n__HTTP__000')"
    HTTP_CODE="${BODY##*__HTTP__}"
    PAYLOAD="${BODY%$'\n'__HTTP__*}"
  fi
  echo "  http status: $HTTP_CODE"

  if echo "$PAYLOAD" | jq -e 'type=="object"' >/dev/null 2>&1; then
    echo "  parses as JSON: yes"
    echo "  top-level keys: $(echo "$PAYLOAD" | jq -r 'keys_unsorted | join(", ")')"
  else
    echo "  parses as JSON: no"
  fi
  echo
done <<< "$(head -5 "$IDFILE")"

echo "sampled: $ATTEMPTED   resolved to a URI: $RESOLVED"
echo '```'
echo
echo "**Conclusion:** $RESOLVED of $ATTEMPTED sampled agentIds resolved to a metadata URI via \`$(echo $ORDER | cut -d' ' -f1)\` on the IdentityRegistry. Per-agent rows above record URI scheme, HTTP status, and whether the metadata parses as JSON - this determines whether the marketplace can render agent metadata at all. Sample is drawn from $SRC's ${SPAN}-block coverage window."
