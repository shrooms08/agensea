# AgenSea

## What this is

BSC has **322,974** registered AI agents. **4,353** have ever had a client.
(Both figures from `registry_stats`, measured 31 Aug 2026.)

AgenSea is a marketplace and registry explorer for BNB Chain that measures
which agents are real, and lets you hire the ones that are — and revoke their
permissions — in-product.

Live: https://agensea-navy.vercel.app  
Agent Advantage Report: [AGENT_ADVANTAGE_REPORT.md](AGENT_ADVANTAGE_REPORT.md)  
Try it: [/category/health-factor-monitoring](https://agensea-navy.vercel.app/category/health-factor-monitoring) — Hire runs a real on-chain job, free, in ~10s  
How it works: [/docs](https://agensea-navy.vercel.app/docs) — how we measure, how hiring works, how to verify a deliverable, session keys, and what we have not built

![AgenSea landing — the fan-out curve and the four category cards](docs/landing-1440.png)

## What we measured

Every figure below carries the `measured_at` of the sweep it came from — the
same date the site prints next to each number. Percentages marked *derived*
are computed from those measured values.

- **322,974** ERC-8004 agents minted on BSC mainnet (chain 56) — measured 31 Aug 2026
- **The registry grows ~3,095 agents/day** (*derived*: +5,506 minted between the
  29 Aug 20:53 UTC and 31 Aug 15:36 UTC sweeps) — while the number that have
  ever had a client did not move
- **4,353** have ever had a client — 1.35% of minted and falling (*derived*) —
  measured 31 Aug 2026
- **The fan-out collapse:** those 4,353 agents' **8,265** client relationships come
  from only **108** distinct client addresses, and the top two addresses alone
  account for **35.5%** of all edges (1,800 + 1,137 = 2,937; *derived*).
  Reputation on the registry traces to a small set of payers.
- **B402 Bazaar:** **978** resources from **7** payees, one payee holding
  **96.22%** of the catalogue — measured 31 Aug 2026
- **Exactly one** agent address appears in both datasets — measured 31 Aug 2026

### Cross-checked against 8004scan (surveyed 1 Sep 2026)

We compared our sweep with [8004scan](https://8004scan.io), a third-party
ERC-8004 explorer, on chain 56:

- **They index 295,734 BSC agents against our 322,974** measured from chain —
  8.4% behind.
- **Their API never returns “no data.”** An agent it cannot resolve comes back
  as a synthesized `"Agent #<id>"` with an empty description and
  `metadata_completeness_score: 0.0` — indistinguishable from real metadata
  unless you check for it. We asked them for **all 908** of our agents that
  have a client but no metadata of their own:

  | | agents | share |
  |---|---:|---:|
  | real metadata, stored | 136 | 15.0% |
  | **synthesized `Agent #<id>` placeholder, rejected** | **730** | **80.4%** |
  | blank name, rejected | 31 | 3.4% |
  | name only, nothing behind it, rejected | 11 | 1.2% |

  A 40-agent pre-sample had predicted 52% placeholders. It was drawn from our
  highest fan-out agents, which are far better documented than the tail, so it
  overestimated their coverage by 28 points — the measured figure above is the
  one to trust. The rejection is enforced by a `CHECK` constraint on our table,
  not only by ingest code, so their filler cannot be stored even by accident.
- **8 of 11,780** BSC feedback events carry a numeric score, so their
  `average_score` is not a meaningful figure on this chain.

The units are not the same and we do not treat them as such: our client count
is `getClients()` read live from the ReputationRegistry; theirs is an indexed
feedback event. These are two different quantities, not one quantity measured
twice — which is also why our 4,353 agents-with-a-client and their 582
agents-with-feedback are not a contradiction.

The full write-ups: [AGENT_ADVANTAGE_REPORT.md](AGENT_ADVANTAGE_REPORT.md)
(three frozen tasks, hired agent vs. assisted DIY, with timings and quality
comparison) and [PHASE0_FINDINGS.md](PHASE0_FINDINGS.md) (chain diagnostics).

## What we built

Four first-party agents on BSC testnet (chain 97), one per BNB category, each
with completed ERC-8183 jobs whose deliverable hashes are verifiable on chain:

| Agent | Agent id | Category | A completed job |
|---|---|---|---|
| Venus Health Factor Monitor | 2012 | health-factor-monitoring | 795 |
| PancakeSwap V3 Rebalancing Monitor | 2013 | rebalancing | 796 |
| Grid Trading Parameter Advisor | 2014 | grid-trading | 754 |
| BSC Yield Route Optimiser | 2015 | yield-optimisation | 797 |

Verify one yourself: `bash scripts/verify_deliverable.sh 754 --legacy`
re-derives job 754's on-chain hash from the canonical manifest against a public
RPC and prints `RESULT: MATCH` (`--legacy` because 754 predates the non-ASCII
canonicalisation fix). The manifest shape, the exact hashing rule and the
in-browser path are in [/docs](https://agensea-navy.vercel.app/docs#how-to-verify).

- **Hire flow** — wallet-native on `/marketplace/[id]`: you escrow 1 $U from
  your own wallet, the agent delivers a hash-committed result, and our keeper
  settles after the 900-second dispute window. Testnet funding is one click; a
  sponsored fallback covers wallets with no funds.
  ([the five transactions, step by step](https://agensea-navy.vercel.app/docs#how-hiring-works))
- **Revoke control** — revoke an agent's session on chain from its own page and
  watch the authority read go dead; it self-heals on the next hire.
  ([what a session key can and cannot do](https://agensea-navy.vercel.app/docs#session-keys))
- **Per track**: main — the live marketplace (categories, hire, revoke);
  Altana — session keys granted, scoped, revoked and healed on chain
  (`/marketplace/2012`, session panel); TermiX —
  [AGENT_ADVANTAGE_REPORT.md](AGENT_ADVANTAGE_REPORT.md) with evidence in
  `apps/agents/evidence/`; PancakeSwap — agents 2013 (V3 position analysis)
  and 2014 (grid parameters from the pool's own TWAP oracle).
- **Mainnet identity** — the Venus Health Factor Monitor is also registered in
  the BSC MAINNET (56) ERC-8004 IdentityRegistry: agentId **322885**,
  [tx 0x381cff97…](https://bscscan.com/tx/0x381cff9788d7c6866f56609035a49fa9dca78ed01540884b0557beec4b377807),
  byte-identical metadata. Jobs, sessions and escrow are demonstrated on
  testnet 97 — no mainnet jobs exist.

## Upstream issues filed

Authored by `shrooms08` (GitHub shows the authorship):

- [altana-sdk #57](https://github.com/altananetwork/altana-sdk/issues/57) —
  `waitForCalls` hangs for the full 240 s timeout on unmapped relay status 300
- [altana-sdk #58](https://github.com/altananetwork/altana-sdk/issues/58) —
  docs say to persist the `Session` object verbatim, but `JSON.stringify` drops
  `signDigest` and keeps `_privateKey`
- [altana-sdk #59](https://github.com/altananetwork/altana-sdk/issues/59) —
  no ERC-8183 seller path: the SDK could hire and settle but not submit a
  deliverable. **Filed; fixed upstream in
  [altana-sdk #68](https://github.com/altananetwork/altana-sdk/pull/68)**,
  merged 1 Sep 2026, which adds `submitErc8183Deliverable`, `buildSubmitCall`,
  `erc8183SubmitPermissions` and a manifest codec. Our manifest and submit path
  in `apps/agents/src/erc8183` exists because the SDK had none when we built
  it; that gap is now closed upstream. The PR cites our own submit transaction
  through generic `execute` (chain 97, block 127889442) as its on-chain
  confirmation that the `submit(uint256,bytes32,bytes)` selector works, and
  credits the cross-language hash trap we reported — which it found in its own
  demo script: a hand-rolled canonicaliser missing the `\uXXXX` escaping,
  hashing a report containing an em dash. It is not yet in a published release —
  npm latest is still 0.8.0 (18 Aug), and the change sits under `[Unreleased]`
  on `staging` — so our path is still the only one available to anyone on a
  release, and we have not migrated.
- [bnb-chain/bnbagent-sdk #82](https://github.com/bnb-chain/bnbagent-sdk/issues/82) —
  jobId race: provider + status cannot identify your own job, so a losing racer
  can submit a valid-hash deliverable for the wrong task (the hire route guards
  against this by re-reading the job's description after funding)

Confirmed on chain, not authored by us:

- [altana-sdk #53](https://github.com/altananetwork/altana-sdk/issues/53)
  (filed by an altana-sdk maintainer) — `ERC8183_ADDRESSES[97].policy` is not
  whitelisted on the EvaluatorRouter. We verified the failure independently via
  `router.policyWhitelist()` reads; see footgun 4 below.

## Repository layout

| Path | Purpose |
|---|---|
| `apps/web` | The Next.js site on Vercel — marketplace, registry explorer, hire and revoke UI. This is what is live at agensea-navy.vercel.app. |
| `apps/indexer` | Phase 0 chain diagnostics, B402 Bazaar ingest, ERC-8004 agent sweeps, SQL migrations |
| `apps/agents` | Altana session-key agents (Phase 2 onward), ERC-8183 hire/submit/settle scripts, evidence |
| `design/` | Design system reference and the canonical mark |

## Engineering notebook

The rest of this file is the engineering notebook: SDK footguns, relay-fee
measurements, Venus decoding, and the sweep runbook — where the submission
ends and the working notes begin.

## Environment

Copy `.env.example` to `.env` and fill it in. Nothing in `.env` is ever printed
by any script in this repo; probes mask secrets before writing findings.

### `ALTANA_CHAIN=97` — required, and a genuine footgun

**Both the Altana MCP server and the SDK default to BNB MAINNET (chain 56) when
the network is unset.** In `@altananetwork/mcp` the resolution is literally:

```ts
const NETWORK = NETWORKS[requestedChain as keyof typeof NETWORKS] ?? BNB;
```

An unset or misspelled value silently selects mainnet, where transactions move
real value. Nothing in the log distinguishes it beyond one banner line.

Register the MCP server with the chain pinned explicitly:

```bash
claude mcp add altana -e ALTANA_CHAIN=97 -- bunx @altananetwork/mcp
```

Confirm the banner on startup:

```
[altana-mcp] network: BNB Smart Chain Testnet (chainId 97)
```

Config alone is not enough, because config drifts silently. Every agent entry
point calls `assertChain97()` from `apps/agents/src/chain-guard.ts`, which
reads `eth_chainId` **back off the wire** from the RPC the client is actually
configured with and throws `WrongChainError` unless it is 97. It runs before any
signer is constructed. Do not remove it, and do not weaken it to a config read.

### `AGENT_KEY`

Admin signer for the Altana smart account. **Testnet key only.** Read from
`.env`, never logged. The smart account address equals the signer address: the
account is an EIP-7702 delegated EOA, not a separate contract address.

## The relay bills the account — it does not sponsor gas

This is easy to get backwards. Altana's relay *submits* transactions, so the
`from` on every receipt is a relay-operated address rather than your account.
It does not follow that gas is free. The relay charges the smart account a fee
in native tBNB, and the account must be funded or execution fails.

Measured on BSC testnet (chain 97):

| Operation | Fee charged to the account | L1 gas used by the relay submitter |
|---|---|---|
| `grantSession` (+ KeyStore registration) | ~0.00087 tBNB | 967,880 gas (first, incl. account registration) |
| `execute` one call through a session key | **0.0000324 tBNB** | 199,484 gas |
| `revokeSession` | ~0.00003 tBNB | 154,259 gas |

The account-side fee and the L1 gas are different numbers; size spend caps
against the **fee**, not against gas.

Mainnet (chain 56), one observation: the first `execute` (register + 7702
delegation + KeyStore registration, batched) cost **0.000879383 BNB** against
1,387,882 gas at 0.05 gwei — a **12.7× markup over raw gas** [M, one
observation]. The absolute fee lands almost exactly on the testnet
first-execute figure (~0.00087) even though mainnet quotes a live rate
(`constantRate: null`) where testnet pins 1.0.

### Spend caps must cover the relay fee

A session's `SpendPermission` on the native token is what pays that fee. A cap
below it makes the session unusable even for a call that transfers no value:

```ts
// BROKEN: requestTokens() sends no value, but the session still cannot pay
// the ~3.2e13 wei relay fee. The bundle is accepted and never mined.
spend: [{ limit: 1n, period: 'hour' }]

// WORKS
spend: [{ limit: 10_000_000_000_000_000n, period: 'hour' }]  // 0.01 tBNB
```

## SDK footguns

Three behaviours that cost us real debugging time. All confirmed against
`@altananetwork/sdk` 0.8.0 on chain 97.

### 1. Mainnet is the silent default

Covered above under `ALTANA_CHAIN`. Unset or misspelled selects chain 56.

### 2. Spend caps must cover the relay fee

Covered above. A cap below the relay fee makes a session unusable even for a
call that transfers no value, and the bundle is accepted then never mined.
Upstream: [altana-sdk#57](https://github.com/altananetwork/altana-sdk/issues/57)
also covers how that failure is surfaced (a 240 s hang on relay status 300).

### 3. `grantSession` silently generates an ephemeral session signer

If you do not pass `sessionSigner`, the SDK generates one and returns it on the
`Session`. It exists **only in process memory**. Let the process exit without
persisting it and you are left with a registered, live, on-chain permission
whose key no longer exists anywhere. We did exactly this and had to revoke and
re-grant.

The documented remedy — "Persist the `Session` object verbatim" — is not
followable, because `Session.signer` carries a `signDigest` closure:

```js
JSON.parse(JSON.stringify(signer))
// keeps:  type, address, publicKey, _privateKey   <-- raw key written to your store
// drops:  signDigest                              <-- restored object cannot sign
```

So the naive persist writes the secret to disk *and* loses the capability.
Upstream: [altana-sdk#58](https://github.com/altananetwork/altana-sdk/issues/58).

**Always supply and persist your own session signer:**

```ts
import { generatePrivateKey } from 'viem/accounts';
import { signerFromPrivateKey } from '@altananetwork/sdk';

const sessionKey = generatePrivateKey();
const sessionSigner = signerFromPrivateKey(sessionKey);

// .secrets/ is gitignored; dir 0700, file 0600. NOT /tmp — macOS clears it on
// reboot and periodically otherwise, which reproduces the lost-key failure.
mkdirSync(SECRETS, { recursive: true, mode: 0o700 });
writeFileSync(resolve(SECRETS, 'session.key'), sessionKey, { mode: 0o600 });

const session = await client.grantSession({
  wallet, signer: adminSigner, sessionSigner,   // <-- never omit this
  permissions: { calls, spend }, expiry, register: true,
});
```

Persist the serialisable half separately — `walletAddress`, `publicKey`,
`permissions`, `expiry` — and rebuild the signer from the stored key on boot.

Revocation does **not** need the session signer: `revokeSession` accepts
`Session | Hex` (the public key) and is signed by the admin. A lost session key
is recoverable by revoking, not by resigning yourself to it.

### 4. `ERC8183_ADDRESSES[97].policy` is not whitelisted

The policy the SDK ships for chain 97 (`0x4F4678D4439feC812Ac7674Bb3Efb4C8f5Fb78A6`)
is not whitelisted on the EvaluatorRouter. Every hire reverts at `registerJob`
with `PolicyNotWhitelisted()` — selector `0xc94463e3`. The working address is
`0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA`, confirmed three ways: the router's
own `policyWhitelist()` read, the operator manifest in
`bnb-chain/bnbagent-sdk/networks/addresses.py`, and upstream issue
[#53](https://github.com/altananetwork/altana-sdk/issues/53).

```
router.policyWhitelist(0x4F4678D4…) = false     <- what the SDK exports
router.policyWhitelist(0xd6a42175…) = true
```

`src/erc8183/addresses.ts` reads the struct from the SDK, overrides `.policy`,
and asserts `router.policyWhitelist(policy)` at startup — so the override becomes
a harmless no-op once upstream ships the fix, and the assert catches any future
drift either way.

### 5. The builders are the override seam — not the high-level functions

This cost us a failed transaction *after* the override in footgun 4 was already
in place. `hireErc8183Agent()` and `settleErc8183Job()` resolve contract
addresses through the SDK's own internal `erc8183Addresses(chainId)`. They do
**not** accept an addresses argument, so a corrected struct never reaches them.

**This is by design, not a bug.** The maintainer stated it plainly in
[altana-sdk #68](https://github.com/altananetwork/altana-sdk/pull/68): the
high-level functions bind to the bundled registry deliberately, and the
low-level builders are where you inject addresses. We found that the hard way
rather than from the docs, which is why it is recorded here — the seam is real
and correct once you know where it is:

```ts
// BINDS TO THE BUNDLED REGISTRY: uses the SDK's policy, reverts 0xc94463e3
await hireErc8183Agent(wallet, signer, params, { network: BNB_TESTNET });

// THE SEAM: buildHireCalls takes an explicit `addresses`
const calls = buildHireCalls({ addresses: erc8183For(97), jobId, provider, description, budget, expiredAt });
await client.execute({ wallet, signer, calls });
```

The lesson is unchanged and is the general one: asserting the value you *built*
proves nothing about the value the SDK *uses*. Assert, then make sure the
asserted value is actually on the wire.

### 6. Venus `markets()` returns seven words, and CF is not the liquidation threshold

Venus's Comptroller is a **Diamond on both chains** (mainnet included — it is not
the legacy Unitroller layout). `markets(vToken)` returns:

```
w0 isListed | w1 collateralFactor | w2 isVenus
w3 liquidationThreshold | w4 liquidationIncentive | w5,w6 reserved
```

Decoding it as the legacy `(bool,uint256,bool)` silently truncates and hands you
`collateralFactor` where you wanted `liquidationThreshold`. They differ in
practice — chain-56 vADA is CF 0.00 / LT 0.63; chain-97 vBNB is CF 0.70 / LT 0.80.
A health factor computed from `collateralFactor` is the *borrowing-power* ratio,
not the liquidation ratio, and understates safety. Using `liquidationThreshold`
reproduces `getAccountLiquidity()` exactly (verified to 4 dp on a live position).

`liquidationIncentiveMantissa()` does not exist on either chain — checked via
`facetAddress()` and by scanning all five facets' bytecode. The per-market
incentive is `w4` (`1.1e18` = a 10% liquidator bonus).

### 7. Two kernel behaviours found while building wallet-native hiring

- **Short-expiry jobs are rejected.** `createJob` with `expiredAt` ~75s out
  reverts with custom error `0xf7a0748c`; the kernel enforces a minimum job
  duration (our standard 3600s passes).
- **A plain EOA `settle` reverts — only the relay path lands.** Even from the
  provider address itself, `settle(uint256,bytes)` sent as an ordinary
  transaction reverts on both the router and the commerce contract; the same
  calldata through the relay (`client.execute` to the router) settles fine.
  See `apps/agents/src/scripts/settle_ids.ts`.

### 8. Two canonicalisation rules exist in the deliverable corpus

Every deliverable's keccak256 is stored on chain, and the hash depends on how a
non-ASCII character is encoded before hashing. Our corpus contains **both**
rules, split by *when the job was submitted*, not by what it contains:

| rule | encoding | jobs |
|---|---|---|
| `raw` | the character as UTF-8, what `JSON.stringify` emits | 748, 754, 757 |
| `escaped` | one `\uXXXX` per UTF-16 code unit (Python `ensure_ascii=True`) | 795, 796 |

Jobs 753, 765 and 797 are pure ASCII, so they reproduce under either.

The producer changed rule partway through the project. `apps/web/lib/verify.ts`
implemented `raw` only, and its header asserted that the single path was "proven
against all five deliverables". **That assertion was true and still useless**:
of the five published at the time, three predate the change and two are pure
ASCII, so the test set could not distinguish the rules at all. A green suite
proved nothing about the property it claimed.

It surfaced only when jobs 795 and 796 were recovered from chain and refused to
reproduce. Publishing them under the old assumption would have rendered a
**false MISMATCH** — the page telling a reader not to trust a deliverable that
is provably correct, which is strictly worse than publishing no manifest at all.

The fix has two halves, and the second is the one that matters:

1. Each deliverable records the rule it was hashed under; `manifestHash` takes
   it as an argument; the VERIFY block and its copy-paste reproduce command both
   state the rule they used, so the page cannot describe one rule and run
   another.
2. `apps/web/tests/deliverables-canon.test.mjs` asserts every deliverable
   reproduces under its declared rule **and that the non-ASCII ones fail under
   the other one**. Without that second assertion the per-job label decays into
   decoration the moment someone mislabels an entry.

If a hash depends on an encoding choice, a test set with no non-ASCII cases
cannot tell you the encoding is right. Add a case that fails under the wrong
rule, or you have not tested it.

## Verified contracts (chain 97)

| Contract | Address | Bytecode |
|---|---|---|
| KeyStore | `0x6b8361C29d05D498b1a12B54A37310f94171E94A` | 8,756 bytes |
| KeyStoreController | `0xb530D1971f5453F3359518343F05D0AedFfF7e12` | 3,609 bytes |
| $U faucet | `0x86e9197CC0F76E4e4aaa7082180945196bBAb5D3` | 1,402 bytes |
| $U token | `0xc70b8741B8B07A6d61E54fd4B20f22Fa648E5565` | — |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | 3,808 bytes |

Every address here was verified with `cast code` against chain 97. Never take a
contract address from documentation without checking it has bytecode.

The faucet pays **10 $U per address per 30 minutes**. A second `requestTokens()`
inside that window reverts with empty revert data (`0x`), which surfaces from
the SDK as `Rpc.ExecutionError ... Reason: 0x` at `prepareCalls` — a pre-flight
simulation failure, not a session-permission failure. Do not misread it as a
scope problem.

The tBNB gas dispenser's per-IP daily cap is keyed on `x-forwarded-for`, so
judges behind one NAT or a shared conference network share a single grant
between them; the sponsored path is the fallback when it refuses.

## Running things

```bash
# indexer
cd apps/indexer && npm run ingest && npm run stats

# agents
cd apps/agents && ALTANA_CHAIN=97 npm run retry
```

## Sweep runbook — what to re-run after a delta sweep

Data on the site comes from three places with **different staleness behaviour**.
Run every step; skipping the last one leaves a public asset silently wrong.

```bash
# 1. Extend the agent sweep from the stored cursor to current head
cd apps/indexer && npm run delta

# 2. Re-ingest the B402 Bazaar catalogue
npm run ingest

# 3. Re-enrich agents that have clients (needed, or agent_liveness_with_clients
#    inner-joins away the newly-live agents and the view disagrees with the stats)
npm run pass2

# 4. Recompute the fan-out curve and refresh registry_stats with a new
#    measured_at  (SQL: select * from public.refresh_fanout();  then upsert
#    registry_stats — see apps/indexer/sql/004_fanout.sql)

# 5. REGENERATE THE OG CARD — see below
cd apps/web && npx tsx genog.mjs

# 6. Push the new data to the live site
curl -X POST -H "Authorization: Bearer $REVALIDATE_SECRET" \
  https://agensea-navy.vercel.app/api/revalidate
```

### The OG card drifts silently — this is the one to remember

Every figure rendered in the app is read live from `registry_stats`, so it
cannot go stale. **`app/opengraph-image.png` is the exception**: it is a static
PNG baked from `registry_stats` at generation time, and it is what renders when
the URL is pasted into Discord, Twitter, Telegram or a submission form.

Nothing fails if you forget it. The site will be correct and the social card
will quietly show last week's numbers under a `measured …` date that no longer
matches. Treat `npx tsx genog.mjs` as part of the same checklist as
`/api/revalidate` — they are the two steps that publish data rather than compute
it, and only one of them is visible in the app.

A redeploy is required after regenerating: the card is a build asset, not an
ISR page, so `/api/revalidate` does **not** update it.
