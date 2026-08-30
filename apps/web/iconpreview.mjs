import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BG = '#0B0B0B', FG = '#F5F5F5';
// Candidates: fewer, larger cells on a coarser grid, keeping the original's
// sparse descending-scatter gesture. Original is 7 cells on 8x8.
const CANDS = {
  A: { grid: 4, cells: [[3,0],[1,1],[2,2],[0,3]] },   // descending diagonal scatter
  B: { grid: 3, cells: [[2,0],[0,1],[1,2]] },         // 3 cells, coarsest
  C: { grid: 4, cells: [[3,0],[1,1],[0,2],[3,3]] },   // echoes original's bottom-right return
};
const svg = (g, cells) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g} ${g}" width="100%" height="100%" shape-rendering="crispEdges">` +
  `<rect width="${g}" height="${g}" fill="${BG}"/>` +
  cells.map(([x,y])=>`<rect x="${x}" y="${y}" width="1" height="1" fill="${FG}"/>`).join('') + `</svg>`;

for (const [k,v] of Object.entries(CANDS)) writeFileSync(`/tmp/icon/${k}.svg`, svg(v.grid, v.cells));

const b = await chromium.launch();
// render each at true 16 and 32
for (const [k,v] of Object.entries(CANDS)) {
  for (const size of [16,32]) {
    const ctx = await b.newContext({ viewport:{width:size,height:size}, deviceScaleFactor:1 });
    const p = await ctx.newPage();
    await p.setContent(`<style>*{margin:0;padding:0}body{width:${size}px;height:${size}px}</style>${svg(v.grid,v.cells)}`);
    await p.screenshot({ path:`/tmp/icon/${k}-${size}.png` });
    await ctx.close();
  }
}
// contact sheet: 1x beside an 8x pixelated zoom, so smearing is visible
const rows = Object.keys(CANDS).map(k => `
  <div style="display:flex;align-items:center;gap:22px;margin:16px 0">
    <div style="font:600 15px monospace;color:#F5F5F5;width:16px">${k}</div>
    <img src="${k}-16.png" style="width:16px;height:16px">
    <img src="${k}-16.png" style="width:128px;height:128px;image-rendering:pixelated;outline:1px solid #262626">
    <img src="${k}-32.png" style="width:32px;height:32px">
    <img src="${k}-32.png" style="width:128px;height:128px;image-rendering:pixelated;outline:1px solid #262626">
    <div style="font:400 12px monospace;color:#8A8A8A">${CANDS[k].cells.length} cells on ${CANDS[k].grid}x${CANDS[k].grid} · ${(16/CANDS[k].grid).toFixed(1)}px cells @16</div>
  </div>`).join('');
const ctx = await b.newContext({ viewport:{width:820,height:340}, deviceScaleFactor:2 });
const p = await ctx.newPage();
await p.setContent(`<body style="background:#0B0B0B;padding:16px;font-family:monospace">
  <div style="display:flex;gap:22px;color:#4A4A4A;font:500 10px monospace;letter-spacing:.1em;padding-left:38px">
    <span style="width:16px">16</span><span style="width:128px;text-align:center">16px @8x</span>
    <span style="width:32px">32</span><span style="width:128px;text-align:center">32px @8x</span></div>
  ${rows}</body>`);
await p.screenshot({ path:'/tmp/icon/contact-sheet.png' });
await ctx.close(); await b.close();
console.log('  rendered A/B/C at 16 and 32 + contact sheet');
