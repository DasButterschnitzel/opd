/**
 * scripts/inspect-portal.js
 *
 * Standalone Node.js inspection script.
 * Logs into the ePaper portal, navigates to the Dreieich section,
 * and dumps the relevant DOM so selectors can be verified/improved.
 *
 * Run via:  inspect.bat
 * Output:   [project]\debug\inspect-YYYY-MM-DD.json  +  screenshots
 */

'use strict';

const { chromium } = require('playwright-core');
const fs   = require('fs');
const path = require('path');

const PROJECT_DIR = path.join(__dirname, '..');
const OUTPUT_DIR  = path.join(PROJECT_DIR, 'debug');

// ---- Read browser path ----
const browserPathFile = path.join(PROJECT_DIR, 'browser-path.txt');
if (!fs.existsSync(browserPathFile)) {
  console.error('[FEHLER] browser-path.txt fehlt. Bitte setup.bat ausfuehren.');
  process.exit(1);
}
const BROWSER_EXE = fs.readFileSync(browserPathFile, 'utf8').trim();
if (!fs.existsSync(BROWSER_EXE)) {
  console.error('[FEHLER] Browser nicht gefunden: ' + BROWSER_EXE);
  process.exit(1);
}

// ---- Credentials from command line ----
// Usage: node inspect-portal.js EMAIL PASSWORD
const USERNAME = process.argv[2];
const PASSWORD = process.argv[3];
if (!USERNAME || !PASSWORD) {
  console.error('Aufruf: node scripts\\inspect-portal.js EMAIL PASSWORT');
  process.exit(1);
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const today  = new Date().toISOString().slice(0, 10);
const report = { timestamp: new Date().toISOString(), steps: [] };

function log(msg) {
  console.log(msg);
  report.steps.push(msg);
}

(async () => {
  const browser = await chromium.launch({ headless: false, executablePath: BROWSER_EXE });
  const context = await browser.newContext({ acceptDownloads: false });
  const page    = await context.newPage();

  try {
    log('1) Portal oeffnen...');
    await page.goto('https://epaper.op-online.de/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'inspect-01-homepage.png') });

    log('2) Login-Link klicken...');
    await page.getByRole('link', { name: /Anmelden/ }).first().click();
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 });

    log('3) Formular ausfuellen...');
    await page.getByPlaceholder('E-Mail').fill(USERNAME);
    await page.getByPlaceholder('Passwort').fill(PASSWORD);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.waitForLoadState('networkidle', { timeout: 30000 });

    await page.getByRole('link', { name: /mit Anmeldung fortfahren/i })
      .click({ timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'inspect-02-after-login.png') });

    log('4) Erste Ausgabe anklicken...');
    const editionLink = page.getByRole('link', { name: /Offenbach-Post/ }).first();
    const editionText = await editionLink.textContent().catch(() => '?');
    log('   Ausgabe: ' + editionText.trim());
    await editionLink.click({ timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'inspect-03-edition.png') });

    log('5) Sektionsliste oeffnen...');
    await page.locator('rebrush-department-list-control div').nth(2).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'inspect-04-dept-open.png') });

    // Dump ALL department items
    const deptHtml = await page.locator('rebrush-department-list-control').innerHTML().catch(() => '');
    report.departmentListHtml = deptHtml;
    log('   Department list HTML laenge: ' + deptHtml.length + ' Zeichen');

    const deptTexts = await page.locator('rebrush-department-list-control').allInnerTexts().catch(() => []);
    report.departmentTexts = deptTexts;
    log('   Sektionen: ' + JSON.stringify(deptTexts));

    log('6) Dreieich-Sektion suchen und klicken...');
    const dreieichItem = page.locator('rebrush-department-list-control').getByText(/Dreieich/i).first();
    const sectionLabel = (await dreieichItem.textContent({ timeout: 10000 }).catch(() => '?')).trim();
    log('   Gefunden: "' + sectionLabel + '"');
    report.sectionLabel = sectionLabel;

    await dreieichItem.click({ timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 });
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'inspect-05-dreieich.png') });

    // Dump page heading / viewer title
    const headingCandidates = await page.evaluate(() => {
      const selectors = [
        'h1', 'h2', 'h3',
        '[class*="title"]', '[class*="name"]', '[class*="headline"]',
        'rebrush-issue-name', 'rebrush-page-title', 'rebrush-section',
        '.page-name', '.section-title', '.department-name',
      ];
      return selectors.flatMap(s =>
        Array.from(document.querySelectorAll(s))
          .map(el => ({ sel: s, tag: el.tagName, cls: el.className, text: (el.textContent || '').trim().slice(0, 120) }))
          .filter(x => x.text)
      );
    });
    report.headingCandidates = headingCandidates;
    log('   Ueberschriften-Kandidaten:');
    headingCandidates.slice(0, 15).forEach(h => log(`     [${h.sel}] <${h.tag} class="${h.cls}"> "${h.text}"`));

    log('7) Download-Toggle anklicken...');
    await page.locator('rebrush-download i').first().click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'inspect-06-dropdown-open.png') });

    // Dump rebrush-download HTML
    const dlCount = await page.locator('rebrush-download').count();
    log('   rebrush-download Elemente: ' + dlCount);
    report.rebrushDownloadCount = dlCount;

    const dlHtml = await page.locator('rebrush-download').first().innerHTML().catch(() => '');
    report.rebrushDownloadHtml = dlHtml;
    log('   rebrush-download HTML (' + dlHtml.length + ' Zeichen):');
    console.log(dlHtml.substring(0, 2000));

    // Leaf nodes inside rebrush-download
    const leafNodes = await page.locator('rebrush-download').first().evaluate(el => {
      const results = [];
      const walk = (root, prefix) => {
        root.querySelectorAll('*').forEach(n => {
          const t = (n.textContent || '').trim();
          if (n.children.length === 0 && t)
            results.push({ tag: prefix + n.tagName, cls: n.className, text: t.slice(0, 80) });
        });
        if (root.shadowRoot) walk(root.shadowRoot, 'shadow:');
      };
      walk(el, '');
      return results;
    });
    report.rebrushDownloadLeafNodes = leafNodes;
    log('   rebrush-download Leaf-Nodes:');
    leafNodes.forEach(n => log(`     <${n.tag} class="${n.cls}"> "${n.text}"`));

    // Check overlays (Angular CDK / Material)
    const overlayEls = await page.evaluate(() => {
      const container = document.querySelector('.cdk-overlay-container, .mat-overlay-container');
      if (!container) return { found: false, html: '' };
      return { found: true, html: container.innerHTML.slice(0, 3000) };
    });
    report.cdkOverlay = overlayEls;
    log('   CDK-Overlay vorhanden: ' + overlayEls.found);
    if (overlayEls.found) {
      log('   Overlay HTML:');
      console.log(overlayEls.html.substring(0, 2000));
    }

    // All globally visible buttons after opening dropdown
    const globalButtons = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button'))
        .filter(b => {
          const t = (b.textContent || '').trim();
          const r = b.getBoundingClientRect();
          return t && r.width > 0 && r.height > 0; // visible buttons only
        })
        .map(b => ({ text: (b.textContent || '').trim(), cls: b.className }))
    );
    report.visibleButtons = globalButtons;
    log('   Sichtbare Buttons global:');
    globalButtons.forEach(b => log(`     [${b.cls}] "${b.text}"`));

  } catch (err) {
    log('FEHLER: ' + err.message);
    report.error = err.message;
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'inspect-error.png'), fullPage: true }).catch(() => {});
  } finally {
    const reportPath = path.join(OUTPUT_DIR, `inspect-${today}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    log('\nReport gespeichert: ' + reportPath);
    log('Screenshots in: ' + OUTPUT_DIR);
    await browser.close();
  }
})();
