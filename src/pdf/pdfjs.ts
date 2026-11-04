// pdf.js-Anbindung: Dokument laden, Seiten rendern, Text und Vektoren auslesen.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Mat } from '../render/prims';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const assetBase = new URL('./pdfjs/', document.baseURI).href;

export type PdfDoc = pdfjs.PDFDocumentProxy;
export type PdfPage = pdfjs.PDFPageProxy;
export const OPS = pdfjs.OPS;

export async function openPdf(bytes: Uint8Array, password?: string): Promise<PdfDoc> {
  // pdf.js übernimmt den Puffer – Kopie übergeben, damit die Originaldaten erhalten bleiben.
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    password,
    cMapUrl: assetBase + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: assetBase + 'standard_fonts/',
    wasmUrl: assetBase + 'wasm/',
    iccUrl: assetBase + 'iccs/',
    isEvalSupported: false,
    enableXfa: false,
  } as Parameters<typeof pdfjs.getDocument>[0]);
  return task.promise;
}

export function isPasswordError(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { name?: string }).name === 'PasswordException';
}

export interface PageGeom {
  /** Breite/Höhe der angezeigten Seite in pt */
  w: number;
  h: number;
  /** PDF-Benutzerraum → Anzeige (Maßstab 1) */
  transform: Mat;
}

export function pageGeom(page: PdfPage): PageGeom {
  const vp = page.getViewport({ scale: 1 });
  return { w: vp.width, h: vp.height, transform: vp.transform.slice(0, 6) as Mat };
}

export interface RenderJob {
  promise: Promise<void>;
  cancel(): void;
}

/**
 * Rendert die Seite in ein Canvas. scale = Pixel pro pt, (ox, oy) = Pixelversatz des
 * Seitenursprungs im Canvas.
 */
export function renderPage(page: PdfPage, canvas: HTMLCanvasElement, scale: number, ox = 0, oy = 0, transparent = false): RenderJob {
  const viewport = page.getViewport({ scale });
  const task = page.render({
    canvas,
    viewport,
    transform: ox || oy ? [1, 0, 0, 1, ox, oy] : undefined,
    background: transparent ? 'rgba(0,0,0,0)' : 'rgb(255,255,255)',
  } as Parameters<PdfPage['render']>[0]);
  return {
    promise: task.promise.catch((e: unknown) => {
      if ((e as { name?: string })?.name !== 'RenderingCancelledException') throw e;
    }),
    cancel: () => task.cancel(),
  };
}

export async function pageTexts(page: PdfPage): Promise<string[]> {
  const tc = await page.getTextContent();
  const out: string[] = [];
  let line = '';
  for (const it of tc.items) {
    if ('str' in it) {
      line += it.str;
      if (it.hasEOL) {
        out.push(line);
        line = '';
      } else line += ' ';
    }
  }
  if (line) out.push(line);
  return out;
}
