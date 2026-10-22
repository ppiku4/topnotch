// README screenshots: renders each screen in Chromium with the sample data
// from sample-bridge.js (no real media, files or accounts) and saves a PNG.
//
//   npx vite                       # in another terminal
//   node scripts/screenshots/capture.cjs [outDir] [name,name]
//
// Needs Playwright (npm i -g playwright, or npx playwright install chromium).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const DIR = __dirname;
const OUT = process.argv[2] || path.join(DIR, '..', '..', 'docs', 'screenshots');
const ONLY = process.argv[3];
const BASE = 'http://127.0.0.1:5173/';
const SHIM = fs.readFileSync(path.join(DIR, 'sample-bridge.js'), 'utf8');

const BACKDROP = `
  html.is-notch, html.is-notch body, html.is-wheel, html.is-wheel body {
    background: radial-gradient(120% 90% at 50% -10%, #2b2f45 0%, #14151d 55%, #0b0b10 100%) !important;
  }
  * { caret-color: transparent; }
`;

// name, scene, page hash, viewport, crop selector, extra steps
const SCENES = [
  ['pill-lyrics', 'pill', '', { width: 900, height: 140 }, '.island', 2600],
  ['pill-info', 'info', '', { width: 900, height: 140 }, '.island', 1500],
  ['panel-dashboard', 'dashboard', '', { width: 900, height: 460 }, '.island', 2200],
  ['panel-music', 'music', '', { width: 900, height: 480 }, '.island', 4300],
  ['panel-mixer', 'mixer', '', { width: 900, height: 460 }, '.island', 2000],
  ['panel-bluetooth', 'bluetooth', '', { width: 900, height: 460 }, '.island', 2000],
  ['panel-clipboard', 'clipboard', '', { width: 900, height: 460 }, '.island', 2000],
  ['panel-timer', 'timer', '', { width: 900, height: 460 }, '.island', 2000],
  ['panel-stats', 'stats', '', { width: 900, height: 460 }, '.island', 2000],
  ['panel-shelf', 'shelf', '', { width: 900, height: 460 }, '.island', 2000],
  ['activity-volume', 'osd', '', { width: 900, height: 140 }, '.island', 900],
  ['activity-convert', 'convert', '', { width: 900, height: 140 }, '.island', 1300],
  ['activity-bluetooth', 'btconnect', '', { width: 900, height: 140 }, '.island', 1300],
  ['file-wheel', 'wheel', '#wheel', { width: 420, height: 420 }, null, 1500, async (page) => {
    const seg = page.locator('.wheel-seg').nth(2);
    await seg.hover({ force: true });
    await page.waitForTimeout(500);
  }],
  ['image-editor', 'editor', '#editor', { width: 1080, height: 720 }, null, 1800],
  ['settings', 'settings', '#settings', { width: 860, height: 600 }, null, 1500, async (page) => {
    const tab = page.getByRole('button', { name: 'Appearance' }).first();
    if (await tab.count()) { await tab.click(); await page.waitForTimeout(700); }
  }]
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const [name, scene, hash, viewport, crop, wait, steps] of SCENES) {
    if (ONLY && !ONLY.split(',').includes(name)) continue;
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: 'en-US', bypassCSP: true, timezoneId: 'Europe/Lisbon' });
    await context.addInitScript({ content: SHIM });
    // Fixed clock: Friday 23 Oct, 9:41.
    await context.addInitScript({ content: `(() => { const fixed = new Date('2026-10-23T09:41:00+01:00').getTime(); const start = Date.now(); const D = Date; class F extends D { constructor(...a) { super(...(a.length ? a : [fixed + (D.now() - start)])); } static now() { return fixed + (D.now() - start); } } window.Date = F; })();` });
    const page = await context.newPage();
    page.on('pageerror', (e) => console.log(name, 'pageerror', e.message));
    await page.goto(`${BASE}?scene=${scene}${hash}`);
    await page.addStyleTag({ content: BACKDROP });
    await page.waitForTimeout(wait);
    if (steps) await steps(page);
    const file = path.join(OUT, `${name}.png`);
    if (crop) {
      const box = await page.locator(crop).first().boundingBox();
      const pad = 28;
      const clip = { x: Math.max(0, box.x - pad), y: 0, width: Math.min(viewport.width, box.width + pad * 2), height: Math.min(viewport.height, box.y + box.height + pad) };
      await page.screenshot({ path: file, clip });
    } else {
      await page.screenshot({ path: file });
    }
    console.log('saved', name);
    await context.close();
  }
  await browser.close();
})();
