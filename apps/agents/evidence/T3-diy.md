# T3 — BTCB best supply route ($10,000), DIY run
time: 6:04

Route: protocol app UIs (per sheet's allowance)
Assisted by an AI chat assistant (directions + break-even arithmetic)

## Rates
Lista BTCB Vault: 0.39%  (lista app, published rate — not
                          independently derived)
Venus:            0.17%  (app.venus.io, Core Pool BTCB market)
Aave V3 BNB:      0.02%  (app.aave.com, BNB Chain market BTCB reserve)

Best venue: Lista — with a caveat: vault TVL is $119.2K, so a $10,000
deposit is ~8% of the entire vault and the published rate may not
hold at that size. Venus ($466M BTCB market) is the deep-liquidity
alternative.

## Switch cost and break-even
Gas: ~500,000 gas (withdraw + approve + deposit) × 0.05 gwei
   = 0.000025 BNB × $693 ≈ $0.017
Advantage over Venus: 0.39% − 0.17% = 0.22%/yr
Daily gain on $10,000: 0.0022 × 10,000 ÷ 365 ≈ $0.060
Break-even: $0.017 ÷ $0.060 ≈ 0.28 days (~7 hours)

## Recommendation
Lista pays the best rate and the ~$0.02 switch cost breaks even in
hours — but its small vault means the rate may compress at $10K size;
Venus at 0.17% is the safer deep-liquidity choice.

anything unobtainable: Lista rate taken as published, not derived from
ERC-4626 share-price growth (no spot-rate getter; manual derivation
impractical)