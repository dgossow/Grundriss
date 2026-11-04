// Kopiert die Laufzeitdaten von pdf.js (Schriften, CMaps, WASM-Decoder) nach public/pdfjs,
// damit sie im Dev-Server und im fertigen Build verfügbar sind.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'pdfjs-dist');
const dst = join(root, 'public', 'pdfjs');
mkdirSync(dst, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const from = join(src, dir);
  if (existsSync(from)) cpSync(from, join(dst, dir), { recursive: true });
}
console.log('pdf.js-Assets kopiert nach', dst);
