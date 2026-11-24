// Renders the NINDITO POS launcher icons and splash screens into the Android project.
// Run once when the icon changes: node scripts/android-icons.cjs  (needs Playwright + Chromium)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const res = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');
const CART = '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 12.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/>';
const tile = (round) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14998e"/><stop offset="1" stop-color="#0b5f58"/></linearGradient></defs>
${round ? '<circle cx="50" cy="50" r="50" fill="url(#g)"/>' : '<rect width="100" height="100" rx="22" fill="url(#g)"/>'}
<g transform="translate(21 20) scale(2.4)" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${CART}</g></svg>`;
// Adaptive icon foreground: the cart inside the 66% safe zone of a 108dp canvas.
const fg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108"><g transform="translate(33 32) scale(1.8)" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${CART}</g></svg>`;
const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const render = async (svg, w, h, bg = 'transparent', file) => {
    await p.setViewportSize({ width: w, height: h });
    await p.setContent(`<html><body style="margin:0;background:${bg};width:${w}px;height:${h}px;display:grid;place-items:center">${svg}</body></html>`);
    await p.evaluate(([w, h]) => { const s = document.querySelector('svg'); s.setAttribute('width', w); s.setAttribute('height', h); }, [w, h]);
    fs.writeFileSync(file, await p.screenshot({ omitBackground: bg === 'transparent', clip: { x: 0, y: 0, width: w, height: h } }));
  };
  for (const [d, k] of Object.entries(DENS)) {
    const dir = path.join(res, `mipmap-${d}`);
    await render(tile(false), 48 * k, 48 * k, 'transparent', path.join(dir, 'ic_launcher.png'));
    await render(tile(true), 48 * k, 48 * k, 'transparent', path.join(dir, 'ic_launcher_round.png'));
    await render(fg, 108 * k, 108 * k, 'transparent', path.join(dir, 'ic_launcher_foreground.png'));
  }
  // Adaptive icon background colour.
  const bgXml = path.join(res, 'values', 'ic_launcher_background.xml');
  fs.writeFileSync(bgXml, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0F766E</color>\n</resources>\n');
  // Splash screens: brand mark + name on teal.
  const splash = (w, h) => `<div style="width:${w}px;height:${h}px;background:#0f766e;display:grid;place-items:center"><div style="display:grid;justify-items:center;gap:${Math.round(Math.min(w, h) * 0.04)}px">
    <div style="width:${Math.round(Math.min(w, h) * 0.28)}px;height:${Math.round(Math.min(w, h) * 0.28)}px">${tile(false).replace('<svg ', '<svg width="100%" height="100%" ')}</div>
    <div style="font:800 ${Math.round(Math.min(w, h) * 0.07)}px system-ui,sans-serif;letter-spacing:.06em;color:#fff">NINDITO POS</div></div></div>`;
  for (const dir of fs.readdirSync(res).filter((x) => x.startsWith('drawable'))) {
    const f = path.join(res, dir, 'splash.png');
    if (!fs.existsSync(f)) continue;
    const { width, height } = await (async () => { const buf = fs.readFileSync(f); return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }; })();
    await p.setViewportSize({ width, height });
    await p.setContent(`<html><body style="margin:0">${splash(width, height)}</body></html>`);
    fs.writeFileSync(f, await p.screenshot({ clip: { x: 0, y: 0, width, height } }));
  }
  await b.close();
  console.log('Android icons and splash screens written');
})();
