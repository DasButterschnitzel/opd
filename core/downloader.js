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

  // Strategy D: generic menus/dropdowns that appeared after clicking the
  // toolbar Download button (not inside rebrush-download).
  const genericStrategies = [
    '[role="menu"] button',
    '[role="menu"] [role="menuitem"]',
    '[role="listbox"] [role="option"]',
    '.mat-menu-content button',
    '[class*="dropdown-menu"] li',
    '[class*="dropdown-menu"] button',
    '[class*="popup"] button',
    '[class*="popup"] li',
    '[class*="context-menu"] li',
    '[class*="context-menu"] button',
  ];
  for (const sel of genericStrategies) {
    try {
      const loc = page.locator(sel);
      const cnt = await loc.count({ timeout: 600 });
      if (cnt > 0) {
        const texts = (await loc.allTextContents()).map(t => t.trim()).filter(t => t.length > 1 && t.length < 60);
        if (texts.length) {
          logger.info('Dropdown-Optionen [generic/' + sel + ']: ' + texts.join(', '));
          return texts;
        }
      }
    } catch {}
  }

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
// Poll the page URL concurrently with an Inhalt navigation click, trying to
// capture the transient single-page URL (#/ID/30) before the reader switches
// to the spread view (#/ID/30-31).
//
// Usage:
//   const handle = { active: true, result: null };
//   const done   = capturePageFromUrl(page, handle, 3000);
//   await openInhaltSection(page, text, logger);    // click happens here
//   await page.waitForLoadState('networkidle', ...);
//   handle.active = false;
//   await done;
//   const exactPage = handle.result; // number, or null if not found
// ---------------------------------------------------------------------------
function capturePageFromUrl(page, handle, maxMs = 3000) {
  return (async () => {
    const seen = new Set([page.url()]);
    const deadline = Date.now() + maxMs;
    while (handle.active && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 20));
      const url = page.url();
      if (!seen.has(url)) {
        seen.add(url);
        // Look only at the last segment of the hash path, e.g. "#/903932/30"
        const hashPart = url.includes('#') ? url.split('#')[1] : '';
        const lastSeg = hashPart.split('/').filter(Boolean).pop() || '';
        if (/^\d+$/.test(lastSeg)) {
          const n = parseInt(lastSeg, 10);
          // 2–999: plausible newspaper page; edition IDs are typically 6 digits
          if (n >= 2 && n <= 999) {
            handle.result = n;
            return;
          }
        }
      }
    }
  })();
}

// ---------------------------------------------------------------------------
// Click a reader-toolbar/menu button identified by visible text, aria-label or
// title. Returns true on success. Used for "Inhalt", "Download", etc.
// ---------------------------------------------------------------------------
async function clickReaderButton(page, label, logger, { optional = false } = {}) {
  const re = new RegExp('^\\s*' + label + '\\s*$', 'i');
  const strategies = [
    () => page.getByRole('button',   { name: re }),
    () => page.getByRole('link',     { name: re }),
    () => page.getByRole('menuitem', { name: re }),
    () => page.locator('[aria-label*="' + label + '" i]'),
    () => page.locator('[title*="' + label + '" i]'),
    () => page.getByText(re),
  ];
  for (const make of strategies) {
    try {
      const loc = make().first();
      if ((await loc.count().catch(() => 0)) > 0 &&
          (await loc.isVisible().catch(() => false))) {
        await loc.click({ timeout: 4000 });
        logger.info('Klick: "' + label + '"');
        return true;
      }
    } catch {}
  }
  if (!optional) logger.warn('Button "' + label + '" nicht gefunden.');
  return false;
}

// ---------------------------------------------------------------------------
// Discovery helper: log every visible, short clickable/list item on the page.
// This makes the real portal structure visible in the protocol so selectors
// can be sharpened from a single test run instead of blind guessing.
// ---------------------------------------------------------------------------
async function dumpClickables(page, logger, tag) {
  try {
    const items = await page.evaluate(() => {
      const sel = 'a,button,li,[role="button"],[role="menuitem"],[role="option"],' +
                  '[class*="item"],[class*="chapter"],[class*="toc"],[class*="content"]';
      const out = [];
      document.querySelectorAll(sel).forEach(n => {
        const r = n.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        const t = (n.innerText || n.textContent || '').trim().replace(/\s+/g, ' ');
        if (t && t.length > 0 && t.length < 60) out.push(t);
      });
      return [...new Set(out)].slice(0, 60);
    });
    logger.info('[' + tag + '] Sichtbare Elemente: ' + (items.length ? items.join(' | ') : '(keine)'));
  } catch (e) {
    logger.warn('[' + tag + '] Struktur-Dump fehlgeschlagen: ' + e.message);
  }
}

// ---------------------------------------------------------------------------
// Find the Dreieich entry anywhere on the page (not limited to one custom
// element). Enumerates visible clickable items, scores each with scoreDreieich,
// and returns the best match. Throws a helpful error (kept generic) otherwise.
// ---------------------------------------------------------------------------
async function findDreieichAnywhere(page, logger) {
  const itemSel = 'a,button,li,[role="button"],[role="menuitem"],[role="option"],' +
                  '[class*="item"],[class*="chapter"],[class*="toc"]';
  const loc = page.locator(itemSel);
  const cnt = await loc.count().catch(() => 0);
  const scored = [];
  for (let i = 0; i < cnt && i < 400; i++) {
    const el = loc.nth(i);
    let text = '';
    try {
      if (!(await el.isVisible().catch(() => false))) continue;
      text = ((await el.textContent().catch(() => '')) || '').trim().replace(/\s+/g, ' ');
    } catch { continue; }
    if (!text || text.length > 60) continue;
    const score = scoreDreieich(text);
    if (score > 0) scored.push({ i, text, score });
  }
  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    const direct = page.getByText(/\bDreieich\b/i).first();
    if (await direct.isVisible().catch(() => false)) {
      logger.warn('Dreieich via Direktsuche gefunden.');
      return direct;
    }
    throw new Error(
      'Dreieich-Eintrag nicht gefunden. Bitte Protokoll ("Sichtbare Elemente") und ' +
      'Screenshot pruefen – moeglicherweise Feiertag/Sonderedition oder die Menue-Struktur ' +
      'weicht ab.'
    );
  }

  const best = scored[0];
  if (best.score === 100)     logger.info('Dreieich-Eintrag: "' + best.text + '"');
  else if (best.score === 80) logger.warn('Kombi-Eintrag erkannt: "' + best.text + '"');
  else                        logger.warn('Unsichere Zuordnung: "' + best.text + '" – Protokoll pruefen.');
  return loc.nth(best.i);
}

// ---------------------------------------------------------------------------
// Toolbar / non-section labels that share the broad item selector with the
// real Inhalt menu entries. Filtered out so the local city sections stay
// contiguous and neighbour lookup (order±1) stays reliable.
// ---------------------------------------------------------------------------
const TOOLBAR_LABELS = new Set([
  'schließen', 'schliessen', 'inhalt', 'seitenübersicht', 'seitenubersicht',
  'download', 'ganze ausgabe', 'linke seite', 'rechte seite',
  'ausgewählte seiten', 'ausgewaehlte seiten', 'drucken', 'mehr',
  'artikel aus', 'artikel an', 'einzelseiten zeigen', 'vollbild',
  'mehr artikel aus einzelseiten zeigen vollbild',
]);

function isToolbarLabel(text) {
  const t = text.toLowerCase();
  if (TOOLBAR_LABELS.has(t)) return true;
  if (/^[\d.\s]+$/.test(text)) return true;          // pure numbers / coords
  if (/^\d+\s+von\s+\d+$/i.test(text)) return true;  // "1 von 42" page counter
  return false;
}

// ---------------------------------------------------------------------------
// Collect EVERY entry in the open Inhalt menu (deduplicated, in DOM = page
// order). Returns [{ text, score, order }] where `order` is a compacted
// 0..n-1 index in menu order so that immediate neighbours (order±1) are the
// adjacent newspaper sections – the key signal for left/right placement.
// ---------------------------------------------------------------------------
async function collectAllSections(page) {
  const itemSel = 'a,button,li,[role="button"],[role="menuitem"],[role="option"],' +
                  '[class*="item"],[class*="chapter"],[class*="toc"]';
  const loc = page.locator(itemSel);
  const cnt = await loc.count().catch(() => 0);
  const seen = new Set();
  const sections = [];
  for (let i = 0; i < cnt && i < 400; i++) {
    const el = loc.nth(i);
    let text = '';
    try {
      if (!(await el.isVisible().catch(() => false))) continue;
      text = ((await el.textContent().catch(() => '')) || '').trim().replace(/\s+/g, ' ');
    } catch { continue; }
    if (!text || text.length > 60) continue;
    if (seen.has(text) || isToolbarLabel(text)) continue;
    seen.add(text);
    sections.push({ text, score: scoreDreieich(text), domIndex: i });
  }
  sections.sort((a, b) => a.domIndex - b.domIndex);
  sections.forEach((s, idx) => { s.order = idx; });   // compact: neighbours = order±1
  return sections;
}

// Backwards-compatible: only the Dreieich-relevant entries.
async function collectDreieichSections(page) {
  const all = await collectAllSections(page);
  return all.filter(s => s.score > 0);
}

// ---------------------------------------------------------------------------
// Open a named section from the Inhalt menu. Re-opens the Inhalt panel first if
// the entry isn't currently visible (the panel closes after navigating).
// ---------------------------------------------------------------------------
async function openInhaltSection(page, text, logger) {
  const exact = () => page.getByText(text, { exact: true }).first();
  if (!(await exact().isVisible().catch(() => false))) {
    await clickReaderButton(page, 'Inhalt', logger, { optional: true });
    await page.waitForTimeout(1000);
  }
  if (await exact().isVisible().catch(() => false)) {
    await exact().click({ timeout: 5000 });
    return true;
  }
  const loose = page.getByText(text, { exact: false }).first();
  if (await loose.isVisible().catch(() => false)) {
    await loose.click({ timeout: 5000 });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// After navigating to a section, determine BOTH the spread range and the
// specific page that was navigated to.
//
// Returns { spread: "30-31", currentPage: 30 }
//   spread       – e.g. "30-31" (from URL hash) or "30" (single page)
//   currentPage  – the exact ePaper page the Inhalt click landed on, or null
//                  if it cannot be determined unambiguously.
//
// currentPage detection: the reader's "X von Y" navigation bar shows ONE
// value when exactly one page counter is visible (= the navigated page).
// If BOTH pages of a spread each show their own counter, we cannot tell which
// one Dreieich is on and return null (caller falls back to menu-order logic).
// ---------------------------------------------------------------------------
async function getPagePosition(page) {
  let spread = null;
  let currentPage = null;

  // URL hash is the most reliable source for the spread, e.g. #/903932/30-31
  try {
    const segs = (page.url() || '').split(/[/#?]/).filter(Boolean);
    for (let i = segs.length - 1; i >= 0; i--) {
      const seg = segs[i];
      if (/^\d+-\d+$/.test(seg)) { spread = seg; break; }
      if (/^\d+$/.test(seg)) { spread = seg; break; }
    }
  } catch {}

  // "X von Y" indicators → tells us which page(s) are currently visible
  try {
    const nums = await page.evaluate(() => {
      const out = new Set();
      document.querySelectorAll('*').forEach(el => {
        if (el.children.length) return;
        const m = (el.textContent || '').trim().match(/^(\d+)\s+von\s+\d+$/i);
        if (m) out.add(parseInt(m[1]));
      });
      return [...out];
    });
    const sorted = nums.sort((a, b) => a - b);
    if (!spread && sorted.length > 0) spread = sorted.join('-');
    if (sorted.length === 1) {
      // Exactly one "X von Y" counter → that's the page we navigated to
      currentPage = sorted[0];
    }
    // sorted.length > 1: both pages show a counter, can't tell which is ours
  } catch {}

  return { spread, currentPage };
}

// ---------------------------------------------------------------------------
// Decide, for each Dreieich section, which page of its spread to download.
//  - Group sections by spread range.
//  - Single section on a spread: use currentPage vs. spread range to determine
//    left (first/lower) or right (second/higher). Falls back to a warning when
//    currentPage is unavailable.
//  - Multiple sections on a spread (sorted by menu order): first = Linke Seite,
//    last = Rechte Seite (menu order = page order, proven to work).
// Mutates each section object by setting `.side`.
// ---------------------------------------------------------------------------
function assignSides(sections, logger) {
  const groups = new Map();
  for (const s of sections) {
    const key = s.range || ('solo-' + s.text);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  for (const [range, group] of groups) {
    group.sort((a, b) => a.order - b.order);
    if (group.length === 1) {
      const s = group[0];
      const parts = (s.range || '').split('-').map(Number).filter(n => !isNaN(n));
      if (s.currentPage != null && parts.length === 2) {
        // Reliable: compare navigated page to spread boundaries
        s.side = s.currentPage <= parts[0] ? 'Linke Seite' : 'Rechte Seite';
        logger.info('Solo "' + s.text + '": Seite ' + s.currentPage +
          ' in Spread ' + s.range + ' → ' + s.side);
      } else if (parts.length === 1) {
        // Single-page spread (no right page)
        s.side = 'Linke Seite';
        logger.info('Solo "' + s.text + '": Einzelseite → Linke Seite');
      } else {
        // Cannot determine reliably – log a prominent warning and default to
        // Linke Seite (statistically more common: local sections typically
        // start on an even/left page). User should check the screenshot.
        s.side = 'Linke Seite';
        logger.warn(
          'Solo "' + s.text + '": Seite nicht bestimmbar ' +
          '(Spread ' + (s.range || '?') + ', keine URL-Seiteninfo, kein Spread-Nachbar). ' +
          'Annahme: Linke Seite – bitte Debug-Screenshot prüfen.'
        );
      }
    } else {
      // Multiple sections: menu order = page order (first=links, last=rechts)
      group.forEach((s, idx) => {
        s.side = idx === 0 ? 'Linke Seite'
               : idx === group.length - 1 ? 'Rechte Seite'
               : 'Linke Seite';
      });
    }
    logger.info('Spread ' + range + ': ' +
      group.map(s => '"' + s.text + '" → ' + s.side).join(' | '));
  }
}

// ---------------------------------------------------------------------------
// Download one specific page side ("Linke Seite" / "Rechte Seite") of the
// currently displayed spread via the reader toolbar. Opens the Download menu,
// clicks the exact side entry, and saves the resulting PDF to outFile.
// ---------------------------------------------------------------------------
async function downloadSide(page, side, outFile, logger) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      // Open the Download submenu (Ganze Ausgabe / Linke Seite / Rechte Seite …)
      await clickReaderButton(page, 'Download', logger, { optional: true });
      await page.waitForTimeout(500);
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 30_000 }),
        page.getByText(side, { exact: true }).first().click({ timeout: 5000 }),
      ]);
      await dl.saveAs(outFile);
      const failure = await dl.failure();
      if (failure) throw new Error(failure);
      verifyPdfIntegrity(outFile);
      logger.info('Gespeichert: ' + path.basename(outFile) + ' (' + side + ')');
      return true;
    } catch (e) {
      logger.warn('Download "' + side + '" Versuch ' + attempt + ' fehlgeschlagen: ' + e.message);
      await page.waitForTimeout(1200);
    }
  }
  return false;
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
// Select a past edition date on the kiosk overview page using the
// "Erscheinungstag wählen" dropdown. Must be called BEFORE entering the reader.
// dateStr is YYYY-MM-DD; the dropdown lists entries in German locale format
// like "Samstag, 21.06.2026".
// ---------------------------------------------------------------------------
async function selectArchiveDateOnKiosk(page, dateStr, logger) {
  const DE_DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const d = new Date(dateStr + 'T12:00:00');
  const germanDate = DE_DAYS[d.getDay()] + ', ' +
    String(d.getDate()).padStart(2, '0') + '.' +
    String(d.getMonth() + 1).padStart(2, '0') + '.' +
    d.getFullYear();
  const shortDate = String(d.getDate()).padStart(2, '0') + '.' +
    String(d.getMonth() + 1).padStart(2, '0') + '.' +
    d.getFullYear();

  logger.info('Archiv: suche Ausgabe für ' + germanDate);
  await dumpClickables(page, logger, 'Kiosk-Seite');

  // Strategy A: native <select> – most reliable when present
  const selects = page.locator('select');
  const selectCount = await selects.count().catch(() => 0);
  for (let i = 0; i < selectCount; i++) {
    const sel = selects.nth(i);
    // Full label match
    try {
      await sel.selectOption({ label: germanDate }, { timeout: 2000 });
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
      logger.info('Archiv: Datum über <select> gewählt: ' + germanDate);
      return;
    } catch {}
    // Partial label (DD.MM.YYYY)
    try {
      const options = await sel.evaluate(el =>
        [...el.options].map(o => ({ value: o.value, text: o.text.trim() }))
      );
      const match = options.find(o => o.text.includes(shortDate));
      if (match) {
        await sel.selectOption({ value: match.value }, { timeout: 2000 });
        await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
        logger.info('Archiv: Datum über <select> (Teilübereinstimmung) gewählt: ' + match.text);
        return;
      }
    } catch {}
  }

  // Strategy B: custom dropdown – click trigger to open, then click date item
  const triggerSelectors = [
    '[placeholder*="Erscheinungstag" i]',
    '[aria-label*="Erscheinungstag" i]',
    '[aria-label*="Ausgabe" i]',
    'button:has-text("Erscheinungstag")',
    '[class*="date-select"] button',
    '[class*="edition-select"] button',
    '[class*="issue-select"] button',
    'rebrush-kiosk [class*="select"] button',
    'rebrush-kiosk select',
  ];
  for (const tSel of triggerSelectors) {
    try {
      const trigger = page.locator(tSel).first();
      if (await trigger.count({ timeout: 500 }).catch(() => 0) === 0) continue;
      await trigger.click({ timeout: 3000 });
      await page.waitForTimeout(600);
      for (const label of [germanDate, shortDate]) {
        const item = page.getByText(label, { exact: true }).first();
        if (await item.isVisible({ timeout: 1500 }).catch(() => false)) {
          await item.click({ timeout: 3000 });
          await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
          logger.info('Archiv: Datum über Dropdown gewählt ("' + tSel + '"): ' + label);
          return;
        }
      }
    } catch {}
  }

  // Strategy C: date text visible directly on the page (no trigger needed)
  for (const label of [germanDate, shortDate]) {
    try {
      const el = page.getByText(label, { exact: true }).first();
      if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
        await el.click({ timeout: 3000 });
        await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
        logger.info('Archiv: Datum direkt angeklickt: ' + label);
        return;
      }
    } catch {}
  }

  throw new Error(
    'Archiv-Navigation für ' + dateStr + ' (' + germanDate + ') nicht möglich – ' +
    '"Erscheinungstag wählen" nicht gefunden. Bitte Debug-Screenshot der Kiosk-Seite prüfen.'
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
// Log in to the portal, navigate to the Offenbach-Post kiosk overview, and
// return the kiosk URL. Guarantees the page is on the kiosk (not the reader)
// when it returns – even if clicking the nav link would go straight to the
// current edition. Shared by runDownload and runCatchUpBatch so they can
// reuse a single browser session across multiple dates.
// ---------------------------------------------------------------------------
async function loginAndGetKiosk(page, config, logger, abortSignal) {
  const { username, password } = config;

  logger.info('[2/6] Portal laden');
  await withRetry(
    () => page.goto(PORTAL, { waitUntil: 'domcontentloaded', timeout: 30_000 }),
    { retries: 2, baseDelayMs: 2000, label: 'Portal laden', logger, abortSignal }
  );

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

  logger.info('[4/6] Ausgabe wählen');

  // Capture the kiosk href before clicking so we can navigate back to it later
  const opLink = page.getByRole('link', { name: /Offenbach-Post/ }).first();
  const linkHref = await opLink.getAttribute('href', { timeout: 10_000 }).catch(() => null);

  await opLink.click({ timeout: 20_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 });

  // If the link went directly into the reader (today's edition auto-loaded),
  // navigate back to the kiosk overview so that date selection can happen.
  const deptCtrl = page.locator('rebrush-department-list-control');
  const inReader = await deptCtrl.count({ timeout: 2000 }).catch(() => 0) > 0;

  if (inReader) {
    logger.info('Direkt in Reader gelandet – navigiere zurück zur Kiosk-Übersicht');
    if (linkHref) {
      const kioskUrl = linkHref.startsWith('http')
        ? linkHref
        : new URL(linkHref, PORTAL).toString();
      try {
        await page.goto(kioskUrl, { waitUntil: 'networkidle', timeout: 30_000 });
        logger.info('Kiosk-URL: ' + kioskUrl);
        return { kioskUrl };
      } catch {}
    }
    // Fallback: browser history back
    await page.goBack({ timeout: 15_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  }

  const kioskUrl = page.url();
  logger.info('Kiosk-URL: ' + kioskUrl);
  return { kioskUrl };
}

// ---------------------------------------------------------------------------
// Core per-date download logic. Must be called after loginAndGetKiosk() has
// placed the page on the kiosk overview. Handles:
//   - navigating back to kioskUrl between batch dates
//   - archive-date selection on kiosk
//   - entering the reader
//   - Inhalt probe with concurrent URL interception (smart side detection)
//   - download + PDF integrity verification
// Returns { skipped, files }. Does NOT close the browser (caller owns it).
// ---------------------------------------------------------------------------
async function downloadDateInSession(page, kioskUrl, config, dateStr, logger, abortSignal) {
  const { outputDir } = config;
  const isToday = formatDate() === dateStr;
  const screenshotDir = path.join(outputDir, 'debug');

  // Idempotency per date: skip if all valid files already exist
  try {
    const existing = fs.existsSync(outputDir)
      ? fs.readdirSync(outputDir).filter(f => f.startsWith('Dreieich_' + dateStr) && f.endsWith('.pdf'))
      : [];
    if (existing.length > 0) {
      const allValid = existing.every(f => {
        try { verifyPdfIntegrity(path.join(outputDir, f)); return true; } catch { return false; }
      });
      if (allValid) {
        logger.info('Bereits heruntergeladen (' + dateStr + '): ' + existing.join(', '));
        return { skipped: true, files: existing };
      }
      logger.warn('Korrupter/unvollständiger vorheriger Download für ' + dateStr + ' – lade erneut.');
    }
  } catch {}

  fs.mkdirSync(outputDir, { recursive: true });

  // If a previous date's download left us inside the reader, navigate back to kiosk
  const deptCtrl = page.locator('rebrush-department-list-control');
  const currentlyInReader = await deptCtrl.count({ timeout: 800 }).catch(() => 0) > 0;
  if (currentlyInReader) {
    logger.info('Navigiere zur Kiosk-Übersicht für ' + dateStr + '...');
    await page.goto(kioskUrl, { waitUntil: 'networkidle', timeout: 30_000 });
  }

  // ------------------------------------------------------------------
  // KIOSK: select archive date (if needed) then click cover to enter reader
  // ------------------------------------------------------------------
  logger.info('[4/6] Ausgabe öffnen (' + (isToday ? 'heute' : dateStr) + ')');
  const alreadyInReader = await deptCtrl.count({ timeout: 1500 }).catch(() => 0) > 0;
  if (!alreadyInReader) {
    const label = isToday ? 'aktuelle Ausgabe' : 'Archiv-Ausgabe ' + dateStr;
    logger.info('Kiosk-Übersicht erkannt – öffne ' + label + '...');

    if (!isToday) {
      await selectArchiveDateOnKiosk(page, dateStr, logger);
      await page.waitForTimeout(800);
    }

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

  // ------------------------------------------------------------------
  // READER: find all Dreieich sections (incl. Kombiseiten) via Inhalt menu
  // ------------------------------------------------------------------
  await page.waitForTimeout(1500);

  logger.info('[5/6] Dreieich-Sektion(en) über Inhalt finden');
  await dumpClickables(page, logger, 'Reader-Toolbar');
  await clickReaderButton(page, 'Inhalt', logger);
  await page.waitForTimeout(1200);
  await dumpClickables(page, logger, 'Inhalt-Menü');

  const allSections = await collectAllSections(page);
  const sections = allSections.filter(s => s.score > 0);
  if (sections.length === 0) {
    throw new Error(
      'Keine Dreieich-Sektion im Inhalt gefunden. Bitte Protokoll ("Inhalt-Menü") und ' +
      'Screenshot prüfen – möglicherweise Feiertag oder Sonderedition.'
    );
  }
  logger.info('Dreieich-relevante Sektionen: ' +
    sections.map(s => '"' + s.text + '" (' + s.score + ')').join(' | '));
  const combos = sections.filter(s => s.score < 100);
  if (combos.length) {
    logger.warn('Kombiseite(n) erkannt: ' + combos.map(s => '"' + s.text + '"').join(', '));
  }

  // ------------------------------------------------------------------
  // PROBE: navigate each Dreieich section + its direct menu neighbours to
  // determine which spread it falls on and its left/right position.
  // Concurrent URL interception captures the transient single-page URL
  // (#/ID/30) before the reader switches to spread view (#/ID/30-31) –
  // this is the most reliable source of exact page position.
  // Example 15.06: Dreieich (S.28) + Neu-Isenburg (S.29) → both on spread
  // 30-31 → Dreieich earlier in menu → Linke Seite.
  // ------------------------------------------------------------------
  logger.info('[6/6] Seiten zuordnen & herunterladen');
  const probeOrders = new Set();
  for (const s of sections) {
    probeOrders.add(s.order);
    if (s.order > 0) probeOrders.add(s.order - 1);
    if (s.order < allSections.length - 1) probeOrders.add(s.order + 1);
  }
  const probe = allSections
    .filter(s => probeOrders.has(s.order))
    .sort((a, b) => a.order - b.order);

  for (const sec of probe) {
    // Start URL polling BEFORE the click to catch the transient single-page URL
    const pollHandle = { active: true, result: null };
    const pollDone = capturePageFromUrl(page, pollHandle, 3000);

    const secOpened = await openInhaltSection(page, sec.text, logger);
    if (!secOpened) {
      pollHandle.active = false;
      await pollDone;
      logger.warn('Sektion "' + sec.text + '" nicht anklickbar – übersprungen.');
      sec.skip = true;
      continue;
    }
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1000);
    pollHandle.active = false;
    await pollDone;

    const pos = await getPagePosition(page);
    sec.range = pos.spread;
    // URL-captured single page takes priority over "X von Y" (always null in practice)
    sec.currentPage = pollHandle.result ?? pos.currentPage;
    if (pollHandle.result != null) {
      logger.info('Sektion "' + sec.text + '" – Seite via URL erfasst: ' + pollHandle.result);
    }
    const tag = sec.score > 0 ? '' : ' (Nachbar)';
    logger.info('Sektion "' + sec.text + '"' + tag + ' → Spread ' + (sec.range || '?') +
      (sec.currentPage != null ? ', Seite ' + sec.currentPage : ''));
  }

  assignSides(probe.filter(s => !s.skip), logger);
  const active = probe.filter(s => !s.skip && s.score > 0);

  // ------------------------------------------------------------------
  // DOWNLOAD
  // ------------------------------------------------------------------
  const downloadedFiles = [];
  const seenSpreadSide = new Set();
  for (const sec of active) {
    const key = (sec.range || sec.text) + '|' + sec.side;
    if (seenSpreadSide.has(key)) {
      logger.info('Überspringe Duplikat: "' + sec.text + '" (' + sec.side + ' auf Spread ' + sec.range + ' bereits geladen)');
      continue;
    }
    logger.info('Öffne Sektion: "' + sec.text + '" (' + sec.side + ')');
    const secOpened = await openInhaltSection(page, sec.text, logger);
    if (!secOpened) { logger.warn('Sektion "' + sec.text + '" nicht anklickbar – übersprungen.'); continue; }
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const outFile = path.join(outputDir, 'Dreieich_' + dateStr + '_' + toSafeFilename(sec.text) + '.pdf');
    const ok = await downloadSide(page, sec.side, outFile, logger);
    if (ok) {
      seenSpreadSide.add(key);
      downloadedFiles.push(outFile);
    }
  }

  if (downloadedFiles.length === 0) {
    throw new Error(
      'Kein Download ausgelöst. Bitte Protokoll und Screenshot prüfen – ' +
      'die Toolbar- bzw. Inhalt-Struktur muss noch feinjustiert werden.'
    );
  }

  logger.info('Fertig (' + dateStr + '). ' + downloadedFiles.length + ' Datei(en) heruntergeladen.');
  return { skipped: false, files: downloadedFiles.map(f => path.basename(f)), screenshotDir };
}

// ---------------------------------------------------------------------------
// Main download function.
//   options.targetDate – optional Date/string for catch-up of a past edition.
//                        Defaults to today (current edition).
// ---------------------------------------------------------------------------
async function runDownload(config, logger, abortSignal, options = {}) {
  const { outputDir } = config;
  const targetDate = options.targetDate ? new Date(options.targetDate) : null;
  const today = formatDate(targetDate);
  const isToday = !targetDate || formatDate() === today;
  if (!isToday) logger.info('Rückwirkender Lauf für ' + today);

  // ------------------------------------------------------------------
  // IDEMPOTENZ: Skip if today's files all exist and pass integrity check.
  // Partial or corrupt downloads fall through for re-download.
  // (downloadDateInSession also checks per-date, but this early exit avoids
  //  launching the browser at all when nothing is needed.)
  // ------------------------------------------------------------------
  try {
    const existing = fs.existsSync(outputDir)
      ? fs.readdirSync(outputDir).filter(f => f.startsWith('Dreieich_' + today) && f.endsWith('.pdf'))
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
    const { kioskUrl } = await loginAndGetKiosk(page, config, logger, abortSignal);
    const result = await downloadDateInSession(page, kioskUrl, config, today, logger, abortSignal);

    if (isToday && !result.skipped) {
      const cfg = await loadConfig();
      await saveConfig({ ...cfg, lastSuccess: new Date().toISOString() });
    }

    return result;

  } catch (err) {
    try {
      fs.mkdirSync(screenshotDir, { recursive: true });
      const screenshotPath = path.join(screenshotDir, 'error-' + today + '-' + Date.now() + '.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      logger.error('Screenshot: ' + screenshotPath);
      rotateScreenshots(screenshotDir, 10);
    } catch {}
    throw err;

  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Catch-up batch: download multiple past dates in a single browser session
// (one login, one browser, N date iterations). Oldest dates first.
// Returns [{ date, ok, files?, error? }].
// ---------------------------------------------------------------------------
async function runCatchUpBatch(config, logger, abortSignal, dates) {
  if (!dates || dates.length === 0) return [];

  const { outputDir } = config;

  logger.info('[Aufholen] ' + dates.length + ' verpasste(r) Tag(e): ' + dates.join(', '));

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
      logger.warn('Aufholen abgebrochen.');
      await browser.close().catch(() => {});
    });
  }

  const results = [];
  try {
    const { kioskUrl } = await loginAndGetKiosk(page, config, logger, abortSignal);

    for (const dateStr of dates) {
      if (abortSignal?.aborted) break;
      logger.info('━━━ Aufholen: ' + dateStr + ' ━━━');
      try {
        const r = await downloadDateInSession(page, kioskUrl, config, dateStr, logger, abortSignal);
        results.push({ date: dateStr, ok: true, files: r.files, skipped: r.skipped });
      } catch (err) {
        logger.error('Fehler beim Nachladen ' + dateStr + ': ' + err.message);
        results.push({ date: dateStr, ok: false, error: err.message });
        // Save a debug screenshot and navigate back to kiosk for the next date
        try {
          const screenshotDir = path.join(outputDir, 'debug');
          fs.mkdirSync(screenshotDir, { recursive: true });
          const screenshotPath = path.join(screenshotDir, 'error-' + dateStr + '-' + Date.now() + '.png');
          await page.screenshot({ path: screenshotPath, fullPage: true });
          logger.error('Screenshot: ' + screenshotPath);
          rotateScreenshots(screenshotDir, 10);
        } catch {}
        // Navigate back to kiosk so the next date can proceed
        try {
          await page.goto(kioskUrl, { waitUntil: 'networkidle', timeout: 30_000 });
        } catch {}
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const ok  = results.filter(r => r.ok && !r.skipped).length;
  const skp = results.filter(r => r.skipped).length;
  const fail = results.filter(r => !r.ok).length;
  logger.info('[Aufholen] Abgeschlossen: ' + ok + ' neu, ' + skp + ' übersprungen, ' + fail + ' fehlgeschlagen.');
  return results;
}

module.exports = {
  runDownload,
  runCatchUpBatch,
  getFilesForToday,
  testLogin,
  scoreDreieich,
  findMissedDates,
  getChromiumPath,
};
