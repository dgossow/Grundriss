import { MM_TO_PT } from './geom';
import type { Scale, Settings, Unit } from './types';

/** Seitenpunkte pro Meter für einen Maßstab 1:n bei maßstabsgetreuer PDF. */
export function ptPerMForRatio(n: number): number {
  return (1000 / n) * MM_TO_PT;
}

export function scaleFromRatio(n: number): Scale {
  return { ptPerM: ptPerMForRatio(n), label: `1:${fmtNum(n, 0)}` };
}

/** Maßstabsverhältnis n (1:n) aus ptPerM, falls die PDF maßstabsgetreu ist. */
export function ratioOf(scale: Scale): number {
  return 1000 / (scale.ptPerM / MM_TO_PT);
}

export const SCALE_PRESETS = [1, 2, 5, 10, 20, 25, 50, 75, 100, 200, 250, 500, 1000, 2000, 2500, 5000];

export const DEFAULT_SCALE = scaleFromRatio(100);

export function fmtNum(v: number, decimals: number): string {
  return v.toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

const UNIT_FACTOR: Record<Unit, number> = { m: 1, cm: 100, mm: 1000 };

/** Länge in Metern formatieren. */
export function fmtLen(m: number, s: Settings, withUnit = true): string {
  const v = m * UNIT_FACTOR[s.unit];
  const dec = s.unit === 'mm' ? Math.max(0, s.decimals - 3) : s.unit === 'cm' ? Math.max(0, s.decimals - 2) : s.decimals;
  return fmtNum(v, dec) + (withUnit ? ' ' + s.unit : '');
}

/** Fläche in m² formatieren (immer m², wie im Bauwesen üblich). */
export function fmtArea(m2: number): string {
  return fmtNum(m2, 2) + ' m²';
}

/** Maß in cm ohne Einheit, z. B. Türbreiten "88,5". */
export function fmtCm(m: number): string {
  const cm = m * 100;
  const dec = Math.abs(cm - Math.round(cm)) < 1e-6 ? 0 : 1;
  return fmtNum(cm, dec);
}

/** Deutsche Zahleneingabe parsen ("3,65", "3.65", "365 cm", "1/2"). */
export function parseNumber(s: string): number | null {
  const t = s.trim().replace(/\s+/g, '').replace(',', '.');
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** Längeneingabe mit optionaler Einheit, Ergebnis in Metern. */
export function parseLength(s: string, defaultUnit: Unit): number | null {
  const m = s.trim().toLowerCase().replace(',', '.').match(/^(-?\d*\.?\d+)\s*(mm|cm|m)?$/);
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  const unit = (m[2] as Unit | undefined) ?? defaultUnit;
  return v / UNIT_FACTOR[unit];
}

/** Sucht Maßstabsangaben wie "M 1:100" oder "1 : 50" in Text. */
export function findScaleInText(texts: string[]): number | null {
  const counts = new Map<number, number>();
  const re = /(?:^|[^\d.,:])1\s*:\s*(\d{1,5})(?![\d.,:])/g;
  for (const t of texts) {
    for (const m of t.matchAll(re)) {
      const n = Number(m[1]);
      if (SCALE_PRESETS.includes(n) && n > 1) counts.set(n, (counts.get(n) || 0) + 1);
    }
  }
  let best: number | null = null;
  let bestC = 0;
  for (const [n, c] of counts) {
    if (c > bestC) {
      best = n;
      bestC = c;
    }
  }
  return best;
}
