'use strict';

// --------------------------------------------------------------------------
// Tab-Navigation
// --------------------------------------------------------------------------
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((s) => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + target).classList.add('active');

    if (target === 'log') loadFullLog();
  });
});

// --------------------------------------------------------------------------
// Status-Karte befüllen
// --------------------------------------------------------------------------
async function refreshStatus() {
  const cfg = await window.api.getConfig();

  const lastEl = document.getElementById('last-success');
  lastEl.textContent = cfg.lastSuccess
    ? new Date(cfg.lastSuccess).toLocaleString('de-DE')
    : '–';

  document.getElementById('output-dir').textContent = cfg.outputDir || '–';
}

// --------------------------------------------------------------------------
// Einstellungen laden / speichern
// --------------------------------------------------------------------------
async function loadSettings() {
  const cfg = await window.api.getConfig();
  document.getElementById('inp-user').value  = cfg.username || '';
  document.getElementById('inp-pass').value  = cfg.password || '';   // kommt als ••••••
  document.getElementById('inp-dir').value   = cfg.outputDir || '';
  document.getElementById('inp-hour').value  = cfg.scheduleHour  ?? 6;
  document.getElementById('inp-min').value   = cfg.scheduleMinute ?? 0;
}

document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('save-msg');

  const result = await window.api.saveConfig({
    username:       document.getElementById('inp-user').value.trim(),
    password:       document.getElementById('inp-pass').value,
    outputDir:      document.getElementById('inp-dir').value,
    scheduleHour:   parseInt(document.getElementById('inp-hour').value, 10),
    scheduleMinute: parseInt(document.getElementById('inp-min').value, 10),
  });

  msg.classList.remove('hidden', 'err');
  if (result.ok) {
    msg.textContent = 'Gespeichert.';
    msg.classList.remove('err');
  } else {
    msg.textContent = 'Fehler beim Speichern.';
    msg.classList.add('err');
  }
  setTimeout(() => msg.classList.add('hidden'), 3000);
  await refreshStatus();
});

document.getElementById('btn-select-dir').addEventListener('click', async () => {
  const dir = await window.api.selectFolder();
  if (dir) document.getElementById('inp-dir').value = dir;
});

// --------------------------------------------------------------------------
// Windows-Aufgabe anlegen
// --------------------------------------------------------------------------
document.getElementById('btn-create-task').addEventListener('click', async () => {
  // Aktuelle Einstellungen zuerst speichern
  await window.api.saveConfig({
    scheduleHour:   parseInt(document.getElementById('inp-hour').value, 10),
    scheduleMinute: parseInt(document.getElementById('inp-min').value, 10),
  });

  const resEl = document.getElementById('task-result');
  resEl.classList.remove('hidden', 'err');
  resEl.textContent = 'Richte Aufgabe ein…';

  const result = await window.api.createSchedulerTask();
  resEl.textContent = result.message || result.error;
  if (!result.ok) resEl.classList.add('err');
});

// --------------------------------------------------------------------------
// Download starten
// --------------------------------------------------------------------------
const btnDownload    = document.getElementById('btn-download');
const progressWrap   = document.getElementById('progress-wrap');
const resultBanner   = document.getElementById('result-banner');
const liveLog        = document.getElementById('live-log');

function appendLog(line) {
  const div = document.createElement('div');
  div.textContent = line;
  if (line.includes('[ERROR]')) div.className = 'log-line-error';
  else if (line.includes('[WARN]')) div.className = 'log-line-warn';
  liveLog.appendChild(div);
  liveLog.scrollTop = liveLog.scrollHeight;
}

btnDownload.addEventListener('click', async () => {
  btnDownload.disabled = true;
  liveLog.innerHTML = '';
  resultBanner.classList.add('hidden');
  progressWrap.classList.remove('hidden');

  // Live-Log Listener registrieren
  const unsubscribe = window.api.onDownloadLog(appendLog);

  const result = await window.api.startDownload();

  unsubscribe();
  progressWrap.classList.add('hidden');
  btnDownload.disabled = false;

  resultBanner.classList.remove('hidden', 'ok', 'err');
  if (result.ok) {
    resultBanner.classList.add('ok');
    resultBanner.textContent = 'Download erfolgreich abgeschlossen.';
  } else {
    resultBanner.classList.add('err');
    resultBanner.textContent = 'Fehler: ' + (result.error || 'Unbekannter Fehler');
  }

  await refreshStatus();
});

document.getElementById('btn-open-folder').addEventListener('click', () => {
  window.api.openFolder();
});

// --------------------------------------------------------------------------
// Protokoll-Tab
// --------------------------------------------------------------------------
async function loadFullLog() {
  const lines = await window.api.getLogs();
  const el = document.getElementById('full-log');
  el.innerHTML = '';
  for (const line of lines) {
    const div = document.createElement('div');
    div.textContent = line;
    if (line.includes('[ERROR]')) div.className = 'log-line-error';
    else if (line.includes('[WARN]')) div.className = 'log-line-warn';
    el.appendChild(div);
  }
  el.scrollTop = el.scrollHeight;
}

document.getElementById('btn-refresh-log').addEventListener('click', loadFullLog);

// --------------------------------------------------------------------------
// Init
// --------------------------------------------------------------------------
(async () => {
  await refreshStatus();
  await loadSettings();
})();
