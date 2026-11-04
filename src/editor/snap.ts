// Fang (Objektfang) auf Endpunkte, Mittelpunkte, Schnittpunkte und Linien.
import { closestOnSegment, dist } from '../geom';
import type { Pt } from '../types';

export type SnapKind = 'end' | 'mid' | 'cross' | 'line';

export interface SnapResult {
  p: Pt;
  kind: SnapKind;
}

const CELL = 24;

export class SegmentIndex {
  segs: Float32Array;
  private grid = new Map<number, number[]>();

  constructor(segs: Float32Array) {
    this.segs = segs;
    const n = segs.length / 4;
    for (let i = 0; i < n; i++) {
      const x1 = segs[i * 4];
      const y1 = segs[i * 4 + 1];
      const x2 = segs[i * 4 + 2];
      const y2 = segs[i * 4 + 3];
      const L = Math.hypot(x2 - x1, y2 - y1);
      const steps = Math.max(1, Math.ceil(L / (CELL / 2)));
      let last = NaN;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const k = this.key(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
        if (k !== last) {
          this.add(k, i);
          last = k;
        }
      }
    }
  }

  private key(x: number, y: number) {
    return Math.floor(x / CELL) * 100003 + Math.floor(y / CELL);
  }

  private add(k: number, i: number) {
    const arr = this.grid.get(k);
    if (arr) {
      if (arr[arr.length - 1] !== i) arr.push(i);
    } else this.grid.set(k, [i]);
  }

  /** Segmente in der Nähe von p (Radius r). */
  near(p: Pt, r: number): number[] {
    const set = new Set<number>();
    const x0 = Math.floor((p.x - r) / CELL);
    const x1 = Math.floor((p.x + r) / CELL);
    const y0 = Math.floor((p.y - r) / CELL);
    const y1 = Math.floor((p.y + r) / CELL);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) return [];
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const arr = this.grid.get(x * 100003 + y);
        if (arr) for (const i of arr) set.add(i);
      }
    return [...set];
  }

  seg(i: number): [Pt, Pt] {
    const s = this.segs;
    return [
      { x: s[i * 4], y: s[i * 4 + 1] },
      { x: s[i * 4 + 2], y: s[i * 4 + 3] },
    ];
  }
}

export interface SnapSources {
  pdf: SegmentIndex | null;
  /** Segmente aus eigenen Elementen */
  annotSegs: [Pt, Pt][];
  /** zusätzliche Punkte (z. B. bisherige Punkte der aktuellen Polylinie) */
  extraPoints?: Pt[];
}

/** Sucht den besten Fangpunkt im Radius r (in pt). */
export function findSnap(p: Pt, r: number, src: SnapSources): SnapResult | null {
  const segs: [Pt, Pt][] = [];
  if (src.pdf) for (const i of src.pdf.near(p, r).slice(0, 300)) segs.push(src.pdf.seg(i));
  for (const s of src.annotSegs) {
    const c = closestOnSegment(p, s[0], s[1]);
    if (c.d <= r) segs.push(s);
  }
  let best: SnapResult | null = null;
  let bestD = r;
  const consider = (q: Pt, kind: SnapKind, bias = 0) => {
    const d = dist(p, q) + bias;
    if (d <= bestD) {
      bestD = d;
      best = { p: q, kind };
    }
  };
  for (const q of src.extraPoints ?? []) consider(q, 'end');
  for (const [a, b] of segs) {
    consider(a, 'end');
    consider(b, 'end');
  }
  if (best) return best;
  for (const [a, b] of segs) consider({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 'mid', r * 0.15);
  if (best) return best;
  // Schnittpunkte
  const near = segs.slice(0, 60);
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      const q = segIntersection(near[i], near[j]);
      if (q) consider(q, 'cross');
    }
  }
  if (best) return best;
  // Auf Linie
  let lineBest: SnapResult | null = null;
  let lineD = r * 0.6;
  for (const [a, b] of segs) {
    const c = closestOnSegment(p, a, b);
    if (c.d < lineD) {
      lineD = c.d;
      lineBest = { p: c.p, kind: 'line' };
    }
  }
  return lineBest;
}

function segIntersection([a, b]: [Pt, Pt], [c, d]: [Pt, Pt]): Pt | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}
