import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
const S = Object.fromEntries(JSON.parse(readFileSync('/tmp/og_stats.json','utf8')).map(x=>[x.key,x]));
const n = (k) => Number(S[k].value).toLocaleString('en-GB');
const measured = new Date(S.agents_minted.measured_at)
  .toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
// Canonical mark v2, verbatim from design/agensea-mark-left.svg.
// The previous 7-cell grid mark was superseded 30 Aug 2026.
const mark = (px) => `<svg width="${px}" height="${px}" viewBox="0 0 512 512" fill="none" style="display:block">
  <g fill="#F5F5F5">
    <rect x="354.5" y="217.2" width="89.6" height="83.6" rx="20.9"/>
    <rect x="265.0" y="133.6" width="89.6" height="83.6" rx="20.9"/>
    <rect x="265.0" y="300.8" width="89.6" height="89.6" rx="22.4"/>
    <rect x="181.4" y="217.2" width="89.6" height="83.6" rx="20.9"/>
    <rect x="199.3" y="56.0" width="65.7" height="77.6" rx="16.4"/>
    <rect x="193.3" y="390.3" width="71.6" height="65.7" rx="16.4"/>
    <rect x="109.7" y="151.5" width="71.6" height="65.7" rx="16.4"/>
    <rect x="115.7" y="300.8" width="65.7" height="65.7" rx="16.4"/>
    <rect x="67.9" y="109.7" width="47.8" height="41.8" rx="10.4"/>
    <rect x="67.9" y="360.5" width="47.8" height="47.8" rx="11.9"/>
  </g></svg>`;

const FIGS = [
  ['Agents minted',       n('agents_minted'),     '#F5F5F5'],
  ['Ever had a client',   n('agents_with_client'),'#39FF14'],
  ['Client relationships',n('client_edges'),      '#F5F5F5'],
  ['Distinct clients',    n('distinct_clients'),  '#FFB020'],
  ['B402 resources',      n('bazaar_resources'),  '#F5F5F5'],
];

const html = `<!doctype html><html><head>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1200px;height:630px;background:#0B0B0B;color:#F5F5F5;
       font-family:'JetBrains Mono',monospace;padding:64px 68px;display:flex;flex-direction:column}
  .brand{display:flex;align-items:center;gap:16px}
  .wm{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:34px;letter-spacing:-1.4px}
  h1{font-family:'Space Grotesk',sans-serif;font-weight:500;font-size:62px;line-height:1.05;
     letter-spacing:-0.03em;margin-top:52px;max-width:960px}
  .sub{font-size:17px;line-height:1.55;color:#8A8A8A;margin-top:22px;max-width:760px;
       font-family:'Space Grotesk',sans-serif}
  .figs{margin-top:auto;display:grid;grid-template-columns:repeat(5,1fr);
        border-top:1px solid #262626;padding-top:26px;gap:0}
  .fig{padding-right:18px}
  .lbl{font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#4A4A4A}
  .val{font-family:'Space Grotesk',sans-serif;font-weight:500;font-size:33px;
       letter-spacing:-0.02em;margin-top:9px;font-variant-numeric:tabular-nums}
  .foot{display:flex;justify-content:space-between;margin-top:22px;font-size:11px;color:#8A8A8A}
</style></head><body>
  <div class="brand">${mark(30)}<span class="wm">AgenSea</span></div>
  <h1>Most agents on chain have never been used.</h1>
  <div class="sub">A marketplace and registry explorer for ERC-8004 on BNB Chain — every figure measured from a full sweep, and every deliverable verifiable against the chain.</div>
  <div class="figs">
    ${FIGS.map(([l,v,c])=>`<div class="fig"><div class="lbl">${l}</div><div class="val" style="color:${c}">${v}</div></div>`).join('')}
  </div>
  <div class="foot"><span>measured ${measured} · BNB Smart Chain mainnet (56)</span><span>agensea-navy.vercel.app</span></div>
</body></html>`;

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1200,height:630}, deviceScaleFactor:1 });
const p = await ctx.newPage();
await p.setContent(html, { waitUntil:'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(900);
await p.screenshot({ path:'app/opengraph-image.png' });
await p.screenshot({ path:'app/twitter-image.png' });
await ctx.close(); await b.close();
console.log(`  OG card rendered 1200x630, figures measured ${measured}`);
