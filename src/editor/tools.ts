// Werkzeuge: Auswahl, Zeichnen, Messen, Grundriss-Elemente, Bereich löschen.
import { defOf, primsOf, type Ctx, type Handle } from '../elements';
import {
  add,
  angleOf,
  closestOnSegment,
  DEG,
  dist,
  mid,
  mul,
  norm,
  offsetPolyline,
  rectFromPts,
  rectContainsRect,
  simplify,
  sub,
  uid,
  type Rect,
} from '../geom';
import { primsTouchRect } from '../render/hit';
import { primsBBox } from '../render/prims';
import type { Annot, DoorA, Pt, StairsA, SymbolA, WallA, WindowA } from '../types';
import { fmtLen, fmtNum, parseLength } from '../units';
import { makeAnnot, type EraserOptions, type ToolId } from './defaults';
import type { History } from './doc';
import type { PtrEvent, View } from './view';
import { wallOffsets } from '../elements/plan';

export interface AppApi {
  view: View;
  hist: History;
  readonly pageIndex: number;
  readonly annots: Annot[];
  readonly ctx: Ctx;
  selection: Set<string>;
  eraser: EraserOptions;
  setSelection(ids: Iterable<string>): void;
  defaults(tool: ToolId): Record<string, unknown>;
  snap(e: PtrEvent, from?: Pt | null, exclude?: Set<string>, extra?: Pt[]): Pt;
  clearSnap(): void;
  hitTest(p: Pt): Annot | null;
  handleAt(sx: number, sy: number): { annot: Annot; index: number; handle: Handle } | null;
  redraw(): void;
  setTool(id: ToolId): void;
  editText(id: string, isNew: boolean): void;
  calibrate(lenPt: number): void;
  focusParam(key: string): void;
  status(msg: string): void;
}

export interface Tool {
  id: ToolId;
  cursor: string;
  down?(e: PtrEvent): void;
  move?(e: PtrEvent, pressed: boolean): void;
  up?(e: PtrEvent): void;
  dblclick?(e: PtrEvent): void;
  key?(e: KeyboardEvent): boolean;
  /** true, wenn gerade eine Eingabe läuft (Esc bricht dann nur diese ab) */
  busy?(): boolean;
  cancel?(): void;
  preview?(): Annot[];
  /** zusätzliches Bildschirm-Overlay (SVG-Markup in Bildschirmkoordinaten) */
  overlay?(): string;
  tooltip?(): string | null;
  /** Bildschirmposition für den Tooltip */
  lastScreen?: { x: number; y: number };
}

const DRAG_PX = 4;

function lengthLabel(app: AppApi, a: Pt, b: Pt): string {
  const m = dist(a, b) / app.ctx.ptPerM;
  let deg = -angleOf(a, b) / DEG;
  if (deg < 0) deg += 360;
  return `${fmtLen(m, app.ctx.settings)} · ${fmtNum(deg, 1)}°`;
}

function rectMarkup(app: AppApi, r: Rect, cls: string): string {
  const a = app.view.toScreen({ x: r.x, y: r.y });
  const b = app.view.toScreen({ x: r.x + r.w, y: r.y + r.h });
  return `<rect class="${cls}" x="${a.x}" y="${a.y}" width="${b.x - a.x}" height="${b.y - a.y}"/>`;
}

/** Tippen einer Länge während des Zeichnens */
function typedKey(e: KeyboardEvent, typed: string): string | null {
  if (/^[0-9.,]$/.test(e.key) || (e.key === 'm' && typed) || (e.key === 'c' && typed)) return typed + e.key;
  if (e.key === 'Backspace' && typed) return typed.slice(0, -1);
  return null;
}

// ---------------------------------------------------------------------------
// Auswahl
// ---------------------------------------------------------------------------

export class SelectTool implements Tool {
  id: ToolId = 'select';
  cursor = 'default';
  private mode: 'none' | 'pending' | 'move' | 'handle' | 'marquee' = 'none';
  private start: Pt = { x: 0, y: 0 };
  private startScreen = { x: 0, y: 0 };
  private orig = new Map<string, Annot>();
  private handle: { id: string; index: number } | null = null;
  private marquee: Rect | null = null;
  private additive = false;

  constructor(private app: AppApi) {}

  down(e: PtrEvent) {
    const app = this.app;
    this.start = e.p;
    this.startScreen = { x: e.sx, y: e.sy };
    const h = app.handleAt(e.sx, e.sy);
    if (h) {
      const a = h.annot;
      if (e.alt && h.handle.type === 'vertex' && 'pts' in a) {
        const min = a.kind === 'area' || a.kind === 'room' ? 3 : 2;
        if (a.pts.length > min) {
          app.hist.replace(app.pageIndex, [{ ...a, pts: a.pts.filter((_, i) => i !== h.index) } as Annot]);
          app.status('Punkt gelöscht');
        }
        this.mode = 'none';
        return;
      }
      app.hist.begin();
      this.handle = { id: a.id, index: h.index };
      this.mode = 'handle';
      return;
    }
    const hit = app.hitTest(e.p);
    if (hit) {
      if (e.shift) {
        const s = new Set(app.selection);
        if (s.has(hit.id)) s.delete(hit.id);
        else s.add(hit.id);
        app.setSelection(s);
      } else if (!app.selection.has(hit.id)) app.setSelection([hit.id]);
      if (!app.selection.has(hit.id)) {
        this.mode = 'none';
        return;
      }
      if (e.alt) {
        // ⌥-Ziehen: Kopie verschieben
        const copies = app.annots.filter((a) => app.selection.has(a.id)).map((a) => ({ ...structuredClone(a), id: uid() }));
        app.hist.begin();
        app.hist.add(app.pageIndex, copies);
        app.setSelection(copies.map((c) => c.id));
      } else app.hist.begin();
      this.orig = new Map(app.annots.filter((a) => app.selection.has(a.id)).map((a) => [a.id, a]));
      this.mode = 'pending';
      return;
    }
    this.additive = e.shift;
    if (!e.shift) app.setSelection([]);
    this.mode = 'marquee';
    this.marquee = { x: e.p.x, y: e.p.y, w: 0, h: 0 };
  }

  move(e: PtrEvent, pressed: boolean) {
    const app = this.app;
    if (!pressed) {
      const h = app.handleAt(e.sx, e.sy);
      app.view.stage.style.cursor = h ? (h.handle.type === 'rotate' ? 'alias' : 'pointer') : app.hitTest(e.p) ? 'move' : 'default';
      return;
    }
    if (this.mode === 'handle' && this.handle) {
      const a = app.annots.find((x) => x.id === this.handle!.id);
      if (!a) return;
      const def = defOf(a);
      const handles = def.handles(a, app.ctx);
      const h = handles[this.handle.index];
      let p = e.p;
      if (h && (h.type === 'vertex' || h.type === 'corner' || h.type === 'end')) p = app.snap(e, null, new Set([a.id]));
      const next = def.moveHandle(a, this.handle.index, p, app.ctx, { shift: e.shift, alt: e.alt });
      app.hist.replace(app.pageIndex, [next]);
      return;
    }
    if (this.mode === 'pending') {
      if (Math.hypot(e.sx - this.startScreen.x, e.sy - this.startScreen.y) < DRAG_PX) return;
      this.mode = 'move';
    }
    if (this.mode === 'move') {
      let d = sub(e.p, this.start);
      if (e.shift) d = Math.abs(d.x) > Math.abs(d.y) ? { x: d.x, y: 0 } : { x: 0, y: d.y };
      const moved = [...this.orig.values()].map((a) => defOf(a).translate(a, d));
      app.hist.replace(app.pageIndex, moved);
      return;
    }
    if (this.mode === 'marquee') {
      this.marquee = rectFromPts(this.start, e.p);
      app.redraw();
    }
  }

  up(_e: PtrEvent) {
    const app = this.app;
    if (this.mode === 'marquee' && this.marquee) {
      const r = this.marquee;
      if (r.w > app.view.px(2) || r.h > app.view.px(2)) {
        const ids = app.annots.filter((a) => primsTouchRect(primsOf(a, app.ctx), r)).map((a) => a.id);
        app.setSelection(this.additive ? [...app.selection, ...ids] : ids);
      }
      this.marquee = null;
    }
    if (this.mode === 'handle' || this.mode === 'move' || this.mode === 'pending') app.hist.commit();
    this.mode = 'none';
    this.handle = null;
    app.clearSnap();
    app.redraw();
  }

  dblclick(e: PtrEvent) {
    const app = this.app;
    const hit = app.hitTest(e.p);
    if (!hit) return;
    if (hit.kind === 'text') {
      app.editText(hit.id, false);
      return;
    }
    if ('pts' in hit && hit.kind !== 'freehand') {
      // Punkt auf nächstem Segment einfügen
      const pts = hit.pts;
      const closed = hit.kind === 'area' || hit.kind === 'room' || (hit.kind === 'polyline' && hit.closed) || (hit.kind === 'wall' && hit.closed);
      let best = -1;
      let bestD = Infinity;
      let bestP = e.p;
      const n = closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const c = closestOnSegment(e.p, pts[i], pts[(i + 1) % pts.length]);
        if (c.d < bestD) {
          bestD = c.d;
          best = i;
          bestP = c.p;
        }
      }
      if (best >= 0 && bestD < app.view.px(8)) {
        const np = [...pts.slice(0, best + 1), bestP, ...pts.slice(best + 1)];
        app.hist.replace(app.pageIndex, [{ ...hit, pts: np } as Annot]);
        app.status('Punkt eingefügt');
        return;
      }
    }
    if (hit.kind === 'room') app.focusParam('name');
  }

  busy() {
    return this.mode !== 'none';
  }

  cancel() {
    if (this.mode === 'handle' || this.mode === 'move' || this.mode === 'pending') this.app.hist.rollback();
    this.mode = 'none';
    this.marquee = null;
  }

  overlay() {
    return this.marquee ? rectMarkup(this.app, this.marquee, 'marquee') : '';
  }
}

// ---------------------------------------------------------------------------
// Hand
// ---------------------------------------------------------------------------

export class HandTool implements Tool {
  id: ToolId = 'hand';
  cursor = 'grab';
}

// ---------------------------------------------------------------------------
// Zwei-Punkt-Werkzeuge: Linie, Pfeil, Distanz, Kalibrieren
// ---------------------------------------------------------------------------

export class TwoPointTool implements Tool {
  cursor = 'crosshair';
  private p1: Pt | null = null;
  private p2: Pt | null = null;
  private downScreen = { x: 0, y: 0 };
  private dragged = false;
  private typed = '';
  lastScreen = { x: 0, y: 0 };

  constructor(
    private app: AppApi,
    public id: ToolId,
  ) {}

  down(e: PtrEvent) {
    const p = this.app.snap(e, this.p1);
    if (!this.p1) {
      this.p1 = p;
      this.p2 = p;
      this.downScreen = { x: e.sx, y: e.sy };
      this.dragged = false;
      this.typed = '';
    } else {
      this.p2 = p;
      this.finish();
    }
  }

  move(e: PtrEvent, pressed: boolean) {
    this.lastScreen = { x: e.sx, y: e.sy };
    const p = this.app.snap(e, this.p1);
    if (this.p1) {
      this.p2 = p;
      if (pressed && Math.hypot(e.sx - this.downScreen.x, e.sy - this.downScreen.y) > DRAG_PX) this.dragged = true;
    }
    this.app.redraw();
  }

  up() {
    if (this.p1 && this.dragged) this.finish();
  }

  key(e: KeyboardEvent) {
    if (!this.p1) return false;
    if (e.key === 'Enter') {
      const len = parseLength(this.typed, this.app.ctx.settings.unit);
      if (len && this.p2) {
        // Richtung der aktuellen Mausposition (bei Nulllänge: nach rechts)
        this.p2 = add(this.p1, mul(norm(sub(this.p2, this.p1)), len * this.app.ctx.ptPerM));
      }
      this.finish();
      return true;
    }
    if (this.id === 'calibrate') return false;
    const t = typedKey(e, this.typed);
    if (t !== null) {
      this.typed = t;
      this.app.redraw();
      return true;
    }
    return false;
  }

  private finish() {
    const { p1, p2 } = this;
    this.p1 = this.p2 = null;
    this.typed = '';
    this.app.clearSnap();
    if (!p1 || !p2 || dist(p1, p2) < this.app.view.px(2)) {
      this.app.redraw();
      return;
    }
    if (this.id === 'calibrate') {
      this.app.redraw();
      this.app.calibrate(dist(p1, p2));
      return;
    }
    const a = this.build(p1, p2);
    if (a) {
      this.app.hist.add(this.app.pageIndex, [a]);
      if (this.id === 'measure') this.app.status(`Gemessen: ${fmtLen(dist(p1, p2) / this.app.ctx.ptPerM, this.app.ctx.settings)}`);
    }
    this.app.redraw();
  }

  private build(p1: Pt, p2: Pt): Annot | null {
    const d = this.app.defaults(this.id);
    return makeAnnot(d, { p1, p2 } as never, uid());
  }

  busy() {
    return !!this.p1;
  }
  cancel() {
    this.p1 = this.p2 = null;
    this.typed = '';
  }

  preview(): Annot[] {
    if (!this.p1 || !this.p2) return [];
    if (this.id === 'calibrate') {
      return [makeAnnot({ kind: 'line', style: { stroke: '#ff6d00', fill: null, width: 0.35, dash: 'dashed', opacity: 1 }, arrowStart: false, arrowEnd: false }, { p1: this.p1, p2: this.p2 } as never, 'preview')];
    }
    return [this.build(this.p1, this.p2)!];
  }

  tooltip() {
    if (!this.p1 || !this.p2) return null;
    const base = this.id === 'calibrate' ? `Papier: ${fmtNum(dist(this.p1, this.p2) * (25.4 / 72), 1)} mm` : lengthLabel(this.app, this.p1, this.p2);
    return this.typed ? `Länge: ${this.typed}▌  (↩)` : base;
  }
}

// ---------------------------------------------------------------------------
// Rechteck-Werkzeuge: Rechteck, Ellipse, Wolke, Bereich löschen
// ---------------------------------------------------------------------------

export class BoxTool implements Tool {
  cursor = 'crosshair';
  private p1: Pt | null = null;
  private p2: Pt | null = null;
  private shift = false;
  private downScreen = { x: 0, y: 0 };
  private dragged = false;
  lastScreen = { x: 0, y: 0 };

  constructor(
    private app: AppApi,
    public id: ToolId,
  ) {}

  private rect(): Rect | null {
    if (!this.p1 || !this.p2) return null;
    let q = this.p2;
    if (this.shift) {
      const s = Math.max(Math.abs(q.x - this.p1.x), Math.abs(q.y - this.p1.y));
      q = { x: this.p1.x + Math.sign(q.x - this.p1.x || 1) * s, y: this.p1.y + Math.sign(q.y - this.p1.y || 1) * s };
    }
    return rectFromPts(this.p1, q);
  }

  down(e: PtrEvent) {
    const p = this.app.snap(e);
    if (!this.p1) {
      this.p1 = this.p2 = p;
      this.downScreen = { x: e.sx, y: e.sy };
      this.dragged = false;
    } else {
      this.p2 = p;
      this.shift = e.shift;
      this.finish();
    }
  }

  move(e: PtrEvent, pressed: boolean) {
    this.lastScreen = { x: e.sx, y: e.sy };
    const p = this.app.snap(e);
    if (this.p1) {
      this.p2 = p;
      this.shift = e.shift;
      if (pressed && Math.hypot(e.sx - this.downScreen.x, e.sy - this.downScreen.y) > DRAG_PX) this.dragged = true;
    }
    this.app.redraw();
  }

  up() {
    if (this.p1 && this.dragged) this.finish();
  }

  private finish() {
    const r = this.rect();
    this.p1 = this.p2 = null;
    this.app.clearSnap();
    if (!r || r.w < this.app.view.px(2) || r.h < this.app.view.px(2)) {
      this.app.redraw();
      return;
    }
    if (this.id === 'eraser') this.erase(r);
    else this.app.hist.add(this.app.pageIndex, [makeAnnot(this.app.defaults(this.id), { ...r } as never, uid())]);
    this.app.redraw();
  }

  private erase(r: Rect) {
    const app = this.app;
    const opts = app.eraser;
    const del = new Set<string>();
    if (opts.deleteMode !== 'none') {
      for (const a of app.annots) {
        const prims = primsOf(a, app.ctx);
        const inside = rectContainsRect(r, primsBBox(prims));
        if (a.kind === 'whiteout' ? inside : opts.deleteMode === 'inside' ? inside : primsTouchRect(prims, r)) del.add(a.id);
      }
    }
    app.hist.begin();
    app.hist.remove(app.pageIndex, del);
    if (opts.cover) app.hist.add(app.pageIndex, [makeAnnot(app.defaults('eraser'), { ...r } as never, uid())]);
    app.hist.commit();
    app.setSelection([...app.selection].filter((id) => !del.has(id)));
    const parts: string[] = [];
    if (opts.deleteMode !== 'none') parts.push(`${del.size} Element${del.size === 1 ? '' : 'e'} gelöscht`);
    if (opts.cover) parts.push('Planbereich abgedeckt');
    app.status(parts.join(' · ') || 'Nichts zu löschen');
  }

  busy() {
    return !!this.p1;
  }
  cancel() {
    this.p1 = this.p2 = null;
  }

  preview(): Annot[] {
    const r = this.rect();
    if (!r || this.id === 'eraser') return [];
    return [makeAnnot(this.app.defaults(this.id), { ...r } as never, 'preview')];
  }

  overlay() {
    const r = this.rect();
    if (!r || this.id !== 'eraser') return '';
    return rectMarkup(this.app, r, 'erase-rect');
  }

  tooltip() {
    const r = this.rect();
    if (!r) return null;
    const s = this.app.ctx.settings;
    return `${fmtLen(r.w / this.app.ctx.ptPerM, s, false)} × ${fmtLen(r.h / this.app.ctx.ptPerM, s)}`;
  }
}

// ---------------------------------------------------------------------------
// Polygon-/Polylinien-Werkzeuge: Polylinie, Kettenmaß, Fläche, Wand, Raum
// ---------------------------------------------------------------------------

export class PolyTool implements Tool {
  cursor = 'crosshair';
  private pts: Pt[] = [];
  private cur: Pt | null = null;
  private typed = '';
  lastScreen = { x: 0, y: 0 };

  constructor(
    private app: AppApi,
    public id: ToolId,
  ) {}

  private get alwaysClosed() {
    return this.id === 'area' || this.id === 'room';
  }
  private get minPts() {
    return this.alwaysClosed ? 3 : 2;
  }

  down(e: PtrEvent) {
    const last = this.pts[this.pts.length - 1] ?? null;
    const p = this.app.snap(e, last, undefined, this.pts.slice(0, 1));
    // Klick auf Startpunkt schließt
    if (this.pts.length >= this.minPts && this.pts.length >= 2) {
      const s = this.app.view.toScreen(this.pts[0]);
      if (Math.hypot(s.x - e.sx, s.y - e.sy) < 9) {
        this.finish(true);
        return;
      }
    }
    if (last && dist(last, p) < this.app.view.px(1)) return;
    this.pts.push(p);
    this.cur = p;
    this.typed = '';
    this.app.redraw();
  }

  move(e: PtrEvent) {
    this.lastScreen = { x: e.sx, y: e.sy };
    const last = this.pts[this.pts.length - 1] ?? null;
    this.cur = this.app.snap(e, last, undefined, this.pts.slice(0, 1));
    this.app.redraw();
  }

  dblclick() {
    // Der Doppelklick hat bereits einen Punkt gesetzt
    if (this.pts.length >= 2 && dist(this.pts[this.pts.length - 1], this.pts[this.pts.length - 2]) < this.app.view.px(4)) this.pts.pop();
    this.finish(false);
  }

  key(e: KeyboardEvent) {
    if (!this.pts.length) return false;
    if (e.key === 'Enter') {
      const len = parseLength(this.typed, this.app.ctx.settings.unit);
      if (len && this.cur) {
        const last = this.pts[this.pts.length - 1];
        let d = norm(sub(this.cur, last));
        if (dist(this.cur, last) < 1e-6) d = { x: 1, y: 0 };
        const p = add(last, mul(d, len * this.app.ctx.ptPerM));
        this.pts.push(p);
        this.cur = p;
        this.typed = '';
        this.app.redraw();
        return true;
      }
      this.finish(false);
      return true;
    }
    if (e.key === 'Backspace' && !this.typed) {
      this.pts.pop();
      this.app.redraw();
      return true;
    }
    const t = typedKey(e, this.typed);
    if (t !== null) {
      this.typed = t;
      this.app.redraw();
      return true;
    }
    return false;
  }

  private build(pts: Pt[], closed: boolean, id: string): Annot {
    const d = this.app.defaults(this.id);
    const geom: Record<string, unknown> = { pts };
    if (this.id === 'polyline' || this.id === 'wall') geom.closed = closed;
    return makeAnnot(d, geom as never, id);
  }

  private finish(closed: boolean) {
    const pts = this.pts;
    this.pts = [];
    this.typed = '';
    this.app.clearSnap();
    if (pts.length >= this.minPts) {
      const a = this.build(pts, closed || this.alwaysClosed, uid());
      this.app.hist.add(this.app.pageIndex, [a]);
      if (this.id === 'room') this.app.setSelection([a.id]);
    }
    this.app.redraw();
  }

  busy() {
    return this.pts.length > 0;
  }
  cancel() {
    this.pts = [];
    this.typed = '';
  }

  preview(): Annot[] {
    if (!this.pts.length) return [];
    const pts = this.cur ? [...this.pts, this.cur] : this.pts;
    if (pts.length < 2) return [];
    return [this.build(pts, false, 'preview')];
  }

  overlay() {
    if (this.pts.length < 2) return '';
    const s = this.app.view.toScreen(this.pts[0]);
    return `<circle class="close-target" cx="${s.x}" cy="${s.y}" r="6"/>`;
  }

  tooltip() {
    if (!this.pts.length || !this.cur) return null;
    const last = this.pts[this.pts.length - 1];
    const base = lengthLabel(this.app, last, this.cur);
    return this.typed ? `Länge: ${this.typed}▌  (↩)` : base;
  }
}

// ---------------------------------------------------------------------------
// Freihand
// ---------------------------------------------------------------------------

export class FreehandTool implements Tool {
  cursor = 'crosshair';
  private pts: Pt[] = [];

  constructor(
    private app: AppApi,
    public id: ToolId,
  ) {}

  down(e: PtrEvent) {
    this.pts = [e.p];
  }
  move(e: PtrEvent, pressed: boolean) {
    if (!pressed || !this.pts.length) return;
    const last = this.pts[this.pts.length - 1];
    if (dist(last, e.p) > this.app.view.px(1.5)) {
      this.pts.push(e.p);
      this.app.redraw();
    }
  }
  up() {
    const pts = simplify(this.pts, this.app.view.px(0.6));
    this.pts = [];
    if (pts.length >= 2) this.app.hist.add(this.app.pageIndex, [makeAnnot(this.app.defaults(this.id), { pts } as never, uid())]);
    this.app.redraw();
  }
  busy() {
    return this.pts.length > 0;
  }
  cancel() {
    this.pts = [];
  }
  preview(): Annot[] {
    return this.pts.length > 1 ? [makeAnnot(this.app.defaults(this.id), { pts: this.pts } as never, 'preview')] : [];
  }
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export class TextTool implements Tool {
  id: ToolId = 'text';
  cursor = 'text';
  constructor(private app: AppApi) {}
  down(e: PtrEvent) {
    const hit = this.app.hitTest(e.p);
    if (hit && hit.kind === 'text') {
      this.app.editText(hit.id, false);
      return;
    }
    const a = makeAnnot(this.app.defaults('text'), { p: e.p, text: '' } as never, uid());
    this.app.hist.add(this.app.pageIndex, [a]);
    this.app.editText(a.id, true);
  }
}

// ---------------------------------------------------------------------------
// Platzieren: Tür, Fenster, Treppe, Stütze, Einrichtung
// ---------------------------------------------------------------------------

interface WallSnap {
  p: Pt;
  angle: number;
  thickness: number;
  /** Abstand des Cursors von der Wandmitte (vorzeichenbehaftet, + = lokale +y-Seite) */
  side: number;
}

export class PlaceTool implements Tool {
  cursor = 'crosshair';
  private hover: Pt | null = null;
  /** Drehung bei freier Platzierung (null = Standardwert) */
  private freeAngle: number | null = null;
  /** zusätzliche Drehung an einer Wand: 0° oder 180° */
  private wallRot = 0;
  private mirror: boolean | null = null;
  private flip: boolean | null = null;
  private wallSnap: WallSnap | null = null;
  private dragA: Pt | null = null;
  private dragB: Pt | null = null;
  private downScreen = { x: 0, y: 0 };
  private dragging = false;
  lastScreen = { x: 0, y: 0 };

  constructor(
    private app: AppApi,
    public id: ToolId,
  ) {}

  private findWall(p: Pt): WallSnap | null {
    if (this.id !== 'door' && this.id !== 'window') return null;
    const app = this.app;
    let best: WallSnap | null = null;
    let bestD = Infinity;
    for (const a of app.annots) {
      if (a.kind !== 'wall' || a.pts.length < 2) continue;
      const w = a as WallA;
      const [oL, oR] = wallOffsets(w, app.ctx);
      const closed = w.closed && w.pts.length > 2;
      const axis = offsetPolyline(w.pts, (oL + oR) / 2, closed);
      const half = (w.thickness * app.ctx.ptPerM) / 2;
      const n = closed ? axis.length : axis.length - 1;
      for (let i = 0; i < n; i++) {
        const A = axis[i];
        const B = axis[(i + 1) % axis.length];
        const c = closestOnSegment(p, A, B);
        if (c.d <= half + app.view.px(12) && c.d < bestD) {
          bestD = c.d;
          const ang = angleOf(A, B) / DEG;
          const ly = { x: -Math.sin(ang * DEG), y: Math.cos(ang * DEG) };
          const side = (p.x - c.p.x) * ly.x + (p.y - c.p.y) * ly.y;
          best = { p: c.p, angle: ang, thickness: w.thickness, side };
        }
      }
    }
    return best;
  }

  private ghost(): Annot | null {
    const app = this.app;
    const d = app.defaults(this.id);
    const geom: Record<string, unknown> = {};
    let angle = this.freeAngle ?? ((d.angle as number) || 0);
    if (this.mirror !== null) geom.mirror = this.mirror;
    if (this.flip !== null) geom.flip = this.flip;
    if (this.dragA && this.dragB && this.dragging) {
      const A = this.dragA;
      const B = this.dragB;
      const L = dist(A, B) / app.ctx.ptPerM;
      const t = angleOf(A, B) / DEG;
      if (this.id === 'door' || this.id === 'window') {
        geom.p = mid(A, B);
        angle = t;
        geom.width = Math.max(0.2, Math.round(L * 200) / 200);
        if (this.wallSnap) geom.wall = this.wallSnap.thickness;
      } else if (this.id === 'stairs') {
        geom.p = mid(A, B);
        angle = t;
        geom.length = Math.max(0.5, Math.round(L * 100) / 100);
        geom.mirror = false;
      } else {
        geom.p = A;
        angle = t - 90;
      }
    } else {
      if (!this.hover) return null;
      geom.p = this.hover;
      const ws = this.wallSnap;
      if (ws) {
        geom.p = ws.p;
        geom.wall = ws.thickness;
        angle = ws.angle + this.wallRot;
        if (this.id === 'door' && this.flip === null && Math.abs(ws.side) > (ws.thickness * app.ctx.ptPerM) / 4) {
          // Tür schlägt zur Seite des Mauszeigers auf
          const sideLocal = this.wallRot ? -ws.side : ws.side;
          geom.flip = sideLocal < 0;
        }
      }
    }
    geom.angle = Math.round((((angle % 360) + 360) % 360) * 100) / 100;
    return makeAnnot(d, geom as never, 'preview');
  }

  down(e: PtrEvent) {
    this.wallSnap = this.findWall(e.p);
    this.dragA = this.app.snap(e);
    this.dragB = this.dragA;
    this.dragging = false;
    this.downScreen = { x: e.sx, y: e.sy };
  }

  move(e: PtrEvent, pressed: boolean) {
    this.lastScreen = { x: e.sx, y: e.sy };
    if (pressed && this.dragA) {
      this.dragB = this.app.snap(e, this.dragA);
      if (Math.hypot(e.sx - this.downScreen.x, e.sy - this.downScreen.y) > DRAG_PX * 2) this.dragging = true;
    } else {
      this.wallSnap = this.findWall(e.p);
      if (this.wallSnap) {
        this.hover = e.p;
        this.app.clearSnap();
      } else this.hover = this.app.snap(e);
    }
    this.app.redraw();
  }

  up() {
    if (!this.dragging && !this.wallSnap) this.hover = this.dragA;
    const g = this.ghost();
    if (g) {
      const a = { ...g, id: uid() } as Annot;
      this.app.hist.add(this.app.pageIndex, [a]);
      if (this.dragging && 'angle' in a) this.freeAngle = a.angle;
      this.app.status(`${defOf(a).label} gesetzt`);
    }
    this.dragA = this.dragB = null;
    this.dragging = false;
    this.app.clearSnap();
    this.app.redraw();
  }

  key(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    if (k === 'r') {
      if (this.wallSnap) this.wallRot = this.wallRot ? 0 : 180;
      else {
        const base = this.freeAngle ?? ((this.app.defaults(this.id).angle as number) || 0);
        this.freeAngle = (((base + (e.shiftKey ? -90 : 90)) % 360) + 360) % 360;
      }
      this.app.redraw();
      return true;
    }
    if (k === 'x' && this.id !== 'window' && this.id !== 'column') {
      this.mirror = !(this.mirror ?? (this.app.defaults(this.id).mirror as boolean));
      this.app.redraw();
      return true;
    }
    if (k === 'f' && this.id === 'door') {
      const g = this.ghost() as DoorA | null;
      this.flip = !(g?.flip ?? false);
      this.app.redraw();
      return true;
    }
    return false;
  }

  busy() {
    return !!this.dragA;
  }
  cancel() {
    this.dragA = this.dragB = null;
    this.dragging = false;
  }

  preview(): Annot[] {
    const g = this.ghost();
    return g ? [g] : [];
  }

  tooltip() {
    const g = this.ghost();
    if (!g) return null;
    const s = this.app.ctx.settings;
    if (g.kind === 'door' || g.kind === 'window') return `${fmtLen((g as DoorA | WindowA).width, s)}${this.wallSnap ? ' · an Wand' : ''}`;
    if (g.kind === 'stairs') return `${fmtLen((g as StairsA).length, s)} × ${fmtLen((g as StairsA).width, s)}`;
    if (g.kind === 'symbol') return `${fmtLen((g as SymbolA).w, s, false)} × ${fmtLen((g as SymbolA).d, s)}`;
    return null;
  }
}
