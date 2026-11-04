import type { Pt } from './types';

export const MM_TO_PT = 72 / 25.4;
export const PT_TO_MM = 25.4 / 72;
export const DEG = Math.PI / 180;

export const pt = (x: number, y: number): Pt => ({ x, y });
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Pt, s: number): Pt => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
export const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
export const len = (a: Pt) => Math.hypot(a.x, a.y);
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const norm = (a: Pt): Pt => {
  const l = len(a);
  return l < 1e-12 ? { x: 1, y: 0 } : { x: a.x / l, y: a.y / l };
};
/** Linke Normale im y-nach-unten-System (optisch "links" der Laufrichtung). */
export const leftNormal = (d: Pt): Pt => ({ x: d.y, y: -d.x });
export const rot = (a: Pt, rad: number): Pt => {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
};
export const angleOf = (a: Pt, b: Pt) => Math.atan2(b.y - a.y, b.x - a.x);

export function polylineLength(pts: Pt[], closed = false): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  if (closed && pts.length > 2) l += dist(pts[pts.length - 1], pts[0]);
  return l;
}

/** Vorzeichenbehaftete Fläche (Shoelace). */
export function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function centroid(pts: Pt[]): Pt {
  const a = signedArea(pts);
  if (Math.abs(a) < 1e-9) {
    const s = pts.reduce((acc, p) => add(acc, p), pt(0, 0));
    return mul(s, 1 / Math.max(1, pts.length));
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Ein Punkt innerhalb des Polygons, möglichst mittig (für Beschriftungen bei L-Formen). */
export function labelPoint(poly: Pt[]): Pt {
  const c = centroid(poly);
  if (pointInPolygon(c, poly)) return c;
  // Horizontale Scanlinie durch den Schwerpunkt: Mitte des breitesten inneren Abschnitts.
  const xs: number[] = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > c.y !== b.y > c.y) xs.push(a.x + ((c.y - a.y) * (b.x - a.x)) / (b.y - a.y));
  }
  xs.sort((a, b) => a - b);
  let best = c;
  let bestW = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const w = xs[i + 1] - xs[i];
    if (w > bestW) {
      bestW = w;
      best = { x: (xs[i] + xs[i + 1]) / 2, y: c.y };
    }
  }
  return best;
}

export function closestOnSegment(p: Pt, a: Pt, b: Pt): { p: Pt; t: number; d: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  let t = l2 < 1e-12 ? 0 : dot(sub(p, a), ab) / l2;
  t = Math.max(0, Math.min(1, t));
  const q = add(a, mul(ab, t));
  return { p: q, t, d: dist(p, q) };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function rectFromPts(a: Pt, b: Pt): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export function rectContains(r: Rect, p: Pt): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

export function segmentIntersectsRect(a: Pt, b: Pt, r: Rect): boolean {
  if (rectContains(r, a) || rectContains(r, b)) return true;
  const c = [pt(r.x, r.y), pt(r.x + r.w, r.y), pt(r.x + r.w, r.y + r.h), pt(r.x, r.y + r.h)];
  for (let i = 0; i < 4; i++) if (segmentsIntersect(a, b, c[i], c[(i + 1) % 4])) return true;
  return false;
}

export function segmentsIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d1 = cross(sub(p4, p3), sub(p1, p3));
  const d2 = cross(sub(p4, p3), sub(p2, p3));
  const d3 = cross(sub(p2, p1), sub(p3, p1));
  const d4 = cross(sub(p2, p1), sub(p4, p1));
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Schnittpunkt zweier Geraden (nicht Strecken). */
export function lineIntersection(p1: Pt, d1: Pt, p2: Pt, d2: Pt): Pt | null {
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(p2, p1), d2) / den;
  return add(p1, mul(d1, t));
}

/**
 * Parallele Polylinie im Abstand d (positiv = links der Laufrichtung) mit Gehrungsecken.
 */
export function offsetPolyline(pts: Pt[], d: number, closed: boolean): Pt[] {
  const n = pts.length;
  if (n < 2) return pts.slice();
  if (Math.abs(d) < 1e-9) return pts.slice();
  const segs: { a: Pt; b: Pt; dir: Pt; nrm: Pt }[] = [];
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dir = norm(sub(b, a));
    const nrm = leftNormal(dir);
    segs.push({ a: add(a, mul(nrm, d)), b: add(b, mul(nrm, d)), dir, nrm });
  }
  const out: Pt[] = [];
  const join = (s0: (typeof segs)[0], s1: (typeof segs)[0], corner: Pt): Pt => {
    const ip = lineIntersection(s0.a, s0.dir, s1.a, s1.dir);
    if (!ip) return s1.a;
    // Gehrungsbegrenzung: bei sehr spitzen Winkeln nicht ins Unendliche laufen
    if (dist(ip, corner) > Math.abs(d) * 6) return add(corner, mul(norm(add(s0.nrm, s1.nrm)), d));
    return ip;
  };
  if (closed) {
    for (let i = 0; i < segs.length; i++) {
      const prev = segs[(i - 1 + segs.length) % segs.length];
      out.push(join(prev, segs[i], pts[i]));
    }
  } else {
    out.push(segs[0].a);
    for (let i = 1; i < segs.length; i++) out.push(join(segs[i - 1], segs[i], pts[i]));
    out.push(segs[segs.length - 1].b);
  }
  return out;
}

/** Ramer-Douglas-Peucker-Vereinfachung. */
export function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = closestOnSegment(pts[i], pts[s], pts[e]).d;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function bboxOf(pts: Pt[]): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  if (x0 === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Winkel auf Schritte einrasten (Shift-Taste). */
export function snapAngle(from: Pt, to: Pt, stepDeg = 45): Pt {
  const a = angleOf(from, to);
  const step = stepDeg * DEG;
  const sa = Math.round(a / step) * step;
  const l = dist(from, to);
  return { x: from.x + Math.cos(sa) * l, y: from.y + Math.sin(sa) * l };
}

export function normDeg(a: number): number {
  let r = a % 360;
  if (r < 0) r += 360;
  return r;
}

let idCounter = 0;
export function uid(): string {
  idCounter = (idCounter + 1) % 1e6;
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + idCounter.toString(36);
}
