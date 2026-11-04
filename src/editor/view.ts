// Darstellung einer PDF-Seite mit Kamera (Zoom/Verschieben) und SVG-Ebenen.
import { layerOf, primsOf, type Ctx } from '../elements';
import type { Rect } from '../geom';
import { renderPage, type PageGeom, type PdfPage, type RenderJob } from '../pdf/pdfjs';
import { primsToSvg } from '../render/svg';
import type { Annot, Pt } from '../types';

export interface Camera {
  x: number;
  y: number;
  z: number;
}

export interface PtrEvent {
  p: Pt;
  sx: number;
  sy: number;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  button: number;
  raw: PointerEvent | MouseEvent;
}

export interface ViewCallbacks {
  down(e: PtrEvent): void;
  move(e: PtrEvent, pressed: boolean): void;
  up(e: PtrEvent): void;
  dblclick(e: PtrEvent): void;
  /** Soll ein Linksklick die Ansicht verschieben (Hand/Leertaste)? */
  panMode(): boolean;
  cameraChanged(): void;
  leave(): void;
}

const SVGNS = 'http://www.w3.org/2000/svg';
const MIN_Z = 0.02;
const MAX_Z = 64;

export class View {
  readonly stage: HTMLDivElement;
  private pageBox: HTMLDivElement;
  private baseCanvas: HTMLCanvasElement;
  private detailCanvas: HTMLCanvasElement;
  private svg: SVGSVGElement;
  private world: SVGGElement;
  private maskLayer: SVGGElement;
  private fillLayer: SVGGElement;
  private annotLayer: SVGGElement;
  private previewLayer: SVGGElement;
  private ui: SVGGElement;
  readonly tooltip: HTMLDivElement;

  cam: Camera = { x: 0, y: 0, z: 1 };
  page: PdfPage | null = null;
  geom: PageGeom | null = null;
  private baseScale = 1;
  private baseJob: RenderJob | null = null;
  private detailJob: RenderJob | null = null;
  private detailCam: Camera | null = null;
  private detailRect: Rect | null = null;
  private detailTimer = 0;
  private elCache = new Map<string, { a: Annot; key: string; el: SVGGElement }>();
  private panning: { sx: number; sy: number; cx: number; cy: number; id: number } | null = null;
  private pressed = false;
  private fitted = false;

  constructor(
    container: HTMLElement,
    private cb: ViewCallbacks,
  ) {
    this.stage = document.createElement('div');
    this.stage.className = 'stage';
    this.stage.tabIndex = 0;
    this.pageBox = div('page-box');
    this.baseCanvas = document.createElement('canvas');
    this.baseCanvas.className = 'pdf-base';
    this.detailCanvas = document.createElement('canvas');
    this.detailCanvas.className = 'pdf-detail';
    this.svg = document.createElementNS(SVGNS, 'svg');
    this.svg.classList.add('overlay');
    this.world = g('world');
    this.maskLayer = g('masks');
    this.fillLayer = g('fills');
    this.annotLayer = g('annots');
    this.previewLayer = g('preview');
    this.world.append(this.maskLayer, this.fillLayer, this.annotLayer, this.previewLayer);
    this.ui = g('ui');
    this.svg.append(this.world, this.ui);
    this.tooltip = div('tooltip');
    this.stage.append(this.pageBox, this.baseCanvas, this.detailCanvas, this.svg, this.tooltip);
    container.append(this.stage);
    this.bindEvents();
    new ResizeObserver(() => {
      if (!this.fitted && this.geom) this.fit();
      this.applyCamera();
    }).observe(this.stage);
  }

  // ---------- Koordinaten ----------

  toPage(sx: number, sy: number): Pt {
    return { x: (sx - this.cam.x) / this.cam.z, y: (sy - this.cam.y) / this.cam.z };
  }

  toScreen(p: Pt): Pt {
    return { x: p.x * this.cam.z + this.cam.x, y: p.y * this.cam.z + this.cam.y };
  }

  /** Bildschirm-Pixel in Seitenpunkte */
  px(n: number) {
    return n / this.cam.z;
  }

  get width() {
    return this.stage.clientWidth;
  }
  get height() {
    return this.stage.clientHeight;
  }

  // ---------- Seite ----------

  setPage(page: PdfPage | null, geom: PageGeom | null, keepCamera = false) {
    this.baseJob?.cancel();
    this.detailJob?.cancel();
    this.page = page;
    this.geom = geom;
    this.detailCam = null;
    this.detailCanvas.style.display = 'none';
    this.elCache.clear();
    this.maskLayer.replaceChildren();
    this.fillLayer.replaceChildren();
    this.annotLayer.replaceChildren();
    this.previewLayer.replaceChildren();
    this.ui.replaceChildren();
    if (!page || !geom) {
      this.pageBox.style.display = 'none';
      this.baseCanvas.style.display = 'none';
      return;
    }
    this.pageBox.style.display = '';
    // Basisbild: ganze Seite in begrenzter Auflösung (für flüssiges Zoomen/Verschieben)
    const maxSide = 4096;
    const maxPx = 14e6;
    this.baseScale = Math.min(maxSide / Math.max(geom.w, geom.h), Math.sqrt(maxPx / (geom.w * geom.h)), 4);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(geom.w * this.baseScale));
    c.height = Math.max(1, Math.round(geom.h * this.baseScale));
    c.className = 'pdf-base';
    const job = renderPage(page, c, this.baseScale);
    this.baseJob = job;
    this.baseCanvas.style.display = 'none';
    job.promise
      .then(() => {
        if (this.baseJob !== job) return;
        this.baseCanvas.replaceWith(c);
        this.baseCanvas = c;
        this.applyCamera();
      })
      .catch((e) => console.error('Rendern fehlgeschlagen', e));
    if (!keepCamera) {
      this.fitted = false;
      this.fit();
    } else this.applyCamera();
  }

  fit(mode: 'page' | 'width' = 'page') {
    if (!this.geom) return;
    const W = this.width;
    const H = this.height;
    if (W < 10 || H < 10) return;
    this.fitted = true;
    const m = 24;
    const zw = (W - 2 * m) / this.geom.w;
    const zh = (H - 2 * m) / this.geom.h;
    const z = mode === 'width' ? zw : Math.min(zw, zh);
    this.cam = { z, x: (W - this.geom.w * z) / 2, y: mode === 'width' ? m : (H - this.geom.h * z) / 2 };
    this.applyCamera();
  }

  setZoom(z: number, anchor?: { x: number; y: number }) {
    z = Math.max(MIN_Z, Math.min(MAX_Z, z));
    const a = anchor ?? { x: this.width / 2, y: this.height / 2 };
    const p = this.toPage(a.x, a.y);
    this.cam = { z, x: a.x - p.x * z, y: a.y - p.y * z };
    this.applyCamera();
  }

  zoomBy(f: number, anchor?: { x: number; y: number }) {
    this.setZoom(this.cam.z * f, anchor);
  }

  panBy(dx: number, dy: number) {
    this.cam = { ...this.cam, x: this.cam.x + dx, y: this.cam.y + dy };
    this.applyCamera();
  }

  /** Bereich (Seitenkoordinaten) sichtbar machen. */
  centerOn(p: Pt) {
    this.cam = { ...this.cam, x: this.width / 2 - p.x * this.cam.z, y: this.height / 2 - p.y * this.cam.z };
    this.applyCamera();
  }

  private clampCamera() {
    if (!this.geom) return;
    const { z } = this.cam;
    const W = this.width;
    const H = this.height;
    const pw = this.geom.w * z;
    const ph = this.geom.h * z;
    const keep = 80; // mindestens so viele Pixel der Seite sichtbar lassen
    this.cam.x = Math.min(W - keep, Math.max(keep - pw, this.cam.x));
    this.cam.y = Math.min(H - keep, Math.max(keep - ph, this.cam.y));
  }

  applyCamera() {
    if (!this.geom) return;
    this.clampCamera();
    const { x, y, z } = this.cam;
    const { w, h } = this.geom;
    this.pageBox.style.transform = `translate(${x}px, ${y}px)`;
    this.pageBox.style.width = `${w * z}px`;
    this.pageBox.style.height = `${h * z}px`;
    const k = z / this.baseScale;
    this.baseCanvas.style.display = '';
    this.baseCanvas.style.width = `${this.baseCanvas.width}px`;
    this.baseCanvas.style.height = `${this.baseCanvas.height}px`;
    this.baseCanvas.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
    this.world.setAttribute('transform', `matrix(${z} 0 0 ${z} ${x} ${y})`);
    if (this.detailCam && this.detailRect) {
      const d = this.detailCam;
      const kk = z / d.z;
      const tx = (this.detailRect.x - d.x) * kk + x;
      const ty = (this.detailRect.y - d.y) * kk + y;
      this.detailCanvas.style.transform = `translate(${tx}px, ${ty}px) scale(${kk})`;
    }
    this.svg.style.setProperty('--z', String(z));
    this.scheduleDetail();
    this.cb.cameraChanged();
  }

  private scheduleDetail() {
    window.clearTimeout(this.detailTimer);
    this.detailTimer = window.setTimeout(() => this.renderDetail(), 140);
  }

  private renderDetail() {
    const page = this.page;
    const geom = this.geom;
    if (!page || !geom) return;
    const dpr = window.devicePixelRatio || 1;
    const { x, y, z } = this.cam;
    if (z * dpr <= this.baseScale * 1.05) {
      this.detailJob?.cancel();
      this.detailCam = null;
      this.detailCanvas.style.display = 'none';
      return;
    }
    // sichtbarer Teil der Seite in Bildschirmkoordinaten
    const sx0 = Math.max(0, Math.floor(x));
    const sy0 = Math.max(0, Math.floor(y));
    const sx1 = Math.min(this.width, Math.ceil(x + geom.w * z));
    const sy1 = Math.min(this.height, Math.ceil(y + geom.h * z));
    if (sx1 <= sx0 || sy1 <= sy0) return;
    this.detailJob?.cancel();
    const c = document.createElement('canvas');
    c.className = 'pdf-detail';
    c.width = Math.round((sx1 - sx0) * dpr);
    c.height = Math.round((sy1 - sy0) * dpr);
    const cam = { ...this.cam };
    const rect = { x: sx0, y: sy0, w: sx1 - sx0, h: sy1 - sy0 };
    const job = renderPage(page, c, z * dpr, (x - sx0) * dpr, (y - sy0) * dpr);
    this.detailJob = job;
    job.promise
      .then(() => {
        if (this.detailJob !== job || this.page !== page) return;
        c.style.width = `${rect.w}px`;
        c.style.height = `${rect.h}px`;
        this.detailCanvas.replaceWith(c);
        this.detailCanvas = c;
        this.detailCam = cam;
        this.detailRect = rect;
        this.applyCameraToDetailOnly();
      })
      .catch((e) => console.error('Detail-Rendern fehlgeschlagen', e));
  }

  private applyCameraToDetailOnly() {
    if (!this.detailCam || !this.detailRect) return;
    const { x, y, z } = this.cam;
    const d = this.detailCam;
    const kk = z / d.z;
    const tx = (this.detailRect.x - d.x) * kk + x;
    const ty = (this.detailRect.y - d.y) * kk + y;
    this.detailCanvas.style.display = '';
    this.detailCanvas.style.transform = `translate(${tx}px, ${ty}px) scale(${kk})`;
  }

  // ---------- Elemente ----------

  renderAnnots(annots: Annot[], ctx: Ctx, hidden?: Set<string>) {
    const key = `${ctx.ptPerM}|${ctx.settings.unit}|${ctx.settings.decimals}`;
    const seen = new Set<string>();
    const layers: SVGGElement[][] = [[], [], []];
    for (const a of annots) {
      seen.add(a.id);
      let c = this.elCache.get(a.id);
      if (!c || c.a !== a || c.key !== key) {
        const el = c?.el ?? (document.createElementNS(SVGNS, 'g') as SVGGElement);
        el.setAttribute('data-id', a.id);
        el.innerHTML = primsToSvg(primsOf(a, ctx));
        if (a.style.opacity < 1) el.setAttribute('opacity', String(a.style.opacity));
        else el.removeAttribute('opacity');
        c = { a, key, el };
        this.elCache.set(a.id, c);
      }
      c.el.style.display = hidden?.has(a.id) ? 'none' : '';
      layers[layerOf(a)].push(c.el);
    }
    for (const id of [...this.elCache.keys()]) if (!seen.has(id)) this.elCache.delete(id);
    syncChildren(this.maskLayer, layers[0]);
    syncChildren(this.fillLayer, layers[1]);
    syncChildren(this.annotLayer, layers[2]);
  }

  renderPreview(annots: Annot[], ctx: Ctx) {
    this.previewLayer.innerHTML = annots.map((a) => `<g${a.style.opacity < 1 ? ` opacity="${a.style.opacity}"` : ''}>${primsToSvg(primsOf(a, ctx))}</g>`).join('');
  }

  /** Bildschirm-Overlay (Griffe, Rahmen, Fangsymbol) als SVG-Markup in Bildschirmkoordinaten. */
  renderUI(markup: string) {
    this.ui.innerHTML = markup;
  }

  showTooltip(text: string | null, sx = 0, sy = 0) {
    if (!text) {
      this.tooltip.style.display = 'none';
      return;
    }
    this.tooltip.textContent = text;
    this.tooltip.style.display = 'block';
    const W = this.width;
    const tx = Math.min(sx + 16, W - this.tooltip.offsetWidth - 4);
    this.tooltip.style.transform = `translate(${tx}px, ${sy + 18}px)`;
  }

  // ---------- Ereignisse ----------

  private ptr(e: PointerEvent | MouseEvent): PtrEvent {
    const r = this.stage.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    return {
      p: this.toPage(sx, sy),
      sx,
      sy,
      shift: e.shiftKey,
      alt: e.altKey,
      meta: e.metaKey || e.ctrlKey,
      button: e.button,
      raw: e,
    };
  }

  private bindEvents() {
    const s = this.stage;
    s.addEventListener('pointerdown', (e) => {
      s.focus({ preventScroll: true });
      if (e.button === 1 || (e.button === 0 && this.cb.panMode())) {
        this.panning = { sx: e.clientX, sy: e.clientY, cx: this.cam.x, cy: this.cam.y, id: e.pointerId };
        s.setPointerCapture(e.pointerId);
        s.classList.add('panning');
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;
      this.pressed = true;
      s.setPointerCapture(e.pointerId);
      this.cb.down(this.ptr(e));
      e.preventDefault();
    });
    s.addEventListener('pointermove', (e) => {
      if (this.panning) {
        this.cam = { ...this.cam, x: this.panning.cx + e.clientX - this.panning.sx, y: this.panning.cy + e.clientY - this.panning.sy };
        this.applyCamera();
        return;
      }
      this.cb.move(this.ptr(e), this.pressed);
    });
    const end = (e: PointerEvent) => {
      if (this.panning) {
        this.panning = null;
        s.classList.remove('panning');
        return;
      }
      if (!this.pressed) return;
      this.pressed = false;
      this.cb.up(this.ptr(e));
    };
    s.addEventListener('pointerup', end);
    s.addEventListener('pointercancel', end);
    s.addEventListener('pointerleave', () => this.cb.leave());
    s.addEventListener('dblclick', (e) => this.cb.dblclick(this.ptr(e)));
    s.addEventListener('contextmenu', (e) => e.preventDefault());
    s.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = s.getBoundingClientRect();
        const anchor = { x: e.clientX - r.left, y: e.clientY - r.top };
        let dx = e.deltaX;
        let dy = e.deltaY;
        if (e.deltaMode === 1) {
          dx *= 16;
          dy *= 16;
        }
        if (e.ctrlKey || e.metaKey || e.altKey) {
          // Pinch-Geste (ctrlKey) oder ⌘/⌥ + Mausrad
          const f = Math.exp(-dy * (e.ctrlKey && !e.metaKey ? 0.01 : 0.0025));
          this.zoomBy(f, anchor);
        } else {
          if (e.shiftKey && !dx) {
            dx = dy;
            dy = 0;
          }
          this.panBy(-dx, -dy);
        }
      },
      { passive: false },
    );
  }
}

function div(cls: string) {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

function g(cls: string) {
  const el = document.createElementNS(SVGNS, 'g') as SVGGElement;
  el.setAttribute('class', cls);
  return el;
}

/** Kinder in gegebener Reihenfolge setzen, ohne unnötige DOM-Operationen. */
function syncChildren(parent: Element, items: Element[]) {
  const cur = parent.children;
  let same = cur.length === items.length;
  if (same) for (let i = 0; i < items.length; i++) if (cur[i] !== items[i]) same = false;
  if (!same) parent.replaceChildren(...items);
}
