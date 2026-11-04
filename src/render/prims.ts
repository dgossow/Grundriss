// Zeichenprimitive: Jedes Element wird in Pfade und Texte zerlegt. Daraus erzeugen
// sowohl der Bildschirm-Renderer (SVG) als auch der PDF-Export ihre Ausgabe.
import { CAP_HEIGHT, DESCENT, LINE_HEIGHT, textWidth } from '../font';
import { bboxOf, DEG, type Rect } from '../geom';
import type { Pt } from '../types';

export type Seg =
  | ['M', number, number]
  | ['L', number, number]
  | ['C', number, number, number, number, number, number]
  | ['Z'];

export interface PathPrim {
  t: 'path';
  d: Seg[];
  stroke: string | null;
  fill: string | null;
  /** Linienbreite in pt */
  width: number;
  dash: number[] | null;
  cap: 'butt' | 'round' | 'square';
  join: 'miter' | 'round' | 'bevel';
  evenOdd?: boolean;
  /** nicht für Auswahl/Fang verwenden */
  noHit?: boolean;
  /** deckende Fläche (z. B. Wandöffnung) – nicht als Fangpunkt nutzen */
  mask?: boolean;
}

export interface TextPrim {
  t: 'text';
  x: number;
  y: number;
  /** Drehung in Grad (im Uhrzeigersinn) */
  angle: number;
  lines: string[];
  size: number;
  bold: boolean;
  color: string;
  align: 'start' | 'middle' | 'end';
  valign: 'top' | 'middle' | 'bottom';
  bg: string | null;
  frame: string | null;
  frameWidth: number;
  pad: number;
}

export type Prim = PathPrim | TextPrim;

export class PathBuilder {
  d: Seg[] = [];
  M(p: Pt) {
    this.d.push(['M', p.x, p.y]);
    return this;
  }
  L(p: Pt) {
    this.d.push(['L', p.x, p.y]);
    return this;
  }
  C(c1: Pt, c2: Pt, p: Pt) {
    this.d.push(['C', c1.x, c1.y, c2.x, c2.y, p.x, p.y]);
    return this;
  }
  Z() {
    this.d.push(['Z']);
    return this;
  }
  line(a: Pt, b: Pt) {
    return this.M(a).L(b);
  }
  poly(pts: Pt[], closed: boolean) {
    if (!pts.length) return this;
    this.M(pts[0]);
    for (let i = 1; i < pts.length; i++) this.L(pts[i]);
    if (closed) this.Z();
    return this;
  }
  rect(x: number, y: number, w: number, h: number) {
    return this.poly(
      [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ],
      true,
    );
  }
  roundRect(x: number, y: number, w: number, h: number, r: number) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    if (r < 1e-6) return this.rect(x, y, w, h);
    this.M({ x: x + r, y });
    this.L({ x: x + w - r, y });
    this.arc(x + w - r, y + r, r, -90, 0, false);
    this.L({ x: x + w, y: y + h - r });
    this.arc(x + w - r, y + h - r, r, 0, 90, false);
    this.L({ x: x + r, y: y + h });
    this.arc(x + r, y + h - r, r, 90, 180, false);
    this.L({ x, y: y + r });
    this.arc(x + r, y + r, r, 180, 270, false);
    return this.Z();
  }
  ellipse(cx: number, cy: number, rx: number, ry: number) {
    const k = 0.5522847498;
    this.M({ x: cx + rx, y: cy });
    this.C({ x: cx + rx, y: cy + ry * k }, { x: cx + rx * k, y: cy + ry }, { x: cx, y: cy + ry });
    this.C({ x: cx - rx * k, y: cy + ry }, { x: cx - rx, y: cy + ry * k }, { x: cx - rx, y: cy });
    this.C({ x: cx - rx, y: cy - ry * k }, { x: cx - rx * k, y: cy - ry }, { x: cx, y: cy - ry });
    this.C({ x: cx + rx * k, y: cy - ry }, { x: cx + rx, y: cy - ry * k }, { x: cx + rx, y: cy });
    return this.Z();
  }
  circle(cx: number, cy: number, r: number) {
    return this.ellipse(cx, cy, r, r);
  }
  /** Kreisbogen von a0 nach a1 (Grad, im Uhrzeigersinn bei y nach unten). */
  arc(cx: number, cy: number, r: number, a0: number, a1: number, move = true) {
    const total = a1 - a0;
    const n = Math.max(1, Math.ceil(Math.abs(total) / 90));
    const step = (total / n) * DEG;
    let a = a0 * DEG;
    const p0 = { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    if (move) this.M(p0);
    else this.L(p0);
    const k = (4 / 3) * Math.tan(step / 4);
    for (let i = 0; i < n; i++) {
      const b = a + step;
      const c1 = { x: cx + r * (Math.cos(a) - k * Math.sin(a)), y: cy + r * (Math.sin(a) + k * Math.cos(a)) };
      const c2 = { x: cx + r * (Math.cos(b) + k * Math.sin(b)), y: cy + r * (Math.sin(b) - k * Math.cos(b)) };
      this.C(c1, c2, { x: cx + r * Math.cos(b), y: cy + r * Math.sin(b) });
      a = b;
    }
    return this;
  }
}

export interface StrokeOpts {
  stroke?: string | null;
  fill?: string | null;
  width?: number;
  dash?: number[] | null;
  cap?: PathPrim['cap'];
  join?: PathPrim['join'];
  evenOdd?: boolean;
  noHit?: boolean;
  mask?: boolean;
}

export function path(pb: PathBuilder | Seg[], o: StrokeOpts): PathPrim {
  return {
    t: 'path',
    d: Array.isArray(pb) ? pb : pb.d,
    stroke: o.stroke === undefined ? null : o.stroke,
    fill: o.fill === undefined ? null : o.fill,
    width: o.width ?? 0.5,
    dash: o.dash ?? null,
    cap: o.cap ?? 'butt',
    join: o.join ?? 'miter',
    evenOdd: o.evenOdd,
    noHit: o.noHit,
    mask: o.mask,
  };
}

export interface TextOpts {
  angle?: number;
  size: number;
  bold?: boolean;
  color: string;
  align?: TextPrim['align'];
  valign?: TextPrim['valign'];
  bg?: string | null;
  frame?: string | null;
  frameWidth?: number;
  pad?: number;
}

export function text(p: Pt, content: string, o: TextOpts): TextPrim {
  return {
    t: 'text',
    x: p.x,
    y: p.y,
    angle: o.angle ?? 0,
    lines: content.split('\n'),
    size: o.size,
    bold: !!o.bold,
    color: o.color,
    align: o.align ?? 'middle',
    valign: o.valign ?? 'middle',
    bg: o.bg ?? null,
    frame: o.frame ?? null,
    frameWidth: o.frameWidth ?? 0.4,
    pad: o.pad ?? o.size * 0.25,
  };
}

/** Lesbarkeit: Text nie auf dem Kopf (Winkel auf (-90°, 90°] normieren). */
export function readableAngle(deg: number): number {
  let a = ((deg % 360) + 360) % 360;
  if (a > 90 && a <= 270) a -= 180;
  if (a > 270) a -= 360;
  return a;
}

/** Layout eines Textprimitivs im lokalen (ungedrehten) Koordinatensystem. */
export function textLayout(t: TextPrim) {
  const lh = t.size * LINE_HEIGHT;
  const widths = t.lines.map((l) => textWidth(l, t.size, t.bold));
  const w = Math.max(0, ...widths);
  const h = (t.lines.length - 1) * lh + t.size * (CAP_HEIGHT + DESCENT);
  let top: number;
  if (t.valign === 'top') top = 0;
  else if (t.valign === 'bottom') top = -h;
  else top = -h / 2;
  let left: number;
  if (t.align === 'start') left = 0;
  else if (t.align === 'end') left = -w;
  else left = -w / 2;
  const lines = t.lines.map((s, i) => {
    const lw = widths[i];
    const x = t.align === 'start' ? left : t.align === 'end' ? left + w - lw : left + (w - lw) / 2;
    return { s, x, y: top + t.size * CAP_HEIGHT + i * lh };
  });
  const box = { x: left - t.pad, y: top - t.pad, w: w + 2 * t.pad, h: h + 2 * t.pad };
  return { lines, box, w, h };
}

export type Mat = [number, number, number, number, number, number];

export function matPlace(p: Pt, angleDeg: number, mirror: boolean): Mat {
  const a = angleDeg * DEG;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const mx = mirror ? -1 : 1;
  return [c * mx, s * mx, -s, c, p.x, p.y];
}

export function applyMat(m: Mat, p: Pt): Pt {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** Transformiert Primitive; Texte werden nur verschoben/gedreht (nie gespiegelt). */
export function transformPrims(prims: Prim[], m: Mat, textAngle: number): Prim[] {
  return prims.map((pr) => {
    if (pr.t === 'text') {
      const p = applyMat(m, pr);
      return { ...pr, x: p.x, y: p.y, angle: readableAngle(pr.angle + textAngle) };
    }
    const d: Seg[] = pr.d.map((s) => {
      if (s[0] === 'Z') return s;
      if (s[0] === 'C') {
        const a = applyMat(m, { x: s[1], y: s[2] });
        const b = applyMat(m, { x: s[3], y: s[4] });
        const c = applyMat(m, { x: s[5], y: s[6] });
        return ['C', a.x, a.y, b.x, b.y, c.x, c.y];
      }
      const p = applyMat(m, { x: s[1], y: s[2] });
      return [s[0], p.x, p.y];
    });
    return { ...pr, d };
  });
}

/** Zerlegt Pfade in Polylinien (Bézierkurven abgetastet). */
export function flattenPath(d: Seg[], steps = 8): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  let start: Pt | null = null;
  let last: Pt = { x: 0, y: 0 };
  for (const s of d) {
    if (s[0] === 'M') {
      if (cur.length > 1) out.push(cur);
      last = { x: s[1], y: s[2] };
      start = last;
      cur = [last];
    } else if (s[0] === 'L') {
      last = { x: s[1], y: s[2] };
      cur.push(last);
    } else if (s[0] === 'C') {
      const p0 = last;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const mt = 1 - t;
        cur.push({
          x: mt * mt * mt * p0.x + 3 * mt * mt * t * s[1] + 3 * mt * t * t * s[3] + t * t * t * s[5],
          y: mt * mt * mt * p0.y + 3 * mt * mt * t * s[2] + 3 * mt * t * t * s[4] + t * t * t * s[6],
        });
      }
      last = { x: s[5], y: s[6] };
    } else if (s[0] === 'Z') {
      if (start) {
        cur.push(start);
        last = start;
      }
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

export function textCorners(t: TextPrim): Pt[] {
  const { box } = textLayout(t);
  const a = t.angle * DEG;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x + box.w, y: box.y + box.h },
    { x: box.x, y: box.y + box.h },
  ].map((p) => ({ x: t.x + p.x * c - p.y * s, y: t.y + p.x * s + p.y * c }));
}

export function primsBBox(prims: Prim[]): Rect {
  const pts: Pt[] = [];
  for (const p of prims) {
    if (p.t === 'text') pts.push(...textCorners(p));
    else {
      const pad = p.stroke ? p.width / 2 : 0;
      for (const poly of flattenPath(p.d, 4))
        for (const q of poly) {
          pts.push({ x: q.x - pad, y: q.y - pad }, { x: q.x + pad, y: q.y + pad });
        }
    }
  }
  return bboxOf(pts);
}
