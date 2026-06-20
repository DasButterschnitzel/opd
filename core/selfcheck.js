const fs = require('fs');
const path = require('path');
const os = require('os');
const { safeStorage } = require('electron');
const { loadConfig } = require('./config');

// ---------------------------------------------------------------------------
// Selbsttest: prüft alle Voraussetzungen für einen erfolgreichen Download,
// OHNE das Portal zu kontaktieren. Liefert eine Liste von Checks zurück:
//   { name, ok, level: 'ok'|'warn'|'error', detail }
// So sieht der Nutzer auf einen Blick, was fehlt (Browser, Ordner, Login …).
// ---------------------------------------------------------------------------
async function runSelfCheck(getChromiumPath) {
  const checks = [];
  const add = (name, ok, detail, level) =>
    checks.push({ name, ok, level: level || (ok ? 'ok' : 'error'), detail });

  let cfg;
  try {
    cfg = await loadConfig();
  } catch (err) {
    add('Konfiguration', false, 'Konnte nicht geladen werden: ' + err.message);
    return { ok: false, checks };
  }

  // 1) Zugangsdaten
  add(
    'Zugangsdaten',
    !!(cfg.username && cfg.password),
    cfg.username && cfg.password
      ? 'Benutzer „' + cfg.username + '" hinterlegt'
      : 'Benutzername oder Passwort fehlt – bitte in den Einstellungen eintragen.'
  );

  // 2) Passwort-Verschlüsselung (DPAPI)
  let encOk = false;
  try { encOk = safeStorage.isEncryptionAvailable(); } catch {}
  add(
    'Passwort-Verschlüsselung',
    true,
    encOk
      ? 'Windows-DPAPI aktiv – Passwort sicher verschlüsselt.'
      : 'DPAPI nicht verfügbar – Passwort nur Base64-kodiert (Entwicklungsmodus).',
    encOk ? 'ok' : 'warn'
  );

  // 3) Browser
  let browserPath;
  try { browserPath = getChromiumPath ? getChromiumPath() : undefined; } catch {}
  add(
    'Browser',
    !!browserPath,
    browserPath
      ? 'Gefunden: ' + browserPath
      : 'Kein Browser gefunden – setup.bat ausführen oder Chrome/Edge installieren.'
  );

  // 4) Zielordner beschreibbar
  let dirOk = false, dirDetail = '';
  try {
    fs.mkdirSync(cfg.outputDir, { recursive: true });
    const probe = path.join(cfg.outputDir, '.write-test-' + Date.now());
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    dirOk = true;
    dirDetail = 'Beschreibbar: ' + cfg.outputDir;
  } catch (err) {
    dirDetail = 'Nicht beschreibbar (' + cfg.outputDir + '): ' + err.message;
  }
  add('Zielordner', dirOk, dirDetail);

  // 5) Freier Speicherplatz (best effort)
  try {
    const stat = fs.statfsSync ? fs.statfsSync(cfg.outputDir) : null;
    if (stat) {
      const freeMb = Math.round((stat.bfree * stat.bsize) / (1024 * 1024));
      add(
        'Speicherplatz',
        freeMb > 50,
        freeMb + ' MB frei',
        freeMb > 50 ? 'ok' : 'warn'
      );
    }
  } catch {}

  const ok = checks.every(c => c.level !== 'error');
  return { ok, checks };
}

module.exports = { runSelfCheck };
