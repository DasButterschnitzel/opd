const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { saveConfig, loadConfig } = require('./config');

function getChromiumPath() {
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'chromium-browser');
    for (const c of [
      path.join(bundled, 'chrome-win', 'chrome.exe'),
      path.join(bundled, 'chrome-linux', 'chrome'),
      path.join(bundled, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    ]) {
      if (fs.existsSync(c)) return c;
    }
  }

  const browserPathFile = path.join(__dirname, '..', 'browser-path.txt');
  if (fs.existsSync(browserPathFile)) {
    const saved = fs.readFileSync(browserPathFile, 'utf8').trim();
    if (saved && fs.existsSync(saved)) return saved;
  }

  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }

  const localAppData = process.env.LOCALAPPDATA || '';
  const pwBase = path.join(localAppData, 'ms-playwright');
  if (fs.existsSync(pwBase)) {
    const dirs = fs.readdirSync(pwBase).filter(d => d.startsWith('chromium-')).sort().reverse();
    for (const d of dirs) {
      const exe = path.join(pwBase, d, 'chrome-win', 'chrome.exe');
      if (fs.existsSync(exe)) return exe;
    }
  }

  const pf   = process.env['ProgramFiles']      || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  for (const c of [
    path.join(pf,          'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86,        'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(localAppData,'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86,        'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf,          'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]) {
    if (fs.existsSync(c)) return c;
  }

  return undefined;
}

const PORTAL = 'https://epaper.op-online.de';

// ---------------------------------------------------------------------------
// Enumerate download options from the open dropdown.
// Tries multiple strategies because the rebrush portal may render the menu
// inside the custom element OR in an Angular CDK overlay appended to <body>.
// ---------------------------------------------------------------------------
async function getDropdownOptions(page, logger) {
  await page.waitForTimeout(500);

  // Strategy A: elements directly inside rebrush-download
  const innerStrategies = [
    'rebrush-download button',
    'rebrush-download li',
    'rebrush-download [role="menuitem"]',
    'rebrush-download a',
    'rebrush-download span[class]',
  ];
  for (const sel of innerStrategies) {
    try {
      const loc = page.locator(sel);
      const cnt = await loc.count({ timeout: 800 });
      if (cnt > 0) {
        const texts = (await loc.allTextContents()).map(t => t.trim()).filter(t => t.length > 1);
        if (texts.length) {
          logger.info('Dropdown-Optionen [' + sel + ']: ' + texts.join(', '));
          return texts;
        }
      }
    } catch {}
  }

  // Strategy B: Angular CDK / Material overlay appended to document body
  const overlayStrategies = [
    '.cdk-overlay-container button',
    '.cdk-overlay-container li',
    '.cdk-overlay-container [role="menuitem"]',
    'mat-option',
    '[mat-menu-item]',
    'mat-menu button',
  ];
  for (const sel of overlayStrategies) {
    try {
      const loc = page.locator(sel);
      const cnt = await loc.count({ timeout: 800 });
      if (cnt > 0) {
        const texts = (await loc.allTextContents()).map(t => t.trim()).filter(t => t.length > 1);
        if (texts.length) {
          logger.info('Dropdown-Optionen [overlay/' + sel + ']: ' + texts.join(', '));
          return texts;
        }
      }
    } catch {}
  }

  // Strategy C: walk all leaf DOM nodes inside rebrush-download (incl. shadow DOM)
  try {
    const nodeTexts = await page.locator('rebrush-download').first().evaluate(el => {
      const seen = new Set();
      const walk = root => {
        root.querySelectorAll('*').forEach(n => {
          if (n.children.length === 0) {
            const t = (n.textContent || '').trim();
            if (t && t.length > 1 && t.length < 60) seen.add(t);
          }
        });
        if (root.shadowRoot) walk(root.shadowRoot);
      };
      walk(el);
      return [...seen];
    });
    if (nodeTexts.length) {
      logger.info('Dropdown-Optionen [DOM-walk]: ' + nodeTexts.join(', '));
      return nodeTexts;
    }
  } catch {}

  // Fallback: the options recorded by codegen
  logger.warn('Dropdown-Optionen nicht automatisch erkannt – nutze Standardnamen.');
  return ['Linke Seite', 'Rechte Seite'];
}

// Sanitize option text to a safe filename segment
function toSafeFilename(text) {
  return text
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 60);
}

// Return sorted list of today's PDF files in outputDir (basenames only)
function getFilesForToday(outputDir) {
  const today = new Date().toISOString().slice(0, 10);
  if (!fs.existsSync(outputDir)) return [];
  return fs.readdirSync(outputDir)
    .filter(f => f.startsWith('Dreieich_' + today) && f.endsWith('.pdf'))
    .sort();
}

// Open the department list control, trying multiple approaches
async function openDeptList(page, logger) {
  // Already open?
  const already = await page.locator('rebrush-department-list-control')
    .getByText(/Dreieich/i).first().isVisible({ timeout: 800 }).catch(() => false);
  if (already) return;

  // Approach A: nth(2) from codegen recording
  try {
    await page.locator('rebrush-department-list-control div').nth(2).click({ timeout: 5000 });
    await page.waitForTimeout(500);
    const open = await page.locator('rebrush-department-list-control')
      .getByText(/Dreieich/i).first().isVisible({ timeout: 2000 }).catch(() => false);
    if (open) return;
  } catch {}

  // Approach B: first div as fallback
  logger.warn('Sektionsliste-Toggle: nth(2) erfolglos – versuche first()');
  await page.locator('rebrush-department-list-control div').first().click({ timeout: 5000 });
  await page.waitForTimeout(600);
}

// ---------------------------------------------------------------------------
// Main download function
// ---------------------------------------------------------------------------
async function runDownload(config, logger, abortSignal) {
  const { username, password, outputDir } = config;
  const today = new Date().toISOString().slice(0, 10);

  // ------------------------------------------------------------------
  // IDEMPOTENZ: Wenn heute bereits erfolgreich geladen wurde UND
  // mindestens eine Dreieich-Datei fuer heute existiert -> ueberspringen.
  // So wird der Login komplett vermieden.
  // ------------------------------------------------------------------
  try {
    const cfg = await loadConfig();
    if (cfg.lastSuccess && cfg.lastSuccess.slice(0, 10) === today) {
      const existing = fs.existsSync(outputDir)
        ? fs.readdirSync(outputDir).filter(f => f.startsWith(`Dreieich_${today}`) && f.endsWith('.pdf'))
        : [];
      if (existing.length > 0) {
        logger.info('Bereits heute heruntergeladen: ' + existing.join(', ') + ' – ueberspringe.');
        return { skipped: true, files: existing };
      }
    }
  } catch {}

  fs.mkdirSync(outputDir, { recursive: true });

  logger.info('[1/6] Browser ermitteln...');
  const executablePath = getChromiumPath();
  if (!executablePath) {
    throw new Error('Kein Browser gefunden. Bitte setup.bat erneut ausfuehren.');
  }
  logger.info('Starte Browser: ' + executablePath);

  const browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({ acceptDownloads: true });
  const page    = await context.newPage();

  if (abortSignal) {
    abortSignal.addEventListener('abort', async () => {
      logger.warn('Download abgebrochen.');
      await browser.close().catch(() => {});
    });
  }

  const screenshotDir = path.join(outputDir, 'debug');

  try {
    // ------------------------------------------------------------------
    // 1) PORTAL
    // ------------------------------------------------------------------
    logger.info('[2/6] Portal laden');
    await page.goto(PORTAL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // ------------------------------------------------------------------
    // 2) LOGIN
    // ------------------------------------------------------------------
    logger.info('[3/6] Login durchführen');
    await page.getByRole('link', { name: /Anmelden/ }).first().click();
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });

    logger.info('Fuelle Login-Formular');
    await page.getByPlaceholder('E-Mail').fill(username);
    await page.getByPlaceholder('Passwort').fill(password);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    // Optionaler "mit Anmeldung fortfahren" Dialog
    await page.getByRole('link', { name: /mit Anmeldung fortfahren/i })
      .click({ timeout: 5_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    const loginError = await page.getByText(/ungueltig|falsch|incorrect|invalid|fehlgeschlagen/i)
      .isVisible({ timeout: 3_000 }).catch(() => false);
    if (loginError) throw new Error('Login fehlgeschlagen – Zugangsdaten pruefen.');
    logger.info('Login erfolgreich');

    // ------------------------------------------------------------------
    // 3) AKTUELLE AUSGABE
    // ------------------------------------------------------------------
    logger.info('[4/6] Ausgabe wählen');
    await page.getByRole('link', { name: /Offenbach-Post/ }).first().click({ timeout: 20_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    // Warten bis die rebrush-Komponenten gerendert sind (Angular bootstrapping)
    await page.locator('rebrush-department-list-control').waitFor({ timeout: 20_000 });
    logger.info('[5/6] Dreieich-Sektion finden');

    // ------------------------------------------------------------------
    // 4) DREIEICH-SEKTION FINDEN
    // Partial match: findet "Dreieich", "Dreieich + Neu-Isenburg", etc.
    // ------------------------------------------------------------------
    await openDeptList(page, logger);

    const dreieichItem = page.locator('rebrush-department-list-control').getByText(/Dreieich/i).first();
    const sectionLabel = (await dreieichItem.textContent({ timeout: 10_000 })).trim();
    logger.info('Sektion gefunden: "' + sectionLabel + '"');

    // Hinweis wenn Kombiseite
    if (sectionLabel.toLowerCase() !== 'dreieich') {
      logger.info('Hinweis: Kombiseite – Dreieich erscheint zusammen mit anderen Orten.');
    }

    await dreieichItem.click();
    await page.waitForLoadState('networkidle', { timeout: 20_000 });
    // Warten bis das rebrush-download-Element sichtbar ist
    await page.locator('rebrush-download').first().waitFor({ timeout: 15_000 });

    // ------------------------------------------------------------------
    // 5) DOWNLOAD-OPTIONEN ERMITTELN
    // ------------------------------------------------------------------
    logger.info('[6/6] Download-Optionen ermitteln');
    await page.locator('rebrush-download i').first().click();
    const options = await getDropdownOptions(page, logger);

    // ------------------------------------------------------------------
    // 6) ALLE OPTIONEN HERUNTERLADEN
    // ------------------------------------------------------------------
    const downloadedFiles = [];
    for (const optText of options) {
      const safeSuffix = toSafeFilename(optText);
      const outFile    = path.join(outputDir, `Dreieich_${today}_${safeSuffix}.pdf`);

      if (fs.existsSync(outFile)) {
        logger.info('Bereits vorhanden: ' + outFile);
        downloadedFiles.push(outFile);
        continue;
      }

      // Sicherstellen, dass das Dropdown offen ist (koennte nach einem Download geschlossen sein)
      const menuVisible = await page.locator('rebrush-download li, rebrush-download button, rebrush-download a')
        .first().isVisible({ timeout: 800 }).catch(() => false);
      if (!menuVisible) {
        logger.info('Dropdown geschlossen – oeffne neu');
        await page.locator('rebrush-download i').first().click();
        await page.waitForTimeout(300);
      }

      logger.info('[6/6] Herunterladen: "' + optText + '" (' + (options.indexOf(optText)+1) + '/' + options.length + ')');
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 60_000 }),
        page.locator('rebrush-download').getByText(optText).first().click(),
      ]);

      await dl.saveAs(outFile);
      const failure = await dl.failure();
      if (failure) throw new Error('Download "' + optText + '" fehlgeschlagen: ' + failure);

      downloadedFiles.push(outFile);
      logger.info('Gespeichert: ' + outFile);
    }

    if (downloadedFiles.length === 0) {
      throw new Error('Keine Dateien heruntergeladen – Dropdown leer?');
    }

    logger.info('Fertig. ' + downloadedFiles.length + ' Datei(en) heruntergeladen.');

    const cfg = await loadConfig();
    await saveConfig({ ...cfg, lastSuccess: new Date().toISOString() });

    return { skipped: false, files: downloadedFiles.map(f => path.basename(f)) };

  } catch (err) {
    try {
      fs.mkdirSync(screenshotDir, { recursive: true });
      const screenshotPath = path.join(screenshotDir, `error-${today}-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      logger.error('Screenshot: ' + screenshotPath);
    } catch {}
    throw err;

  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { runDownload, getFilesForToday };
