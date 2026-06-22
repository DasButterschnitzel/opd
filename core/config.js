const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

const DEFAULTS = {
  username: '',
  password: '',           // verschlüsselt als Base64-String gespeichert
  outputDir: path.join(app.getPath('documents'), 'OP-ePaper'),
  scheduleHour: 6,
  scheduleMinute: 0,
  lastSuccess: null,
  // --- Lauf-Status (für Fehler-Benachrichtigung) ---
  lastRunAt: null,            // ISO-Zeitstempel des letzten Laufs (Erfolg ODER Fehler)
  lastError: null,            // Fehlertext des letzten fehlgeschlagenen Laufs
  lastErrorAt: null,          // ISO-Zeitstempel des letzten Fehlers
  consecutiveFailures: 0,     // Anzahl Fehlschläge in Folge (für Eskalation)
  // --- Rückwirkendes Laden ---
  skipSundays: true,          // Sonntags erscheint i.d.R. keine Ausgabe
  catchUpDays: 7,             // wie viele Tage rückwirkend auf Lücken geprüft wird
  // --- Vision API ---
  anthropicApiKey: '',        // optionaler Anthropic API Key für Vision-Seitenerkennung
};

async function loadConfig() {
  const file = configPath();
  let raw = { ...DEFAULTS };

  if (fs.existsSync(file)) {
    try {
      const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
      raw = { ...DEFAULTS, ...stored };
    } catch {
      // Korrupte Config → Defaults verwenden
    }
  }

  // Passwort entschlüsseln
  if (raw._passwordEnc && safeStorage.isEncryptionAvailable()) {
    try {
      raw.password = safeStorage.decryptString(Buffer.from(raw._passwordEnc, 'base64'));
    } catch {
      raw.password = '';
    }
  } else if (raw._passwordEnc) {
    // Fallback: Base64 (nur wenn DPAPI nicht verfügbar – Entwicklungsumgebung)
    raw.password = Buffer.from(raw._passwordEnc, 'base64').toString('utf8');
  }
  delete raw._passwordEnc;

  return raw;
}

async function saveConfig(cfg) {
  const file = configPath();
  const toSave = { ...cfg };
  const plainPassword = toSave.password || '';
  delete toSave.password;

  // Passwort verschlüsseln
  if (plainPassword) {
    if (safeStorage.isEncryptionAvailable()) {
      toSave._passwordEnc = safeStorage.encryptString(plainPassword).toString('base64');
    } else {
      // Fallback: Base64 (Entwicklung ohne DPAPI)
      toSave._passwordEnc = Buffer.from(plainPassword).toString('base64');
    }
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(toSave, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Lauf-Ergebnis festhalten (Erfolg oder Fehler) – für Fehler-Benachrichtigung.
// Bei Erfolg wird der Fehlerzustand zurückgesetzt; bei Fehler hochgezählt.
// Gibt die neue consecutiveFailures-Zahl zurück (für Eskalation).
// ---------------------------------------------------------------------------
async function recordRunResult({ ok, error } = {}) {
  const cfg = await loadConfig();
  const now = new Date().toISOString();
  cfg.lastRunAt = now;
  if (ok) {
    cfg.lastSuccess = now;
    cfg.lastError = null;
    cfg.lastErrorAt = null;
    cfg.consecutiveFailures = 0;
  } else {
    cfg.lastError = (error || 'Unbekannter Fehler').toString().slice(0, 500);
    cfg.lastErrorAt = now;
    cfg.consecutiveFailures = (cfg.consecutiveFailures || 0) + 1;
  }
  await saveConfig(cfg);
  return cfg.consecutiveFailures;
}

module.exports = { loadConfig, saveConfig, recordRunResult };
