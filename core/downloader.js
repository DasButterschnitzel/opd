/**
 * core/downloader.js
 *
 * Playwright-Automatisierung: Login → Navigation zur Dreieich-Seite → PDF-Download.
 *
 * SELEKTOREN ANPASSEN:
 *   Die mit "TODO" markierten Stellen müssen einmalig mit
 *     npx playwright codegen https://epaper.op-online.de
 *   ermittelt und hier eingetragen werden.
 *   Vorgehensweise:
 *     1. playwright codegen starten
 *     2. Im Browser einloggen und zur Dreieich-Seite navigieren
 *     3. Den Download/PDF-Button anklicken
 *     4. Den erzeugten Code als Grundlage für die TODOs unten verwenden
 */

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
  const pf  = process.env['ProgramFiles']        || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)']  || 'C:\\Program Files (x86)';
  for (const c of [
    path.join(pf,   'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf,   'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]) {
    if (fs.existsSync(c)) return c;
  }

  return undefined;
}

const PORTAL = 'https://epaper.op-online.de';

// ============================================================================
// SELEKTOREN – hier nach playwright codegen anpassen
// ============================================================================

// Login-Formular
const SEL_USERNAME  = 'input[name="username"]';   // TODO: ggf. anpassen
const SEL_PASSWORD  = 'input[name="password"]';   // TODO: ggf. anpassen
const SEL_SUBMIT    = 'button[type="submit"]';     // TODO: ggf. anpassen

// Navigation zur Dreieich-Ausgabe (nur nötig, wenn nicht automatisch gewählt)
// Auskommentiert lassen, falls die Ausgabe automatisch korrekt geladen wird.
// const SEL_AUSGABE   = 'text=Dreieich';            // TODO: aktivieren + anpassen

// Download-Button (Fall A: Portal bietet PDF-Download an)
// Setze DOWNLOAD_SELECTOR auf null, wenn kein Download-Button vorhanden ist (→ Fall B).
const DOWNLOAD_SELECTOR = 'text=PDF herunterladen'; // TODO: anpassen oder null setzen

// Seiten-Navigation (falls manuell zur richtigen Seite geblättert werden muss)
// const SEL_DREIEICH_SEITE = 'text=Dreieich';       // TODO: aktivieren + anpassen

// ============================================================================

async function runDownload(config, logger, abortSignal) {
  const { username, password, outputDir } = config;
  const today = new Date().toISOString().slice(0, 10);
  const filename = `Dreieich_${today}.pdf`;
  const targetPath = path.join(outputDir, filename);

  // Idempotenz: nicht doppelt laden
  if (fs.existsSync(targetPath)) {
    logger.info(`Datei für heute existiert bereits: ${targetPath} – überspringe.`);
    return { skipped: true, path: targetPath };
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const executablePath = getChromiumPath();
  logger.info('Starte Chromium' + (executablePath ? ` (${executablePath})` : ' (System-Chromium)'));

  const browser = await chromium.launch({
    headless: true,
    executablePath,
  });

  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  // Abbruch-Signal weitergeben
  if (abortSignal) {
    abortSignal.addEventListener('abort', async () => {
      logger.warn('Download abgebrochen.');
      await browser.close().catch(() => {});
    });
  }

  // Response-Monitor: hilft beim Ermitteln direkter PDF-URLs (Discovery)
  page.on('response', (res) => {
    const url  = res.url();
    const ct   = res.headers()['content-type'] || '';
    if (ct.includes('pdf') || (ct.includes('image') && /seite|page/i.test(url))) {
      logger.info(`[treffer] ${ct} ${url}`);
    }
  });

  const screenshotDir = path.join(outputDir, 'debug');

  try {
    // ------------------------------------------------------------------
    // 1) LOGIN
    // ------------------------------------------------------------------
    logger.info('Navigiere zu ' + PORTAL);
    await page.goto(PORTAL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Cookie-Banner o.ä. wegklicken, falls vorhanden
    // TODO: ggf. activieren
    // await page.locator('button:has-text("Akzeptieren")').click({ timeout: 5000 }).catch(() => {});

    logger.info('Fülle Login-Formular aus');
    await page.fill(SEL_USERNAME, username);
    await page.fill(SEL_PASSWORD, password);
    await page.click(SEL_SUBMIT);

    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    // Login-Fehler erkennen
    const loginError = await page.locator('text=ungültig, text=Fehler, text=falsch, .error, .alert-danger').first().isVisible({ timeout: 3000 }).catch(() => false);
    if (loginError) {
      throw new Error('Login fehlgeschlagen – Zugangsdaten prüfen.');
    }
    logger.info('Login erfolgreich');

    // ------------------------------------------------------------------
    // 2) NAVIGATION ZUR DREIEICH-AUSGABE
    // ------------------------------------------------------------------
    // TODO: Falls die Lokalausgabe automatisch geladen wird, diesen Block
    //       auskommentiert lassen. Andernfalls die Klicks aktivieren:
    //
    // logger.info('Navigiere zur Dreieich-Ausgabe');
    // await page.locator(SEL_AUSGABE).click();
    // await page.waitForLoadState('networkidle', { timeout: 20_000 });
    //
    // logger.info('Navigiere zur Dreieich-Seite');
    // await page.locator(SEL_DREIEICH_SEITE).click();
    // await page.waitForLoadState('networkidle', { timeout: 20_000 });

    // ------------------------------------------------------------------
    // 3a) DOWNLOAD-EVENT (falls Portal einen PDF-Button hat)
    // ------------------------------------------------------------------
    if (DOWNLOAD_SELECTOR) {
      logger.info('Warte auf Download-Button: ' + DOWNLOAD_SELECTOR);
      await page.locator(DOWNLOAD_SELECTOR).waitFor({ timeout: 20_000 });

      logger.info('Klicke Download-Button');
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 60_000 }),
        page.locator(DOWNLOAD_SELECTOR).click(),
      ]);

      logger.info('Download läuft, speichere nach: ' + targetPath);
      await download.saveAs(targetPath);

      const failure = await download.failure();
      if (failure) throw new Error('Download fehlgeschlagen: ' + failure);

      logger.info('Gespeichert: ' + targetPath);

    } else {
      // ------------------------------------------------------------------
      // 3b) FALLBACK: Seite als PDF rendern (kein Download-Button vorhanden)
      // ------------------------------------------------------------------
      logger.info('Kein Download-Button konfiguriert – rendere Seite als PDF');
      await page.waitForLoadState('networkidle', { timeout: 20_000 });
      await page.pdf({
        path: targetPath,
        format: 'A3',
        printBackground: true,
      });
      logger.info('PDF gerendert: ' + targetPath);
    }

    // Erfolg in Config festhalten
    const cfg = await loadConfig();
    await saveConfig({ ...cfg, lastSuccess: new Date().toISOString() });

    return { skipped: false, path: targetPath };

  } catch (err) {
    // Screenshot für Debugging
    try {
      fs.mkdirSync(screenshotDir, { recursive: true });
      const screenshotPath = path.join(screenshotDir, `error-${today}-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      logger.error('Screenshot gespeichert: ' + screenshotPath);
    } catch {}
    throw err;

  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { runDownload };
