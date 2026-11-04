import './basic';
import './measure';
import './plan';
import './symbols';
import { defOf, type Ctx } from './registry';
import type { Annot } from '../types';
import type { Prim } from '../render/prims';

export * from './registry';

/**
 * Zeichenebene: 0 = Abdeckungen (direkt auf dem Plan), 1 = Raum-/Flächenfüllungen,
 * 2 = alle übrigen Elemente. Innerhalb einer Ebene gilt die Reihenfolge der Liste.
 */
export function layerOf(a: Annot): 0 | 1 | 2 {
  if (a.kind === 'whiteout') return 0;
  if (a.kind === 'room' || a.kind === 'area') return 1;
  return 2;
}

/** Elemente in Zeichenreihenfolge (unten → oben). */
export function drawOrder(annots: Annot[]): Annot[] {
  return [0, 1, 2].flatMap((l) => annots.filter((a) => layerOf(a) === l));
}

/** Primitive eines Elements, mit Cache pro Objektinstanz (Elemente sind unveränderlich). */
const cache = new WeakMap<Annot, { key: string; prims: Prim[] }>();

export function primsOf(a: Annot, ctx: Ctx): Prim[] {
  const key = `${ctx.ptPerM}|${ctx.settings.unit}|${ctx.settings.decimals}`;
  const c = cache.get(a);
  if (c && c.key === key) return c.prims;
  let prims: Prim[];
  try {
    prims = defOf(a).prims(a as never, ctx);
  } catch (e) {
    console.error('Fehler beim Zeichnen', a, e);
    prims = [];
  }
  cache.set(a, { key, prims });
  return prims;
}
