// Liest die Vektorgeometrie einer PDF-Seite aus (für den Fang auf Linienenden/Ecken des Plans).
import { AnnotationMode } from 'pdfjs-dist';
import { applyMat, type Mat } from '../render/prims';
import { OPS, type PdfPage } from './pdfjs';

const MAX_SEGMENTS = 400_000;

const mulMat = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/** Liefert Liniensegmente [x1,y1,x2,y2,…] im Anzeigeraum (pt, y nach unten). */
export async function extractSegments(page: PdfPage, view: Mat): Promise<Float32Array> {
  const opList = await page.getOperatorList({ annotationMode: AnnotationMode.DISABLE });
  const out: number[] = [];
  const stack: Mat[] = [];
  let ctm: Mat = view;
  const { fnArray, argsArray } = opList;
  for (let i = 0; i < fnArray.length && out.length < MAX_SEGMENTS * 4; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as any;
    switch (fn) {
      case OPS.save:
        stack.push(ctm);
        break;
      case OPS.restore:
        ctm = stack.pop() ?? view;
        break;
      case OPS.transform:
        ctm = mulMat(ctm, args as Mat);
        break;
      case OPS.paintFormXObjectBegin:
        stack.push(ctm);
        if (Array.isArray(args?.[0]) || ArrayBuffer.isView(args?.[0])) ctm = mulMat(ctm, Array.from(args[0] as ArrayLike<number>) as Mat);
        break;
      case OPS.paintFormXObjectEnd:
        ctm = stack.pop() ?? view;
        break;
      case OPS.constructPath: {
        const op = args?.[0];
        if (op === OPS.endPath) break; // reiner Clip-Pfad
        const data: ArrayLike<number> | null = args?.[1]?.[0] ?? null;
        if (!data) break;
        let sx = 0,
          sy = 0,
          cx = 0,
          cy = 0;
        const seg = (x1: number, y1: number, x2: number, y2: number) => {
          const a = applyMat(ctm, { x: x1, y: y1 });
          const b = applyMat(ctm, { x: x2, y: y2 });
          if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 0.05) out.push(a.x, a.y, b.x, b.y);
        };
        for (let k = 0; k < data.length; ) {
          switch (data[k++]) {
            case 0: // moveTo
              cx = sx = data[k++];
              cy = sy = data[k++];
              break;
            case 1: {
              const x = data[k++];
              const y = data[k++];
              seg(cx, cy, x, y);
              cx = x;
              cy = y;
              break;
            }
            case 2: {
              // Kurve grob als Sehne erfassen (Endpunkte für den Fang)
              k += 4;
              const x = data[k++];
              const y = data[k++];
              seg(cx, cy, x, y);
              cx = x;
              cy = y;
              break;
            }
            case 3: {
              k += 2;
              const x = data[k++];
              const y = data[k++];
              seg(cx, cy, x, y);
              cx = x;
              cy = y;
              break;
            }
            case 4:
              seg(cx, cy, sx, sy);
              cx = sx;
              cy = sy;
              break;
            default:
              k = data.length;
          }
        }
        break;
      }
    }
  }
  return new Float32Array(out);
}
