// Einfache Zeichenwerkzeuge: Linie, Pfeil, Polylinie, Rechteck, Ellipse, Wolke, Freihand, Text, Abdecken.
import { add, dist, mul, norm, polylineLength, sub, leftNormal } from '../geom';
import { PathBuilder, path, text, type Prim } from '../render/prims';
import type { BoxBase, CloudA, EllipseA, FreehandA, LineA, PolylineA, Pt, RectA, TextA, WhiteoutA } from '../types';
import { fmtLen } from '../units';
import {
  arrowHead,
  arrowSize,
  constrainToNeighbor,
  dashArray,
  mm,
  register,
  replaceAt,
  strokeOf,
  translatePt,
  translatePts,
  vertexHandles,
  type Ctx,
  type Handle,
  type Mods,
} from './registry';

// ---------- Linie / Pfeil ----------

register<LineA>({
  kind: 'line',
  label: 'Linie',
  styleKeys: ['stroke', 'width', 'dash', 'opacity'],
  params: [
    { key: 'arrowStart', label: 'Pfeil am Anfang', type: 'bool' },
    { key: 'arrowEnd', label: 'Pfeil am Ende', type: 'bool' },
  ],
  prims(a) {
    const out: Prim[] = [];
    const as = arrowSize(a.style);
    const d = norm(sub(a.p2, a.p1));
    const L = dist(a.p1, a.p2);
    let s = a.p1;
    let e = a.p2;
    if (a.arrowStart && L > as) s = add(a.p1, mul(d, as * 0.8));
    if (a.arrowEnd && L > as) e = sub(a.p2, mul(d, as * 0.8));
    out.push(strokeOf(a.style, new PathBuilder().line(s, e)));
    if (a.arrowStart) out.push(arrowHead(a.p1, a.p2, as, a.style.stroke));
    if (a.arrowEnd) out.push(arrowHead(a.p2, a.p1, as, a.style.stroke));
    return out;
  },
  handles: (a) => [
    { p: a.p1, type: 'vertex' },
    { p: a.p2, type: 'vertex' },
  ],
  moveHandle(a, i, p, _ctx, mods) {
    const pts = [a.p1, a.p2];
    const q = constrainToNeighbor(pts, i, p, mods);
    return i === 0 ? { ...a, p1: q } : { ...a, p2: q };
  },
  translate: (a, d) => ({ ...a, p1: translatePt(a.p1, d), p2: translatePt(a.p2, d) }),
  info: (a, ctx) => [`Länge: ${fmtLen(dist(a.p1, a.p2) / ctx.ptPerM, ctx.settings)}`],
});

// ---------- Polylinie ----------

register<PolylineA>({
  kind: 'polyline',
  label: 'Polylinie',
  styleKeys: ['stroke', 'fill', 'width', 'dash', 'opacity'],
  params: [{ key: 'closed', label: 'Geschlossen', type: 'bool' }],
  prims: (a) => [strokeOf(a.style, new PathBuilder().poly(a.pts, a.closed), { fill: a.closed })],
  handles: (a) => vertexHandles(a.pts),
  moveHandle: (a, i, p, _c, mods) => ({ ...a, pts: replaceAt(a.pts, i, constrainToNeighbor(a.pts, i, p, mods)) }),
  translate: (a, d) => ({ ...a, pts: translatePts(a.pts, d) }),
  info: (a, ctx) => [`Länge: ${fmtLen(polylineLength(a.pts, a.closed) / ctx.ptPerM, ctx.settings)}`],
});

// ---------- Rechteck-artige ----------

export function boxCorners(a: BoxBase): Pt[] {
  return [
    { x: a.x, y: a.y },
    { x: a.x + a.w, y: a.y },
    { x: a.x + a.w, y: a.y + a.h },
    { x: a.x, y: a.y + a.h },
  ];
}

function boxHandles(a: BoxBase): Handle[] {
  return boxCorners(a).map((p) => ({ p, type: 'corner' as const }));
}

function boxMove<A extends BoxBase>(a: A, i: number, p: Pt, mods: Mods): A {
  const c = boxCorners(a);
  const o = c[(i + 2) % 4];
  let q = p;
  if (mods.shift) {
    // Seitenverhältnis 1:1
    const s = Math.max(Math.abs(p.x - o.x), Math.abs(p.y - o.y));
    q = { x: o.x + Math.sign(p.x - o.x || 1) * s, y: o.y + Math.sign(p.y - o.y || 1) * s };
  }
  return { ...a, x: Math.min(o.x, q.x), y: Math.min(o.y, q.y), w: Math.abs(q.x - o.x), h: Math.abs(q.y - o.y) };
}

function boxInfo(a: BoxBase, ctx: Ctx): string[] {
  return [`Größe: ${fmtLen(a.w / ctx.ptPerM, ctx.settings, false)} × ${fmtLen(a.h / ctx.ptPerM, ctx.settings)}`];
}

const boxCommon = {
  handles: boxHandles,
  moveHandle: (a: any, i: number, p: Pt, _c: Ctx, mods: Mods) => boxMove(a, i, p, mods),
  translate: (a: any, d: Pt) => ({ ...a, x: a.x + d.x, y: a.y + d.y }),
  info: boxInfo,
};

register<RectA>({
  kind: 'rect',
  label: 'Rechteck',
  styleKeys: ['stroke', 'fill', 'width', 'dash', 'opacity'],
  params: [],
  prims: (a) => [strokeOf(a.style, new PathBuilder().rect(a.x, a.y, a.w, a.h), { fill: true })],
  ...boxCommon,
});

register<EllipseA>({
  kind: 'ellipse',
  label: 'Ellipse',
  styleKeys: ['stroke', 'fill', 'width', 'dash', 'opacity'],
  params: [],
  prims: (a) => [strokeOf(a.style, new PathBuilder().ellipse(a.x + a.w / 2, a.y + a.h / 2, a.w / 2, a.h / 2), { fill: true })],
  ...boxCommon,
});

register<WhiteoutA>({
  kind: 'whiteout',
  label: 'Abdeckung',
  styleKeys: ['fill'],
  params: [],
  prims: (a) => [path(new PathBuilder().rect(a.x, a.y, a.w, a.h), { fill: a.style.fill || '#ffffff', stroke: null, width: 0, mask: true })],
  ...boxCommon,
});

/** Revisionswolke entlang eines Rechtecks. */
function cloudPath(a: CloudA): PathBuilder {
  const pb = new PathBuilder();
  const corners = boxCorners(a);
  const size = Math.max(mm(1.5), mm(a.arc));
  pb.M(corners[0]);
  for (let i = 0; i < 4; i++) {
    const A = corners[i];
    const B = corners[(i + 1) % 4];
    const L = dist(A, B);
    const n = Math.max(1, Math.round(L / size));
    const dir = norm(sub(B, A));
    // Außenseite: im Uhrzeigersinn (y nach unten) liegt außen links der Laufrichtung
    const out = leftNormal(dir);
    for (let k = 0; k < n; k++) {
      const p0 = add(A, mul(dir, (L * k) / n));
      const p1 = add(A, mul(dir, (L * (k + 1)) / n));
      const h = (L / n) * 0.6;
      pb.C(add(p0, mul(out, h)), add(p1, mul(out, h)), p1);
    }
  }
  return pb.Z();
}

register<CloudA>({
  kind: 'cloud',
  label: 'Revisionswolke',
  styleKeys: ['stroke', 'fill', 'width', 'opacity'],
  params: [{ key: 'arc', label: 'Bogengröße', type: 'mm', min: 1, max: 50, step: 0.5 }],
  prims: (a) => {
    const w = mm(a.style.width);
    return [path(cloudPath(a), { stroke: a.style.stroke, fill: a.style.fill, width: w, join: 'round', cap: 'round' })];
  },
  ...boxCommon,
});

// ---------- Freihand ----------

export function smoothPath(pts: Pt[]): PathBuilder {
  const pb = new PathBuilder();
  if (!pts.length) return pb;
  pb.M(pts[0]);
  if (pts.length === 1) return pb.L({ x: pts[0].x + 0.01, y: pts[0].y });
  if (pts.length === 2) return pb.L(pts[1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    pb.C(add(p1, mul(sub(p2, p0), 1 / 6)), sub(p2, mul(sub(p3, p1), 1 / 6)), p2);
  }
  return pb;
}

register<FreehandA>({
  kind: 'freehand',
  label: 'Freihand',
  styleKeys: ['stroke', 'width', 'dash', 'opacity'],
  params: [],
  prims: (a) => {
    const w = mm(a.style.width);
    return [path(smoothPath(a.pts), { stroke: a.style.stroke, width: w, cap: 'round', join: 'round', dash: dashArray(a.style.dash, w) })];
  },
  handles: () => [],
  moveHandle: (a) => a,
  translate: (a, d) => ({ ...a, pts: translatePts(a.pts, d) }),
});

// ---------- Text ----------

register<TextA>({
  kind: 'text',
  label: 'Text',
  styleKeys: ['stroke', 'opacity'],
  params: [
    { key: 'text', label: 'Text', type: 'textarea' },
    { key: 'size', label: 'Schriftgröße', type: 'pt', min: 3, max: 200, step: 1 },
    { key: 'bold', label: 'Fett', type: 'bool' },
    { key: 'bg', label: 'Weißer Hintergrund', type: 'bool' },
    { key: 'frame', label: 'Rahmen', type: 'bool' },
    { key: 'angle', label: 'Drehung', type: 'angle' },
  ],
  prims: (a) => [
    text(a.p, a.text || ' ', {
      size: a.size,
      bold: a.bold,
      color: a.style.stroke,
      align: 'start',
      valign: 'top',
      angle: a.angle,
      bg: a.bg ? '#ffffff' : null,
      frame: a.frame ? a.style.stroke : null,
      frameWidth: Math.max(0.5, a.size / 18),
      pad: a.size * 0.3,
    }),
  ],
  handles: () => [],
  moveHandle: (a) => a,
  translate: (a, d) => ({ ...a, p: translatePt(a.p, d) }),
});
