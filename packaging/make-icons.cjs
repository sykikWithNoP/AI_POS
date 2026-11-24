// Renders the app icon (teal tile + cart) to PNGs, then packs icon.ico (Windows) and icon.icns (macOS).
// Run once when the icon changes:  node packaging/make-icons.cjs   (needs Playwright + Chromium)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, 'icons');
const CART = '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 12.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/>';
const svg = (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 100 100">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14998e"/><stop offset="1" stop-color="#0b5f58"/></linearGradient></defs>
<rect x="4" y="4" width="92" height="92" rx="22" fill="url(#g)"/>
<g transform="translate(20 19) scale(2.5)" fill="none" stroke="#fff" stroke-width="${s <= 32 ? 2.4 : 1.9}" stroke-linecap="round" stroke-linejoin="round">${CART}</g></svg>`;

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage();
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
  const png = {};
  for (const s of sizes) {
    await p.setViewportSize({ width: s, height: s });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg(s)}</body></html>`);
    png[s] = await p.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } });
    fs.writeFileSync(path.join(out, `icon-${s}.png`), png[s]);
  }
  await b.close();
  // ICO: directory of PNG images (supported since Windows Vista).
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(icoSizes.length, 4);
  let offset = 6 + 16 * icoSizes.length;
  const dir = []; const data = [];
  for (const s of icoSizes) {
    const e = Buffer.alloc(16); const d = png[s];
    e.writeUInt8(s >= 256 ? 0 : s, 0); e.writeUInt8(s >= 256 ? 0 : s, 1); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(d.length, 8); e.writeUInt32LE(offset, 12); offset += d.length; dir.push(e); data.push(d);
  }
  fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([head, ...dir, ...data]));
  // ICNS: PNG entries.
  const types = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]];
  const parts = types.map(([t, s]) => { const h = Buffer.alloc(8); h.write(t, 0, 'latin1'); h.writeUInt32BE(png[s].length + 8, 4); return Buffer.concat([h, png[s]]); });
  const total = 8 + parts.reduce((a, x) => a + x.length, 0);
  const ih = Buffer.alloc(8); ih.write('icns', 0, 'latin1'); ih.writeUInt32BE(total, 4);
  fs.writeFileSync(path.join(out, 'icon.icns'), Buffer.concat([ih, ...parts]));
  for (const s of sizes) if (![256, 512].includes(s)) fs.rmSync(path.join(out, `icon-${s}.png`));
  console.log('icons written to', out);
})();
