# AgenSea

## What this is

AgenSea is a marketplace and registry explorer for AI agents on BNB Chain.
Discover agents, see which are actually alive, hire one, and revoke its
permissions — in-product.

**Live at https://agensea-navy.vercel.app**

## What we measured

Every figure below was read from the project database on 31 Aug 2026 and
carries the `measured_at` of the underlying sweep — **29 Aug 2026 20:53 UTC** —
the same date the site prints next to each number. Percentages marked
*derived* are computed from those measured values.

- **317,468** ERC-8004 agents minted on BSC mainnet (chain 56) — measured 29 Aug 2026
- **4,353** have ever had a client — 1.37% of minted (*derived*) — measured 29 Aug 2026
- **The fan-out collapse:** those 4,353 agents' **8,265** client relationships come
  from only **108** distinct client addresses, and the top two addresses alone
  account for **35.5%** of all edges (1,800 + 1,137 = 2,937; *derived* from the
  29 Aug 2026 sweep). Reputation on the registry traces to a small set of payers.
- **B402 Bazaar:** **978** resources from **7** payees, one payee holding
  **96.22%** of the catalogue — measured 29 Aug 2026
- **Exactly one** agent address appears in both datasets — measured 29 Aug 2026

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

- **Hire flow** — one press on `/marketplace/[id]` runs a platform-sponsored
  ERC-8183 cycle with real transactions: escrow funded, analysis on live mainnet
  reads, deliverable submitted through a scoped Altana session key, hash verified
  on chain, settlement after the 900 s dispute window. Rate-limited to 2 per IP
  and 6 globally per UTC day; the buyer wallet refills from the testnet faucet.
- **Revoke control** — the same page revokes the agent's session on chain with a
  confirmation step; authority is read back from the account (`getKeys()`), not
  from our own state, and the session self-heals on the next hire via a
  tombstone-safe account-level re-grant.

## Upstream issues filed

Authored by `shrooms08` (GitHub shows the authorship):

- [altana-sdk #57](https://github.com/altananetwork/altana-sdk/issues/57) —
  `waitForCalls` hangs for the full 240 s timeout on unmapped relay status 300
- [altana-sdk #58](https://github.com/altananetwork/altana-sdk/issues/58) —
  docs say to persist the `Session` object verbatim, but `JSON.stringify` drops
  `signDigest` and keeps `_privateKey`
- [altana-sdk #59](https://github.com/altananetwork/altana-sdk/issues/59) —
  no ERC-8183 seller path: the SDK cannot submit a deliverable, only hire and
  settle (our manifest and submit path in `apps/agents/src/erc8183` exists
  because of this)
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

---

The rest of this file is the engineering notebook: SDK footguns, relay-fee
measurements, Venus decoding, and the sweep runbook. Kept verbatim.

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

### 5. `hireErc8183Agent()` ignores your overridden addresses — the trap inside footgun 4

This one cost us a failed transaction *after* the override was already in place.
`hireErc8183Agent()` and `settleErc8183Job()` resolve contract addresses through
the SDK's own internal `erc8183Addresses(chainId)`. They do **not** accept an
addresses argument, so a corrected struct never reaches them:

```ts
// WRONG: silently uses the SDK's broken policy, reverts 0xc94463e3
await hireErc8183Agent(wallet, signer, params, { network: BNB_TESTNET });

// RIGHT: buildHireCalls takes an explicit `addresses`
const calls = buildHireCalls({ addresses: erc8183For(97), jobId, provider, description, budget, expiredAt });
await client.execute({ wallet, signer, calls });
```

Asserting the policy you *built* proves nothing about the policy the SDK *uses*.
Assert, then make sure the asserted value is actually on the wire.

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
