# T2 — PancakeSwap V3 position 6801109, DIY run
time: 5:50

Route: BscScan read-contract (NonfungiblePositionManager → factory → pool)
Assisted by an AI chat assistant (directions + tick math guidance)

## Position (positions(6801109) on 0x46A15B0b27311cedF172AB29E4f4766fbE7F4364)
token0: 0x000Ae314E2A2172a039B26378814C252734f556A  (ASTER)
token1: 0x55d398326f99059fF775485246999027B3197955  (USDT)
fee: 500 (0.05%)
tickLower: 47100
tickUpper: 48040
liquidity: 2375811483877499950463887 (~2.376e24)
tokensOwed0: 0
tokensOwed1: 0

## Pool
getPool(token0, token1, 500) → 0x7E58f160B5B77b8B24Cd9900C09A3E730215aC47
slot0 → tick: -3479

## Answers
In range: NO — current tick -3479 is far below tickLower 47100
Composition: 100% ASTER (current tick below the entire range)
Uncollected fees: 0 (tokensOwed0/1 both zero; out of range, earning
nothing)

## Prices (1.0001^tick; negative tick → reciprocal; both tokens
18-decimal, no adjustment)
current (tick -3479):  ≈ 0.706 USDT per ASTER
lower  (tick 47100):   ≈ 111.2 USDT per ASTER
upper  (tick 48040):   ≈ 122.2 USDT per ASTER

Note: the range prices sit two orders of magnitude above the market —
this range was set far above where ASTER trades, so the position
cannot earn fees at current prices.

## Recommended new range
Same width (940 ticks), re-centred on current tick, rounded to tick
spacing 10: -3950 to -3010
As prices: ≈ 0.674 to 0.740 USDT per ASTER
Reasoning: same width re-centred on the actual market price so the
position earns fees again.

anything unobtainable: live unclaimed fees beyond tokensOwed (V3 only
updates owed amounts on position touch); exact token amounts within
the position (stated as "all in ASTER" per sheet's allowance)