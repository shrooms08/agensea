import { chromium } from 'playwright';
import { writeFileSync, readFileSync } from 'node:fs';
const BG='#0B0B0B', FG='#F5F5F5';
// Chosen variant C: descending run plus the bottom-right return, preserving the
// full mark's structure rather than flattening it to a plain diagonal.
const C = [[3,0],[1,1],[0,2],[3,3]];
// Full 7-cell mark, used only where size clears the 20px floor.
const FULL = [[6,0],[3,2],[5,3],[2,4],[4,5],[1,6],[6,6]];
const svg = (g,cells,bg=BG) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g} ${g}" width="100%" height="100%" shape-rendering="crispEdges">`+
  `<rect width="${g}" height="${g}" fill="${bg}"/>`+
  cells.map(([x,y])=>`<rect x="${x}" y="${y}" width="1" height="1" fill="${FG}"/>`).join('')+`</svg>`;

// icon.svg — the scalable master, viewBox 0 0 4 4
writeFileSync('app/icon.svg',
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4" shape-rendering="crispEdges">
  <rect width="4" height="4" fill="${BG}"/>
${C.map(([x,y])=>`  <rect x="${x}" y="${y}" width="1" height="1" fill="${FG}"/>`).join('\n')}
</svg>\n`);

const b = await chromium.launch();
const shot = async (markup, w, h, out, scale=1) => {
  const ctx = await b.newContext({ viewport:{width:w,height:h}, deviceScaleFactor:scale });
  const p = await ctx.newPage();
  await p.setContent(`<style>*{margin:0;padding:0}html,body{width:${w}px;height:${h}px;background:${BG}}</style>${markup}`);
  await p.waitForTimeout(200);
  await p.screenshot({ path: out });
  await ctx.close();
};
await shot(svg(4,C), 16, 16, '/tmp/icon/ship-16.png');
await shot(svg(4,C), 32, 32, '/tmp/icon/ship-32.png');
// apple-touch-icon: 180px clears the 20px floor, so the FULL 7-cell mark is used.
await shot(svg(8,FULL), 180, 180, 'app/apple-icon.png');
await b.close();
console.log('  icon.svg, apple-icon.png (full 7-cell), 16/32 PNGs written');
