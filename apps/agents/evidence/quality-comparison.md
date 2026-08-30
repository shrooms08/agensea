# Quality comparison — agent vs DIY, per task

Method note, stated up front: the DIY runs were performed by Minos with help
from an AI chat assistant for directions and arithmetic. That is the realistic
2026 baseline — the comparison is not "agent vs unaided human", it is "hired
agent vs a capable operator using every free tool available". Timings are his
stopwatch; nothing here is estimated.

Both arms ran the identical frozen inputs. The runs happened hours apart, so
tick/rate drift between them reflects the market moving, not disagreement —
each claim below is judged against chain state at ITS OWN read time.

---

## T1 — Venus health factor · **the agent was right and the DIY answer was wrong**

| | agent (job 795) | DIY |
|---|---|---|
| health factor | **3.4607** | **∞ (no borrows)** |
| borrowed | $6,440.74 (USDT) | $0 |
| markets found | 9 | 7 |
| collateral USD | $28,682.85 | ≈$29,000 ✓ |

**Adjudication — verified on chain, not by comparing the two files:**
`getAssetsIn(wallet)` returns **11 markets**, including vUSDT;
`vUSDT.borrowBalanceStored(wallet)` = **6,441.45 USDT** (agent's 6,440.74 +
interest accrued between reads). The wallet has real debt. HF ∞ is wrong.

**Root cause — a method failure, not an operator failure.** The wallet's vUSDT
market holds **$0.002 of supply** against **$6.4K of borrow**. Any manual route
that enumerates markets from visible token balances (which is what BscScan
shows you) will never surface a market you supplied dust to — and that is
exactly where the entire debt sat. The only reliable enumeration is
`getAssetsIn`, which the sheet listed but which is easy to skip once the
Venus app route fails and time pressure mounts. The agent enumerates
`getAssetsIn` unconditionally on every run.

**Stakes:** this is the risk-monitoring task. The DIY conclusion — "no price
move can liquidate this wallet" — is the exact wrong answer to give the owner
of a leveraged position. The DIY output also could not have been proven wrong
later: it is prose in a file. The agent's answer is hash-committed on chain at
block 118945982 and re-derivable by anyone.

## T2 — PancakeSwap V3 position (TRADING) · **agreement; agent more precise, DIY added one insight**

| | agent (job 796, block 118946049) | DIY (later; pool had moved) |
|---|---|---|
| in range | NO ✓ | NO ✓ |
| current tick | −3579 | −3479 (market drift between runs, both correct) |
| composition | 100% ASTER, **10,351.6674 exact** | "100% ASTER" (qualitative) |
| uncollected fees | 0 ✓ | 0 ✓ |
| recommended range | [−4050, −3110] | [−3950, −3010] |
| extra fields | rangeWidthPct 1564.9, distanceToEdge, exact prices | — |

Same verdict, same fee tier, same-width re-centred recommendation — the two
ranges differ only because each is centred on the tick at its own read time.
The agent quantifies what DIY states qualitatively (exact token amount, range
width %). **DIY's unique contribution:** it flags that the range sits two
orders of magnitude above the market — i.e. the position looks misconfigured
at creation, not merely drifted out. The agent's output implies this
(priceLower 111 vs priceCurrent 0.70) but never says it. Legitimate credit to
the human eye; noted as an agent improvement.

## T3 — BTCB yield route · **same ranking; different Lista methods; one insight each**

| | agent (job 797) | DIY |
|---|---|---|
| Lista | **0.9200%** realised (share-price growth, 10.42d window, blocks cited) | **0.39%** as published by the app |
| Venus | 0.1771% (on-chain rate) | 0.17% ✓ |
| Aave V3 | 0.0199% (on-chain rate) | 0.02% ✓ |
| best venue | Lista ✓ | Lista ✓ |
| break-even | 0.06 days | 0.28 days |

Venus and Aave agree to the displayed precision. The Lista gap is METHOD, not
error: the agent derives a realised trailing APR from ERC-4626 share-price
growth (verifiable — both blocks cited); the app publishes a forward rate.
Both defensible; the agent's is reproducible, the app's is not. Ranking and
recommendation identical either way.

**DIY's unique contribution — and it matters:** the vault is only **$119.2K
TVL, so a $10K deposit is ~8% of the vault** and the rate may not survive the
deposit itself. The agent does not consider position-size impact at all. That
is the single best DIY finding across all three tasks; recorded as a concrete
agent improvement (add TVL + size-impact caveat to the yield agent).

---

## Summary

| | T1 | T2 | T3 |
|---|---|---|---|
| agent time (hire→verified) [M] | 29.0s | 20.0s | 18.0s |
| DIY time [M, Minos] | 12m13s † | 5m50s | 6m04s |
| speed-up | **25×** † | **17.5×** | **20×** |
| agent cost [M] | 1 $U + $0.130 | 1 $U + $0.129 | 1 $U + $0.127 |
| DIY cost | $0 + 12m13s of operator | $0 + 5m50s | $0 + 6m04s |
| correctness | **agent right, DIY wrong on HF** (chain-adjudicated) | agree | agree (method split on Lista, ranking same) |
| verifiability | hash on chain, re-derivable | prose file | hash + cited blocks vs published-rate screenshot |
| unique DIY insight | — | "range mispriced at creation" | vault-size caveat |

† T1 time discrepancy: the message said **12m13s**, the file records **8:13**.
The table uses the message figure pending Minos's confirmation; at 8m13s the
speed-up is 17×. Either way the conclusion is unchanged.

The one-line version the report will argue: **the agent was 17–25× faster,
cost ~$1.13 a task — and on the task where correctness carried real stakes,
the manual route produced a confidently wrong answer that only the agent's
on-chain, re-derivable output could have exposed.**
