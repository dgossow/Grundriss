// Erzeugt einen einfachen Test-Grundriss (A3 quer, Maßstab 1:100) als Vektor-PDF.
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MM = 72 / 25.4;
const M = (m) => (m * 1000 / 100) * MM; // 1:100 → Meter in pt

async function plan({ rotate = 0 } = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([420 * MM, 297 * MM]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const ox = 60 * MM;
  const oy = 50 * MM;
  const P = (x, y) => ({ x: ox + M(x), y: oy + M(y) });
  // Außenwände 10 m x 8 m, 36,5 cm
  const t = 0.365;
  const rect = (x, y, w, h, fill = true) => {
    const p = P(x, y);
    page.drawRectangle({ x: p.x, y: p.y, width: M(w), height: M(h), color: fill ? rgb(0.75, 0.75, 0.75) : undefined, borderColor: rgb(0, 0, 0), borderWidth: 0.5 });
  };
  rect(0, 0, 10, t);
  rect(0, 8 - t, 10, t);
  rect(0, t, t, 8 - 2 * t);
  rect(10 - t, t, t, 8 - 2 * t);
  // Innenwand bei x = 4 m, 11,5 cm
  rect(4, t, 0.115, 8 - 2 * t);
  // Bemaßung 10,00 unten
  const a = P(0, -1);
  const b = P(10, -1);
  page.drawLine({ start: a, end: b, thickness: 0.3 });
  page.drawText('10,00', { x: (a.x + b.x) / 2 - 10, y: a.y + 3, size: 8, font });
  page.drawText('Grundriss EG   M 1:100', { x: ox, y: 20 * MM, size: 14, font });
  if (rotate) page.setRotation(degrees(rotate));
  // feste Datumswerte → reproduzierbare Dateien
  doc.setCreationDate(new Date('2026-01-01T00:00:00Z'));
  doc.setModificationDate(new Date('2026-01-01T00:00:00Z'));
  return doc.save();
}

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(here, 'fixtures'), { recursive: true });
writeFileSync(join(here, 'fixtures', 'grundriss-1zu100.pdf'), await plan());
writeFileSync(join(here, 'fixtures', 'grundriss-gedreht.pdf'), await plan({ rotate: 90 }));
console.log('Fixtures erzeugt');
