# Agent Advantage Report

**AgenSea — ERC-8004 / ERC-8183 seller agents on BNB Chain**
Prepared for TermiX. All figures are measured, not estimated.

---

## 1. Methodology

Three analytical tasks were each performed **twice**: once by hiring an autonomous
agent through the ERC-8183 job-escrow protocol, and once by hand using public
tooling. Both sides are recorded in full below.

**What was measured**
- Agent side: on-chain transaction hashes, `$U` cost, wall-clock from job FUNDED to
  deliverable SUBMITTED, and the complete deliverable content.
- Manual side: every RPC call issued, the wall-clock from first command to final
  output, and the output produced.

**What was NOT measured**
- Correctness against a ground truth. Both sides read the same contracts; where they
  agree, that is consistency, not independent validation.
- Human cold-start cost. **The manual timings are lower bounds.** The operator
  already knew every contract address, the Aave `ReserveData` struct layout, the
  Venus 7-word `markets()` layout, and the PancakeSwap oracle decode — knowledge that
  took hours to acquire across earlier phases and is not reflected in these numbers.
  A practitioner starting cold would take substantially longer.
- Statistical significance. n=1 per task.

**Environment.** BNB Smart Chain **testnet (chain 97)** for all signing and escrow.
BNB Smart Chain **mainnet (chain 56)** for read-only analysis, because that is where
real positions and real liquidity exist. No mainnet transaction was ever signed.

---

## 2. Results summary

| Task | Agent (funded→deliverable) | Manual | Delta | Agent cost |
|---|---|---|---|---|
| 1 — Grid parameters (trading) | **11.8s** | 51s | agent **4.3× faster** | 1 $U |
| 2 — V3 rebalance analysis | 248.4s | **26s** | **manual 9.6× faster** | 1 $U |
| 3 — Yield route | **8.0s** | 38s | agent **4.8× faster** | 1 $U |

**Manual beat the agent on Task 2.** The agent's 248.4s was two relay timeouts of
~245s each before the submit landed; its actual analysis took 3.8s. That caveat is
real but it does not change the measured number, and a system that times out is
slower in practice than one that does not. Reported as measured.

Excluding transport failure, agent analysis time was **2.4s–5.2s** across all three
tasks versus **26s–51s** manual — but the honest headline is that on one of three
tasks, doing it by hand was faster end to end.

---

## 3. Task 1 — Grid parameters, USDT/WBNB 0.05% (trading)

### Agent side — Agent 3, agentId 2014

```
hire   0x9c5e085aff585a5cdad2b1228b5536308230654ab82bed620f5fb313c204583a
submit 0x1d7fe6528bd1fa526c3f7947487ff374139abe377c313d8139424776e7a0143d
job    754  ->  COMPLETED
cost   1 $U (zero platform fee)
funded -> deliverable  11.8s   (analysis 5227ms)
deliverable hash  0x7923d665c028295136f83593a8afef43b420ad81d8e69c3bef6eaaa9c1af9600
manifest  2195 bytes
```

**Full deliverable:**

```json
{
  "pool": "0x36696169c63e42cd08ce11f5deebbcebae652050",
  "pair": "USDT/WBNB",
  "feeTierPct": 0.05,
  "blockNumber": 118754687,
  "windowHours": 15,
  "samples": 15,
  "currentPrice": 0.001450171865292413,
  "twapPrice": 0.0014515299952656815,
  "hourlyVolPct": 0.15608534496373744,
  "annualisedVolPct": 14.608787829010744,
  "observedLowPrice": 0.001445752265937178,
  "observedHighPrice": 0.0014543471821683578,
  "poolLiquidity": "3203830264900345723174695",
  "lowerBound": 0.0014327443892389832,
  "upperBound": 0.0014678113239743379,
  "gridCount": 15,
  "capitalPerLevelUsd": 666.6666666666666,
  "gridSpacingPct": 0.15608534496373744,
  "expectedFillsPerDay": 4.898979485566356,
  "recommendation": "Over the last 15h the USDT/WBNB 0.05% pool realised 0.1561% hourly volatility (14.6% annualised), trading between 0.00144575 and 0.00145435. A grid from 0.00143274 to 0.00146781 (+/-2 sigma) with 15 levels spaced 0.156% apart puts $666.67 at each level. At the measured volatility that is roughly 4.9 level-crossings per day. Grid trading loses money in a sustained trend \u2014 if price leaves the band you hold the losing side, so treat the bounds as a stop, not a suggestion.",
  "dataWindow": "15h of hourly TWAPs from pool.observe() (24h requested; oracle retained 15h), 15 samples, ending at block 118754687",
  "assumptions": [
    "volatility is REALISED over the stated window only \u2014 it is not a forecast",
    "bounds are +/-2 sigma assuming log-normal returns; crypto returns are fat-tailed, so breaches are more likely than 5%",
    "expected fills are a crossings estimate from realised vol / grid spacing, NOT a backtest \u2014 no historical fill simulation was run",
    "capital per level is a naive equal split; no inventory or fee modelling",
    "pool fee tier 0.05% is charged per fill and is not netted out of the estimate"
  ]
}
```

### Manual side — 51s

Commands actually issued:

```bash
cast call 0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865 \
  "getPool(address,address,uint24)(address)" $WBNB $USDT 500 --rpc-url $RPC
cast call $POOL "liquidity()(uint128)" --rpc-url $RPC
cast call $POOL "slot0()(uint160,int24,uint16,uint16,uint16,uint32,bool)" --rpc-url $RPC
# probe oracle retention by hand — 86400s -> OLD, 43200s -> OK, 57600s -> OK
cast call $POOL "observe(uint32[])(int56[],uint160[])" "[86400]" --rpc-url $RPC
cast call $POOL "observe(uint32[])(int56[],uint160[])" "[54000,50400,...,0]" --rpc-url $RPC
# then: parse tickCumulatives, difference to hourly TWAP ticks, log returns,
#       stdev, annualise, +/-2 sigma bounds, grid count, spacing, crossings
```

Output: hourly vol **0.1583%**, annualised **14.82%**, grid
`[0.0014335007, 0.0014690921]`, 15 levels @ 0.158%, $666.67/level, ~4.9 crossings/day.

The first parse attempt failed — a regex matched cast's scientific-notation
annotations instead of the integers — costing a retry. That failure is included in
the 51s.

### Comparison

| | Agent | Manual |
|---|---|---|
| Hourly vol | 0.1561% | 0.1583% |
| Annualised | 14.61% | 14.82% |
| Grid levels | 15 @ 0.156% | 15 @ 0.158% |

Same answer; the small delta is a different 15h window. **The agent's output also
carried** an explicit `dataWindow` string recording that 24h was requested but the
oracle only retained 15h, and five stated assumptions including "no backtest was
run". **The manual output carried none of that** — the retention limit was
discovered but not written down, which is exactly how a caveat gets lost between
analyst and reader.

**What manual had that the agent did not:** nothing on this task.

---

## 4. Task 2 — PancakeSwap V3 rebalance, position 6801109

### Agent side — Agent 2, agentId 2013

```
hire   0x1bbe19999291d9f250016bdd35a4b17e6598995949a55f35881dbeffaa409954
submit 0xc0a673cf752d0fa9b6ab4cfc99430565a99ad8e7e505d04aa4e31d5b1467db73
settle 0x22de5aff7e3708f26f95945941f67cae75413ff40929ff9ef6afea4a152dae41
job    757  ->  COMPLETED
cost   1 $U
funded -> deliverable  248.4s   (analysis 3816ms)
deliverable hash  0x9265db4ab38322fd1b76bd704b1cbfcd023356f0d154bc6ca909c0c9bd4bd5e9
```

**Full deliverable:**

```json
{
  "tokenId": "6801109",
  "pool": "0x7e58f160b5b77b8b24cd9900c09a3e730215ac47",
  "fee": 500,
  "token0": {
    "address": "0x000ae314e2a2172a039b26378814c252734f556a",
    "symbol": "ASTER",
    "decimals": 18
  },
  "token1": {
    "address": "0x55d398326f99059ff775485246999027b3197955",
    "symbol": "USDT",
    "decimals": 18
  },
  "tickLower": 47100,
  "tickUpper": 48040,
  "currentTick": -3579,
  "inRange": false,
  "liquidity": "5227473592648299221393621",
  "priceCurrent": 0.6991587214055577,
  "priceLower": 111.02601194421,
  "priceUpper": 121.96813425826302,
  "amount0": 22776.66740000344,
  "amount1": 0,
  "uncollectedFees0": 0,
  "uncollectedFees1": 0,
  "tokensOwed0": 0,
  "tokensOwed1": 0,
  "rangeWidthPct": 1565.041238712644,
  "distanceToEdgePct": 0,
  "recommendedLower": -4050,
  "recommendedUpper": -3110,
  "recommendation": "OUT OF RANGE \u2014 price is below the position's band, so it is earning NO fees and sits entirely in ASTER. Re-centre to ticks [-4050, -3110] (same width, centred on the current tick -3579) to resume earning. Re-entering realises the divergence loss already incurred; holding does not recover it while out of range.",
  "blockNumber": 118754877
}
```

### Manual side — 26s

```bash
cast call $NFPM "positions(uint256)(uint96,address,address,address,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128)" 6801109 --rpc-url $RPC
cast call $FACTORY "getPool(address,address,uint24)(address)" $ASTER $USDT 500 --rpc-url $RPC
cast call $POOL "slot0()(uint160,int24,uint16,uint16,uint16,uint32,bool)" --rpc-url $RPC
cast call $ASTER "symbol()(string)" --rpc-url $RPC   # and decimals, x2
# then: 1.0001^tick for range bounds, compare to current tick, V3 amount formula
```

Output: ticks [47100, 48040] vs current −3595 → **OUT OF RANGE**, price 0.698 vs band
[111.03, 121.97], **23,489.67 ASTER + 0 USDT**, width 1567.6%, recommended re-centre
[−4060, −3120].

### Comparison

Both reached the same conclusion. Differences:

**Agent output contained, manual did not:** uncollected fee accounting
(`feeGrowthInside` deltas against `tokensOwed`, both zero here), an explicit
`inRange` boolean, `distanceToEdgePct`, and a recommendation stating that re-entering
*realises* the divergence loss while holding does not recover it.

**Manual output contained, agent did not:** nothing material — but manual was
**9.6× faster end to end**, and on a single ad-hoc question that matters more than
the extra fields.

The honest read: for a one-off look at one position, a competent operator with the
addresses to hand beats hiring an agent. The agent's case is repetition, provenance,
and the caveats surviving into the record — not speed on a single lookup.

---

## 5. Task 3 — Best BTCB supply route

### Agent side — Agent 4, agentId 2015

```
hire   0xc6dc1c9d0bbc6b08c6b1cb21e969d37a42f17fecf65da6508fd511a798b06d04
submit 0xd26d8dd7807b6ecb943d176c5d78c4e1e55538b8cf8e8f31c986872e9b3a80ce
job    753  ->  COMPLETED
cost   1 $U
funded -> deliverable  8.0s   (analysis 2404ms)
deliverable hash  0x58bb1271cb01d9a061d23caacf5064c621c88f77fed2c634a2ce199d31195c97
```

**Full deliverable:**

```json
{
  "asset": "BTCB",
  "chainId": 56,
  "blockNumber": 118754715,
  "venues": [
    {
      "venue": "Lista",
      "asset": "BTCB",
      "supplyAprPct": 0.9986887011612124,
      "spot": false,
      "method": "ERC-4626 share-price growth over 2000000 blocks, annualised (REALISED, not spot)",
      "detail": {
        "sharePriceNow": "1003835908989386159",
        "sharePriceThen": "1003549778796098704",
        "windowDays": "10.42",
        "fromBlock": 116754717,
        "toBlock": 118754717
      }
    },
    {
      "venue": "Venus",
      "asset": "BTCB",
      "supplyAprPct": 0.17894622451199999,
      "spot": true,
      "method": "supplyRatePerBlock() x interestRateModel.blocksPerYear()",
      "detail": {
        "supplyRatePerBlock": "25534564",
        "blocksPerYear": "70080000",
        "interestRateModel": "0x7d47671514a1b13f0e376d70fcf13b2eb2694c3a"
      }
    },
    {
      "venue": "Aave V3",
      "asset": "BTCB",
      "supplyAprPct": 0.02006810429773286,
      "spot": true,
      "method": "Pool.getReserveData(asset).currentLiquidityRate (ray)",
      "detail": {
        "currentLiquidityRate": "200681042977328585351671",
        "ray": "1e27"
      }
    }
  ],
  "best": {
    "venue": "Lista",
    "asset": "BTCB",
    "supplyAprPct": 0.9986887011612124,
    "spot": false,
    "method": "ERC-4626 share-price growth over 2000000 blocks, annualised (REALISED, not spot)",
    "detail": {
      "sharePriceNow": "1003835908989386159",
      "sharePriceThen": "1003549778796098704",
      "windowDays": "10.42",
      "fromBlock": 116754717,
      "toBlock": 118754717
    }
  },
  "gasCostToSwitchTBnb": 2.25e-05,
  "gasCostUsd": 0.0154575,
  "breakEvenDays": 0.05765244996971052,
  "positionSizeUsd": 10000,
  "recommendation": "Move to Lista at 0.9987% (from Aave V3 at 0.0201%). On $10,000 the spread is $97.86/yr against $0.02 of gas; break-even in 0.1 days. Worth it if you hold longer than that.",
  "assumptions": [
    "gas: 450000 units for withdraw+approve+deposit at the live eth_gasPrice",
    "BNB priced at $687 for the gas conversion",
    "Lista's figure is a REALISED trailing APR from share-price growth (no spot-rate getter exists); Venus and Aave are spot rates",
    "break-even assumes rates hold constant, which they do not"
  ]
}
```

### Manual side — 38s

```bash
cast call $vBTC "supplyRatePerBlock()(uint256)" --rpc-url $RPC        # 25541095
cast call $vBTC "interestRateModel()(address)" --rpc-url $RPC
cast call $IRM  "blocksPerYear()(uint256)" --rpc-url $RPC             # 70080000
cast call $AAVE_POOL "getReserveData(address)" $BTCB --rpc-url $RPC   # decode word 2 by hand
cast call $LISTA "convertToAssets(uint256)(uint256)" 1e18 --rpc-url $RPC
cast call $LISTA "convertToAssets(uint256)(uint256)" 1e18 --rpc-url $RPC --block $((H-2000000))
cast block $H --field timestamp --rpc-url $RPC   # and the historical block
cast gas-price --rpc-url $RPC
```

Output: **Lista 0.9961% > Venus 0.1790% > Aave 0.0201%**; gas to switch 0.0000225 BNB
($0.0155); spread $97.61/yr on $10k; break-even 0.058 days.

### Comparison

| | Agent | Manual |
|---|---|---|
| Lista | 0.9987% | 0.9961% |
| Venus | 0.1789% | 0.1790% |
| Aave V3 | 0.0201% | 0.0201% |
| Break-even | 0.058 days | 0.058 days |

Identical ranking; Lista differs in the 3rd decimal because the two runs sampled
different blocks.

**Agent output contained, manual did not:** a `spot` boolean per venue flagging that
Lista's figure is a *realised trailing* APR derived from ERC-4626 share-price growth
rather than a spot rate — because Lista exposes no rate getter — plus the raw inputs
(`sharePriceNow`, `sharePriceThen`, `windowDays`, block range) for every venue, and
four stated assumptions.

That distinction is the single most decision-relevant fact in the comparison: it says
the leading number is backward-looking and the two trailing numbers are not. The
manual run computed it correctly and **did not write it down**.

---

## 6. Reproducibility — anyone can verify these deliverables

This is the strongest claim in this report, and it is checkable without trusting us.

`job.deliverable` on-chain is `keccak256(canonical manifest JSON)`. The manifest
itself is carried in `optParams` and emitted by the OptimisticPolicy, so it is
recoverable from a public RPC alone — no API, no server, nothing we control.

```bash
git clone <this repo> && cd agensea
bash scripts/verify_deliverable.sh 753          # Agent 4  — yield route
bash scripts/verify_deliverable.sh 754 --legacy # Agent 3  — grid parameters
bash scripts/verify_deliverable.sh 757 --legacy # Agent 2  — V3 rebalance
bash scripts/verify_deliverable.sh 748 --legacy # Agent 1  — Venus health factor
bash scripts/verify_deliverable.sh 765          # live demo job
```

Each run: reads `job.deliverable` from AgenticCommerce, pulls the manifest out of the
policy event log, re-canonicalises it, re-hashes with keccak256, and compares.

**Verified output — all five confirmed at time of writing:**

```
job 748 --legacy -> MATCH        job 753 (standard) -> MATCH
job 754 --legacy -> MATCH        job 765 (standard) -> MATCH
job 757 --legacy -> MATCH
```

One example in full:

```
on-chain job.deliverable : 0x58bb1271cb01d9a061d23caacf5064c621c88f77fed2c634a2ce199d31195c97
canonical manifest bytes : 2404
recomputed keccak256     : 0x58bb1271cb01d9a061d23caacf5064c621c88f77fed2c634a2ce199d31195c97
RESULT: MATCH — deliverable is authentic
```

### The `--legacy` flag is a real defect, disclosed

bnbagent's reference `schema.py` hashes
`json.dumps(obj, sort_keys=True, separators=(",", ":"))`. Python defaults to
`ensure_ascii=True` and escapes an em-dash as `\u2014`; JavaScript's `JSON.stringify`
emits the raw UTF-8 byte. **Same object, different bytes, different hash.**

Our recommendation strings contain em-dashes, so jobs **748, 750, 752, 754, 757**
were hashed the JavaScript way and verify only with `--legacy` (`ensure_ascii=False`).
Job **753** verifies either way because its text is pure ASCII. The canonicaliser is
now fixed and byte-identical to Python across em-dash, accented Latin, CJK and emoji;
job **765** was produced after the fix and verifies with standard Python defaults.

An earlier cross-language test passed and gave false confidence because it used only
ASCII. Reported upstream at
[altana-sdk#59](https://github.com/altananetwork/altana-sdk/issues/59#issuecomment-5462254512).

---

## 7. Cost model

```
per job          1.0 $U            platform fee: ZERO (measured: provider +1.0 $U exactly)
submit (seller)  ~0.000047 tBNB    measured 47,105,300,000,000 wei
hire (buyer)     ~0.000957 tBNB    5-call atomic batch
settle           ~0.000029 tBNB    permissionless
session grant    ~0.00089 tBNB     one-off, long-lived
identity mint    one-off
```

Granting a session costs ~19× a submit, so an agent that grants once and serves many
jobs is cheap; one that re-grants per task is not.

---

## 8. Limitations

1. **The 900s dispute window is protocol overhead, not agent latency.** Settlement is
   `submittedAt + 900s`, set globally on the OptimisticPolicy. `registerJob` takes no
   window parameter and `disputeWindow()` is a single contract-wide value — a seller
   cannot shorten it. Time-to-deliverable and time-to-settlement are reported
   separately throughout and must not be added together as "agent time".
2. **Agent 2's 248.4s was transport, not analysis.** Two relay timeouts of ~245s each.
   Its analysis was 3.8s. The measured number is reported as measured.
3. **Testnet, not mainnet.** All escrow and signing on chain 97. Analysis reads
   mainnet, so the *data* is real; the *payments* are not.
4. **Manual timings are lower bounds** (see §1).
5. **n=1 per task.** No error bars.
6. **Both sides read the same contracts.** Agreement is consistency, not independent
   verification of correctness.
7. **The Altana SDK has no seller path.** `submit` is driven against AgenticCommerce
   directly ([altana-sdk#59](https://github.com/altananetwork/altana-sdk/issues/59)).
8. **The chain-97 policy address shipped by the SDK is not whitelisted** and is
   overridden with a startup assertion
   ([altana-sdk#53](https://github.com/altananetwork/altana-sdk/issues/53)).

---

## 9. Defects found and reported

| # | Finding | Where |
|---|---|---|
| 1 | `waitForCalls` hangs 240s on unmapped relay status 300 | [altana-sdk#57](https://github.com/altananetwork/altana-sdk/issues/57) |
| 2 | `Session` cannot be persisted as documented; `_privateKey` leaks, `signDigest` lost | [altana-sdk#58](https://github.com/altananetwork/altana-sdk/issues/58) |
| 3 | No ERC-8183 seller path in the SDK | [altana-sdk#59](https://github.com/altananetwork/altana-sdk/issues/59) |
| 4 | Chain-97 policy not whitelisted (confirmed on-chain) | [altana-sdk#53](https://github.com/altananetwork/altana-sdk/issues/53) |
| 5 | **jobId race: a losing racer submits a valid-hash deliverable for the wrong task** | [bnbagent-sdk#82](https://github.com/bnb-chain/bnbagent-sdk/issues/82) |
| 6 | Canonical JSON not cross-language safe without `ensure_ascii` | [altana-sdk#59 comment](https://github.com/altananetwork/altana-sdk/issues/59#issuecomment-5462254512) |

Finding 5 is ours: **job 750** received a PancakeSwap rebalance manifest against a
grid-parameters task. The hash verified. The content answered a different question,
and optimistic settlement released the escrow anyway. Mitigation: identify your job
by comparing `job.description`, not `provider` + `status`.

---

## 10. Demo fixtures

**Pre-settled jobs — no waiting on camera:**

| Job | Agent | Status | Verify |
|---|---|---|---|
| 748 | Venus health factor | COMPLETED | `verify_deliverable.sh 748 --legacy` |
| 753 | Yield route | COMPLETED | `verify_deliverable.sh 753` |
| 754 | Grid parameters | COMPLETED | `verify_deliverable.sh 754 --legacy` |
| 757 | V3 rebalance | COMPLETED | `verify_deliverable.sh 757 --legacy` |

**Live hire on camera — 9.5s funded → deliverable:**

```
job 765
hire   0x0a7de33fbfabcf8da7f2beff847f28d0761a5f2d3e67230dd5fb82e08f542a2c
submit 0x49ef81d43bd226bbe9a6e77d9dd2ff44043399c92e821a17302acdfa498e83e6
bash scripts/verify_deliverable.sh 765    # verifies with NO --legacy flag
```

Job 765 is currently `SUBMITTED` — its 900s dispute window is still running, which is
the correct state for a freshly hired job and what a live demo will show. Jobs 748,
753, 754 and 757 are `COMPLETED` and settle-free.

```
cd apps/agents && ALTANA_CHAIN=97 npx tsx src/scripts/demo_live.ts
```

**Venus health-factor fixture on chain 97** — currently **HF 1.1808** (ELEVATED),
$4.80 collateral / $3.2520 borrowed, 15.31% drop to liquidation.

To move it live (borrow more USDT lowers HF):

```bash
cd apps/agents && ALTANA_CHAIN=97 npx tsx src/scripts/p3b_fixture.ts
```

Note: **HF 1.05 is unreachable by borrowing.** vBNB on chain 97 has collateral factor
0.70 but liquidation threshold 0.80; borrowing is capped by CF while health factor is
measured against LT, so the floor reachable by borrowing is LT/CF = **1.1429**. Only a
price move or accrued interest takes it lower.
