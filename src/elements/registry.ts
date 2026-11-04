import { add, DEG, MM_TO_PT, norm, sub, mul, leftNormal, dist } from '../geom';
import { PathBuilder, path, type Prim } from '../render/prims';
import type { Annot, Dash, Kind, Pt, Settings, Style } from '../types';

export interface Ctx {
  ptPerM: number;
  settings: Settings;
}

export type HandleType = 'vertex' | 'corner' | 'rotate' | 'offset' | 'size' | 'label' | 'end';

export interface Handle {
  p: Pt;
  type: HandleType;
}

export interface Mods {
  shift: boolean;
  alt: boolean;
}

export type ParamType = 'length' | 'number' | 'int' | 'angle' | 'select' | 'bool' | 'text' | 'textarea' | 'pt' | 'mm';

export interface ParamDef {
  key: string;
  label: string;
  type: ParamType;
  options?: [string, string][];
  min?: number;
  max?: number;
  step?: number;
  /** Bei Längen: Vorschlagswerte (m) */
  presets?: number[];
}

export type StyleKey = 'stroke' | 'fill' | 'width' | 'dash' | 'opacity';

export interface ElementDef<A extends Annot = Annot> {
  kind: A['kind'];
  label: string;
  styleKeys: StyleKey[];
  params: ParamDef[];
  prims(a: A, ctx: Ctx): Prim[];
  handles(a: A, ctx: Ctx): Handle[];
  moveHandle(a: A, index: number, p: Pt, ctx: Ctx, mods: Mods): A;
  translate(a: A, d: Pt): A;
  info?(a: A, ctx: Ctx): string[];
}

export const mm = (v: number) => v * MM_TO_PT;

export function dashArray(d: Dash, widthPt: number): number[] | null {
  const f = Math.max(1, widthPt / mm(0.35));
  switch (d) {
    case 'dashed':
      return [mm(2) * f, mm(1) * f];
    case 'dotted':
      return [0, mm(0.8) * f];
    case 'dashdot':
      return [mm(3) * f, mm(0.8) * f, 0, mm(0.8) * f];
    default:
      return null;
  }
}

/** Standard-Strichprimitiv aus dem Stil eines Elements. */
export function strokeOf(style: Style, pb: PathBuilder, opts: { fill?: boolean; closed?: boolean; widthFactor?: number } = {}): Prim {
  const w = mm(style.width) * (opts.widthFactor ?? 1);
  return path(pb, {
    stroke: style.width > 0 ? style.stroke : null,
    fill: opts.fill ? style.fill : null,
    width: w,
    dash: dashArray(style.dash, w),
    cap: style.dash === 'dotted' ? 'round' : 'butt',
    join: 'miter',
  });
}

export function arrowHead(tip: Pt, from: Pt, sizePt: number, color: string): Prim {
  const d = norm(sub(tip, from));
  const n = leftNormal(d);
  const base = sub(tip, mul(d, sizePt));
  const pb = new PathBuilder()
    .M(tip)
    .L(add(base, mul(n, sizePt * 0.33)))
    .L(add(base, mul(n, -sizePt * 0.33)))
    .Z();
  return path(pb, { fill: color, stroke: null, width: 0 });
}

export function arrowSize(style: Style): number {
  return mm(2.2) + mm(style.width) * 3;
}

export const translatePt = (p: Pt, d: Pt): Pt => ({ x: p.x + d.x, y: p.y + d.y });
export const translatePts = (pts: Pt[], d: Pt): Pt[] => pts.map((p) => translatePt(p, d));

/** Handles für Elemente mit Punktliste. */
export function vertexHandles(pts: Pt[]): Handle[] {
  return pts.map((p) => ({ p, type: 'vertex' as const }));
}

export function replaceAt<T>(arr: T[], i: number, v: T): T[] {
  const c = arr.slice();
  c[i] = v;
  return c;
}

/** Shift: Punkt orthogonal/45° zum Nachbarpunkt ausrichten. */
export function constrainToNeighbor(pts: Pt[], i: number, p: Pt, mods: Mods): Pt {
  if (!mods.shift || pts.length < 2) return p;
  const nb = pts[i > 0 ? i - 1 : 1];
  const a = Math.atan2(p.y - nb.y, p.x - nb.x);
  const sa = Math.round(a / (45 * DEG)) * 45 * DEG;
  const l = dist(nb, p);
  return { x: nb.x + Math.cos(sa) * l, y: nb.y + Math.sin(sa) * l };
}

const registry = new Map<Kind, ElementDef<any>>();

export function register<A extends Annot>(def: ElementDef<A>) {
  registry.set(def.kind, def);
}

export function defOf<A extends Annot>(a: A | Kind): ElementDef<A> {
  const k = typeof a === 'string' ? a : a.kind;
  const d = registry.get(k);
  if (!d) throw new Error('Unbekannter Elementtyp: ' + k);
  return d;
}

export const DASH_OPTIONS: [string, string][] = [
  ['solid', 'durchgezogen'],
  ['dashed', 'gestrichelt'],
  ['dotted', 'gepunktet'],
  ['dashdot', 'Strich-Punkt'],
];
