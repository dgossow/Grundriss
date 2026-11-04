// Grundriss-Elemente mit realen Maßen: Wand, Tür, Fenster, Treppe, Raum, Stütze.
import { DEG, labelPoint, offsetPolyline, polylineLength, rot, signedArea, sub } from '../geom';
import { applyMat, matPlace, PathBuilder, path, text, transformPrims, type Prim } from '../render/prims';
import type { ColumnA, DoorA, PlacedBase, Pt, RoomA, StairsA, WallA, WindowA } from '../types';
import { fmtArea, fmtCm, fmtLen, fmtNum } from '../units';
import {
  arrowHead,
  constrainToNeighbor,
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
  type ParamDef,
} from './registry';

// ---------- Hilfsfunktionen für platzierte Elemente ----------

export function toLocal(a: PlacedBase, p: Pt): Pt {
  const q = rot(sub(p, a.p), -a.angle * DEG);
  return a.mirror ? { x: -q.x, y: q.y } : q;
}

export function toPage(a: PlacedBase, p: Pt): Pt {
  return applyMat(matPlace(a.p, a.angle, a.mirror), p);
}

export function placePrims(a: PlacedBase, local: Prim[]): Prim[] {
  return transformPrims(local, matPlace(a.p, a.angle, a.mirror), a.angle);
}

const roundTo = (v: number, step: number) => Math.round(v / step) * step;

export function rotateFromHandle(a: PlacedBase, p: Pt, mods: Mods): number {
  let deg = (Math.atan2(p.y - a.p.y, p.x - a.p.x) * 180) / Math.PI + 90;
  if (mods.shift) deg = roundTo(deg, 15);
  else {
    const r = roundTo(deg, 90);
    if (Math.abs(r - deg) < 3) deg = r;
  }
  deg = ((deg % 360) + 360) % 360;
  return Math.round(deg * 100) / 100;
}

/** Gemeinsame Handles: Drehgriff oberhalb, Größengriff an der Ecke. */
export function placedHandles(a: PlacedBase, halfW: number, halfD: number, size: 'corner' | 'width' | null): Handle[] {
  const h: Handle[] = [{ p: toPage(a, { x: 0, y: -halfD - mm(6) }), type: 'rotate' }];
  if (size === 'corner') h.push({ p: toPage(a, { x: halfW, y: halfD }), type: 'size' });
  if (size === 'width') h.push({ p: toPage(a, { x: halfW, y: 0 }), type: 'size' });
  return h;
}

export const ANGLE_PARAM: ParamDef = { key: 'angle', label: 'Drehung', type: 'angle' };
export const MIRROR_PARAM = (label = 'Spiegeln'): ParamDef => ({ key: 'mirror', label, type: 'bool' });

/** Schraffur (45°-Linien), auf Ringe geclippt (gerade-ungerade-Regel). */
export function hatchSegments(rings: Pt[][], spacing: number, angleDeg = 45): PathBuilder {
  const pb = new PathBuilder();
  const a = -angleDeg * DEG;
  const rr = rings.map((r) => r.map((p) => rot(p, a)));
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const r of rr)
    for (const p of r) {
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
  if (!Number.isFinite(y0) || y1 - y0 > spacing * 4000) return pb;
  const back = (x: number, y: number) => rot({ x, y }, -a);
  for (let y = Math.ceil(y0 / spacing) * spacing; y < y1; y += spacing) {
    const xs: number[] = [];
    for (const r of rr) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const p = r[i];
        const q = r[j];
        if (p.y > y !== q.y > y) xs.push(p.x + ((y - p.y) * (q.x - p.x)) / (q.y - p.y));
      }
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) pb.line(back(xs[i], y), back(xs[i + 1], y));
  }
  return pb;
}

// ---------- Wand ----------

export function wallOffsets(a: WallA, ctx: Ctx): [number, number] {
  const t = a.thickness * ctx.ptPerM;
  if (a.align === 'left') return [0, -t];
  if (a.align === 'right') return [t, 0];
  return [t / 2, -t / 2];
}

export function wallRings(a: WallA, ctx: Ctx): Pt[][] {
  const [oL, oR] = wallOffsets(a, ctx);
  const closed = a.closed && a.pts.length > 2;
  const L = offsetPolyline(a.pts, oL, closed);
  const R = offsetPolyline(a.pts, oR, closed);
  if (closed) return [L, R];
  return [[...L, ...R.reverse()]];
}

register<WallA>({
  kind: 'wall',
  label: 'Wand',
  styleKeys: ['stroke', 'fill', 'width', 'opacity'],
  params: [
    { key: 'thickness', label: 'Wandstärke', type: 'length', min: 0.01, max: 3, presets: [0.1, 0.115, 0.175, 0.24, 0.3, 0.365, 0.49] },
    {
      key: 'align',
      label: 'Bezugslinie',
      type: 'select',
      options: [
        ['center', 'Wandachse (Mitte)'],
        ['left', 'linke Wandseite'],
        ['right', 'rechte Wandseite'],
      ],
    },
    {
      key: 'fillMode',
      label: 'Füllung',
      type: 'select',
      options: [
        ['solid', 'voll (Schnitt)'],
        ['hatch', 'schraffiert'],
        ['none', 'leer'],
      ],
    },
    { key: 'closed', label: 'Geschlossen (Umfassung)', type: 'bool' },
  ],
  prims(a, ctx) {
    if (a.pts.length < 2) return [];
    const rings = wallRings(a, ctx);
    const out: Prim[] = [];
    const outline = new PathBuilder();
    for (const r of rings) outline.poly(r, true);
    const w = mm(a.style.width);
    if (a.fillMode === 'solid') {
      out.push(path(outline, { fill: a.style.fill || a.style.stroke, stroke: a.style.stroke, width: w, evenOdd: true, join: 'miter' }));
    } else {
      out.push(path(outline, { fill: '#ffffff', stroke: a.style.stroke, width: w, evenOdd: true, join: 'miter' }));
      if (a.fillMode === 'hatch') {
        out.push(path(hatchSegments(rings, mm(1.2)), { stroke: a.style.stroke, width: Math.max(0.25, w * 0.4), noHit: true }));
      }
    }
    return out;
  },
  handles: (a) => vertexHandles(a.pts),
  moveHandle: (a, i, p, _c, mods) => ({ ...a, pts: replaceAt(a.pts, i, constrainToNeighbor(a.pts, i, p, mods)) }),
  translate: (a, d) => ({ ...a, pts: translatePts(a.pts, d) }),
  info(a, ctx) {
    const rings = wallRings(a, ctx);
    let area = Math.abs(signedArea(rings[0]));
    if (rings[1]) area = Math.abs(area - Math.abs(signedArea(rings[1])));
    return [
      `Länge (Bezugslinie): ${fmtLen(polylineLength(a.pts, a.closed) / ctx.ptPerM, ctx.settings)}`,
      `Grundfläche: ${fmtArea(area / (ctx.ptPerM * ctx.ptPerM))}`,
    ];
  },
});

// ---------- Tür ----------

function openingMask(W: number, T: number): Prim {
  const e = mm(0.35);
  return path(new PathBuilder().rect(-W / 2, -T / 2 - e, W, T + 2 * e), { fill: '#ffffff', stroke: null, width: 0, mask: true });
}

register<DoorA>({
  kind: 'door',
  label: 'Tür',
  styleKeys: ['stroke', 'width', 'opacity'],
  params: [
    {
      key: 'doorType',
      label: 'Türart',
      type: 'select',
      options: [
        ['single', 'Drehtür, 1-flügelig'],
        ['double', 'Drehtür, 2-flügelig'],
        ['sliding', 'Schiebetür'],
      ],
    },
    { key: 'width', label: 'Breite (licht)', type: 'length', min: 0.3, max: 6, presets: [0.635, 0.76, 0.885, 1.01, 1.135, 1.26, 1.51, 1.76, 2.01] },
    { key: 'height', label: 'Höhe', type: 'length', min: 1, max: 5, presets: [1.985, 2.01, 2.11, 2.135, 2.26] },
    { key: 'wall', label: 'Wanddicke', type: 'length', min: 0.02, max: 2, presets: [0.115, 0.175, 0.24, 0.3, 0.365] },
    { key: 'mirror', label: 'Anschlag links/rechts tauschen', type: 'bool' },
    { key: 'flip', label: 'Aufschlag zur anderen Seite', type: 'bool' },
    ANGLE_PARAM,
    { key: 'showLabel', label: 'Maße beschriften', type: 'bool' },
    { key: 'textSize', label: 'Schriftgröße', type: 'pt', min: 3, max: 72, step: 0.5 },
  ],
  prims(a, ctx) {
    const W = a.width * ctx.ptPerM;
    const T = a.wall * ctx.ptPerM;
    const s = a.flip ? -1 : 1;
    const w = mm(a.style.width);
    const thin = Math.max(mm(0.13), w * 0.5);
    const col = a.style.stroke;
    const local: Prim[] = [openingMask(W, T)];
    const jambs = new PathBuilder().line({ x: -W / 2, y: -T / 2 }, { x: -W / 2, y: T / 2 }).line({ x: W / 2, y: -T / 2 }, { x: W / 2, y: T / 2 });
    local.push(path(jambs, { stroke: col, width: w }));
    const y0 = (s * T) / 2;
    const leafT = Math.max(mm(0.6), 0.04 * ctx.ptPerM);
    const leaf = (hx: number, dirX: number, L: number) => {
      // Türblatt (90° geöffnet) + Öffnungsbogen
      const lb = new PathBuilder().rect(Math.min(hx, hx + dirX * leafT), Math.min(y0, y0 + s * L), leafT, L);
      local.push(path(lb, { stroke: col, width: w, fill: '#ffffff' }));
      const a0 = s > 0 ? 90 : -90;
      const arc = new PathBuilder();
      if (dirX > 0) arc.arc(hx, y0, L, a0, 0);
      else arc.arc(hx, y0, L, 180 - a0, 180);
      local.push(path(arc, { stroke: col, width: thin }));
    };
    if (a.doorType === 'single') leaf(-W / 2, 1, W);
    else if (a.doorType === 'double') {
      leaf(-W / 2, 1, W / 2);
      leaf(W / 2, -1, W / 2);
    } else {
      // Schiebetür: Blatt vor der Wand, Pfeil zeigt Öffnungsrichtung
      const yl = y0 + s * mm(0.4);
      const lb = new PathBuilder().rect(-W / 2 - mm(1), Math.min(yl, yl + s * leafT), W + mm(1), leafT);
      local.push(path(lb, { stroke: col, width: w, fill: '#ffffff' }));
      const ya = yl + s * (leafT + mm(1.5));
      local.push(path(new PathBuilder().line({ x: W * 0.3, y: ya }, { x: -W * 0.25, y: ya }), { stroke: col, width: thin }));
      local.push(arrowHead({ x: -W * 0.3, y: ya }, { x: W * 0.3, y: ya }, mm(1.6), col));
    }
    if (a.showLabel) {
      const ly = -s * (T / 2 + mm(1.2));
      local.push(
        text({ x: 0, y: ly }, `${fmtCm(a.width)}/${fmtCm(a.height)}`, {
          size: a.textSize,
          color: col,
          valign: s > 0 ? 'bottom' : 'top',
          bg: null,
        }),
      );
    }
    return placePrims(a, local);
  },
  handles: (a, ctx) => placedHandles(a, (a.width * ctx.ptPerM) / 2, (a.wall * ctx.ptPerM) / 2 + (a.doorType !== 'sliding' && a.flip ? a.width * ctx.ptPerM : 0), 'width'),
  moveHandle(a, i, p, ctx, mods) {
    if (i === 0) return { ...a, angle: rotateFromHandle(a, p, mods) };
    const l = toLocal(a, p);
    return { ...a, width: Math.max(0.3, roundTo((2 * Math.abs(l.x)) / ctx.ptPerM, mods.shift ? 0.125 : 0.005)) };
  },
  translate: (a, d) => ({ ...a, p: translatePt(a.p, d) }),
  info: (a, ctx) => [`Breite ${fmtLen(a.width, ctx.settings)} · Höhe ${fmtLen(a.height, ctx.settings)}`],
});

// ---------- Fenster ----------

register<WindowA>({
  kind: 'window',
  label: 'Fenster',
  styleKeys: ['stroke', 'width', 'opacity'],
  params: [
    { key: 'width', label: 'Breite', type: 'length', min: 0.2, max: 10, presets: [0.51, 0.635, 0.76, 0.885, 1.01, 1.26, 1.51, 2.01] },
    { key: 'height', label: 'Höhe', type: 'length', min: 0.2, max: 6, presets: [0.625, 0.875, 1.01, 1.135, 1.26, 1.385, 2.01, 2.26] },
    { key: 'sill', label: 'Brüstungshöhe', type: 'length', min: 0, max: 3, presets: [0, 0.5, 0.8, 0.9, 1.0, 1.1] },
    { key: 'wall', label: 'Wanddicke', type: 'length', min: 0.02, max: 2, presets: [0.115, 0.175, 0.24, 0.3, 0.365] },
    { key: 'panes', label: 'Flügel', type: 'int', min: 1, max: 8 },
    ANGLE_PARAM,
    { key: 'showLabel', label: 'Maße beschriften', type: 'bool' },
    { key: 'textSize', label: 'Schriftgröße', type: 'pt', min: 3, max: 72, step: 0.5 },
  ],
  prims(a, ctx) {
    const W = a.width * ctx.ptPerM;
    const T = a.wall * ctx.ptPerM;
    const w = mm(a.style.width);
    const thin = Math.max(mm(0.13), w * 0.5);
    const col = a.style.stroke;
    const local: Prim[] = [openingMask(W, T)];
    local.push(path(new PathBuilder().line({ x: -W / 2, y: -T / 2 }, { x: -W / 2, y: T / 2 }).line({ x: W / 2, y: -T / 2 }, { x: W / 2, y: T / 2 }), { stroke: col, width: w }));
    // Fensterbank/Laibungslinien
    local.push(path(new PathBuilder().line({ x: -W / 2, y: -T / 2 }, { x: W / 2, y: -T / 2 }).line({ x: -W / 2, y: T / 2 }, { x: W / 2, y: T / 2 }), { stroke: col, width: thin }));
    // Rahmen/Glas
    const g = Math.max(mm(0.35), T * 0.1);
    const glass = new PathBuilder().line({ x: -W / 2, y: -g }, { x: W / 2, y: -g }).line({ x: -W / 2, y: g }, { x: W / 2, y: g });
    const n = Math.max(1, Math.round(a.panes));
    for (let i = 1; i < n; i++) {
      const x = -W / 2 + (W * i) / n;
      glass.line({ x, y: -g }, { x, y: g });
    }
    local.push(path(glass, { stroke: col, width: w }));
    if (a.showLabel) {
      local.push(
        text({ x: 0, y: -T / 2 - mm(1.2) }, `${fmtCm(a.width)}/${fmtCm(a.height)}\nBRH ${fmtCm(a.sill)}`, {
          size: a.textSize,
          color: col,
          valign: 'bottom',
        }),
      );
    }
    return placePrims(a, local);
  },
  handles: (a, ctx) => placedHandles(a, (a.width * ctx.ptPerM) / 2, (a.wall * ctx.ptPerM) / 2 + mm(4), 'width'),
  moveHandle(a, i, p, ctx, mods) {
    if (i === 0) return { ...a, angle: rotateFromHandle(a, p, mods) };
    const l = toLocal(a, p);
    return { ...a, width: Math.max(0.2, roundTo((2 * Math.abs(l.x)) / ctx.ptPerM, mods.shift ? 0.125 : 0.005)) };
  },
  translate: (a, d) => ({ ...a, p: translatePt(a.p, d) }),
  info: (a, ctx) => [`Breite ${fmtLen(a.width, ctx.settings)} · Höhe ${fmtLen(a.height, ctx.settings)}`, `Brüstung ${fmtLen(a.sill, ctx.settings)}`],
});

// ---------- Treppe ----------

register<StairsA>({
  kind: 'stairs',
  label: 'Treppe',
  styleKeys: ['stroke', 'width', 'opacity'],
  params: [
    { key: 'width', label: 'Laufbreite', type: 'length', min: 0.5, max: 6, presets: [0.8, 0.9, 1.0, 1.1, 1.2] },
    { key: 'length', label: 'Lauflänge', type: 'length', min: 0.5, max: 20 },
    { key: 'steps', label: 'Steigungen', type: 'int', min: 2, max: 40 },
    { key: 'rise', label: 'Geschosshöhe', type: 'length', min: 0.2, max: 10, presets: [2.75, 2.8, 2.9, 3.0] },
    { key: 'mirror', label: 'Laufrichtung umkehren', type: 'bool' },
    ANGLE_PARAM,
    { key: 'showLabel', label: 'Steigungsverhältnis anzeigen', type: 'bool' },
    { key: 'textSize', label: 'Schriftgröße', type: 'pt', min: 3, max: 72, step: 0.5 },
  ],
  prims(a, ctx) {
    const L = a.length * ctx.ptPerM;
    const B = a.width * ctx.ptPerM;
    const n = Math.max(2, Math.round(a.steps));
    const w = mm(a.style.width);
    const thin = Math.max(mm(0.13), w * 0.6);
    const col = a.style.stroke;
    const local: Prim[] = [];
    local.push(path(new PathBuilder().rect(-L / 2, -B / 2, L, B), { stroke: col, width: w, fill: '#ffffff' }));
    const st = new PathBuilder();
    // n Steigungen → n-1 Auftritte im Grundriss (letzte Stufe = Austritt)
    const treads = n - 1;
    for (let i = 1; i < treads; i++) {
      const x = -L / 2 + (L * i) / treads;
      st.line({ x, y: -B / 2 }, { x, y: B / 2 });
    }
    local.push(path(st, { stroke: col, width: thin }));
    // Lauflinie
    const t = L / treads;
    const xs = -L / 2 + t / 2;
    const xe = L / 2 - mm(0.2);
    local.push(path(new PathBuilder().line({ x: xs, y: 0 }, { x: xe - mm(1.5), y: 0 }), { stroke: col, width: thin }));
    local.push(path(new PathBuilder().circle(xs, 0, Math.min(mm(0.9), t * 0.3)), { stroke: col, width: thin, fill: '#ffffff' }));
    local.push(arrowHead({ x: xe, y: 0 }, { x: xs, y: 0 }, mm(2), col));
    if (a.showLabel) {
      const h = (a.rise / n) * 100;
      const g = (a.length / treads) * 100;
      local.push(
        text({ x: 0, y: B / 2 + mm(1) }, `${n} Stg. ${fmtNum(h, 1)}/${fmtNum(g, 1)}`, { size: a.textSize, color: col, valign: 'top' }),
      );
    }
    return placePrims(a, local);
  },
  handles: (a, ctx) => placedHandles(a, (a.length * ctx.ptPerM) / 2, (a.width * ctx.ptPerM) / 2, 'corner'),
  moveHandle(a, i, p, ctx, mods) {
    if (i === 0) return { ...a, angle: rotateFromHandle(a, p, mods) };
    const l = toLocal(a, p);
    return {
      ...a,
      length: Math.max(0.5, roundTo((2 * Math.abs(l.x)) / ctx.ptPerM, 0.01)),
      width: Math.max(0.5, roundTo((2 * Math.abs(l.y)) / ctx.ptPerM, 0.01)),
    };
  },
  translate: (a, d) => ({ ...a, p: translatePt(a.p, d) }),
  info(a, ctx) {
    const n = Math.max(2, Math.round(a.steps));
    const h = a.rise / n;
    const g = a.length / (n - 1);
    const sm = 2 * h + g;
    return [
      `Steigung ${fmtNum(h * 100, 1)} cm · Auftritt ${fmtNum(g * 100, 1)} cm`,
      `Schrittmaß 2s+a = ${fmtNum(sm * 100, 1)} cm ${sm >= 0.59 && sm <= 0.65 ? '✓' : '(Ziel 59–65)'}`,
      `Fläche ${fmtLen(a.length, ctx.settings, false)} × ${fmtLen(a.width, ctx.settings)}`,
    ];
  },
});

// ---------- Raum ----------

register<RoomA>({
  kind: 'room',
  label: 'Raum',
  styleKeys: ['stroke', 'fill', 'width', 'dash', 'opacity'],
  params: [
    { key: 'name', label: 'Raumname', type: 'text' },
    { key: 'showArea', label: 'Fläche anzeigen', type: 'bool' },
    { key: 'showPerimeter', label: 'Umfang anzeigen', type: 'bool' },
    { key: 'height', label: 'Lichte Höhe (0 = aus)', type: 'length', min: 0, max: 20 },
    { key: 'textSize', label: 'Schriftgröße', type: 'pt', min: 3, max: 72, step: 0.5 },
  ],
  prims(a, ctx) {
    const out: Prim[] = [];
    if (a.pts.length < 3) return [strokeOf(a.style, new PathBuilder().poly(a.pts, false))];
    out.push(strokeOf(a.style, new PathBuilder().poly(a.pts, true), { fill: true }));
    const lp = a.label ?? labelPoint(a.pts);
    const lines: string[] = [];
    if (a.showArea) lines.push(fmtArea(Math.abs(signedArea(a.pts)) / (ctx.ptPerM * ctx.ptPerM)));
    if (a.showPerimeter) lines.push(`U ${fmtLen(polylineLength(a.pts, true) / ctx.ptPerM, ctx.settings)}`);
    if (a.height > 0) lines.push(`LH ${fmtLen(a.height, ctx.settings)}`);
    const col = a.style.stroke;
    const nameSize = a.textSize * 1.15;
    const gap = a.textSize * 0.25;
    const totalH = (a.name ? nameSize * 1.1 : 0) + lines.length * a.textSize * 1.2;
    let y = lp.y - totalH / 2;
    if (a.name) {
      out.push(text({ x: lp.x, y }, a.name, { size: nameSize, bold: true, color: col, valign: 'top', pad: gap }));
      y += nameSize * 1.1;
    }
    if (lines.length) out.push(text({ x: lp.x, y }, lines.join('\n'), { size: a.textSize, color: col, valign: 'top', pad: gap }));
    return out;
  },
  handles: (a) => [...vertexHandles(a.pts), { p: a.label ?? labelPoint(a.pts), type: 'label' }],
  moveHandle(a, i, p, _c, mods) {
    if (i === a.pts.length) return { ...a, label: p };
    return { ...a, pts: replaceAt(a.pts, i, constrainToNeighbor(a.pts, i, p, mods)) };
  },
  translate: (a, d) => ({ ...a, pts: translatePts(a.pts, d), label: a.label ? translatePt(a.label, d) : null }),
  info: (a, ctx) => [
    `Fläche: ${fmtArea(Math.abs(signedArea(a.pts)) / (ctx.ptPerM * ctx.ptPerM))}`,
    `Umfang: ${fmtLen(polylineLength(a.pts, true) / ctx.ptPerM, ctx.settings)}`,
    ...(a.height > 0 ? [`Volumen: ${fmtNum((Math.abs(signedArea(a.pts)) / (ctx.ptPerM * ctx.ptPerM)) * a.height, 2)} m³`] : []),
  ],
});

// ---------- Stütze ----------

register<ColumnA>({
  kind: 'column',
  label: 'Stütze',
  styleKeys: ['stroke', 'fill', 'width', 'opacity'],
  params: [
    { key: 'round', label: 'Rund', type: 'bool' },
    { key: 'w', label: 'Breite / Durchmesser', type: 'length', min: 0.05, max: 5, presets: [0.2, 0.24, 0.25, 0.3, 0.365, 0.4] },
    { key: 'd', label: 'Tiefe', type: 'length', min: 0.05, max: 5, presets: [0.2, 0.24, 0.25, 0.3, 0.365, 0.4] },
    {
      key: 'fillMode',
      label: 'Füllung',
      type: 'select',
      options: [
        ['solid', 'voll'],
        ['hatch', 'schraffiert'],
        ['none', 'leer'],
      ],
    },
    ANGLE_PARAM,
  ],
  prims(a, ctx) {
    const W = a.w * ctx.ptPerM;
    const D = (a.round ? a.w : a.d) * ctx.ptPerM;
    const w = mm(a.style.width);
    const pb = new PathBuilder();
    if (a.round) pb.circle(0, 0, W / 2);
    else pb.rect(-W / 2, -D / 2, W, D);
    const local: Prim[] = [];
    const fill = a.fillMode === 'solid' ? a.style.fill || a.style.stroke : '#ffffff';
    local.push(path(pb, { stroke: a.style.stroke, fill, width: w }));
    if (a.fillMode === 'hatch') {
      const ring = a.round
        ? Array.from({ length: 32 }, (_, i) => ({ x: (Math.cos((i / 32) * 2 * Math.PI) * W) / 2, y: (Math.sin((i / 32) * 2 * Math.PI) * W) / 2 }))
        : [
            { x: -W / 2, y: -D / 2 },
            { x: W / 2, y: -D / 2 },
            { x: W / 2, y: D / 2 },
            { x: -W / 2, y: D / 2 },
          ];
      local.push(path(hatchSegments([ring], mm(1)), { stroke: a.style.stroke, width: Math.max(0.25, w * 0.4), noHit: true }));
      if (a.round) local.push(path(new PathBuilder().circle(0, 0, W / 2), { stroke: a.style.stroke, width: w }));
    }
    return placePrims(a, local);
  },
  handles: (a, ctx) => placedHandles(a, (a.w * ctx.ptPerM) / 2, ((a.round ? a.w : a.d) * ctx.ptPerM) / 2, 'corner'),
  moveHandle(a, i, p, ctx, mods) {
    if (i === 0) return { ...a, angle: rotateFromHandle(a, p, mods) };
    const l = toLocal(a, p);
    const w = Math.max(0.05, roundTo((2 * Math.abs(l.x)) / ctx.ptPerM, 0.005));
    const d = Math.max(0.05, roundTo((2 * Math.abs(l.y)) / ctx.ptPerM, 0.005));
    return a.round ? { ...a, w: Math.max(w, d) } : { ...a, w, d };
  },
  translate: (a, d) => ({ ...a, p: translatePt(a.p, d) }),
  info: (a, ctx) => [a.round ? `Ø ${fmtLen(a.w, ctx.settings)}` : `${fmtLen(a.w, ctx.settings, false)} × ${fmtLen(a.d, ctx.settings)}`],
});

