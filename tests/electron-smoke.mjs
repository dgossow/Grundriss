// Rauchtest der Electron-App: Start, Datei öffnen (wie über Finder/Menü), Element zeichnen,
// Sichern auf die Festplatte, Fenster-Status. Unter Linux mit xvfb-run ausführen.
import { createRequire } from 'node:module';
import { existsSync, readFileSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(root, 'test-results');
mkdirSync(outDir, { recursive: true });

let failures = 0;
const check = (c, m) => {
  console.log(c ? '  ✓' : '  ✗', m);
  if (!c) failures++;
};

const work = join(outDir, 'electron');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const input = join(work, 'plan.pdf');
copyFileSync(join(here, 'fixtures', 'grundriss-1zu100.pdf'), input);
const target = join(work, 'plan annotiert.pdf');

// GRUNDRISS_EXE=/pfad/zur/gepackten/App → testet das fertige Paket (inkl. app.asar)
const packaged = process.env.GRUNDRISS_EXE;
const app = await electron.launch({
  executablePath: packaged || require('electron'),
  args: packaged ? ['--no-sandbox'] : [root, '--no-sandbox'],
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
});
const errors = [];
try {
  const win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push(String(e)));
  win.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await win.waitForFunction(() => !!window.grundrissApp);
  check(await win.evaluate(() => !!window.grundriss && location.protocol === 'app:'), 'Renderer über app:// mit Preload-Brücke geladen');

  // Datei öffnen wie über Finder („open-file“)
  await app.evaluate(({ BrowserWindow }, p) => BrowserWindow.getAllWindows()[0].webContents.send('open-file', p), input);
  await win.waitForFunction(() => window.grundrissApp.hasDoc, null, { timeout: 15000 });
  check(true, 'PDF über IPC geöffnet (pdf.js-Worker läuft)');
  await win.waitForTimeout(800);
  const title = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());
  check(title === 'plan.pdf', `Fenstertitel = Dateiname (${title})`);

  // Messung zeichnen
  await win.keyboard.press('m');
  const box = await win.evaluate(() => {
    const r = window.grundrissApp.view.stage.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await win.mouse.click(box.x - 100, box.y);
  await win.mouse.click(box.x + 100, box.y + 50);
  check((await win.evaluate(() => window.grundrissApp.annots.length)) === 1, 'Messung gezeichnet');
  check(await win.evaluate(() => window.grundrissApp.hist.dirty), 'Dokument als geändert markiert');

  // Sichern-Dialog ersetzen und über das Menü-Kommando sichern
  await app.evaluate(({ dialog }, t) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: t });
  }, target);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'save'));
  await win.waitForFunction(() => !window.grundrissApp.hist.dirty, null, { timeout: 15000 });
  check(existsSync(target), 'Datei auf die Festplatte gesichert');
  const bytes = readFileSync(target);
  check(bytes.toString('latin1').includes('/GrundrissData'), 'Bearbeitungsdaten eingebettet');
  check(readFileSync(input).equals(readFileSync(join(here, 'fixtures', 'grundriss-1zu100.pdf'))), 'Original-PDF unverändert');
  const title2 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());
  check(title2 === 'plan annotiert.pdf', `Titel nach Sichern (${title2})`);

  // Erneutes ⌘S schreibt ohne Dialog in dieselbe Datei
  await win.keyboard.press('m');
  await win.mouse.click(box.x - 50, box.y + 100);
  await win.mouse.click(box.x + 50, box.y + 120);
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => {
      throw new Error('Dialog darf nicht erscheinen');
    };
  });
  check((await win.evaluate(() => window.grundrissApp.annots.length)) === 2, 'Zweite Messung gezeichnet');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'save'));
  await win.waitForFunction(() => !window.grundrissApp.hist.dirty, null, { timeout: 15000 });
  check(readFileSync(target).length !== bytes.length, 'Zweites Sichern ohne Dialog in dieselbe Datei');

  await win.screenshot({ path: join(outDir, 'electron.png') });
  check(errors.length === 0, `Keine Konsolenfehler${errors.length ? ': ' + errors.join(' | ') : ''}`);
} catch (e) {
  failures++;
  console.error(e);
} finally {
  await app.close();
}
console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen` : '\nElectron-Rauchtest bestanden');
process.exit(failures ? 1 : 0);
