# DIY arm — timing sheets for Minos

One sheet per task. **Run each once, timed.** Start and stop definitions are
strict so the two arms measure the same thing:

- **START** the clock at the moment you begin the first step (tools may already
  be open in tabs — the agent's clock likewise starts at the hire call, not at
  infrastructure setup).
- **STOP** when you have every field in the "done means" list written down in
  one place (file or notes). Formatting doesn't count; completeness does.
- Record: total minutes:seconds, and (optionally) anything you *couldn't* get.
- Do not look at the agent outputs first — they bias what "done" feels like.
- If a step fails, keep the clock running while you find another way; that is
  the honest cost of the manual route.

Frozen inputs (identical to the agent arm — do not substitute):

```
T1 wallet : 0xb76b35db3f2a7d8346013d9b02edbf756cf27c72   (Venus, BSC mainnet)
T2 tokenId: 6801109  (PancakeSwap V3 ASTER/USDT 0.05%, BSC mainnet)
T3 asset  : BTCB, $10,000 position (Venus vs Aave V3 vs Lista, BSC mainnet)
```

---

## T1 — Venus health factor (wallet 0xb76b…c72)

Suggested route (any public tools are allowed; these are the obvious ones):
1. Open app.venus.io → paste the wallet in the account/portfolio view, or use
   BscScan `0xfD36E2c2a6789Db23113685031d7F16329158384` (Unitroller) → Read as
   Proxy → `getAssetsIn(wallet)`, then per vToken: `balanceOfUnderlying`,
   `borrowBalanceStored`, and the Comptroller's `markets(vToken)` for the
   collateral factor.
2. Price each asset (any price source; note which you used).
3. Compute: total collateral USD, borrowed USD, weighted collateral
   (Σ collateral×CF), health factor = weighted/borrowed, % price drop to
   liquidation, and write a one-line risk verdict.

**Done means all of:** health factor (number) · risk level (your words) ·
collateral USD · borrowed USD · per-market list (asset, supplied, borrowed) ·
liquidation threshold used · % drop to liquidation · a recommendation sentence.

- time: ____ : ____
- anything unobtainable: ______________________________________

## T2 — PancakeSwap V3 position 6801109  ← the trading task

1. BscScan `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364`
   (NonfungiblePositionManager) → Read → `positions(6801109)`:
   token0/token1/fee/tickLower/tickUpper/liquidity/tokensOwed.
2. Find the pool (factory `getPool(token0, token1, 500)` or the pair's info
   page) → `slot0()` for the current tick.
3. Convert ticks to prices (1.0001^tick, adjust decimals), state in/out of
   range, position composition (which token it currently sits in),
   uncollected fees, and propose a re-centred range of the same width.

**Done means all of:** in-range yes/no · current tick + both bound ticks ·
prices for all three · composition (amounts or "all in X") · uncollected
fees · a recommended new range (two numbers) with one line of reasoning.

- time: ____ : ____
- anything unobtainable: ______________________________________

## T3 — BTCB best supply route ($10,000)

1. Venus: vBTC `0x882C173bC7Ff3b7786CA16dfeD3DFFfb9Ee7847B` →
   `supplyRatePerBlock()` × blocksPerYear (interestRateModel) → APR. (Or read
   the rate off app.venus.io.)
2. Aave V3 BSC: pool `0x6807dc923806fE8Fd134338EABCA509979a7e0cB` →
   `getReserveData(BTCB)` → currentLiquidityRate / 1e27 → APR. (Or app.aave.com.)
3. Lista: the BTCB vault has NO spot-rate getter — derive a trailing APR from
   ERC-4626 share-price growth (`convertToAssets` now vs an older block), or
   find their published rate and note the source.
4. Rank, estimate gas to switch (withdraw+approve+deposit at current gas
   price), compute break-even days on $10,000.

**Done means all of:** three APRs with the method noted per venue · the best
venue · gas cost in USD · break-even period · a recommendation sentence.

- time: ____ : ____
- anything unobtainable: ______________________________________

---

When done, drop your three outputs (any format — notes, screenshots, files)
into `apps/agents/evidence/` as `T1-diy.*`, `T2-diy.*`, `T3-diy.*` and give me
the three times. Screenshots welcome — the verifiability comparison will use
them as-is.
