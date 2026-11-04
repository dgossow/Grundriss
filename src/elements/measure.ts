// Messwerkzeuge: Bemaßung (Distanz), Kettenmaß/Pfadlänge, Fläche.
import { add, angleOf, dist, dot, labelPoint, leftNormal, mid, mul, norm, polylineLength, signedArea, sub } from '../geom';
import { PathBuilder, path, readableAngle, text, type Prim } from '../render/prims';
import type { AreaA, MeasureA, PathLenA } from '../types';
import { fmtArea, fmtLen } from '../units';
import { arrowHead, constrainToNeighbor, mm, register, replaceAt, strokeOf, translatePt, translatePts, vertexHandles } from './registry';

const DIM_END_OPTIONS: [string, string][] = [
  ['tick', 'Schrägstrich'],
  ['arrow', 'Pfeil'],
  ['dot', 'Punkt'],
];

function measureGeometry(a: MeasureA) {
  const d = norm(sub(a.p2, a.p1));
  const n = leftNormal(d);
  const o = mul(n, a.offset);
  return { d, n, q1: add(a.p1, o), q2: add(a.p2, o) };
}

register<MeasureA>({
  kind: 'measure',
  label: 'Bemaßung',
  styleKeys: ['stroke', 'width', 'opacity'],
  params: [
    { key: 'end', label: 'Maßbegrenzung', type: 'select', options: DIM_END_OPTIONS },
    { key: 'textSize', label: 'Schriftgröße', type: 'pt', min: 3, max: 72, step: 0.5 },
  ],
  prims(a, ctx) {
    const out: Prim[] = [];
    const { d, n, q1, q2 } = measureGeometry(a);
    const w = mm(a.style.width);
    const col = a.style.stroke;
    const L = dist(a.p1, a.p2);
    const pb = new PathBuilder().line(q1, q2);
    // Maßhilfslinien
    if (Math.abs(a.offset) > mm(0.5)) {
      const s = Math.sign(a.offset);
      const gap = Math.min(mm(1), Math.abs(a.offset) * 0.3);
      const over = mm(1.5);
      for (const [p, q] of [
        [a.p1, q1],
        [a.p2, q2],
      ]) {
        pb.line(add(p, mul(n, s * gap)), add(q, mul(n, s * over)));
      }
    }
    // Maßlinie leicht über die Begrenzung hinaus verlängern (Architektenstil)
    if (a.end === 'tick') pb.line(sub(q1, mul(d, mm(1.5))), add(q2, mul(d, mm(1.5))));
    out.push(path(pb, { stroke: col, width: w }));
    // Begrenzungen
    if (a.end === 'tick') {
      const t = mm(1.4);
      const diag = norm(add(d, n));
      const tb = new PathBuilder();
      for (const q of [q1, q2]) tb.line(sub(q, mul(diag, t)), add(q, mul(diag, t)));
      out.push(path(tb, { stroke: col, width: w * 2.2 }));
    } else if (a.end === 'arrow') {
      const s = Math.min(mm(2.5), L / 3);
      out.push(arrowHead(q1, q2, s, col), arrowHead(q2, q1, s, col));
    } else {
      const r = mm(0.6);
      out.push(path(new PathBuilder().circle(q1.x, q1.y, r).circle(q2.x, q2.y, r), { fill: col, stroke: null, width: 0 }));
    }
    // Maßzahl
    const ang = readableAngle((angleOf(a.p1, a.p2) * 180) / Math.PI);
    const up = { x: Math.sin((ang * Math.PI) / 180), y: -Math.cos((ang * Math.PI) / 180) };
    const m = add(mid(q1, q2), mul(up, mm(0.8)));
    out.push(
      text(m, fmtLen(L / ctx.ptPerM, ctx.settings), {
        size: a.textSize,
        color: col,
        angle: ang,
        align: 'middle',
        valign: 'bottom',
        bg: '#ffffff',
        pad: a.textSize * 0.12,
      }),
    );
    return out;
  },
  handles(a) {
    const { q1, q2 } = measureGeometry(a);
    return [
      { p: a.p1, type: 'vertex' },
      { p: a.p2, type: 'vertex' },
      { p: mid(q1, q2), type: 'offset' },
    ];
  },
  moveHandle(a, i, p, _ctx, mods) {
    if (i === 2) {
      const { n } = measureGeometry(a);
      return { ...a, offset: dot(sub(p, mid(a.p1, a.p2)), n) };
    }
    const q = constrainToNeighbor([a.p1, a.p2], i, p, mods);
    return i === 0 ? { ...a, p1: q } : { ...a, p2: q };
  },
  translate: (a, d) => ({ ...a, p1: translatePt(a.p1, d), p2: translatePt(a.p2, d) }),
  info: (a, ctx) => {
    const dx = Math.abs(a.p2.x - a.p1.x) / ctx.ptPerM;
    const dy = Math.abs(a.p2.y - a.p1.y) / ctx.ptPerM;
    return [
      `Länge: ${fmtLen(dist(a.p1, a.p2) / ctx.ptPerM, ctx.settings)}`,
      `Δx ${fmtLen(dx, ctx.settings)} · Δy ${fmtLen(dy, ctx.settings)}`,
    ];
  },
});

register<PathLenA>({
  kind: 'pathlen',
  label: 'Kettenmaß',
  styleKeys: ['stroke', 'width', 'dash', 'opacity'],
  params: [{ key: 'textSize', label: 'Schriftgröße', type: 'pt', min: 3, max: 72, step: 0.5 }],
  prims(a, ctx) {
    const out: Prim[] = [strokeOf(a.style, new PathBuilder().poly(a.pts, false))];
    const r = mm(0.6);
    const dots = new PathBuilder();
    for (const p of a.pts) dots.circle(p.x, p.y, r);
    out.push(path(dots, { fill: a.style.stroke, stroke: null, width: 0, noHit: true }));
    if (a.pts.length >= 2) {
      const total = polylineLength(a.pts) / ctx.ptPerM;
      // Teilmaße an jedem Segment
      if (a.pts.length > 2) {
        for (let i = 1; i < a.pts.length; i++) {
          const p = a.pts[i - 1];
          const q = a.pts[i];
          const ang = readableAngle((angleOf(p, q) * 180) / Math.PI);
          const up = { x: Math.sin((ang * Math.PI) / 180), y: -Math.cos((ang * Math.PI) / 180) };
          out.push(
            text(add(mid(p, q), mul(up, mm(0.8))), fmtLen(dist(p, q) / ctx.ptPerM, ctx.settings, false), {
              size: a.textSize * 0.85,
              color: a.style.stroke,
              angle: ang,
              valign: 'bottom',
              bg: '#ffffff',
              pad: a.textSize * 0.1,
            }),
          );
        }
      }
      const last = a.pts[a.pts.length - 1];
      out.push(
        text(add(last, { x: mm(2), y: -mm(2) }), `Σ ${fmtLen(total, ctx.settings)}`, {
          size: a.textSize,
          bold: true,
          color: a.style.stroke,
          align: 'start',
          valign: 'bottom',
          bg: '#ffffff',
          frame: a.style.stroke,
          frameWidth: 0.5,
          pad: a.textSize * 0.25,
        }),
      );
    }
    return out;
  },
  handles: (a) => vertexHandles(a.pts),
  moveHandle: (a, i, p, _c, mods) => ({ ...a, pts: replaceAt(a.pts, i, constrainToNeighbor(a.pts, i, p, mods)) }),
  translate: (a, d) => ({ ...a, pts: translatePts(a.pts, d) }),
  info: (a, ctx) => [`Gesamtlänge: ${fmtLen(polylineLength(a.pts) / ctx.ptPerM, ctx.settings)}`, `${a.pts.length - 1} Segmente`],
});

export function areaM2(pts: { x: number; y: number }[], ptPerM: number): number {
  return Math.abs(signedArea(pts)) / (ptPerM * ptPerM);
}

register<AreaA>({
  kind: 'area',
  label: 'Fläche',
  styleKeys: ['stroke', 'fill', 'width', 'dash', 'opacity'],
  params: [
    { key: 'showPerimeter', label: 'Umfang anzeigen', type: 'bool' },
    { key: 'textSize', label: 'Schriftgröße', type: 'pt', min: 3, max: 72, step: 0.5 },
  ],
  prims(a, ctx) {
    const out: Prim[] = [strokeOf(a.style, new PathBuilder().poly(a.pts, true), { fill: true })];
    if (a.pts.length >= 3) {
      const A = areaM2(a.pts, ctx.ptPerM);
      let s = `A = ${fmtArea(A)}`;
      if (a.showPerimeter) s += `\nU = ${fmtLen(polylineLength(a.pts, true) / ctx.ptPerM, ctx.settings)}`;
      out.push(
        text(labelPoint(a.pts), s, {
          size: a.textSize,
          bold: false,
          color: a.style.stroke,
          bg: '#ffffff',
          pad: a.textSize * 0.25,
        }),
      );
    }
    return out;
  },
  handles: (a) => vertexHandles(a.pts),
  moveHandle: (a, i, p, _c, mods) => ({ ...a, pts: replaceAt(a.pts, i, constrainToNeighbor(a.pts, i, p, mods)) }),
  translate: (a, d) => ({ ...a, pts: translatePts(a.pts, d) }),
  info: (a, ctx) => [
    `Fläche: ${fmtArea(areaM2(a.pts, ctx.ptPerM))}`,
    `Umfang: ${fmtLen(polylineLength(a.pts, true) / ctx.ptPerM, ctx.settings)}`,
  ],
});

