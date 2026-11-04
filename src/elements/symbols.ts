// Einrichtungs- und Sanitärsymbole mit realen Abmessungen.
// Lokales System: x = Breite, y = Tiefe; Rückseite (Wand) bei y = -d/2.
import { PathBuilder, path, type Prim } from '../render/prims';
import type { SymbolA, SymbolKind } from '../types';
import { fmtLen } from '../units';
import { ANGLE_PARAM, MIRROR_PARAM, placedHandles, placePrims, rotateFromHandle, toLocal } from './plan';
import { mm, register, translatePt } from './registry';

export interface SymbolInfo {
  label: string;
  w: number;
  d: number;
}

export const SYMBOLS: Record<SymbolKind, SymbolInfo> = {
  bed: { label: 'Bett', w: 1.8, d: 2.0 },
  sofa: { label: 'Sofa', w: 2.2, d: 0.9 },
  table: { label: 'Tisch mit Stühlen', w: 1.6, d: 0.9 },
  wardrobe: { label: 'Schrank', w: 1.2, d: 0.6 },
  kitchen: { label: 'Küchenzeile', w: 2.4, d: 0.6 },
  wc: { label: 'WC', w: 0.4, d: 0.65 },
  sink: { label: 'Waschtisch', w: 0.6, d: 0.45 },
  shower: { label: 'Dusche', w: 0.9, d: 0.9 },
  bathtub: { label: 'Badewanne', w: 1.7, d: 0.75 },
  washer: { label: 'Waschmaschine', w: 0.6, d: 0.6 },
  car: { label: 'Pkw-Stellplatz', w: 2.5, d: 5.0 },
};

type Draw = (W: number, D: number, u: number, a: SymbolA) => { outline: PathBuilder; detail: PathBuilder; under?: PathBuilder };

/** u = Punkte pro Meter */
const DRAW: Record<SymbolKind, Draw> = {
  bed(W, D, u) {
    const outline = new PathBuilder().rect(-W / 2, -D / 2, W, D);
    const detail = new PathBuilder();
    const m = 0.07 * u;
    const ph = Math.min(0.35 * u, D * 0.2);
    const two = W >= 1.2 * u;
    if (two) {
      const pw = W / 2 - 1.5 * m;
      detail.roundRect(-W / 2 + m, -D / 2 + m, pw, ph, ph * 0.3);
      detail.roundRect(W / 2 - m - pw, -D / 2 + m, pw, ph, ph * 0.3);
    } else {
      detail.roundRect(-W / 2 + m, -D / 2 + m, W - 2 * m, ph, ph * 0.3);
    }
    const yb = -D / 2 + m * 2 + ph;
    const f = Math.min(0.35 * u, W * 0.25);
    detail.line({ x: -W / 2, y: yb }, { x: W / 2 - f, y: yb });
    detail.line({ x: W / 2 - f, y: yb }, { x: W / 2, y: yb + f });
    detail.line({ x: W / 2 - f, y: yb }, { x: W / 2 - f * 0.2, y: yb + f * 0.8 });
    return { outline, detail };
  },
  sofa(W, D, u) {
    const outline = new PathBuilder().roundRect(-W / 2, -D / 2, W, D, 0.05 * u);
    const detail = new PathBuilder();
    const b = Math.min(0.2 * u, D * 0.3);
    const arm = Math.min(0.2 * u, W * 0.15);
    detail.rect(-W / 2 + arm, -D / 2, W - 2 * arm, b);
    detail.line({ x: -W / 2 + arm, y: -D / 2 + b }, { x: -W / 2 + arm, y: D / 2 });
    detail.line({ x: W / 2 - arm, y: -D / 2 + b }, { x: W / 2 - arm, y: D / 2 });
    const inner = W - 2 * arm;
    const n = Math.max(1, Math.round(inner / (0.65 * u)));
    for (let i = 1; i < n; i++) {
      const x = -W / 2 + arm + (inner * i) / n;
      detail.line({ x, y: -D / 2 + b }, { x, y: D / 2 });
    }
    return { outline, detail };
  },
  table(W, D, u, a) {
    const outline = new PathBuilder().rect(-W / 2, -D / 2, W, D);
    const detail = new PathBuilder();
    const under = new PathBuilder();
    if (a.chairs) {
      const c = 0.45 * u;
      const n = Math.max(1, Math.floor(W / (0.6 * u)));
      for (let i = 0; i < n; i++) {
        const x = -W / 2 + (W * (i + 0.5)) / n;
        for (const s of [-1, 1]) {
          const y = s * (D / 2 + c / 2 - 0.12 * u);
          under.rect(x - c / 2, y - c / 2, c, c);
          const yb = y + (s * c) / 2;
          under.line({ x: x - c / 2, y: yb - s * 0.06 * u }, { x: x + c / 2, y: yb - s * 0.06 * u });
        }
      }
      if (D >= 0.8 * u && W >= 1.4 * u) {
        for (const s of [-1, 1]) {
          const x = s * (W / 2 + c / 2 - 0.12 * u);
          under.rect(x - c / 2, -c / 2, c, c);
          const xb = x + (s * c) / 2;
          under.line({ x: xb - s * 0.06 * u, y: -c / 2 }, { x: xb - s * 0.06 * u, y: c / 2 });
        }
      }
    }
    return { outline, detail, under };
  },
  wardrobe(W, D) {
    const outline = new PathBuilder().rect(-W / 2, -D / 2, W, D);
    const detail = new PathBuilder().line({ x: -W / 2, y: D / 2 }, { x: W / 2, y: -D / 2 });
    return { outline, detail };
  },
  kitchen(W, D, u) {
    const outline = new PathBuilder().rect(-W / 2, -D / 2, W, D);
    const detail = new PathBuilder();
    detail.line({ x: -W / 2, y: D / 2 - 0.04 * u }, { x: W / 2, y: D / 2 - 0.04 * u });
    if (W >= 1.2 * u) {
      // Spüle
      const sw = Math.min(0.8 * u, W * 0.3);
      const sx = -W / 2 + W * 0.28;
      detail.roundRect(sx - sw / 2, -D / 2 + 0.08 * u, sw, D - 0.2 * u, 0.04 * u);
      detail.roundRect(sx - sw / 2 + 0.05 * u, -D / 2 + 0.12 * u, sw * 0.55, D - 0.28 * u, 0.03 * u);
      detail.circle(sx + sw * 0.3, -D / 2 + 0.16 * u, 0.025 * u);
      // Kochfeld
      const hx = W / 2 - W * 0.28;
      const r1 = 0.09 * u;
      const r2 = 0.07 * u;
      detail.circle(hx - 0.14 * u, -0.1 * u, r1);
      detail.circle(hx + 0.14 * u, -0.1 * u, r2);
      detail.circle(hx - 0.14 * u, 0.13 * u, r2);
      detail.circle(hx + 0.14 * u, 0.13 * u, r1);
    }
    return { outline, detail };
  },
  wc(W, D, u) {
    const tank = Math.min(0.18 * u, D * 0.3);
    const outline = new PathBuilder().roundRect(-W / 2, -D / 2, W, tank, 0.02 * u);
    const bowlL = D - tank;
    const detail = new PathBuilder();
    detail.ellipse(0, -D / 2 + tank + bowlL / 2 - 0.01 * u, W * 0.42, bowlL / 2);
    detail.ellipse(0, -D / 2 + tank + bowlL / 2 + 0.02 * u, W * 0.28, bowlL * 0.33);
    return { outline, detail };
  },
  sink(W, D, u) {
    const outline = new PathBuilder().roundRect(-W / 2, -D / 2, W, D, 0.04 * u);
    const detail = new PathBuilder();
    detail.ellipse(0, 0.03 * u, W * 0.36, D * 0.32);
    detail.circle(0, -D / 2 + 0.07 * u, 0.025 * u);
    return { outline, detail };
  },
  shower(W, D, u) {
    const outline = new PathBuilder().rect(-W / 2, -D / 2, W, D);
    const detail = new PathBuilder();
    detail.line({ x: -W / 2, y: -D / 2 }, { x: W / 2, y: D / 2 });
    detail.line({ x: W / 2, y: -D / 2 }, { x: -W / 2, y: D / 2 });
    detail.circle(0, 0, 0.04 * u);
    return { outline, detail };
  },
  bathtub(W, D, u) {
    const outline = new PathBuilder().rect(-W / 2, -D / 2, W, D);
    const m = Math.min(0.07 * u, D * 0.1);
    const detail = new PathBuilder().roundRect(-W / 2 + m, -D / 2 + m, W - 2 * m, D - 2 * m, Math.min(D * 0.35, W * 0.2));
    detail.circle(-W / 2 + m + 0.12 * u, 0, 0.03 * u);
    return { outline, detail };
  },
  washer(W, D) {
    const outline = new PathBuilder().rect(-W / 2, -D / 2, W, D);
    const r = Math.min(W, D) * 0.34;
    const detail = new PathBuilder().circle(0, 0.03 * D, r).circle(0, 0.03 * D, r * 0.7);
    return { outline, detail };
  },
  car(W, D, u) {
    const outline = new PathBuilder().rect(-W / 2, -D / 2, W, D);
    const bw = Math.min(1.8 * u, W * 0.78);
    const bl = Math.min(4.6 * u, D * 0.92);
    const detail = new PathBuilder().roundRect(-bw / 2, -bl / 2, bw, bl, bw * 0.22);
    // Front- und Heckscheibe, Dach
    const ws = -bl / 2 + bl * 0.27;
    detail.M({ x: -bw / 2 + bw * 0.1, y: ws }).C({ x: -bw / 4, y: ws - bl * 0.05 }, { x: bw / 4, y: ws - bl * 0.05 }, { x: bw / 2 - bw * 0.1, y: ws });
    const rs = bl / 2 - bl * 0.17;
    detail.M({ x: -bw / 2 + bw * 0.12, y: rs }).C({ x: -bw / 4, y: rs + bl * 0.03 }, { x: bw / 4, y: rs + bl * 0.03 }, { x: bw / 2 - bw * 0.12, y: rs });
    detail.rect(-bw / 2 + bw * 0.12, ws + bl * 0.04, bw * 0.76, rs - ws - bl * 0.08);
    return { outline, detail };
  },
};

register<SymbolA>({
  kind: 'symbol',
  label: 'Einrichtung',
  styleKeys: ['stroke', 'fill', 'width', 'opacity'],
  params: [
    {
      key: 'symbol',
      label: 'Objekt',
      type: 'select',
      options: (Object.keys(SYMBOLS) as SymbolKind[]).map((k) => [k, SYMBOLS[k].label]),
    },
    { key: 'w', label: 'Breite', type: 'length', min: 0.1, max: 20 },
    { key: 'd', label: 'Tiefe', type: 'length', min: 0.1, max: 20 },
    { key: 'chairs', label: 'Stühle (nur Tisch)', type: 'bool' },
    ANGLE_PARAM,
    MIRROR_PARAM(),
  ],
  prims(a, ctx) {
    const u = ctx.ptPerM;
    const W = a.w * u;
    const D = a.d * u;
    const w = mm(a.style.width);
    const thin = Math.max(mm(0.1), w * 0.7);
    const col = a.style.stroke;
    const g = (DRAW[a.symbol] ?? DRAW.wardrobe)(W, D, u, a);
    const local: Prim[] = [];
    if (g.under) local.push(path(g.under, { stroke: col, width: thin, fill: a.style.fill || '#ffffff' }));
    local.push(path(g.outline, { stroke: col, width: w, fill: a.style.fill || '#ffffff' }));
    local.push(path(g.detail, { stroke: col, width: thin }));
    return placePrims(a, local);
  },
  handles: (a, ctx) => placedHandles(a, (a.w * ctx.ptPerM) / 2, (a.d * ctx.ptPerM) / 2, 'corner'),
  moveHandle(a, i, p, ctx, mods) {
    if (i === 0) return { ...a, angle: rotateFromHandle(a, p, mods) };
    const l = toLocal(a, p);
    const step = mods.shift ? 0.05 : 0.01;
    return {
      ...a,
      w: Math.max(0.1, Math.round((2 * Math.abs(l.x)) / ctx.ptPerM / step) * step),
      d: Math.max(0.1, Math.round((2 * Math.abs(l.y)) / ctx.ptPerM / step) * step),
    };
  },
  translate: (a, d) => ({ ...a, p: translatePt(a.p, d) }),
  info: (a, ctx) => [`${SYMBOLS[a.symbol]?.label ?? ''}: ${fmtLen(a.w, ctx.settings, false)} × ${fmtLen(a.d, ctx.settings)}`],
});
