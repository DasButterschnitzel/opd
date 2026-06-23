// ---------------------------------------------------------------------------
// pageverify.js — content-based verification of which page actually shows the
// Dreieich section. Used to self-correct the side selection (Linke/Rechte
// Seite) AFTER download, so the tool never silently keeps the neighbour page.
//
// Two independent, offline-capable signals are provided:
//   1. analyzePdfDreieich(filePath)  – reads the real PDF text layer.
//   2. ocrText(pngBuffer, logger)    – OCRs a screenshot (optional fallback).
//
// Neither depends on guessing: they inspect the actual downloaded artefact /
// rendered page. The caller compares the two candidate pages and keeps the one
// that genuinely contains "Dreieich".
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

// Word-boundary "Dreieich" (same semantics as scoreDreieich in downloader.js).
// Note: \bdreieich\b does NOT match inside "Dreieichenhain" (an "e" follows the
// final "h", so there is no word boundary) – look-alikes are excluded.
const DREIEICH_RE = /\bdreieich\b/gi;

function countDreieich(text) {
  const m = (text || '').match(DREIEICH_RE);
  return m ? m.length : 0;
}

// ---------------------------------------------------------------------------
// Extract the text layer of a (single-page) newspaper PDF and score it for
// Dreieich. Returns:
//   { hasText, count, headerHit, text }
// hasText  – false when the PDF has no usable text layer (image-only scan).
// count    – number of stand-alone "Dreieich" occurrences on the page.
// headerHit – "Dreieich" appears very early in the extracted text, which for
//            these editions usually corresponds to the ressort masthead.
// ---------------------------------------------------------------------------
async function analyzePdfDreieich(filePath) {
  let text = '';
  try {
    const pdfParse = require('pdf-parse');
    const buf = fs.readFileSync(filePath);
    const data = await pdfParse(buf);
    text = (data && data.text) ? data.text : '';
  } catch (e) {
    return { hasText: false, count: 0, headerHit: false, text: '', error: e.message };
  }

  const cleaned = text.replace(/\s+/g, ' ').trim();
  // A real broadsheet page carries plenty of text. Almost-empty output means the
  // page is image-only and we must fall back to OCR / Vision.
  if (cleaned.length < 40) {
    return { hasText: false, count: 0, headerHit: false, text: cleaned };
  }

  const count = countDreieich(cleaned);
  const headerHit = DREIEICH_RE.test(cleaned.slice(0, 200));
  DREIEICH_RE.lastIndex = 0; // reset global regex state
  return { hasText: true, count, headerHit, text: cleaned };
}

// ---------------------------------------------------------------------------
// OCR a PNG buffer to plain text. tesseract.js is an OPTIONAL dependency – if it
// is not installed the function returns null (caller then skips OCR gracefully).
// German trained data is fetched from the jsDelivr CDN by default; to run fully
// offline, drop "deu.traineddata.gz" into <app>/assets/tessdata/.
// ---------------------------------------------------------------------------
async function ocrText(pngBuffer, logger) {
  let mod;
  try {
    mod = require('tesseract.js');
  } catch {
    logger && logger.info('OCR (tesseract.js) nicht installiert – Schritt übersprungen.');
    return null;
  }

  const localTess = path.join(__dirname, '..', 'assets', 'tessdata');
  const opts = fs.existsSync(localTess) ? { langPath: localTess } : {};

  let worker;
  try {
    worker = await mod.createWorker('deu', 1, opts);
    const { data } = await worker.recognize(pngBuffer);
    return (data && data.text) || '';
  } catch (e) {
    logger && logger.warn('OCR fehlgeschlagen: ' + e.message);
    return null;
  } finally {
    if (worker) { try { await worker.terminate(); } catch {} }
  }
}

module.exports = { analyzePdfDreieich, ocrText, countDreieich, DREIEICH_RE };
