const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { saveConfig, loadConfig } = require('./config');

function getChromiumPath() {
  // 1. Packaged build: bundled Chromium under resources/chromium-browser
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

  // 2. Path written by setup.ps1 (covers ms-playwright, system Chrome, Edge)
  const browserPathFile = path.join(__dirname, '..', 'browser-path.txt');
  if (fs.existsSync(browserPathFile)) {
    const saved = fs.readFileSync(browserPathFile, 'utf8').trim();
    if (saved && fs.existsSync(saved)) return saved;
  }

  // 3. Explicit env override
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }

  // 4. Any ms-playwright Chromium (newest first)
  const localAppData = process.env.LOCALAPPDATA || '';
  const pwBase = path.join(localAppData, 'ms-playwright');
  if (fs.existsSync(pwBase)) {
    const dirs = fs.readdirSync(pwBase)
      .filter(d => d.startsWith('chromium-'))
      .sort().reverse();
    for (const d of dirs) {
      const exe = path.join(pwBase, d, 'chrome-win', 'chrome.exe');
      if (fs.existsSync(exe)) return exe;
    }
  }

  // 5. System Chrome / Edge
  const pf   = process.env['ProgramFiles']       || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)']  || 'C:\\Program Files (x86)';
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

async function runDownload(config, logger, abortSignal) {
  const { username, password, outputDir } = config;
  const today = new Date().toISOString().slice(0, 10);

  // Portal liefert zwei Seiten pro Tag
  const fileLinks  = path.join(outputDir, `Dreieich_${today}_links.pdf`);
  const fileRechts = path.join(outputDir, `Dreieich_${today}_rechts.pdf`);

  if (fs.existsSync(fileLinks) && fs.existsSync(fileRechts)) {
    logger.info('Dateien fuer heute bereits vorhanden – ueberspringe.');
    return { skipped: true, path: fileLinks };
  }

  fs.mkdirSync(outputDir, { recursive: true });

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
    // 1) PORTAL OEFFNEN
    // ------------------------------------------------------------------
    logger.info('Navigiere zu ' + PORTAL);
    await page.goto(PORTAL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // ------------------------------------------------------------------
    // 2) LOGIN-LINK KLICKEN
    // ------------------------------------------------------------------
    logger.info('Klicke Anmelden-Link');
    await page.getByRole('link', { name: /Anmelden/ }).first().click();
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });

    // ------------------------------------------------------------------
    // 3) LOGIN-FORMULAR
    // ------------------------------------------------------------------
    logger.info('Fuelle Login-Formular');
    await page.getByPlaceholder('E-Mail').fill(username);
    await page.getByPlaceholder('Passwort').fill(password);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    // ------------------------------------------------------------------
    // 4) OPTIONALER "MIT ANMELDUNG FORTFAHREN"-DIALOG
    // ------------------------------------------------------------------
    await page.getByRole('link', { name: /mit Anmeldung fortfahren/i })
      .click({ timeout: 5_000 })
      .catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    // Login-Fehler pruefen
    const loginError = await page
      .getByText(/ungueltig|falsch|incorrect|invalid|fehlgeschlagen/i)
      .isVisible({ timeout: 3_000 }).catch(() => false);
    if (loginError) throw new Error('Login fehlgeschlagen – Zugangsdaten pruefen.');
    logger.info('Login erfolgreich');

    // ------------------------------------------------------------------
    // 5) AKTUELLE AUSGABE ANKLICKEN
    // ------------------------------------------------------------------
    logger.info('Waehle aktuelle Ausgabe');
    await page.getByRole('link', { name: /Offenbach-Post/ }).first()
      .click({ timeout: 20_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    // ------------------------------------------------------------------
    // 6) DREIEICH-SEITE AUSWAEHLEN
    // ------------------------------------------------------------------
    logger.info('Navigiere zur Dreieich-Ausgabe');
    await page.locator('rebrush-department-list-control div').nth(2).click();
    await page.getByText('Dreieich', { exact: true }).click({ timeout: 10_000 });
    await page.waitForLoadState('networkidle', { timeout: 20_000 });
    logger.info('Dreieich-Seite geladen');

    // ------------------------------------------------------------------
    // 7) LINKE SEITE HERUNTERLADEN
    // ------------------------------------------------------------------
    if (!fs.existsSync(fileLinks)) {
      logger.info('Lade linke Seite herunter');
      await page.locator('rebrush-download i').first().click();
      const [dl1] = await Promise.all([
        page.waitForEvent('download', { timeout: 60_000 }),
        page.locator('rebrush-download').getByText('Linke Seite').click(),
      ]);
      await dl1.saveAs(fileLinks);
      const f1 = await dl1.failure();
      if (f1) throw new Error('Download linke Seite fehlgeschlagen: ' + f1);
      logger.info('Gespeichert: ' + fileLinks);
    }

    // ------------------------------------------------------------------
    // 8) RECHTE SEITE HERUNTERLADEN
    // ------------------------------------------------------------------
    if (!fs.existsSync(fileRechts)) {
      logger.info('Lade rechte Seite herunter');
      await page.locator('rebrush-download i').first().click();
      const [dl2] = await Promise.all([
        page.waitForEvent('download', { timeout: 60_000 }),
        page.locator('rebrush-download').getByText('Rechte Seite').click(),
      ]);
      await dl2.saveAs(fileRechts);
      const f2 = await dl2.failure();
      if (f2) throw new Error('Download rechte Seite fehlgeschlagen: ' + f2);
      logger.info('Gespeichert: ' + fileRechts);
    }

    // Erfolg festhalten
    const cfg = await loadConfig();
    await saveConfig({ ...cfg, lastSuccess: new Date().toISOString() });

    return { skipped: false, path: fileLinks };

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

module.exports = { runDownload };
