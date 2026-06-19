'use strict';

// --------------------------------------------------------------------------
// Log-Zeile parsen und als DOM-Element rendern
// --------------------------------------------------------------------------
function makeLogDiv(line) {
  const div = document.createElement('div');
  // Format: "2026-06-17T20:07:00.123Z [LEVEL] message"
  const m = line.match(/^(\S+) \[(\w+)\] (.*)$/s);
  if (m) {
    const [, ts, level, msg] = m;
    const tsSpan = document.createElement('span');
    tsSpan.className = 'log-ts';
    tsSpan.textContent = ts.slice(11, 19) + ' ';
    const msgSpan = document.createElement('span');
    msgSpan.textContent = msg;
    div.className = 'log-line log-line-' + level.toLowerCase();
    div.appendChild(tsSpan);
    div.appendChild(msgSpan);
  } else {
    div.textContent = line;
  }
  return div;
}

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
// Status-Karte + Heute-Dateien
// --------------------------------------------------------------------------
async function refreshStatus() {
  const cfg = await window.api.getConfig();

  document.getElementById('last-success').textContent = cfg.lastSuccess
    ? new Date(cfg.lastSuccess).toLocaleString('de-DE')
    : '–';
  document.getElementById('output-dir').textContent = cfg.outputDir || '–';

  await refreshTodayFiles();
}

async function refreshTodayFiles() {
  const { files } = await window.api.getFilesToday();
  const row  = document.getElementById('today-row');
  const list = document.getElementById('today-files');
  list.innerHTML = '';
  if (files && files.length) {
    row.classList.remove('hidden');
    files.forEach(name => {
      const span = document.createElement('span');
      span.className = 'today-file';
      span.textContent = name;
      list.appendChild(span);
    });
  } else {
    row.classList.add('hidden');
  }
}

// --------------------------------------------------------------------------
// Einstellungen
// --------------------------------------------------------------------------
async function loadSettings() {
  const cfg = await window.api.getConfig();
  document.getElementById('inp-user').value  = cfg.username || '';
  document.getElementById('inp-pass').value  = cfg.password || '';
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
  msg.textContent = result.ok ? 'Gespeichert.' : 'Fehler beim Speichern.';
  if (!result.ok) msg.classList.add('err');
  setTimeout(() => msg.classList.add('hidden'), 3000);
  await refreshStatus();
});

document.getElementById('btn-select-dir').addEventListener('click', async () => {
  const dir = await window.api.selectFolder();
  if (dir) document.getElementById('inp-dir').value = dir;
});

// --------------------------------------------------------------------------
// Windows-Aufgabe
// --------------------------------------------------------------------------
document.getElementById('btn-create-task').addEventListener('click', async () => {
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
// Download
// --------------------------------------------------------------------------
const btnDownload  = document.getElementById('btn-download');
const btnCancel    = document.getElementById('btn-cancel');
const progressWrap = document.getElementById('progress-wrap');
const progressStep = document.getElementById('progress-step');
const resultBanner = document.getElementById('result-banner');
const liveLog      = document.getElementById('live-log');

function appendLog(line) {
  const div = makeLogDiv(line);
  liveLog.appendChild(div);
  liveLog.scrollTop = liveLog.scrollHeight;

  // Update progress step from [n/6] prefixed INFO lines
  const m = line.match(/\[INFO\] (\[\d+\/\d+\] .+)/);
  if (m) progressStep.textContent = m[1].trim();
}

btnDownload.addEventListener('click', async () => {
  btnDownload.disabled = true;
  liveLog.innerHTML = '';
  resultBanner.classList.add('hidden');
  progressWrap.classList.remove('hidden');
  progressStep.textContent = 'Download läuft…';

  const unsubscribe = window.api.onDownloadLog(appendLog);
  const result = await window.api.startDownload();
  unsubscribe();

  progressWrap.classList.add('hidden');
  btnDownload.disabled = false;

  resultBanner.classList.remove('hidden', 'ok', 'err');
  if (result.ok) {
    resultBanner.classList.add('ok');
    if (result.files && result.files.length) {
      resultBanner.textContent =
        '✓ ' + result.files.length + ' Datei(en) heruntergeladen: ' + result.files.join(', ');
    } else {
      resultBanner.textContent = '✓ Download abgeschlossen (Dateien bereits vorhanden).';
    }
  } else {
    resultBanner.classList.add('err');
    resultBanner.textContent = '✗ Fehler: ' + (result.error || 'Unbekannter Fehler');
  }

  await refreshStatus();
});

btnCancel.addEventListener('click', async () => {
  btnCancel.disabled = true;
  progressStep.textContent = 'Abbrechen…';
  await window.api.cancelDownload();
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
    el.appendChild(makeLogDiv(line));
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
