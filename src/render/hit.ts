// Geometrische Trefferprüfung auf Basis der Primitive.
import { closestOnSegment, pointInPolygon, rectContains, segmentIntersectsRect, type Rect } from '../geom';
import type { Pt } from '../types';
import { flattenPath, textCorners, type Prim } from './prims';

const flatCache = new WeakMap<Prim, Pt[][]>();

function flat(p: Prim): Pt[][] {
  let f = flatCache.get(p);
  if (!f) {
    f = p.t === 'text' ? [[...textCorners(p), textCorners(p)[0]]] : flattenPath(p.d, 10);
    flatCache.set(p, f);
  }
  return f;
}

function insideRings(p: Pt, rings: Pt[][]): boolean {
  let n = 0;
  for (const r of rings) if (pointInPolygon(p, r)) n++;
  return n % 2 === 1;
}

/** Abstand eines Punktes zum Primitiv-Rand ≤ tol oder innerhalb einer Füllung. */
export function hitPrims(prims: Prim[], p: Pt, tol: number): boolean {
  for (const pr of prims) {
    const rings = flat(pr);
    if (pr.t === 'text') {
      if (pointInPolygon(p, rings[0])) return true;
      continue;
    }
    if (pr.noHit) continue;
    if (pr.fill && insideRings(p, rings)) return true;
    const t = tol + (pr.stroke ? pr.width / 2 : 0);
    for (const r of rings) {
      for (let i = 1; i < r.length; i++) if (closestOnSegment(p, r[i - 1], r[i]).d <= t) return true;
    }
  }
  return false;
}

/** Berührt das Element das Rechteck? */
export function primsTouchRect(prims: Prim[], r: Rect): boolean {
  const corners = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
  for (const pr of prims) {
    const rings = flat(pr);
    const filled = pr.t === 'text' || !!pr.fill;
    for (const ring of rings) {
      for (let i = 1; i < ring.length; i++) if (segmentIntersectsRect(ring[i - 1], ring[i], r)) return true;
      if (ring.length === 1 && rectContains(r, ring[0])) return true;
    }
    if (filled && corners.some((c) => insideRings(c, rings))) return true;
  }
  return false;
}
