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

module.exports = { loadConfig, saveConfig };
