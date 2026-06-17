# OP ePaper Tool – Dreieich

Automatischer täglicher Download der Dreieich-Lokalseite aus dem OP-Online ePaper-Leseportal.

## Voraussetzungen

- Node.js LTS (≥ 20)
- Windows 10/11 (empfohlen; macOS/Linux für Entwicklung)

## Installation (Entwicklung)

```bash
npm install
npx playwright install chromium
```

## Starten

```bash
# GUI-Modus (Doppelklick auf .exe oder):
npm start

# Headless-Modus (für Aufgabenplaner):
npm run start:headless
# oder direkt:
electron . --headless
```

## Erste Inbetriebnahme

### 1. Selektoren ermitteln (einmalig, wichtigster Schritt)

Da das Leseportal browserbasiert ist, müssen die Login-Felder und der Klickweg einmalig
ermittelt werden:

```bash
npx playwright codegen https://epaper.op-online.de
```

Im sich öffnenden Browser:
1. Einloggen (Benutzername + Passwort eingeben und absenden)
2. Zur Dreieich-Ausgabe navigieren
3. Den PDF-Download/Button anklicken

Der generierte Code (rechts im Playwright-Fenster) enthält die exakten Selektoren.
Diese in `core/downloader.js` bei den `SEL_*`-Konstanten und dem `DOWNLOAD_SELECTOR` eintragen.

**Parallel im Netzwerk-Tab (F12) prüfen:**  
Wird eine direkte PDF-URL geladen? Falls ja, im Response-Monitor (`[treffer]`-Ausgaben)
die URL notieren – ggf. reicht ein direkter HTTP-Request statt Browser-Steuerung.

### 2. Konfiguration in der GUI

GUI starten → Tab „Einstellungen":
- Benutzername und Passwort des OP-Abonnements eintragen
- Zielordner wählen (Standard: `Dokumente/OP-ePaper`)
- Uhrzeit für den täglichen Lauf einstellen (Ausgabe ist ab ca. 04:00 Uhr online)
- „Speichern" klicken

Das Passwort wird verschlüsselt gespeichert (Windows DPAPI via Electron safeStorage).
Es steht nie im Klartext auf der Festplatte oder im Code.

### 3. Download testen

GUI → Tab „Start" → „Seite jetzt herunterladen".  
Der Live-Log zeigt jeden Schritt. Bei Fehlern wird ein Screenshot unter
`[Zielordner]/debug/` abgelegt.

### 4. Aufgabenplaner einrichten

#### Option A – per Knopf in der GUI

GUI → Tab „Einstellungen" → „Windows-Aufgabe einrichten".  
Richtet automatisch eine tägliche Aufgabe im Windows-Aufgabenplaner ein.

#### Option B – manuell

1. `taskschd.msc` öffnen (Windows-Aufgabenplaner)
2. „Aufgabe erstellen…"
3. **Allgemein**: Name: `OP-ePaper-Dreieich`, „Mit höchsten Rechten ausführen"
4. **Trigger**: Täglich, Startzeit 06:00 Uhr
5. **Aktionen**: Programm starten  
   Programm: `C:\Pfad\zu\OP ePaper Tool.exe`  
   Argumente: `--headless`
6. **Bedingungen**: „Nur starten, wenn Computer im Netzbetrieb" ✓
7. OK

#### Option C – per schtasks (Kommandozeile, als Admin)

```cmd
schtasks /Create /F /TN "OP-ePaper-Dreieich" /TR "\"C:\Pfad\zu\OP ePaper Tool.exe\" --headless" /SC DAILY /ST 06:00 /RL HIGHEST
```

**Exit-Codes** (für Monitoring im Aufgabenplaner):
- `0` – Download erfolgreich (oder Datei für heute existiert bereits)
- `1` – Download-Fehler (Playwright-/Seiten-Fehler)
- `2` – Konfigurationsfehler (fehlende Zugangsdaten o.ä.)

## Packaging (Windows .exe)

```bash
npm run dist:win
```

Erzeugt einen NSIS-Installer unter `dist/`.

**Wichtig – Chromium bündeln:**  
Playwright lädt Chromium separat. Für ein eigenständiges `.exe` gibt es zwei Optionen:

**Option A** (empfohlen für Produktiveinsatz): Chromium als `extraResources` einpacken.

```bash
# Chromium-Verzeichnis lokal kopieren (Pfad je nach System):
# Windows: %LOCALAPPDATA%\ms-playwright\chromium-*
# in: chromium-browser/  (Projektroot)
```

`electron-builder.json` enthält bereits die `extraResources`-Konfiguration dafür.

**Option B**: Auf dem Zielrechner einmalig ausführen:

```cmd
set PLAYWRIGHT_BROWSERS_PATH=C:\OP-ePaper-Tool\browsers
npx playwright install chromium
```

Und `PLAYWRIGHT_BROWSERS_PATH` als Systemumgebungsvariable setzen.

## Projektstruktur

```
op-epaper-tool/
  main.js          – Electron-Einstieg, GUI- vs. Headless-Modus
  preload.js       – IPC-Bridge Renderer ↔ Main
  core/
    downloader.js  – Playwright-Logik (Login, Navigation, PDF-Download)
    config.js      – Konfiguration laden/speichern, safeStorage
    logger.js      – Rotierendes Logfile
  renderer/
    index.html     – GUI
    renderer.js    – GUI-Logik
    styles.css     – Styles
  package.json
  README.md
```

## Datenschutz & Rechtliches

- Das Tool automatisiert ausschließlich den manuellen Download einer einzelnen
  Lokalseite im Rahmen eines bestehenden, bezahlten ePaper-Abonnements.
- Kein Massen-Download, kein Umgehen von Bezahlschranken.
- Zugangsdaten werden ausschließlich lokal und verschlüsselt gespeichert.
- Verwendungszweck: interner Pressespiegel der Stadtverwaltung Dreieich.
