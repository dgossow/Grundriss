// Schriftmetriken (Helvetica) – identisch für Bildschirm und PDF-Export,
// damit Beschriftungen überall gleich laufen.
import { StandardFontEmbedder, StandardFonts } from 'pdf-lib';

const regular = StandardFontEmbedder.for(StandardFonts.Helvetica as never);
const bold = StandardFontEmbedder.for(StandardFonts.HelveticaBold as never);

const encodable = new Map<string, boolean>();

/** Ersetzt Zeichen, die Helvetica/WinAnsi nicht darstellen kann. */
export function sanitize(text: string): string {
  let out = '';
  for (const ch of text) {
    let ok = encodable.get(ch);
    if (ok === undefined) {
      try {
        regular.encodeText(ch);
        ok = true;
      } catch {
        ok = false;
      }
      encodable.set(ch, ok);
    }
    out += ok ? ch : ch === '\t' ? ' ' : '?';
  }
  return out;
}

export function textWidth(text: string, size: number, isBold = false): number {
  const f = isBold ? bold : regular;
  return f.widthOfTextAtSize(sanitize(text), size);
}

/** Versalhöhe von Helvetica relativ zur Schriftgröße. */
export const CAP_HEIGHT = 0.718;
export const DESCENT = 0.207;
export const LINE_HEIGHT = 1.2;
