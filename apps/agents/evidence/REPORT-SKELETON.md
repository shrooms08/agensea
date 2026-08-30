# Agent Advantage Report — AgenSea × TermiX
<!-- SKELETON. Headings mirror the four scored criteria verbatim. Evidence
     slotted; prose written only after Minos reviews this structure. -->

**Marketplace:** https://agensea-navy.vercel.app · agents on BNB Smart Chain
Testnet (97), analyses on BSC mainnet (56)
**Method:** three real tasks, frozen inputs (`evidence/inputs.json`), run both
ways. Every number tagged [M]easured with its source. No estimated timings.

## 1. Value of the services (30%)
<!-- price/speed vs the alternative -->
- Price per job: 1 $U + ~$0.13 gas [M: evidence/hire-arm.json]
- Time to verified deliverable: T1 29.0s · T2 20.0s · T3 18.0s [M]
- DIY time: T1 12m13s† · T2 5m50s · T3 6m04s  [M: Minos, timed runs]
  († file records 8:13 — awaiting confirmation; conclusion unchanged either way)
- ⟨prose after review⟩

## 2. Proven agent advantage (30%) — the evidence table

| | T1 Venus health | T2 PCS V3 position (TRADING) | T3 yield route |
|---|---|---|---|
| frozen input | wallet 0xb76b…c72 | tokenId 6801109 | BTCB, $10k |
| **agent: time** hire→verified [M] | 29.0s | 20.0s | 18.0s |
| agent: analysis alone [M] | 13.0s | 4.2s | 3.0s |
| **agent: cost** [M] | 1 $U + $0.1301 | 1 $U + $0.1287 | 1 $U + $0.1274 |
| agent: job / txs [M] | 795 · hire 0x0aaf7e47… · submit 0x1f033937… | 796 · 0x7c47064f… · 0x46504f1a… | 797 · 0x83e5df9a… · 0xbc8efe33… |
| agent: verified on chain [M] | hash match ✓ | hash match ✓ | hash match ✓ |
| agent: output file | `T1-agent-analysis.json` | `T2-agent-analysis.json` | `T3-agent-analysis.json` |
| **DIY: time** [M] | 12m13s† | 5m50s | 6m04s |
| DIY: cost | $0 + operator time | $0 + operator time | $0 + operator time |
| DIY: output file | `T1-diy.md` | `T2-diy.md` | `T3-diy.md` |
| DIY: verifiability | notes/screenshot | notes/screenshot | notes/screenshot |
| quality diff | **agent right, DIY WRONG on HF** — chain-adjudicated (missed vUSDT borrow $6,441; getAssetsIn=11 vs 7 found) | agree on all facts; agent exact amounts; DIY adds "mispriced at creation" insight | same ranking; Lista method split (realised 0.92% vs published 0.39%); DIY adds vault-size caveat |

Verifiability difference (applies to all three): the agent deliverable's
keccak256 is stored in `job.deliverable` on chain 97 and re-derivable by
anyone (VERIFY button on the site, or `cast` — commands in each agent page).
The DIY output is whatever the operator wrote down.

## 3. High-stakes categories & track record (20%)
- T2 is the trading-category task (PancakeSwap V3 position analysis).
- **Track-record honesty (stated, not hidden):** our trading-adjacent agents
  are ADVISORY — they recommend parameters and analyse positions; they do not
  take positions, hold inventory, or execute trades. **No win rate exists and
  none is claimed.** What is evidenced instead: every recommendation is
  hash-verifiable, reproducible from public chain state at the stated block,
  and checkable against that state by a third party (commands included).
- ⟨prose after review⟩

## 4. Marketplace quality (20%)
- Find/compare: live site, categories, VERIFY.  ⟨prose after review⟩
- Completion counts: 5 -> 8 COMPLETED [M]; live site renders "8 completed jobs"
- Known gap, stated honestly: hiring currently requires the documented
  script path, not a UI button. ⟨decide with Minos how to phrase / whether a
  UI hire ships before the deadline⟩

## Appendix — evidence folder
inputs.json · hire-arm.json · T{1,2,3}-agent-{analysis,deliverable}.json ·
T{1,2,3}-diy.md · DIY-TIMING-SHEETS.md · quality-comparison.md · settle txs in hire-arm.json
