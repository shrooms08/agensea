# Agent Advantage Report — AgenSea

Prepared for the TermiX track. Every figure is measured, not estimated, and
tagged **[M]** with its source. The actual outputs of every run — both arms,
all three tasks — are attached under `apps/agents/evidence/`. This report
supersedes the earlier draft of the same name (28 Aug); the manual arm is now
operator-timed rather than self-timed.

**Marketplace:** https://agensea-navy.vercel.app
**Settlement chain:** BNB Smart Chain Testnet (97) · **Analysis chain:** BSC mainnet (56)
**Method:** three real tasks with frozen inputs (`evidence/inputs.json`), each
run twice — hired through the marketplace via the full ERC-8183 escrow flow,
and manually by an informed operator using public tools with an AI chat
assistant as copilot. The copilot is the honest 2026 baseline: this is not
"agent vs unaided human", and — as T1 shows — the copilot is part of the
manual route's failure surface, not just its speed-up.

---

## 1. Value of the services (30%)

A completed job on AgenSea costs **1 $U plus ~$0.13 of gas** [M:
`hire-arm.json`, buyer + provider balance deltas across each job] and returns
an on-chain-verified deliverable in **18–29 seconds** from the hire call
[M: wall-clock, hire tx sent → deliverable hash matched on chain].

The alternative, measured rather than assumed: the same three tasks took the
operator **8m13s, 5m50s and 6m04s** [M: Minos, stopwatch, procedures in
`DIY-TIMING-SHEETS.md`] — **17–20× slower** — at $0 cash but six to eight
minutes of skilled attention each, and, on one task of three, a wrong result
(§2). The agents' analysis itself takes 3.0–13.0s [M]; the remainder of the
18–29s is escrow transport: hire confirmation, session-key submit, on-chain
verify. Price and speed are not projections — jobs 795, 796 and 797 ran
end-to-end on 30 Aug 2026 and settled to COMPLETED with every tx hash in
`hire-arm.json`.

## 2. Proven agent advantage (30%)

| | T1 Venus health | T2 PCS V3 position (TRADING) | T3 yield route |
|---|---|---|---|
| frozen input | wallet 0xb76b…c72 | tokenId 6801109 | BTCB, $10k |
| **agent: time** hire→verified [M] | 29.0s | 20.0s | 18.0s |
| agent: analysis alone [M] | 13.0s | 4.2s | 3.0s |
| **agent: cost** [M] | 1 $U + $0.1301 | 1 $U + $0.1287 | 1 $U + $0.1274 |
| agent: job / txs [M] | 795 · hire 0x0aaf7e47… · submit 0x1f033937… | 796 · 0x7c47064f… · 0x46504f1a… | 797 · 0x83e5df9a… · 0xbc8efe33… |
| agent: verified on chain [M] | hash match ✓ | hash match ✓ | hash match ✓ |
| agent: output file | `T1-agent-analysis.json` | `T2-agent-analysis.json` | `T3-agent-analysis.json` |
| **DIY: time** [M] | 8m13s | 5m50s | 6m04s |
| DIY: cost | $0 + operator time | $0 + operator time | $0 + operator time |
| DIY: output file | `T1-diy.md` | `T2-diy.md` | `T3-diy.md` |
| quality | **agent right, DIY wrong** | agree; agent more precise | same ranking, methods differ |

**The finding that matters most was adjudicated on chain, not by comparing
files.** On T1 — the risk task — the manual arm concluded the wallet had zero
borrows and an infinite health factor. The chain disagrees:
`getAssetsIn(wallet)` returns 11 markets (the manual route found 7), and
`vUSDT.borrowBalanceStored(wallet)` returns **6,441 USDT** of live debt [M].
The corrected picture is ~$6.4k borrowed against ~$29k supplied — **a real,
finite health factor of 3.46, not ∞**.

The cause is structural, not carelessness. The copilot steered the run to
token-balance enumeration — faster than the procedure's `getAssetsIn` step,
and blind by construction: a borrow needs no visible token balance, and the
market carrying this wallet's entire debt held $0.002 of supply. So an
informed user with an AI copilot produced a confidently wrong answer, in the
reassuring direction, on the one task where wrongness carries liquidation
risk. The agent enumerates `getAssetsIn` unconditionally; that shortcut is
not available to it.

On T2 and T3 the arms agree on every verdict. Honest credits to the manual
arm, both recorded as planned agent improvements: on T2 it observed the range
was mispriced at creation (~150× above market), which the agent's numbers
imply but never state; on T3 it caught that a $10k deposit is ~8% of Lista's
$119.2k vault, a position-size effect the agent ignores. T3's Lista rates
differ by method, not error — the agent derives a realised 0.92% from
ERC-4626 share-price growth with both blocks cited; the app publishes 0.39%.
Same ranking either way.

**Verifiability is the asymmetry that survives any argument about minutes.**
Each agent deliverable's keccak256 is stored in `job.deliverable` on chain 97;
anyone can refetch the manifest, re-canonicalise, re-hash and compare — the
site's VERIFY button does it in the browser, and the equivalent `cast`
commands are printed beside it. The manual outputs are whatever the operator
wrote down. When the two arms disagreed, only one of them could be checked.

## 3. High-stakes categories & track record (20%)

T2 is the trading-category task: analysis of a live PancakeSwap V3
concentrated-liquidity position, out of range, with an actionable re-centring
recommendation.

**Track-record honesty, stated rather than hidden:** these agents are
advisory. They analyse positions and recommend parameters; they do not take
positions, hold inventory, or execute trades. **No win rate exists and none
is claimed** — a win rate constructed from advisory outputs would be the kind
of manufactured metric this report exists to avoid. What is evidenced
instead is the property a track record is a proxy for: every recommendation
is hash-committed on chain at a stated block, reproducible from public state
at that block, and checkable by a third party without trusting us. Where the
advisory quality was tested hardest — T1, against a wrong answer from a
capable manual route — the agent was correct, and provably so.

## 4. Marketplace quality (20%)

Find and compare work today, live: category pages, per-agent detail with the
session's exact on-chain permissions (call allowlist, spend cap, expiry), the
measured price and time-to-deliverable for every completed job, and in-browser
VERIFY on every deliverable. The registry explorer behind it indexes 317,468
mainnet agents with every headline figure dated.

Completion counts moved 5 → 8 COMPLETED during this report's runs [M]; the
live site renders "8 completed jobs".

**Hiring is a button — shipped during the hackathon.** Every agent page
carries "Hire — run a live job": a platform-sponsored demo job (1 $U, BNB
testnet, honestly labelled as such) that runs the full ERC-8183 escrow cycle
on press and streams each stage to the page with its transaction link as it
lands — escrow funded, analysis, deliverable submitted, hash verified, and
settlement pending behind the protocol's 900-second dispute window, disclosed
as protocol overhead rather than agent latency. The in-browser VERIFY block
then re-derives the fresh deliverable's hash against the chain. Spend is
rate-limited server-side (2 per visitor per day, 20 globally) and the
endpoint fails closed if the limiter is unreachable. Verified with a real
press before shipping: job 802, five stages, hash match. What remains on the
roadmap, stated plainly: self-custodial hiring from the visitor's own wallet,
session-scoped via Altana — today's button spends platform funds, not yours.

## Limitations

- The 900-second dispute window before settlement is protocol overhead, not
  agent latency; time-to-deliverable is reported separately from it.
- Settlement runs on testnet 97; analyses read mainnet 56 state. Mainnet
  registration of the four agents costs ~$0.30 at 2× current gas [M].
- Each arm ran once per task. The timings are honest single measurements,
  not distributions; agent execute fees were previously observed to vary ~11%
  run to run.
- The two arms ran hours apart; where chain state moved between them (T2's
  current tick), both readings were correct at their own read time.

## Appendix — evidence (`apps/agents/evidence/`)

`inputs.json` (frozen inputs, live-verified before pinning) ·
`hire-arm.json` (timings, costs, all 12 tx hashes, settle txs) ·
`T{1,2,3}-agent-analysis.json` + `T{1,2,3}-agent-deliverable.json` (attached
agent outputs, canonical manifests) · `T{1,2,3}-diy.md` (attached operator
outputs, verbatim) · `DIY-TIMING-SHEETS.md` (the procedures and stop/start
rules) · `quality-comparison.md` (per-task adjudication, including the
on-chain reads that settled T1).
