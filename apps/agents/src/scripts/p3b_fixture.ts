import process from 'node:process';
import { resolve } from 'node:path';
import { encodeFunctionData, parseAbi } from 'viem';
import { createClient, signerFromPrivateKey, BNB_TESTNET } from '@altananetwork/sdk';
import { assertChain97 } from '../chain-guard.ts';
import { analyze } from '../venus/analyze.ts';
import { updateState, ROOT } from '../agent/state.ts';
process.loadEnvFile(resolve(ROOT, '.env'));
const client = createClient({ chains: [BNB_TESTNET] });
await assertChain97(BNB_TESTNET, client.chains.map(c=>c.chainId));
const VUSDT='0xb7526572FFE56AB9D7489838Bf2E18e3323b441A';
const UNI='0x94d1820b2D1c7c7452A163983Dc888CEC546b77D';
const signer = signerFromPrivateKey(process.env.AGENT_KEY!.trim() as `0x${string}`);
const wallet = await client.createWallet({ signer });
const call = async (to:string,data:string)=>{const r=await fetch(BNB_TESTNET.publicRpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[{to,data},'latest']})});return ((await r.json()) as any).result as string;};
const pad=(a:string)=>a.replace(/^0x/,'').toLowerCase().padStart(64,'0');

const p = await analyze(97, wallet.address);
console.log(`current: HF=${p.healthFactor} collateral=$${p.collateralUsd.toFixed(4)} borrowed=$${p.borrowedUsd.toFixed(4)}`);
const liq = await call(UNI, '0x5ec88c79'+pad(wallet.address));
const liquidity = BigInt('0x'+liq.slice(66,130)), shortfall = BigInt('0x'+liq.slice(130,194));
console.log(`borrow power remaining (CF-based liquidity): $${Number(liquidity)/1e18}  shortfall $${Number(shortfall)/1e18}`);

// CF (0.70) < LT (0.80) on vBNB. Borrow power is capped by CF, but the health
// factor is measured against LT — so borrowing to the very limit floors HF at
// LT/CF = 0.80/0.70 = 1.143. HF 1.05 is UNREACHABLE by borrowing alone.
const LT = 0.8, CF = 0.7;
console.log(`\nstructural floor for HF via borrowing = LT/CF = ${(LT/CF).toFixed(4)}`);
const usdtPrice = 0.5;
const maxMoreUsd = Number(liquidity)/1e18;
// Venus reverts "math error" near the exact limit, so step down until it takes.
let done = false;
for (const frac of [0.90, 0.75, 0.60, 0.45, 0.30]) {
  const units = BigInt(Math.floor((maxMoreUsd / usdtPrice) * frac * 1e6));
  if (units <= 0n) continue;
  try {
    const res = await client.execute({ wallet, signer, calls: [{ to: VUSDT,
      data: encodeFunctionData({abi:parseAbi(['function borrow(uint256 amount)']),functionName:'borrow',args:[units]}) }] });
    console.log(`borrowed ${Number(units)/1e6} USDT (${(frac*100).toFixed(0)}% of power) status=${res.status} tx=${res.transactionHash}`);
    await updateState({ fixturePushTx: res.transactionHash ?? null, fixturePushUsdt: Number(units)/1e6 });
    done = true; break;
  } catch (e) {
    console.log(`  ${(frac*100).toFixed(0)}% (${Number(units)/1e6} USDT) -> ${(e as Error).message.slice(0,60)}`);
  }
}
if (!done) console.log('could not borrow any further increment');
const q = await analyze(97, wallet.address);
console.log(`\nafter: HF=${q.healthFactor} (${q.riskLevel}) collateral=$${q.collateralUsd.toFixed(4)} borrowed=$${q.borrowedUsd.toFixed(4)}`);
console.log(`drop to liquidation: ${(q.priceDropToLiquidation!*100).toFixed(2)}%`);
console.log(q.recommendation);
await updateState({ fixtureFinal: q });
