const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
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

const { loadConfig, saveConfig } = require('./core/config');
const { runDownload } = require('./core/downloader');
const { createLogger, getRecentLogs } = require('./core/logger');

const isHeadless = process.argv.includes('--headless');

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

    try {
      await runDownload(config, logger);
      logger.info('Download abgeschlossen. Beende.');
      app.exit(0);
    } catch (err) {
      logger.error('Download fehlgeschlagen: ' + err.message);
      app.exit(1);
    }
  });

  // Kein Fenster im Headless-Modus
  app.on('window-all-closed', () => {});
  return;
}

// --- GUI MODE ----------------------------------------------------------------

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 820,
    height: 680,
    minWidth: 640,
    minHeight: 520,
    title: 'OP ePaper Tool – Dreieich',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenu(null);
}

app.whenReady().then(createWindow);

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

ipcMain.handle('download:start', async (event) => {
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

  try {
    activeDownloadAbort = new AbortController();
    await runDownload(config, logger, activeDownloadAbort.signal);
    activeDownloadAbort = null;
    return { ok: true };
  } catch (err) {
    activeDownloadAbort = null;
    return { ok: false, error: err.message };
  }
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
