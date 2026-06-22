const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Notification, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Ungefangene Fehler ins Home-Verzeichnis loggen (hilft beim Debugging)
process.on('uncaughtException', (err) => {
  const logFile = path.join(os.homedir(), 'op-epaper-crash.log');
  const msg = `\n[${new Date().toISOString()}] CRASH\n${err.stack || err}\n`;
  try { fs.appendFileSync(logFile, msg); } catch {}
  console.error(msg);
});

const { loadConfig, saveConfig, recordRunResult } = require('./core/config');
const { runDownload, runCatchUpBatch, getFilesForToday, testLogin, findMissedDates, getChromiumPath } = require('./core/downloader');
const { runSelfCheck } = require('./core/selfcheck');
const { createLogger, getRecentLogs } = require('./core/logger');

// Gesamt-Timeout (Watchdog): bricht einen hängenden Download nach 5 Min ab.
const DOWNLOAD_WATCHDOG_MS = 5 * 60 * 1000;

function withWatchdog(promise, abortController, ms = DOWNLOAD_WATCHDOG_MS) {
  let timer;
  const watchdog = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      try { abortController?.abort(); } catch {}
      reject(new Error('Zeitüberschreitung: Download hat länger als ' + Math.round(ms / 60000) + ' Minuten gedauert und wurde abgebrochen.'));
    }, ms);
  });
  return Promise.race([promise, watchdog]).finally(() => clearTimeout(timer));
}

const isHeadless    = process.argv.includes('--headless');
const isStartHidden = process.argv.includes('--start-hidden');

// ---------------------------------------------------------------------------
// Toast notifications (works in both GUI and headless mode)
// ---------------------------------------------------------------------------
function showToast({ title, body, openFolder }) {
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body });
    if (openFolder) n.on('click', () => shell.openPath(openFolder));
    n.show();
  } catch {}
}

// --- HEADLESS MODE -----------------------------------------------------------

if (isHeadless) {
  app.whenReady().then(async () => {
    const logger = createLogger();
    logger.info('Headless-Modus gestartet');

    let config;
    try {
      config = await loadConfig();
    } catch (err) {
      logger.error('Konfiguration konnte nicht geladen werden: ' + err.message);
      app.exit(2);
      return;
    }

    if (!config.username || !config.password) {
      logger.error('Zugangsdaten fehlen. Bitte zuerst die GUI öffnen und konfigurieren.');
      app.exit(2);
      return;
    }

    const abort = new AbortController();
    try {
      const result = await withWatchdog(runDownload(config, logger, abort.signal), abort);
      const summary = result.skipped
        ? 'Bereits heute geladen.'
        : result.files.length + ' Datei(en): ' + result.files.join(', ');
      logger.info('Download abgeschlossen: ' + summary);
      await recordRunResult({ ok: true });
      showToast({
        title: 'OP ePaper – Dreieich',
        body: result.skipped ? 'Bereits heute geladen.' : '✓ ' + summary,
        openFolder: config.outputDir,
      });
      await new Promise(r => setTimeout(r, 2000));
      app.exit(0);
    } catch (err) {
      logger.error('Download fehlgeschlagen: ' + err.message);
      const fails = await recordRunResult({ ok: false, error: err.message });
      // Eskalation: ab dem 2. Fehlschlag in Folge deutlicher warnen
      const title = fails >= 2
        ? `OP ePaper – Fehler (${fails}× in Folge!)`
        : 'OP ePaper – Fehler';
      showToast({ title, body: err.message });
      await new Promise(r => setTimeout(r, 2000));
      app.exit(1);
    }
  });

  // Kein Fenster im Headless-Modus
  app.on('window-all-closed', () => {});
  return;
}

// --- GUI MODE ----------------------------------------------------------------

let mainWindow;
let tray = null;
app.isQuitting = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 820,
    height: 680,
    minWidth: 640,
    minHeight: 520,
    title: 'OP ePaper Tool – Dreieich',
    show: !isStartHidden,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenu(null);

  // Minimize to tray instead of closing
  mainWindow.on('close', (e) => {
    if (tray && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('OP ePaper Tool – Dreieich');

  const sendAction = (action) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tray:action', action);
    }
  };

  const menu = Menu.buildFromTemplate([
    { label: 'Jetzt herunterladen', click: () => { showMainWindow(); sendAction('download'); } },
    { label: 'Einstellungen',       click: () => { showMainWindow(); sendAction('settings'); } },
    { label: 'Protokoll anzeigen',  click: () => { showMainWindow(); sendAction('log'); } },
    { type: 'separator' },
    { label: 'Beenden', click: () => { app.isQuitting = true; app.quit(); } },
  ]);

  tray.setContextMenu(menu);
  tray.on('double-click', showMainWindow);

  loadConfig().then(cfg => {
    if (cfg.lastSuccess && tray) {
      const last = new Date(cfg.lastSuccess).toLocaleDateString('de-DE');
      tray.setToolTip('OP ePaper Tool – Dreieich\nLetzter Erfolg: ' + last);
    }
  }).catch(() => {});
}

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('before-quit', () => { app.isQuitting = true; });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// --- IPC HANDLER -------------------------------------------------------------

// Laufender Download-Vorgang (für Abbruch-Unterstützung)
let activeDownloadAbort = null;

ipcMain.handle('config:get', async () => {
  const cfg = await loadConfig();
  // Passwort nicht im Klartext an Renderer schicken
  return { ...cfg, password: cfg.password ? '••••••••' : '' };
});

ipcMain.handle('config:save', async (_e, updates) => {
  const current = await loadConfig();
  // Passwort nur überschreiben wenn der Nutzer einen neuen Wert eingegeben hat
  const newCfg = {
    ...current,
    ...updates,
    password: updates.password && updates.password !== '••••••••'
      ? updates.password
      : current.password,
  };
  await saveConfig(newCfg);
  return { ok: true };
});

ipcMain.handle('download:start', async (event, opts = {}) => {
  const logger = createLogger((line) => {
    // Log-Zeilen live an den Renderer pushen
    if (!event.sender.isDestroyed()) {
      event.sender.send('download:log', line);
    }
  });

  let config;
  try {
    config = await loadConfig();
  } catch (err) {
    return { ok: false, error: 'Konfiguration konnte nicht geladen werden: ' + err.message };
  }

  if (!config.username || !config.password) {
    return { ok: false, error: 'Zugangsdaten fehlen. Bitte in den Einstellungen konfigurieren.' };
  }

  const targetDate = opts && opts.targetDate ? opts.targetDate : null;
  const isCatchUp = !!targetDate;

  try {
    activeDownloadAbort = new AbortController();
    const result = await withWatchdog(
      runDownload(config, logger, activeDownloadAbort.signal, { targetDate }),
      activeDownloadAbort
    );
    activeDownloadAbort = null;
    // Aufhol-Läufe sollen den Tageslauf-Status nicht überschreiben
    if (!isCatchUp) await recordRunResult({ ok: true });
    const cfg2 = await loadConfig();
    const files = isCatchUp
      ? (result.files || [])
      : getFilesForToday(cfg2.outputDir);
    if (tray && !isCatchUp) {
      const last = new Date().toLocaleDateString('de-DE');
      tray.setToolTip('OP ePaper Tool – Dreieich\nLetzter Erfolg: ' + last);
    }
    return { ok: true, files };
  } catch (err) {
    activeDownloadAbort = null;
    if (!isCatchUp) await recordRunResult({ ok: false, error: err.message });
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('files:today', async () => {
  const cfg = await loadConfig();
  const files = getFilesForToday(cfg.outputDir);
  return { files };
});

ipcMain.handle('download:abort', () => {
  if (activeDownloadAbort) {
    activeDownloadAbort.abort();
  }
  return { ok: true };
});

ipcMain.handle('logs:get', async () => {
  return getRecentLogs();
});

ipcMain.handle('folder:open', async () => {
  const cfg = await loadConfig();
  if (cfg.outputDir) shell.openPath(cfg.outputDir);
});

ipcMain.handle('folder:select', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Zielordner auswählen',
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('file:open', async (_e, absolutePath) => {
  if (!absolutePath || typeof absolutePath !== 'string') return { ok: false };
  const cfg = await loadConfig();
  // Security: only allow opening files within the configured output directory
  if (!absolutePath.startsWith(cfg.outputDir)) return { ok: false, error: 'Pfad nicht erlaubt.' };
  const errMsg = await shell.openPath(absolutePath);
  return { ok: !errMsg, error: errMsg || undefined };
});

ipcMain.handle('login:test', async () => {
  const logger = createLogger();
  try {
    const cfg = await loadConfig();
    if (!cfg.username || !cfg.password) {
      return { ok: false, error: 'Zugangsdaten fehlen.' };
    }
    await testLogin(cfg, logger);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('diagnostics:run', async () => {
  try {
    return await runSelfCheck(getChromiumPath);
  } catch (err) {
    return { ok: false, checks: [{ name: 'Selbsttest', ok: false, level: 'error', detail: err.message }] };
  }
});

ipcMain.handle('missed:get', async () => {
  try {
    const cfg = await loadConfig();
    const dates = findMissedDates(cfg);
    return { dates };
  } catch (err) {
    return { dates: [], error: err.message };
  }
});

// Batch catch-up: single browser session, one login, N dates
ipcMain.handle('catchup:batch', async (event, dates) => {
  if (!Array.isArray(dates) || dates.length === 0) return { ok: true, results: [] };

  const logger = createLogger((line) => {
    if (!event.sender.isDestroyed()) event.sender.send('download:log', line);
  });

  let config;
  try {
    config = await loadConfig();
  } catch (err) {
    return { ok: false, error: 'Konfiguration konnte nicht geladen werden: ' + err.message };
  }

  if (!config.username || !config.password) {
    return { ok: false, error: 'Zugangsdaten fehlen. Bitte in den Einstellungen konfigurieren.' };
  }

  try {
    activeDownloadAbort = new AbortController();
    const results = await withWatchdog(
      runCatchUpBatch(config, logger, activeDownloadAbort.signal, dates),
      activeDownloadAbort,
      dates.length * DOWNLOAD_WATCHDOG_MS  // scale watchdog with date count
    );
    activeDownloadAbort = null;
    return { ok: true, results };
  } catch (err) {
    activeDownloadAbort = null;
    return { ok: false, error: err.message };
  }
});

// Persistenter Lauf-Status für den Fehler-Banner im Renderer
ipcMain.handle('status:get', async () => {
  const cfg = await loadConfig();
  return {
    lastSuccess: cfg.lastSuccess,
    lastError: cfg.lastError,
    lastErrorAt: cfg.lastErrorAt,
    lastRunAt: cfg.lastRunAt,
    consecutiveFailures: cfg.consecutiveFailures || 0,
  };
});

ipcMain.handle('scheduler:create', async () => {
  const cfg = await loadConfig();
  const hour = cfg.scheduleHour ?? 6;
  const minute = cfg.scheduleMinute ?? 0;
  const exePath = process.execPath;

  // Windows-Aufgabenplaner-Aufgabe per schtasks anlegen
  const { execFile } = require('child_process');
  const taskName = 'OP-ePaper-Dreieich';
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  return new Promise((resolve) => {
    execFile('schtasks', [
      '/Create', '/F',
      '/TN', taskName,
      '/TR', `"${exePath}" --headless`,
      '/SC', 'DAILY',
      '/ST', time,
      '/RL', 'HIGHEST',
    ], (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, error: stderr || err.message });
      } else {
        resolve({ ok: true, message: `Aufgabe "${taskName}" täglich um ${time} Uhr eingerichtet.` });
      }
    });
  });
});
