// End-to-End-Test im Browser (Chromium via Playwright) gegen den Produktions-Build.
// Aufruf: npm test   (oder: node tests/e2e.mjs nach "npm run build")
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('@playwright/test'));
}

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'test-results');
mkdirSync(outDir, { recursive: true });
const MM = 72 / 25.4;

let failures = 0;
function check(cond, msg) {
  if (cond) console.log('  ✓', msg);
  else {
    failures++;
    console.log('  ✗', msg);
  }
}

const server = await preview({ root: join(here, '..'), preview: { port: 4179, strictPort: true }, logLevel: 'warn' });
const url = 'http://localhost:4179/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

try {
  await page.goto(url);
  await page.waitForFunction(() => !!window.grundrissApp);
  await page.screenshot({ path: join(outDir, '00-welcome.png') });

  async function openFixture(name, bytes) {
    const arr = Array.from(bytes ?? readFileSync(join(here, 'fixtures', name)));
    await page.evaluate(async ([a, n]) => {
      await window.grundrissApp.openBytes(new Uint8Array(a), n, null);
    }, [arr, name]);
    await page.waitForTimeout(600);
  }

  /** PDF-Koordinaten (pt, y nach oben) des Test-Plans → Bildschirm */
  async function scr(xm, ym) {
    return page.evaluate(
      ([xm, ym, MM]) => {
        const app = window.grundrissApp;
        const H = app.view.geom.h;
        const ox = 60 * MM;
        const oy = 50 * MM;
        const M = (m) => ((m * 1000) / 100) * MM;
        const p = app.view.toScreen({ x: ox + M(xm), y: H - (oy + M(ym)) });
        const r = app.view.stage.getBoundingClientRect();
        return { x: p.x + r.left, y: p.y + r.top };
      },
      [xm, ym, MM],
    );
  }
  const annots = () => page.evaluate(() => window.grundrissApp.annots.map((a) => ({ ...a })));
  const press = (k) => page.keyboard.press(k);
  async function click(xm, ym, opts) {
    const p = await scr(xm, ym);
    await page.mouse.move(p.x, p.y);
    await page.mouse.click(p.x, p.y, opts);
  }

  console.log('Öffnen');
  await openFixture('grundriss-1zu100.pdf');
  check(await page.evaluate(() => window.grundrissApp.hasDoc), 'PDF geöffnet');
  await page.waitForTimeout(800);
  const detected = await page.evaluate(() => window.grundrissApp.detectedScale(0));
  check(detected === 100, `Maßstab im Text erkannt (1:${detected})`);
  check(await page.evaluate(() => window.grundrissApp.currentScale.label === '1:100'), 'Erkannter Maßstab wird verwendet');
  await page.click('.insp-hint .link');
  check(await page.evaluate(() => window.grundrissApp.hist.pages[0].scale?.label === '1:100'), 'Maßstab 1:100 bestätigt');
  await page.screenshot({ path: join(outDir, '01-opened.png') });

  console.log('Messen mit Fang');
  await page.waitForTimeout(1500); // Vektoren für Fang laden
  await press('m');
  // leicht neben die Ecken klicken – Fang muss exakt einrasten
  const a0 = await scr(0, 0);
  const a1 = await scr(10, 0);
  await page.mouse.move(a0.x + 3, a0.y - 2);
  await page.mouse.click(a0.x + 3, a0.y - 2);
  await page.mouse.move(a1.x - 2, a1.y + 3);
  await page.mouse.click(a1.x - 2, a1.y + 3);
  let list = await annots();
  const meas = list.find((a) => a.kind === 'measure');
  const measLen = await page.evaluate((m) => Math.hypot(m.p2.x - m.p1.x, m.p2.y - m.p1.y) / window.grundrissApp.ctx.ptPerM, meas);
  check(meas && Math.abs(measLen - 10) < 0.005, `Distanz 10,00 m gemessen (${measLen?.toFixed(4)} m)`);

  console.log('Kalibrieren');
  await press('k');
  const c0 = await scr(0, 0);
  const c1 = await scr(10, 0);
  await page.mouse.click(c0.x, c0.y);
  await page.mouse.click(c1.x, c1.y);
  await page.waitForSelector('.modal');
  await page.fill('.modal input[type=text]', '5');
  await page.click('.modal .btn.primary');
  let calLabel = await page.evaluate(() => window.grundrissApp.hist.pages[0].scale?.label);
  check(calLabel === '1:50', `Kalibrierung 10-m-Strecke = 5 m ergibt 1:50 (${calLabel})`);
  await page.keyboard.press('Control+z');
  calLabel = await page.evaluate(() => window.grundrissApp.hist.pages[0].scale?.label);
  check(calLabel === '1:100', `Kalibrierung rückgängig (${calLabel})`);

  console.log('Wand, Tür, Fenster');
  await press('w');
  await click(1, 3);
  await click(4, 3);
  await click(4, 6);
  await press('Enter');
  list = await annots();
  const wall = list.find((a) => a.kind === 'wall');
  check(wall && wall.pts.length === 3, 'Wand mit 3 Punkten gezeichnet');
  // Länge per Tastatur
  await click(5, 2);
  await page.keyboard.type('2,5');
  await press('Enter');
  await press('Enter');
  list = await annots();
  const wall2 = list.filter((a) => a.kind === 'wall')[1];
  const w2len = wall2 ? await page.evaluate((w) => Math.hypot(w.pts[1].x - w.pts[0].x, w.pts[1].y - w.pts[0].y) / window.grundrissApp.ctx.ptPerM, wall2) : 0;
  check(Math.abs(w2len - 2.5) < 1e-6, `Wand über Längeneingabe 2,50 m (${w2len.toFixed(3)})`);

  await press('d');
  await click(2.5, 3.08); // knapp neben der Wandachse
  list = await annots();
  const door = list.find((a) => a.kind === 'door');
  check(!!door, 'Tür gesetzt');
  if (door) {
    const onAxis = await page.evaluate((d) => {
      const app = window.grundrissApp;
      const w = app.annots.find((a) => a.kind === 'wall');
      return Math.abs(d.p.y - w.pts[0].y) < 0.01 && Math.abs(d.wall - w.thickness) < 1e-9;
    }, door);
    check(onAxis, 'Tür rastet auf Wandachse ein und übernimmt Wanddicke');
  }
  await press('n');
  await click(4, 4.5);
  list = await annots();
  const win = list.find((a) => a.kind === 'window');
  check(win && Math.abs(((win.angle % 180) + 180) % 180 - 90) < 0.01, `Fenster an senkrechter Wand gedreht (${win?.angle}°)`);

  console.log('Raum mit Fläche');
  await press('b');
  await click(0.365, 0.365);
  await click(4, 0.365);
  await click(4, 7.635);
  await click(0.365, 7.635);
  await press('Enter');
  list = await annots();
  const room = list.find((a) => a.kind === 'room');
  const area = room ? await page.evaluate((r) => {
    let s = 0;
    for (let i = 0; i < r.pts.length; i++) {
      const p = r.pts[i];
      const q = r.pts[(i + 1) % r.pts.length];
      s += p.x * q.y - q.x * p.y;
    }
    return Math.abs(s / 2) / window.grundrissApp.ctx.ptPerM ** 2;
  }, room) : 0;
  check(Math.abs(area - 3.635 * 7.27) < 0.01, `Raumfläche ${area.toFixed(2)} m² (erwartet ${(3.635 * 7.27).toFixed(2)})`);
  const roomName = await page.$('[data-key="name"]');
  check(!!roomName, 'Raumname im Eigenschaften-Panel editierbar');
  if (roomName) {
    await roomName.fill('Wohnen');
    await roomName.press('Tab');
  }

  console.log('Möbel, Treppe, Text, Zeichnen');
  await press('Escape');
  await press('g');
  await page.click('.symbol-btn[data-symbol="table"]');
  await click(7, 4);
  await press('s');
  await click(7, 1.5);
  await press('t');
  await click(6, 7);
  await page.keyboard.type('Neue Wand prüfen');
  await press('Escape');
  await press('c');
  const r0 = await scr(5.5, 6.5);
  const r1 = await scr(9, 7.5);
  await page.mouse.move(r0.x, r0.y);
  await page.mouse.down();
  await page.mouse.move(r1.x, r1.y, { steps: 5 });
  await page.mouse.up();
  await press('f');
  await click(4.2, 0.4);
  await click(9.6, 0.4);
  await click(9.6, 3);
  await page.mouse.dblclick((await scr(4.2, 3)).x, (await scr(4.2, 3)).y);
  list = await annots();
  const kinds = list.map((a) => a.kind).sort();
  for (const k of ['symbol', 'stairs', 'text', 'cloud', 'area']) check(kinds.includes(k), `Element "${k}" vorhanden`);
  const areaA = list.find((a) => a.kind === 'area');
  check(areaA && areaA.pts.length === 4, `Fläche per Doppelklick mit 4 Punkten abgeschlossen (${areaA?.pts.length})`);
  await press('Escape');
  await page.screenshot({ path: join(outDir, '02-drawn.png') });

  console.log('Auswahl, Verschieben, Rückgängig');
  await press('v');
  const tbl = list.find((a) => a.kind === 'symbol');
  const tp = await page.evaluate((t) => {
    const app = window.grundrissApp;
    const s = app.view.toScreen(t.p);
    const r = app.view.stage.getBoundingClientRect();
    return { x: s.x + r.left, y: s.y + r.top };
  }, tbl);
  await page.mouse.move(tp.x, tp.y);
  await page.mouse.down();
  await page.mouse.move(tp.x + 40, tp.y + 10, { steps: 4 });
  await page.mouse.up();
  let moved = (await annots()).find((a) => a.id === tbl.id);
  check(moved && Math.abs(moved.p.x - tbl.p.x) > 1, 'Tisch verschoben');
  await page.keyboard.press('Control+z');
  moved = (await annots()).find((a) => a.id === tbl.id);
  check(moved && Math.abs(moved.p.x - tbl.p.x) < 1e-6, 'Verschieben rückgängig gemacht');
  // Parameter ändern: Tischbreite
  await page.mouse.click(tp.x, tp.y);
  const wInput = await page.$('[data-key="w"]');
  if (wInput) {
    await wInput.fill('2,4');
    await wInput.press('Enter');
  }
  moved = (await annots()).find((a) => a.id === tbl.id);
  check(moved && Math.abs(moved.w - 2.4) < 1e-9, `Tischbreite über Panel auf 2,40 m geändert (${moved?.w})`);

  console.log('Bereich löschen');
  const before = (await annots()).length;
  await press('e');
  const e0 = await scr(5, 3.5);
  const e1 = await scr(9.5, 5);
  await page.mouse.move(e0.x, e0.y);
  await page.mouse.down();
  await page.mouse.move(e1.x, e1.y, { steps: 5 });
  await page.mouse.up();
  list = await annots();
  check(!list.some((a) => a.id === tbl.id), 'Tisch im Löschbereich entfernt');
  check(list.some((a) => a.kind === 'whiteout'), 'Plan im Bereich weiß abgedeckt');
  console.log(`    (${before} → ${list.length} Elemente)`);
  await page.screenshot({ path: join(outDir, '03-erased.png') });

  console.log('Sichern & wieder öffnen');
  const countBefore = list.length;
  const [download] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => window.grundrissApp.command('save'))]);
  const savedPath = join(outDir, 'gesichert.pdf');
  await download.saveAs(savedPath);
  const saved = readFileSync(savedPath);
  check(saved.length > 1000, `PDF gesichert (${saved.length} Bytes)`);
  check(!(await page.evaluate(() => window.grundrissApp.hist.dirty)), 'Dokument nach dem Sichern nicht mehr "bearbeitet"');
  await page.reload();
  await page.waitForFunction(() => !!window.grundrissApp);
  await openFixture('gesichert.pdf', saved);
  list = await annots();
  check(list.length === countBefore, `Alle ${countBefore} Elemente wieder bearbeitbar geladen (${list.length})`);
  check(await page.evaluate(() => window.grundrissApp.hist.pages[0].scale?.label === '1:100'), 'Maßstab mitgespeichert');
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(outDir, '04-reopened.png') });

  // Doppeltes Sichern darf keine Ebenen stapeln
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => window.grundrissApp.command('save'))]);
  const saved2Path = join(outDir, 'gesichert2.pdf');
  await dl2.saveAs(saved2Path);
  const saved2 = readFileSync(saved2Path);
  const count = (buf, s) => buf.toString('latin1').split(s).length - 1;
  check(Math.abs(saved2.length - saved.length) < saved.length * 0.05, `Erneutes Sichern stapelt nichts (${saved.length} → ${saved2.length} Bytes)`);
  check(count(saved2, '/GrundrissData') === 1, 'Genau ein Datenblock');

  console.log('Flacher Export');
  const [dl3] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => window.grundrissApp.command('export-flat'))]);
  const flatPath = join(outDir, 'flach.pdf');
  await dl3.saveAs(flatPath);
  check(count(readFileSync(flatPath), '/GrundrissData') === 0, 'Flacher Export ohne Bearbeitungsdaten');

  console.log('Gedrehte Seite (/Rotate 90)');
  await page.reload();
  await page.waitForFunction(() => !!window.grundrissApp);
  await openFixture('grundriss-gedreht.pdf');
  await page.waitForTimeout(1200);
  await press('m');
  const g = await page.evaluate(() => ({ w: window.grundrissApp.view.geom.w, h: window.grundrissApp.view.geom.h }));
  check(g.h > g.w, `Gedrehte Seite hochkant dargestellt (${g.w.toFixed(0)}×${g.h.toFixed(0)})`);
  const rr = await page.evaluate(() => {
    const app = window.grundrissApp;
    const r = app.view.stage.getBoundingClientRect();
    const s1 = app.view.toScreen({ x: 100, y: 100 });
    const s2 = app.view.toScreen({ x: 300, y: 500 });
    return { a: { x: s1.x + r.left, y: s1.y + r.top }, b: { x: s2.x + r.left, y: s2.y + r.top } };
  });
  await page.keyboard.down('Meta');
  await page.mouse.click(rr.a.x, rr.a.y);
  await page.mouse.click(rr.b.x, rr.b.y);
  await page.keyboard.up('Meta');
  const [dl4] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => window.grundrissApp.command('save'))]);
  const rotPath = join(outDir, 'gedreht-gesichert.pdf');
  await dl4.saveAs(rotPath);
  await page.reload();
  await page.waitForFunction(() => !!window.grundrissApp);
  await openFixture('gedreht-gesichert.pdf', readFileSync(rotPath));
  list = await annots();
  check(list.length === 1 && list[0].kind === 'measure', 'Messung auf gedrehter Seite gespeichert und geladen');
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(outDir, '05-rotated.png') });

  console.log('Geschützte PDF (Verschlüsselung, nur Drucken erlaubt)');
  await page.reload();
  await page.waitForFunction(() => !!window.grundrissApp);
  await openFixture('grundriss-geschuetzt.pdf');
  check(await page.evaluate(() => window.grundrissApp.hasDoc), 'Geschützte PDF geöffnet');
  await page.waitForTimeout(1200);
  await press('m');
  const g0 = await scr(0, 0);
  const g1 = await scr(10, 0);
  await page.mouse.click(g0.x, g0.y);
  await page.mouse.click(g1.x, g1.y);
  const [dl5] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.evaluate(() => window.grundrissApp.command('save'))]);
  const protPath = join(outDir, 'geschuetzt-gesichert.pdf');
  await dl5.saveAs(protPath);
  const prot = readFileSync(protPath);
  check(prot.toString('latin1').includes('/GrundrissBase'), `Als Bild-PDF mit eingebettetem Original gesichert (${prot.length} Bytes)`);
  await page.reload();
  await page.waitForFunction(() => !!window.grundrissApp);
  await openFixture('geschuetzt-gesichert.pdf', prot);
  list = await annots();
  check(list.length === 1 && list[0].kind === 'measure', 'Messung aus geschützter PDF wieder bearbeitbar');

  check(errors.length === 0, `Keine Fehler in der Konsole${errors.length ? ': ' + errors.join(' | ') : ''}`);
} catch (e) {
  failures++;
  console.error(e);
  await page.screenshot({ path: join(outDir, 'error.png') }).catch(() => {});
} finally {
  await browser.close();
  await server.close();
}

console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen` : '\nAlle Prüfungen bestanden');
process.exit(failures ? 1 : 0);
