// Generates the icon SVG markup at a given pixel size.
function iconSVG(s) {
  // scale helpers based on 256 design grid
  const k = s / 256;
  const r = 56 * k;           // corner radius
  const pad = 0;              // full-bleed rounded square
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a84ff"/>
      <stop offset="0.55" stop-color="#4f46e5"/>
      <stop offset="1" stop-color="#7c3aed"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.30"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.06"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <filter id="ds" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#1a124f" flood-opacity="0.45"/>
    </filter>
  </defs>
  <rect x="8" y="6" width="240" height="240" rx="56" fill="url(#g)"/>
  <rect x="8" y="6" width="240" height="240" rx="56" fill="url(#sheen)"/>
  <rect x="8.5" y="6.5" width="239" height="239" rx="55.5" fill="none" stroke="#ffffff" stroke-opacity="0.25" stroke-width="1.5"/>
  <!-- newspaper -->
  <g filter="url(#ds)" fill="none" stroke="#ffffff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round">
    <path d="M64 70 h94 v104 a14 14 0 0 1 -14 14 H78 a14 14 0 0 1 -14 -14 Z"/>
    <path d="M158 102 h22 a14 14 0 0 1 14 14 v58 a14 14 0 0 1 -14 14"/>
    <line x1="84" y1="98"  x2="138" y2="98"/>
    <line x1="84" y1="122" x2="138" y2="122"/>
    <line x1="84" y1="146" x2="120" y2="146"/>
  </g>
  <!-- download badge -->
  <circle cx="176" cy="176" r="40" fill="#ffffff"/>
  <g stroke="#4f46e5" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <line x1="176" y1="156" x2="176" y2="190"/>
    <path d="M162 178 l14 14 14 -14"/>
  </g>
</svg>`;
}
module.exports = { iconSVG };


// ---------------------------------------------------------------------------
// Renders assets/icon.ico (multi-size), icon.png (256) and tray-icon.png (32)
// from the SVG above using playwright-core + Chromium.
//   Run:  node scripts/generate-icon.js
// ---------------------------------------------------------------------------
if (require.main === module) {
  const { chromium } = require('playwright-core');
  const fs = require('fs');
  const path = require('path');
  const SIZES = [16, 24, 32, 48, 64, 128, 256];
  const assets = path.join(__dirname, '..', 'assets');

  (async () => {
    const browser = await chromium.launch();
    const out = {};
    for (const s of SIZES) {
      const page = await browser.newPage({ viewport: { width: s, height: s }, deviceScaleFactor: 1 });
      const svg = iconSVG(256).replace('width="256" height="256"', `width="${s}" height="${s}"`);
      await page.setContent(`<!doctype html><meta charset="utf-8"><style>*{margin:0;padding:0}html,body{background:transparent}</style>${svg}`, { waitUntil: 'networkidle' });
      out[s] = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } });
      await page.close();
    }
    await browser.close();

    const count = SIZES.length;
    const header = Buffer.alloc(6);
    header.writeUInt16LE(1, 2); header.writeUInt16LE(count, 4);
    const dir = Buffer.alloc(16 * count);
    let offset = 6 + 16 * count;
    const chunks = [];
    SIZES.forEach((s, i) => {
      const data = out[s], o = i * 16;
      dir.writeUInt8(s >= 256 ? 0 : s, o); dir.writeUInt8(s >= 256 ? 0 : s, o + 1);
      dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
      dir.writeUInt32LE(data.length, o + 8); dir.writeUInt32LE(offset, o + 12);
      offset += data.length; chunks.push(data);
    });
    fs.writeFileSync(path.join(assets, 'icon.ico'), Buffer.concat([header, dir, ...chunks]));
    fs.writeFileSync(path.join(assets, 'icon.png'), out[256]);
    fs.writeFileSync(path.join(assets, 'tray-icon.png'), out[32]);
    console.log('Generated icon.ico (' + SIZES.join(',') + '), icon.png, tray-icon.png');
  })();
}
