// Speichern und Laden der Bearbeitungen in der PDF.
//
// Beim Sichern werden alle Elemente als echte Vektorgrafik in einen zusätzlichen
// Inhaltsstrom jeder Seite geschrieben (sichtbar in jedem PDF-Programm). Zusätzlich
// wird ein JSON-Datenstrom (/GrundrissData) im Katalog abgelegt, damit Grundriss die
// Elemente beim erneuten Öffnen wieder bearbeitbar machen kann: Die eigenen Inhaltsströme
// werden dann entfernt und die Originalseite bleibt unverändert erhalten.

import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  StandardFonts,
  type PDFFont,
} from 'pdf-lib';
import { drawOrder, primsOf, type Ctx } from '../elements';
import { sanitize } from '../font';
import type { Mat } from '../render/prims';
import { textLayout, type Prim } from '../render/prims';
import type { PageState, SavedData, Settings } from '../types';
import { DEFAULT_SCALE } from '../units';

const DATA_KEY = 'GrundrissData';
const BASE_KEY = 'GrundrissBase';
const PRE_TAG = '/GrundrissPre';
const OVERLAY_TAG = '/GrundrissOverlay';

export interface PreparedPdf {
  /** PDF ohne Grundriss-Ebenen (Grundlage für Anzeige und erneutes Speichern) */
  baseBytes: Uint8Array;
  data: SavedData | null;
  encrypted: boolean;
  warning?: string;
}

function bytesContain(bytes: Uint8Array, needle: string): boolean {
  const n = new TextEncoder().encode(needle);
  outer: for (let i = 0; i <= bytes.length - n.length; i++) {
    if (bytes[i] !== n[0]) continue;
    for (let j = 1; j < n.length; j++) if (bytes[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
}

function streamText(doc: PDFDocument, ref: unknown): string {
  try {
    const obj = doc.context.lookup(ref as PDFRef);
    if (obj instanceof PDFRawStream) {
      const data = decodePDFRawStream(obj).decode();
      // Nur den Anfang prüfen – unsere Markierungen stehen ganz vorne.
      let s = '';
      for (let i = 0; i < Math.min(data.length, 200); i++) s += String.fromCharCode(data[i]);
      return s;
    }
  } catch {
    /* ignorieren */
  }
  return '';
}

/** Prüft eine geöffnete PDF auf Grundriss-Daten und entfernt ggf. die eigenen Ebenen. */
export async function preparePdf(bytes: Uint8Array): Promise<PreparedPdf> {
  if (!bytesContain(bytes, '/' + DATA_KEY)) {
    let encrypted = false;
    if (bytesContain(bytes, '/Encrypt')) {
      try {
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
        encrypted = doc.isEncrypted;
      } catch {
        encrypted = true;
      }
    }
    return { baseBytes: bytes, data: null, encrypted };
  }
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch (e) {
    console.warn('PDF-Struktur nicht lesbar, Bearbeitungsdaten werden ignoriert', e);
    return { baseBytes: bytes, data: null, encrypted: false };
  }
  const catalog = doc.catalog;
  const ref = catalog.get(PDFName.of(DATA_KEY));
  const stream = ref ? doc.context.lookup(ref) : null;
  let data: SavedData | null = null;
  if (stream instanceof PDFRawStream) {
    try {
      const json = new TextDecoder().decode(decodePDFRawStream(stream).decode());
      const parsed = JSON.parse(json);
      if (parsed && parsed.app === 'Grundriss' && Array.isArray(parsed.pages)) data = parsed;
    } catch (e) {
      console.warn('Grundriss-Daten nicht lesbar', e);
    }
  }
  // Gerasterte Sicherung einer geschützten PDF: Original liegt eingebettet bei
  const baseRef = catalog.get(PDFName.of(BASE_KEY));
  const baseStream = baseRef ? doc.context.lookup(baseRef) : null;
  if (data && baseStream instanceof PDFRawStream) {
    try {
      const orig = decodePDFRawStream(baseStream).decode();
      return { baseBytes: orig, data, encrypted: true };
    } catch (e) {
      console.warn('Eingebettetes Original nicht lesbar', e);
    }
  }
  let stripped = 0;
  const orphans = new Set<PDFRef>();
  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    if (!(contents instanceof PDFArray)) continue;
    const items = contents.asArray();
    const keep = items.filter((it) => {
      const t = streamText(doc, it);
      const ours = t.includes(PRE_TAG) || t.includes(OVERLAY_TAG);
      if (ours) {
        stripped++;
        if (it instanceof PDFRef) orphans.add(it);
      }
      return !ours;
    });
    if (keep.length === items.length) continue;
    page.node.set(PDFName.of('Contents'), doc.context.obj(keep));
    // eigene Ressourcen entfernen
    const res = page.node.Resources();
    for (const [key, prefix] of [
      ['Font', 'GrHelv'],
      ['ExtGState', 'GrA'],
    ] as const) {
      const d = res?.lookupMaybe(PDFName.of(key), PDFDict);
      if (!d) continue;
      for (const k of d.keys()) {
        if (!k.asString().startsWith('/' + prefix)) continue;
        const v = d.get(k);
        if (v instanceof PDFRef) orphans.add(v);
        d.delete(k);
      }
    }
  }
  if (ref instanceof PDFRef) orphans.add(ref);
  catalog.delete(PDFName.of(DATA_KEY));
  for (const r of orphans) doc.context.delete(r);
  if (data && stripped === 0) {
    // Ein anderes Programm hat die Datei umgeschrieben – Elemente sind bereits fest eingebrannt.
    return {
      baseBytes: bytes,
      data: null,
      encrypted: doc.isEncrypted,
      warning: 'Die Bearbeitungen in dieser PDF wurden von einem anderen Programm verändert und sind nicht mehr bearbeitbar.',
    };
  }
  const baseBytes = await doc.save({ useObjectStreams: false });
  return { baseBytes, data, encrypted: doc.isEncrypted };
}

// ---------- Schreiben ----------

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.replace(/(.)/g, '$1$1');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const num = (n: number) => {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};
const rgb = (hex: string) => hexToRgb(hex.slice(0, 7)).map((v) => num(v)).join(' ');

export function invertMat(m: Mat): Mat {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

class OpWriter {
  ops: string[] = [];
  push(...s: string[]) {
    this.ops.push(...s);
  }
  pathOps(p: Extract<Prim, { t: 'path' }>) {
    for (const s of p.d) {
      if (s[0] === 'M') this.push(`${num(s[1])} ${num(s[2])} m`);
      else if (s[0] === 'L') this.push(`${num(s[1])} ${num(s[2])} l`);
      else if (s[0] === 'C') this.push(`${num(s[1])} ${num(s[2])} ${num(s[3])} ${num(s[4])} ${num(s[5])} ${num(s[6])} c`);
      else this.push('h');
    }
  }
}

function alphaOf(hex: string | null): number {
  if (!hex) return 1;
  const h = hex.replace('#', '');
  return h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
}

type GsFn = (strokeAlpha: number, fillAlpha: number) => string | null;

function writePrims(w: OpWriter, prims: Prim[], fonts: Fonts | null, opacity: number, gs: GsFn) {
  for (const p of prims) {
    if (p.t === 'path') {
      const hasStroke = !!p.stroke && p.width > 0;
      const hasFill = !!p.fill;
      if (!hasStroke && !hasFill) continue;
      w.push('q');
      const g = gs(hasStroke ? alphaOf(p.stroke) * opacity : 1, hasFill ? alphaOf(p.fill) * opacity : 1);
      if (g) w.push(`/${g} gs`);
      if (hasFill) w.push(`${rgb(p.fill!)} rg`);
      if (hasStroke) {
        w.push(`${rgb(p.stroke!)} RG`, `${num(p.width)} w`);
        w.push(`${p.cap === 'round' ? 1 : p.cap === 'square' ? 2 : 0} J`, `${p.join === 'round' ? 1 : p.join === 'bevel' ? 2 : 0} j`, '6 M');
        if (p.dash) w.push(`[${p.dash.map(num).join(' ')}] 0 d`);
      }
      w.pathOps(p);
      const eo = p.evenOdd ? '*' : '';
      w.push(hasFill && hasStroke ? `B${eo}` : hasFill ? `f${eo}` : 'S');
      w.push('Q');
    } else {
      if (!fonts) continue;
      const L = textLayout(p);
      const a = (p.angle * Math.PI) / 180;
      const c = Math.cos(a);
      const s = Math.sin(a);
      w.push('q', `${num(c)} ${num(s)} ${num(-s)} ${num(c)} ${num(p.x)} ${num(p.y)} cm`);
      const g = gs(opacity, opacity);
      if (g) w.push(`/${g} gs`);
      if (p.bg) w.push(`${rgb(p.bg)} rg`, `${num(L.box.x)} ${num(L.box.y)} ${num(L.box.w)} ${num(L.box.h)} re f`);
      if (p.frame) w.push(`${rgb(p.frame)} RG`, `${num(p.frameWidth)} w`, `${num(L.box.x)} ${num(L.box.y)} ${num(L.box.w)} ${num(L.box.h)} re S`);
      const font = p.bold ? fonts.bold : fonts.regular;
      w.push(`${rgb(p.color)} rg`, 'BT', `/${p.bold ? 'GrHelvB' : 'GrHelv'} ${num(p.size)} Tf`);
      for (const l of L.lines) {
        if (!l.s) continue;
        const hex = font.encodeText(sanitize(l.s)).toString();
        w.push(`1 0 0 -1 ${num(l.x)} ${num(l.y)} Tm`, `${hex} Tj`);
      }
      w.push('ET', 'Q');
    }
  }
}

function ensureDict(doc: PDFDocument, parent: PDFDict, key: string): PDFDict {
  const existing = parent.lookupMaybe(PDFName.of(key), PDFDict);
  if (existing) return existing;
  const d = doc.context.obj({});
  parent.set(PDFName.of(key), d);
  return d;
}

export interface SaveOptions {
  /** Bearbeitungsdaten einbetten (sonst nur flach/eingebrannt) */
  embedData: boolean;
}

/** Schreibt alle Elemente als Vektorgrafik in die Seiten von doc. */
async function writeOverlays(doc: PDFDocument, pages: PageState[], viewTransforms: Mat[], settings: Settings) {
  const ctx = doc.context;
  const pdfPages = doc.getPages();
  const needsFonts = pages.some((p) => p.annots.length > 0);
  const fonts: Fonts | null = needsFonts
    ? { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) }
    : null;

  pages.forEach((ps, i) => {
    const page = pdfPages[i];
    if (!page || !ps.annots.length) return;
    const ectx: Ctx = { ptPerM: (ps.scale ?? DEFAULT_SCALE).ptPerM, settings };
    const w = new OpWriter();
    const inv = invertMat(viewTransforms[i]);
    w.push('Q', `${OVERLAY_TAG} BMC`, 'q', `${inv.map(num).join(' ')} cm`);
    const gsUsed = new Map<string, [number, number]>();
    const gs: GsFn = (sa, fa) => {
      const S = Math.round(Math.max(0, Math.min(1, sa)) * 100);
      const F = Math.round(Math.max(0, Math.min(1, fa)) * 100);
      if (S >= 100 && F >= 100) return null;
      const name = `GrA${S}_${F}`;
      gsUsed.set(name, [S / 100, F / 100]);
      return name;
    };
    // Abdeckungen zuerst (direkt über dem Plan), dann Raumfüllungen, dann alles andere
    for (const a of drawOrder(ps.annots)) {
      const op = Math.max(0, Math.min(1, a.style.opacity ?? 1));
      if (op <= 0.001) continue;
      writePrims(w, primsOf(a, ectx), fonts, op, gs);
    }
    w.push('Q', 'EMC');

    // Ressourcen ergänzen
    let res = page.node.Resources();
    if (!res) {
      res = ctx.obj({});
      page.node.set(PDFName.of('Resources'), res);
    } else if (!page.node.get(PDFName.of('Resources'))) {
      // geerbte Ressourcen auf die Seite kopieren, um andere Seiten nicht zu verändern
      res = res.clone(ctx);
      page.node.set(PDFName.of('Resources'), res);
    }
    if (fonts) {
      const fd = ensureDict(doc, res, 'Font');
      fd.set(PDFName.of('GrHelv'), fonts.regular.ref);
      fd.set(PDFName.of('GrHelvB'), fonts.bold.ref);
    }
    if (gsUsed.size) {
      const gd = ensureDict(doc, res, 'ExtGState');
      for (const [name, [sa, fa]] of gsUsed) {
        gd.set(PDFName.of(name), ctx.obj({ Type: 'ExtGState', CA: PDFNumber.of(sa), ca: PDFNumber.of(fa) }));
      }
    }

    // Inhaltsströme: [Pre (q)] + Original + [Overlay (Q …)]
    const pre = ctx.register(ctx.flateStream(`${PRE_TAG} BMC EMC\nq\n`));
    const overlay = ctx.register(ctx.flateStream(w.ops.join('\n') + '\n'));
    const raw = page.node.get(PDFName.of('Contents'));
    const looked = raw ? ctx.lookup(raw) : undefined;
    let existing: unknown[] = [];
    if (looked instanceof PDFArray) existing = looked.asArray();
    else if (looked instanceof PDFStream) existing = [raw];
    page.node.set(PDFName.of('Contents'), ctx.obj([pre, ...(existing as PDFRef[]), overlay]));
  });
}

function embedData(doc: PDFDocument, pages: PageState[], settings: Settings) {
  const data: SavedData = { app: 'Grundriss', version: 1, pages, settings };
  const json = new TextEncoder().encode(JSON.stringify(data));
  const ref = doc.context.register(doc.context.flateStream(json));
  doc.catalog.set(PDFName.of(DATA_KEY), ref);
}

/**
 * Erzeugt die PDF mit allen Elementen.
 * @param viewTransforms pro Seite die Abbildung PDF-Benutzerraum → Anzeige (pdf.js-Viewport bei Maßstab 1)
 */
export async function buildPdf(
  baseBytes: Uint8Array,
  pages: PageState[],
  viewTransforms: Mat[],
  settings: Settings,
  opts: SaveOptions,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(baseBytes, { ignoreEncryption: true, updateMetadata: false });
  if (doc.isEncrypted) throw new Error('ENCRYPTED');
  await writeOverlays(doc, pages, viewTransforms, settings);
  if (opts.embedData) embedData(doc, pages, settings);
  doc.setModificationDate(new Date());
  return doc.save({ useObjectStreams: false });
}

export interface RasterPage {
  jpeg: Uint8Array;
  /** Seitengröße in pt (angezeigte Ausrichtung) */
  w: number;
  h: number;
}

/**
 * Für geschützte (verschlüsselte) PDFs: Seiten als Bild + Elemente als Vektoren.
 * Das Original wird eingebettet, damit Grundriss die Bearbeitung später fortsetzen kann.
 */
export async function buildRasterPdf(
  original: Uint8Array,
  renderPage: (i: number) => Promise<RasterPage>,
  pageCount: number,
  pages: PageState[],
  settings: Settings,
  opts: SaveOptions,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const transforms: Mat[] = [];
  for (let i = 0; i < pageCount; i++) {
    const r = await renderPage(i);
    const img = await doc.embedJpg(r.jpeg);
    const page = doc.addPage([r.w, r.h]);
    page.drawImage(img, { x: 0, y: 0, width: r.w, height: r.h });
    transforms.push([1, 0, 0, -1, 0, r.h]);
  }
  await writeOverlays(doc, pages, transforms, settings);
  if (opts.embedData) {
    embedData(doc, pages, settings);
    const ref = doc.context.register(doc.context.flateStream(original));
    doc.catalog.set(PDFName.of(BASE_KEY), ref);
  }
  doc.setTitle('Grundriss');
  return doc.save({ useObjectStreams: false });
}
