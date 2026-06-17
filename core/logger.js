const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const LOG_DIR = (() => {
  try {
    return path.join(app.getPath('userData'), 'logs');
  } catch {
    return path.join(process.cwd(), 'logs');
  }
})();

const MAX_LINES = 500;
const MAX_FILES = 10;

function logFilePath(date) {
  const d = date || new Date();
  const stamp = d.toISOString().slice(0, 10);
  return path.join(LOG_DIR, `op-epaper-${stamp}.log`);
}

function rotateLogs() {
  if (!fs.existsSync(LOG_DIR)) return;
  const files = fs.readdirSync(LOG_DIR)
    .filter((f) => f.startsWith('op-epaper-') && f.endsWith('.log'))
    .sort()
    .reverse();
  for (const old of files.slice(MAX_FILES)) {
    try { fs.unlinkSync(path.join(LOG_DIR, old)); } catch {}
  }
}

function createLogger(onLine) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  rotateLogs();
  const file = logFilePath();

  function write(level, msg) {
    const ts = new Date().toISOString();
    const line = `${ts} [${level}] ${msg}`;
    try { fs.appendFileSync(file, line + '\n', 'utf8'); } catch {}
    if (onLine) onLine(line);
    if (level === 'ERROR') console.error(line);
    else console.log(line);
  }

  return {
    info: (msg) => write('INFO', msg),
    warn: (msg) => write('WARN', msg),
    error: (msg) => write('ERROR', msg),
  };
}

function getRecentLogs(lines = 200) {
  if (!fs.existsSync(LOG_DIR)) return [];

  const files = fs.readdirSync(LOG_DIR)
    .filter((f) => f.startsWith('op-epaper-') && f.endsWith('.log'))
    .sort()
    .reverse()
    .slice(0, 3);

  const all = [];
  for (const f of files.reverse()) {
    try {
      const content = fs.readFileSync(path.join(LOG_DIR, f), 'utf8');
      all.push(...content.split('\n').filter(Boolean));
    } catch {}
  }
  return all.slice(-lines);
}

module.exports = { createLogger, getRecentLogs };
