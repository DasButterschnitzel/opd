const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { saveConfig, loadConfig } = require('./config');

// Format a Date (or undefined = today) as YYYY-MM-DD
function formatDate(d) {
  return (d ? new Date(d) : new Date()).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Generic retry helper for network/timing-sensitive operations
// ---------------------------------------------------------------------------
async function withRetry(fn, { retries = 2, baseDelayMs = 2000, label = '', logger, abortSignal } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    if (abortSignal?.aborted) throw new Error('Abgebrochen.');
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (abortSignal?.aborted) throw err;
      if (attempt <= retries) {
        const delay = baseDelayMs * attempt;
        if (logger) logger.warn((label ? label + ': ' : '') + 'Versuch ' + attempt + ' fehlgeschlagen (' + err.message + ') – warte ' + delay + 'ms');
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

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
// Verify a saved file is a valid PDF (size > 1KB, starts with %PDF).
// Deletes the file and throws if invalid so retry can re-download.
// ---------------------------------------------------------------------------
function verifyPdfIntegrity(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size < 1024) {
    fs.unlinkSync(filePath);
    throw new Error('PDF zu klein (' + stat.size + ' Bytes): ' + path.basename(filePath));
  }
  const buf = Buffer.alloc(4);
  const fd = fs.openSync(filePath, 'r');
  try { fs.readSync(fd, buf, 0, 4, 0); } finally { fs.closeSync(fd); }
  if (buf.toString('ascii') !== '%PDF') {
    fs.unlinkSync(filePath);
    throw new Error('Keine gueltige PDF: ' + path.basename(filePath));
  }
}

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

// ---------------------------------------------------------------------------
// Check if the Dreieich entry is visible in the department list
// ---------------------------------------------------------------------------
async function isDreieichVisible(page) {
  return page.locator('rebrush-department-list-control')
    .getByText(/Dreieich/i).first()
    .isVisible({ timeout: 800 }).catch(() => false);
}

// ---------------------------------------------------------------------------
// Open the department list with 3-pass fallback and success verification
// ---------------------------------------------------------------------------
async function openDeptListSmart(page, logger) {
  if (await isDreieichVisible(page)) return;

  // Pass 1: semantic aria/button toggle
  try {
    const toggle = page.locator(
      'rebrush-department-list-control [aria-expanded], ' +
      'rebrush-department-list-control [role="button"], ' +
      'rebrush-department-list-control button'
    ).first();
    const cnt = await toggle.count({ timeout: 1000 }).catch(() => 0);
    if (cnt > 0) {
      await toggle.click({ timeout: 3000 });
      await page.waitForTimeout(600);
      if (await isDreieichVisible(page)) return;
    }
  } catch {}

  // Pass 2: nth(2) from codegen recording
  try {
    await page.locator('rebrush-department-list-control div').nth(2).click({ timeout: 3000 });
    await page.waitForTimeout(600);
    if (await isDreieichVisible(page)) return;
  } catch {}

  // Pass 3: first div as last resort
  logger.warn('Dept-Toggle: alle Strategien erschoepft, versuche first()');
  await page.locator('rebrush-department-list-control div').first().click({ timeout: 3000 });
  await page.waitForTimeout(600);
}

// ---------------------------------------------------------------------------
// Score how strongly a section label represents "Dreieich".
//  100 = exact match ("Dreieich")
//   80 = Dreieich as a whole word among others (Kombiseite, e.g.
//        "Dreieich + Neu-Isenburg", "Langen/Dreieich")
//   40 = substring only, NOT a whole word (e.g. "Dreieichenhain") – uncertain
//    0 = no match
// Pure function (no DOM) so it can be unit-tested without a browser.
// ---------------------------------------------------------------------------
function scoreDreieich(text) {
  const t = (text || '').trim();
  const lower = t.toLowerCase();
  if (lower === 'dreieich') return 100;
  if (/\bdreieich\b/i.test(t)) return 80;
  if (lower.includes('dreieich')) return 40;
  return 0;
}

// ---------------------------------------------------------------------------
// Find the Dreieich section autonomously.
// Enumerates every section item ONCE, scores each, picks the best match,
// and clicks that exact item. Recognises combined pages, ignores look-alikes
// like "Dreieichenhain", and throws a helpful error (listing all sections)
// when Dreieich is genuinely absent today (holiday / special edition).
// ---------------------------------------------------------------------------
async function findDreieichSection(page, logger) {
  const container = page.locator('rebrush-department-list-control');

  // Find whichever selector actually yields the section items
  const itemSelectors = ['[role="option"]', 'li', '[class*="item"]', '[class*="dept"]', 'a', 'button'];
  let items = null;
  for (const sel of itemSelectors) {
    const loc = container.locator(sel);
    const cnt = await loc.count().catch(() => 0);
    if (cnt > 0) {
      const texts = await loc.allTextContents().catch(() => []);
      if (texts.filter(x => x.trim().length > 1).length >= 1) {
        items = loc;
        logger.info('Sektions-Items via "' + sel + '" (' + cnt + ' gefunden)');
        break;
      }
    }
  }

  // Build a scored candidate list from the enumerated items
  const scored = [];
  if (items) {
    const cnt = await items.count();
    for (let i = 0; i < cnt; i++) {
      const text = ((await items.nth(i).textContent().catch(() => '')) || '').trim();
      if (text) scored.push({ i, text, score: scoreDreieich(text) });
    }
  }

  if (scored.length) {
    logger.info('Verfuegbare Sektionen: ' + scored.map(s => s.text).join(' | '));
  }

  const matches = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score);

  if (matches.length === 0) {
    // Last resort: direct word-boundary text search in case the item
    // selectors missed the right element entirely.
    const direct = container.getByText(/\bDreieich\b/i).first();
    if (await direct.isVisible({ timeout: 2000 }).catch(() => false)) {
      const text = ((await direct.textContent().catch(() => '')) || '').trim();
      logger.warn('Sektion via Direktsuche gefunden: "' + text + '"');
      return direct;
    }
    const list = scored.length ? scored.map(s => '"' + s.text + '"').join(', ') : '(keine)';
    throw new Error(
      'Dreieich-Sektion heute nicht verfuegbar. ' +
      'Verfuegbare Sektionen: ' + list +
      '. Moeglicherweise Feiertag oder Sonderedition.'
    );
  }

  const best = matches[0];
  if (best.score === 100)     logger.info('Sektion gefunden: "' + best.text + '"');
  else if (best.score === 80) logger.warn('Kombiseite erkannt: "' + best.text + '" (Dreieich + weitere Orte)');
  else                        logger.warn('Unsichere Zuordnung: "' + best.text + '" – bitte Protokoll pruefen.');

  return items.nth(best.i);
}

// ---------------------------------------------------------------------------
// Test login only (no download) – used by the GUI "Zugangsdaten testen" button
// ---------------------------------------------------------------------------
async function testLogin(config, logger) {
  const executablePath = getChromiumPath();
  if (!executablePath) {
    throw new Error(
      'Kein Browser gefunden.\n' +
      'Loesung: setup.bat erneut ausfuehren oder Chrome/Edge installieren.'
    );
  }

  const browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(PORTAL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.getByRole('link', { name: /Anmelden/ }).first().click();
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });
    await page.getByPlaceholder('E-Mail').fill(config.username);
    await page.getByPlaceholder('Passwort').fill(config.password);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    await page.getByRole('link', { name: /mit Anmeldung fortfahren/i })
      .click({ timeout: 5_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const errorLoc = page.locator('[role="alert"], [class*="error"], [class*="alert"]')
      .or(page.getByText(/ungueltig|falsch|incorrect|invalid|fehlgeschlagen/i));
    const hasError = await errorLoc.first().isVisible({ timeout: 3_000 }).catch(() => false);
    if (hasError) {
      const errText = ((await errorLoc.first().textContent().catch(() => '')) || '').trim();
      throw new Error('Login fehlgeschlagen: ' + (errText || 'Zugangsdaten pruefen'));
    }

    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/anmelden')) {
      throw new Error('Login-Seite noch aktiv – Zugangsdaten vermutlich falsch.');
    }

    return { ok: true };
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Determine which past weekdays have NO downloaded files (i.e. were missed).
// Looks back `catchUpDays` days, skips Sundays if configured, and excludes
// today (handled by the normal run). Returns an array of YYYY-MM-DD strings,
// newest first. Pure file-system check – fully testable without a browser.
// ---------------------------------------------------------------------------
function findMissedDates(config) {
  const { outputDir, catchUpDays = 7, skipSundays = true } = config;
  const missed = [];
  if (!outputDir) return missed;
  const existing = fs.existsSync(outputDir) ? fs.readdirSync(outputDir) : [];

  for (let back = 1; back <= catchUpDays; back++) {
    const d = new Date();
    d.setDate(d.getDate() - back);
    if (skipSundays && d.getDay() === 0) continue;        // 0 = Sonntag
    const stamp = formatDate(d);
    const has = existing.some(f => f.startsWith('Dreieich_' + stamp) && f.endsWith('.pdf'));
    if (!has) missed.push(stamp);
  }
  return missed;
}

// ---------------------------------------------------------------------------
// Archive navigation for catch-up of a PAST edition.
// The recorded codegen flow only covers the *current* edition, so this is a
// best-effort attempt: it looks for a date / calendar control on the reader
// page and tries to select `dateStr` (YYYY-MM-DD). If no such control can be
// found, it throws a clear error rather than silently saving the wrong day's
// content under a past-date filename.
// ---------------------------------------------------------------------------
async function navigateToArchiveDate(page, dateStr, logger) {
  logger.info('Archiv: navigiere zu ' + dateStr);

  // Try a native date input first (most reliable if present)
  const dateInput = page.locator('input[type="date"]').first();
  if (await dateInput.count().catch(() => 0)) {
    await dateInput.fill(dateStr).catch(() => {});
    await page.waitForTimeout(800);
    const val = await dateInput.inputValue().catch(() => '');
    if (val === dateStr) {
      logger.info('Archiv: Datum über Datumsfeld gesetzt.');
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
      return;
    }
  }

  // Try a calendar / archive toggle, then a day cell carrying the ISO date
  const calToggle = page.locator(
    '[aria-label*="Kalender" i], [aria-label*="Datum" i], [aria-label*="Archiv" i], ' +
    '[class*="calendar"], [class*="datepicker"], button[title*="Datum" i]'
  ).first();
  if (await calToggle.count().catch(() => 0)) {
    await calToggle.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(500);
    const dayCell = page.locator(
      `[data-date="${dateStr}"], [aria-label*="${dateStr}"], time[datetime="${dateStr}"]`
    ).first();
    if (await dayCell.count().catch(() => 0)) {
      await dayCell.click({ timeout: 4000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
      logger.info('Archiv: Datum über Kalender ausgewählt.');
      return;
    }
  }

  throw new Error(
    'Archiv-Navigation für ' + dateStr + ' nicht möglich – keine Datums-/Kalendersteuerung ' +
    'im Portal gefunden. Bitte diese Ausgabe manuell im Portal laden, oder die Selektoren ' +
    'nach einer codegen-Aufnahme des Archivs ergänzen.'
  );
}

// ---------------------------------------------------------------------------
// Keep only the newest `keep` debug screenshots so the folder can't grow
// unbounded across many failed runs.
// ---------------------------------------------------------------------------
function rotateScreenshots(screenshotDir, keep = 10) {
  try {
    if (!fs.existsSync(screenshotDir)) return;
    const shots = fs.readdirSync(screenshotDir)
      .filter(f => f.startsWith('error-') && f.endsWith('.png'))
      .sort()
      .reverse();
    for (const old of shots.slice(keep)) {
      try { fs.unlinkSync(path.join(screenshotDir, old)); } catch {}
    }
  } catch {}
}

// ---------------------------------------------------------------------------
// Main download function.
//   options.targetDate – optional Date/string for catch-up of a past edition.
//                        Defaults to today (current edition).
// ---------------------------------------------------------------------------
async function runDownload(config, logger, abortSignal, options = {}) {
  const { username, password, outputDir } = config;
  const targetDate = options.targetDate ? new Date(options.targetDate) : null;
  const today = formatDate(targetDate);
  const isToday = !targetDate || formatDate() === today;
  if (!isToday) logger.info('Rückwirkender Lauf für ' + today);

  // ------------------------------------------------------------------
  // IDEMPOTENZ: Skip if today's files all exist and pass integrity check.
  // Partial or corrupt downloads fall through for re-download.
  // ------------------------------------------------------------------
  try {
    const existing = fs.existsSync(outputDir)
      ? fs.readdirSync(outputDir).filter(f => f.startsWith(`Dreieich_${today}`) && f.endsWith('.pdf'))
      : [];
    if (existing.length > 0) {
      const allValid = existing.every(f => {
        try { verifyPdfIntegrity(path.join(outputDir, f)); return true; } catch { return false; }
      });
      if (allValid) {
        logger.info('Bereits für ' + today + ' heruntergeladen (alle Dateien gueltig): ' + existing.join(', '));
        return { skipped: true, files: existing };
      }
      logger.warn('Unvollstaendiger oder korrupter vorheriger Download – lade erneut herunter.');
    }
  } catch {}

  fs.mkdirSync(outputDir, { recursive: true });

  logger.info('[1/6] Browser ermitteln...');
  const executablePath = getChromiumPath();
  if (!executablePath) {
    throw new Error(
      'Kein Browser gefunden.\n' +
      'Loesung A: setup.bat erneut ausfuehren.\n' +
      'Loesung B: Google Chrome oder Microsoft Edge installieren.\n' +
      'Loesung C: browser-path.txt anlegen mit dem Pfad zur chrome.exe.'
    );
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
    await withRetry(
      () => page.goto(PORTAL, { waitUntil: 'domcontentloaded', timeout: 30_000 }),
      { retries: 2, baseDelayMs: 2000, label: 'Portal laden', logger, abortSignal }
    );

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
    await withRetry(
      () => page.waitForLoadState('networkidle', { timeout: 30_000 }),
      { retries: 2, baseDelayMs: 2000, label: 'Login-Laden', logger, abortSignal }
    );

    // Optionaler "mit Anmeldung fortfahren" Dialog
    await page.getByRole('link', { name: /mit Anmeldung fortfahren/i })
      .click({ timeout: 5_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    const errorLoc = page.locator('[role="alert"], [class*="error"], [class*="alert"]')
      .or(page.getByText(/ungueltig|falsch|incorrect|invalid|fehlgeschlagen/i));
    const hasLoginError = await errorLoc.first().isVisible({ timeout: 3_000 }).catch(() => false);
    if (hasLoginError) {
      const errText = ((await errorLoc.first().textContent().catch(() => '')) || '').trim();
      throw new Error('Login fehlgeschlagen: ' + (errText || 'Zugangsdaten pruefen.'));
    }
    logger.info('Login erfolgreich');

    // ------------------------------------------------------------------
    // 3) AKTUELLE AUSGABE
    // ------------------------------------------------------------------
    logger.info('[4/6] Ausgabe wählen');
    await page.getByRole('link', { name: /Offenbach-Post/ }).first().click({ timeout: 20_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    // After clicking the nav link we may land on the kiosk overview (large
    // edition thumbnail + "Erscheinungstag wählen" / "Ausgabe wählen" dropdowns)
    // rather than directly in the reader.  Click the edition thumbnail to enter
    // the reader when rebrush-department-list-control is not yet visible.
    const deptCtrl = page.locator('rebrush-department-list-control');
    const alreadyInReader = await deptCtrl.count({ timeout: 2000 }).catch(() => 0) > 0;
    if (!alreadyInReader) {
      logger.info('Kiosk-Übersicht erkannt – öffne aktuelle Ausgabe...');
      const kiosk_strategies = [
        'rebrush-kiosk-item a',
        'rebrush-kiosk-item img',
        'rebrush-kiosk-item',
        '[class*="kiosk-item"] a',
        '[class*="kiosk-item"] img',
        '[class*="edition-item"] a',
        '[class*="edition-item"] img',
        '[class*="publication-item"] a',
        '[class*="cover"] a',
        '[class*="cover"] img',
        'article a img',
        'main a img',
      ];
      let opened = false;
      for (const sel of kiosk_strategies) {
        try {
          const loc = page.locator(sel).first();
          if (await loc.count({ timeout: 800 }).catch(() => 0) > 0) {
            await loc.click({ timeout: 5000 });
            await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
            if (await deptCtrl.count({ timeout: 3000 }).catch(() => 0) > 0) {
              logger.info('Ausgabe geöffnet via "' + sel + '"');
              opened = true;
              break;
            }
          }
        } catch {}
      }
      if (!opened) {
        // Final attempt: click the first large image on the page (edition cover)
        try {
          await page.locator('img').first().click({ timeout: 5000 });
          await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
          if (await deptCtrl.count({ timeout: 3000 }).catch(() => 0) > 0) {
            logger.info('Ausgabe geöffnet via erstes Bild auf der Seite');
            opened = true;
          }
        } catch {}
      }
      if (!opened) {
        throw new Error(
          'Kiosk: Ausgabe konnte nicht geöffnet werden – kein Weg in den Reader gefunden. ' +
          'Bitte Debug-Screenshot prüfen.'
        );
      }
    }

    // Rückwirkender Lauf: zur Archiv-Ausgabe des Zieldatums navigieren
    if (!isToday) {
      await navigateToArchiveDate(page, today, logger);
    }

    await page.locator('rebrush-department-list-control').waitFor({ timeout: 20_000 });

    // ------------------------------------------------------------------
    // 4) DREIEICH-SEKTION FINDEN
    // ------------------------------------------------------------------
    logger.info('[5/6] Dreieich-Sektion finden');
    await withRetry(
      () => openDeptListSmart(page, logger),
      { retries: 1, baseDelayMs: 2000, label: 'Sektionsliste oeffnen', logger, abortSignal }
    );

    const dreieichItem = await findDreieichSection(page, logger);
    await dreieichItem.click();
    await page.waitForLoadState('networkidle', { timeout: 20_000 });
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
        try {
          verifyPdfIntegrity(outFile);
          logger.info('Bereits vorhanden (gueltig): ' + path.basename(outFile));
          downloadedFiles.push(outFile);
          continue;
        } catch (intErr) {
          // verifyPdfIntegrity already deleted the corrupt file
          logger.warn('Vorhandene Datei korrupt (' + intErr.message + ') – lade neu.');
        }
      }

      await withRetry(async () => {
        // Ensure dropdown is open before each download attempt
        const menuVisible = await page.locator('rebrush-download li, rebrush-download button, rebrush-download a')
          .first().isVisible({ timeout: 800 }).catch(() => false);
        if (!menuVisible) {
          logger.info('Dropdown geschlossen – oeffne neu');
          await page.locator('rebrush-download i').first().click();
          await page.waitForTimeout(300);
        }

        logger.info('[6/6] Herunterladen: "' + optText + '" (' + (options.indexOf(optText) + 1) + '/' + options.length + ')');
        const [dl] = await Promise.all([
          page.waitForEvent('download', { timeout: 60_000 }),
          page.locator('rebrush-download').getByText(optText).first().click(),
        ]);
        await dl.saveAs(outFile);
        const failure = await dl.failure();
        if (failure) throw new Error('Download "' + optText + '" fehlgeschlagen: ' + failure);
        verifyPdfIntegrity(outFile);
      }, { retries: 2, baseDelayMs: 2000, label: 'Download "' + optText + '"', logger, abortSignal });

      downloadedFiles.push(outFile);
      logger.info('Gespeichert: ' + path.basename(outFile));
    }

    if (downloadedFiles.length === 0) {
      throw new Error('Keine Dateien heruntergeladen – Dropdown leer?');
    }

    logger.info('Fertig. ' + downloadedFiles.length + ' Datei(en) heruntergeladen.');

    // lastSuccess nur beim regulären Heute-Lauf setzen, damit ein Aufhol-Lauf
    // den Status des letzten Tageslaufs nicht überschreibt.
    if (isToday) {
      const cfg = await loadConfig();
      await saveConfig({ ...cfg, lastSuccess: new Date().toISOString() });
    }

    return { skipped: false, files: downloadedFiles.map(f => path.basename(f)) };

  } catch (err) {
    try {
      fs.mkdirSync(screenshotDir, { recursive: true });
      const screenshotPath = path.join(screenshotDir, `error-${today}-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      logger.error('Screenshot: ' + screenshotPath);
      rotateScreenshots(screenshotDir, 10);
    } catch {}
    throw err;

  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = {
  runDownload,
  getFilesForToday,
  testLogin,
  scoreDreieich,
  findMissedDates,
  getChromiumPath,
};
