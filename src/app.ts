// Grundriss – Hauptanwendung
import { defOf, drawOrder, primsOf, type Ctx, type Handle } from './elements';
import { SYMBOLS } from './elements/symbols';
import { flattenPath, primsBBox } from './render/prims';
import { hitPrims } from './render/hit';
import { primsToSvg } from './render/svg';
import { History } from './editor/doc';
import {
  DEFAULTS,
  loadToolDefaults,
  makeAnnot,
  saveToolDefaults,
  symbolDefaults,
  toolInfo,
  TOOLS,
  type EraserOptions,
  type ToolId,
} from './editor/defaults';
import { findSnap, SegmentIndex, type SnapResult } from './editor/snap';
import {
  BoxTool,
  FreehandTool,
  HandTool,
  PlaceTool,
  PolyTool,
  SelectTool,
  TextTool,
  TwoPointTool,
  type AppApi,
  type Tool,
} from './editor/tools';
import { View, type PtrEvent } from './editor/view';
import { dist, dot, norm, snapAngle, sub, add, mul, uid, MM_TO_PT } from './geom';
import { isPasswordError, openPdf, pageGeom, pageTexts, renderPage, type PageGeom, type PdfDoc, type PdfPage } from './pdf/pdfjs';
import { buildPdf, buildRasterPdf, preparePdf } from './pdf/save';
import { extractSegments } from './pdf/vectors';
import { basename, bridge, dirname, downloadInBrowser, isElectron, isMac, pickFileInBrowser } from './platform';
import type { Annot, PageState, Pt, Scale, Settings, SymbolA, SymbolKind, Unit } from './types';
import { DEFAULT_SCALE, findScaleInText, fmtLen, fmtNum, parseLength, ratioOf, scaleFromRatio } from './units';
import { alertDialog, dialog, h, isEditable, toast } from './ui/dom';
import { icon } from './ui/icons';
import { renderInspector } from './ui/inspector';

const SETTINGS_KEY = 'grundriss.settings.v1';
const UI_KEY = 'grundriss.ui.v1';
const mod = isMac ? '⌘' : 'Strg+';

function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { unit: ['m', 'cm', 'mm'].includes(s.unit) ? s.unit : 'm', decimals: 2 };
  } catch {
    return { unit: 'm', decimals: 2 };
  }
}

export class App implements AppApi {
  // ---- DOM ----
  private root: HTMLElement;
  view!: View;
  private toolbar!: HTMLElement;
  private palette!: HTMLElement;
  private thumbs!: HTMLElement;
  private inspector!: HTMLElement;
  private welcome!: HTMLElement;
  private statusHint!: HTMLElement;
  private statusScale!: HTMLButtonElement;
  private statusZoom!: HTMLButtonElement;
  private statusSnap!: HTMLButtonElement;
  private pageInput!: HTMLInputElement;
  private pageTotal!: HTMLElement;
  private zoomLabel!: HTMLButtonElement;
  private titleEl!: HTMLElement;
  private loading!: HTMLElement;

  // ---- Dokument ----
  private pdf: PdfDoc | null = null;
  private baseBytes: Uint8Array | null = null;
  private encrypted = false;
  private filePath: string | null = null;
  private savePath: string | null = null;
  private fileName = '';
  private geoms: PageGeom[] = [];
  private pageCache = new Map<number, PdfPage>();
  hist = new History([]);
  pageIndex = 0;
  selection = new Set<string>();
  settings: Settings = loadSettings();
  toolDefaults = loadToolDefaults();
  toolId: ToolId = 'select';
  private tool: Tool;
  private prevTool: ToolId = 'select';
  eraser: EraserOptions = { deleteMode: 'touch', cover: true };
  snapEnabled = true;
  private snapMark: SnapResult | null = null;
  private segIndex = new Map<number, SegmentIndex | null | 'loading'>();
  private detected = new Map<number, number | null>();
  private clipboard: Annot[] = [];
  private pasteCount = 0;
  private spaceDown = false;
  private editing: { id: string; el: HTMLTextAreaElement; isNew: boolean } | null = null;
  private inspectorKey = '';
  private frame = 0;
  private loadToken = 0;
  private statusTimer = 0;
  private thumbObserver: IntersectionObserver | null = null;
  private annotSegCache = new WeakMap<Annot, { key: string; segs: [Pt, Pt][] }>();

  constructor(root: HTMLElement) {
    this.root = root;
    this.tool = new SelectTool(this);
    this.buildLayout();
    this.bindKeys();
    this.bindDrop();
    this.restoreUi();
    if (bridge) {
      bridge.onMenu((cmd) => this.command(cmd));
      bridge.onOpenFile((p) => this.openPath(p));
    } else {
      window.addEventListener('beforeunload', (e) => {
        if (this.hist.dirty) e.preventDefault();
      });
    }
    this.updateChrome();
    this.redraw();
  }

  // =====================================================================
  // Layout
  // =====================================================================

  private buildLayout() {
    const tb = (name: string, title: string, cmd: string) =>
      h('button', { class: 'tb-btn', type: 'button', title, 'data-cmd': cmd, html: icon(name), onclick: () => this.command(cmd) });

    this.pageInput = h('input', { class: 'page-input', type: 'text', value: '1', title: 'Seite' });
    this.pageInput.addEventListener('change', () => {
      const n = parseInt(this.pageInput.value, 10);
      if (n >= 1 && n <= this.pageCount) this.showPage(n - 1);
      else this.pageInput.value = String(this.pageIndex + 1);
    });
    this.pageTotal = h('span', { class: 'page-total' }, '/ 0');
    this.zoomLabel = h('button', { class: 'zoom-label', type: 'button', title: 'Ganze Seite', onclick: () => this.command('zoom-fit') }, '100 %');
    this.titleEl = h('div', { class: 'doc-title' }, 'Grundriss');

    this.toolbar = h(
      'header',
      { class: `toolbar ${isElectron && isMac ? 'mac-inset' : ''}` },
      h('div', { class: 'tb-group' }, tb('sidebar', 'Seitenleiste', 'toggle-sidebar'), tb('open', `Öffnen (${mod}O)`, 'open'), tb('save', `Sichern (${mod}S)`, 'save')),
      h('div', { class: 'tb-group' }, tb('undo', `Widerrufen (${mod}Z)`, 'undo'), tb('redo', `Wiederholen (⇧${mod}Z)`, 'redo')),
      h('div', { class: 'tb-group pages' }, tb('prev', 'Vorherige Seite', 'page-prev'), this.pageInput, this.pageTotal, tb('next', 'Nächste Seite', 'page-next')),
      h('div', { class: 'tb-group' }, tb('zoomOut', `Verkleinern (${mod}−)`, 'zoom-out'), this.zoomLabel, tb('zoomIn', `Vergrößern (${mod}+)`, 'zoom-in'), tb('fit', `Ganze Seite (${mod}0)`, 'zoom-fit')),
      this.titleEl,
      h('div', { class: 'tb-group right' }, tb('help', 'Tastaturkürzel', 'show-help'), tb('inspector', 'Eigenschaften', 'toggle-inspector')),
    );

    // Werkzeugpalette
    const groups: { id: string; label: string }[] = [
      { id: 'nav', label: '' },
      { id: 'markup', label: 'Markieren' },
      { id: 'measure', label: 'Messen' },
      { id: 'plan', label: 'Grundriss' },
      { id: 'erase', label: 'Löschen' },
    ];
    this.palette = h('nav', { class: 'palette' });
    for (const g of groups) {
      const items = TOOLS.filter((t) => t.group === g.id);
      if (g.label) this.palette.append(h('div', { class: 'palette-label' }, g.label));
      for (const t of items) {
        this.palette.append(
          h('button', {
            class: 'tool-btn',
            type: 'button',
            'data-tool': t.id,
            title: `${t.label} (${t.key.toUpperCase()})`,
            html: icon(t.id) + `<span class="key">${t.key.toUpperCase()}</span>`,
            onclick: () => this.setTool(t.id),
          }),
        );
      }
    }

    this.thumbs = h('aside', { class: 'thumbs' });
    this.inspector = h('aside', { class: 'inspector' });
    const canvasWrap = h('div', { class: 'canvas-wrap' });

    this.welcome = h(
      'div',
      { class: 'welcome' },
      h(
        'div',
        { class: 'welcome-card' },
        h('div', { class: 'welcome-logo', html: icon('wall') }),
        h('h1', {}, 'Grundriss'),
        h('p', {}, 'PDF-Pläne ansehen, annotieren, maßstäblich messen und mit Grundriss-Elementen ergänzen.'),
        h('button', { class: 'btn primary big', type: 'button', onclick: () => this.command('open') }, 'PDF öffnen …'),
        h('p', { class: 'muted' }, 'oder eine PDF-Datei hierher ziehen'),
        h(
          'ul',
          { class: 'welcome-features' },
          h('li', {}, h('b', {}, 'Messen: '), 'Distanzen, Kettenmaße und Flächen – mit Maßstab (1:50, 1:100 …) oder Kalibrierung an einer bekannten Strecke, Fang auf Linien des Plans.'),
          h('li', {}, h('b', {}, 'Grundriss: '), 'Wände, Türen, Fenster, Treppen, Räume mit Flächenberechnung, Stützen, Möbel und Sanitärobjekte – alle mit Maßen als Parameter.'),
          h('li', {}, h('b', {}, 'Markieren: '), 'Stift, Textmarker, Text, Linien, Pfeile, Rechtecke, Ellipsen, Revisionswolken.'),
          h('li', {}, h('b', {}, 'Bereich löschen: '), 'Elemente in einem Rechteck entfernen und Teile des Plans weiß abdecken.'),
        ),
      ),
    );
    this.loading = h('div', { class: 'loading' }, h('div', { class: 'spinner' }), h('span', {}, 'PDF wird geladen …'));
    canvasWrap.append(this.welcome, this.loading);

    this.statusHint = h('div', { class: 'status-hint' });
    this.statusSnap = h('button', { class: 'status-btn', type: 'button', title: 'Objektfang ein/aus (⌘ gedrückt halten = vorübergehend aus)', onclick: () => this.toggleSnap() });
    this.statusScale = h('button', { class: 'status-btn', type: 'button', title: 'Maßstab der Seite', onclick: () => this.focusScale() });
    this.statusZoom = h('button', { class: 'status-btn', type: 'button', title: 'Ganze Seite', onclick: () => this.command('zoom-fit') });
    const status = h('footer', { class: 'statusbar' }, this.statusHint, this.statusSnap, this.statusScale, this.statusZoom);

    const main = h('div', { class: 'main' }, this.palette, this.thumbs, canvasWrap, this.inspector);
    this.root.append(this.toolbar, main, status);

    this.view = new View(canvasWrap, {
      down: (e) => this.onDown(e),
      move: (e, pressed) => this.onMove(e, pressed),
      up: (e) => this.onUp(e),
      dblclick: (e) => {
        if (this.hasDoc) this.tool.dblclick?.(e);
      },
      panMode: () => this.spaceDown || this.toolId === 'hand' || !this.hasDoc,
      cameraChanged: () => {
        this.updateZoomLabel();
        this.positionTextEditor();
        this.redraw();
      },
      leave: () => {
        this.view.showTooltip(null);
      },
    });
    canvasWrap.insertBefore(this.view.stage, this.welcome);
  }

  private restoreUi() {
    try {
      const ui = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
      if (ui.sidebar === false) this.root.classList.add('no-sidebar');
      if (ui.inspector === false) this.root.classList.add('no-inspector');
      if (ui.snap === false) this.snapEnabled = false;
    } catch {
      /* ignorieren */
    }
  }

  private saveUi() {
    try {
      localStorage.setItem(
        UI_KEY,
        JSON.stringify({
          sidebar: !this.root.classList.contains('no-sidebar'),
          inspector: !this.root.classList.contains('no-inspector'),
          snap: this.snapEnabled,
        }),
      );
    } catch {
      /* ignorieren */
    }
  }

  // =====================================================================
  // Zustand
  // =====================================================================

  get hasDoc() {
    return !!this.pdf;
  }
  get pageCount() {
    return this.geoms.length;
  }
  get annots(): Annot[] {
    return this.hist.pages[this.pageIndex]?.annots ?? [];
  }
  get currentScale(): Scale {
    return this.effectiveScale(this.pageIndex);
  }

  /** Maßstab einer Seite: festgelegt, sonst aus der Planbeschriftung erkannt, sonst 1:100. */
  effectiveScale(i: number): Scale {
    const s = this.hist.pages[i]?.scale;
    if (s) return s;
    const d = this.detected.get(i);
    return d ? scaleFromRatio(d) : DEFAULT_SCALE;
  }
  get ctx(): Ctx {
    return { ptPerM: this.currentScale.ptPerM, settings: this.settings };
  }

  selectedAnnots(): Annot[] {
    return this.annots.filter((a) => this.selection.has(a.id));
  }

  defaults(tool: ToolId) {
    return this.toolDefaults[tool] ?? {};
  }

  detectedScale(i: number) {
    return this.detected.get(i) ?? null;
  }

  setSelection(ids: Iterable<string>) {
    this.selection = new Set(ids);
    this.redraw();
  }

  status(msg: string) {
    this.statusHint.textContent = msg;
    this.statusHint.classList.add('flash');
    window.clearTimeout(this.statusTimer);
    this.statusTimer = window.setTimeout(() => {
      this.statusHint.classList.remove('flash');
      this.updateHint();
    }, 3000);
  }

  private updateHint() {
    if (!this.hasDoc) {
      this.statusHint.textContent = 'Öffne eine PDF (⌘O) oder ziehe sie in das Fenster.';
      return;
    }
    this.statusHint.textContent = toolInfo(this.toolId).hint;
  }

  // =====================================================================
  // Öffnen
  // =====================================================================

  async openPath(path: string) {
    if (!bridge) return;
    if (this.hasDoc) {
      bridge.openPath(path);
      return;
    }
    try {
      const bytes = await bridge.readFile(path);
      await this.openBytes(bytes, basename(path), path);
    } catch (e) {
      console.error(e);
      await alertDialog('Datei konnte nicht geöffnet werden', `${basename(path)}\n${(e as Error).message ?? e}`);
      bridge.setDocState({ hasDoc: false, dirty: false, title: 'Grundriss', path: null });
    }
  }

  async openBytes(bytes: Uint8Array, name: string, path: string | null) {
    const token = ++this.loadToken;
    this.loading.classList.add('show');
    try {
      const prepared = await preparePdf(bytes);
      let pdf: PdfDoc;
      try {
        pdf = await openPdf(prepared.baseBytes);
      } catch (e) {
        if (!isPasswordError(e)) throw e;
        pdf = await this.openWithPassword(prepared.baseBytes);
        prepared.encrypted = true;
      }
      if (token !== this.loadToken) return;
      const old = this.pdf;
      this.pdf = pdf;
      old?.loadingTask.destroy();
      this.baseBytes = prepared.baseBytes;
      this.encrypted = prepared.encrypted;
      this.pageCache.clear();
      this.segIndex.clear();
      this.detected.clear();
      this.geoms = [];
      for (let i = 0; i < pdf.numPages; i++) {
        const page = await pdf.getPage(i + 1);
        this.pageCache.set(i, page);
        this.geoms.push(pageGeom(page));
      }
      const pages: PageState[] = this.geoms.map((_, i) => {
        const p = prepared.data?.pages[i];
        return { annots: Array.isArray(p?.annots) ? p!.annots : [], scale: p?.scale ?? null };
      });
      this.hist = new History(pages);
      this.hist.onChange = () => this.onDocChange();
      this.filePath = path;
      this.fileName = name;
      this.savePath = prepared.data && path ? path : null;
      this.pageIndex = 0;
      this.selection.clear();
      this.root.classList.add('has-doc');
      this.buildThumbs();
      this.showPage(0);
      this.updateChrome();
      if (prepared.warning) toast(prepared.warning, 'error');
      else if (prepared.data) toast('Bearbeitungen geladen – alle Elemente sind wieder bearbeitbar.');
      else if (this.encrypted) toast('Diese PDF ist geschützt. Beim Sichern werden die Seiten als Bild (hohe Auflösung) übernommen.');
    } catch (e) {
      console.error(e);
      if ((e as Error).message !== 'abgebrochen') await alertDialog('PDF konnte nicht geöffnet werden', String((e as Error).message ?? e));
    } finally {
      if (token === this.loadToken) this.loading.classList.remove('show');
      this.updateChrome();
    }
  }

  private async openWithPassword(bytes: Uint8Array): Promise<PdfDoc> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const inp = h('input', { type: 'password', placeholder: 'Kennwort' });
      const res = await dialog(
        'Kennwortgeschützte PDF',
        h('div', {}, h('p', {}, attempt ? 'Das Kennwort ist falsch. Bitte erneut versuchen.' : 'Diese PDF ist mit einem Kennwort geschützt.'), inp),
        [
          { label: 'Abbrechen', value: 'cancel' },
          { label: 'Öffnen', value: 'ok', primary: true },
        ],
      );
      if (res !== 'ok') throw new Error('abgebrochen');
      try {
        return await openPdf(bytes, inp.value);
      } catch (e) {
        if (!isPasswordError(e)) throw e;
      }
    }
    throw new Error('abgebrochen');
  }

  private showPage(i: number, keepCamera = false) {
    if (!this.pdf || i < 0 || i >= this.pageCount) return;
    this.finishTextEdit();
    this.tool.cancel?.();
    if (i !== this.pageIndex) this.selection.clear();
    this.pageIndex = i;
    const page = this.pageCache.get(i)!;
    this.view.setPage(page, this.geoms[i], keepCamera);
    this.pageInput.value = String(i + 1);
    this.thumbs.querySelectorAll('.thumb').forEach((el, k) => el.classList.toggle('active', k === i));
    this.thumbs.querySelector('.thumb.active')?.scrollIntoView({ block: 'nearest' });
    this.inspectorKey = '';
    this.redraw();
    this.updateChrome();
    this.prepareSnap(i);
    this.detectScale(i);
  }

  private prepareSnap(i: number) {
    if (this.segIndex.has(i)) return;
    this.segIndex.set(i, 'loading');
    const page = this.pageCache.get(i);
    if (!page) return;
    const run = () =>
      extractSegments(page, this.geoms[i].transform)
        .then((segs) => this.segIndex.set(i, new SegmentIndex(segs)))
        .catch((e) => {
          console.warn('Vektoren für Fang nicht lesbar', e);
          this.segIndex.set(i, null);
        });
    if ('requestIdleCallback' in window) (window as any).requestIdleCallback(run, { timeout: 1500 });
    else setTimeout(run, 300);
  }

  private async detectScale(i: number) {
    if (this.detected.has(i)) return;
    this.detected.set(i, null);
    const page = this.pageCache.get(i);
    if (!page) return;
    try {
      const n = findScaleInText(await pageTexts(page));
      this.detected.set(i, n);
      if (n && i === this.pageIndex) {
        this.inspectorKey = '';
        this.redraw();
        this.updateChrome();
        if (!this.hist.pages[i].scale) this.status(`Maßstab 1:${n} aus der Planbeschriftung erkannt. Bitte mit einer bekannten Strecke prüfen (Kalibrieren).`);
      }
    } catch {
      /* ignorieren */
    }
  }

  // =====================================================================
  // Miniaturen
  // =====================================================================

  private buildThumbs() {
    this.thumbObserver?.disconnect();
    this.thumbs.replaceChildren();
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          obs.unobserve(el);
          this.renderThumb(Number(el.dataset.page));
        }
      },
      { root: this.thumbs, rootMargin: '200px' },
    );
    this.thumbObserver = obs;
    this.geoms.forEach((g, i) => {
      const w = 132;
      const hgt = Math.round((g.h / g.w) * w);
      const box = h('div', { class: 'thumb-img', style: `width:${w}px;height:${hgt}px` });
      const el = h(
        'button',
        { class: 'thumb', type: 'button', 'data-page': i, onclick: () => this.showPage(i) },
        box,
        h('span', { class: 'thumb-label' }, String(i + 1)),
        h('span', { class: 'thumb-badge' }),
      );
      this.thumbs.append(el);
      obs.observe(el);
    });
    this.updateThumbBadges();
  }

  private async renderThumb(i: number) {
    const page = this.pageCache.get(i);
    const el = this.thumbs.querySelector<HTMLElement>(`.thumb[data-page="${i}"] .thumb-img`);
    if (!page || !el) return;
    const g = this.geoms[i];
    const scale = (132 * (window.devicePixelRatio || 1)) / g.w;
    const c = document.createElement('canvas');
    c.width = Math.round(g.w * scale);
    c.height = Math.round(g.h * scale);
    await renderPage(page, c, scale).promise;
    el.replaceChildren(c);
  }

  private updateThumbBadges() {
    this.thumbs.querySelectorAll<HTMLElement>('.thumb').forEach((el, i) => {
      const n = this.hist.pages[i]?.annots.length ?? 0;
      const b = el.querySelector('.thumb-badge')!;
      b.textContent = n ? String(n) : '';
    });
  }

  // =====================================================================
  // Rendering
  // =====================================================================

  redraw() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private render() {
    this.updateInspector();
    if (!this.hasDoc) return;
    const ctx = this.ctx;
    this.view.renderAnnots(this.annots, ctx, this.editing ? new Set([this.editing.id]) : undefined);
    this.view.renderPreview(this.tool.preview?.() ?? [], ctx);
    this.view.renderUI(this.overlayMarkup());
    const tt = this.tool.tooltip?.();
    const ls = this.tool.lastScreen;
    this.view.showTooltip(tt ?? null, ls?.x ?? 0, ls?.y ?? 0);
  }

  private overlayMarkup(): string {
    const v = this.view;
    let out = '';
    const sel = this.selectedAnnots();
    const showHandles = sel.length <= 30 && (this.toolId === 'select' || this.toolId === 'hand');
    for (const a of sel) {
      const prims = primsOf(a, this.ctx);
      const bb = primsBBox(prims);
      const p0 = v.toScreen({ x: bb.x, y: bb.y });
      const p1 = v.toScreen({ x: bb.x + bb.w, y: bb.y + bb.h });
      out += `<rect class="sel-box" x="${p0.x - 3}" y="${p0.y - 3}" width="${p1.x - p0.x + 6}" height="${p1.y - p0.y + 6}"/>`;
      if (!showHandles) continue;
      const hs = defOf(a).handles(a as never, this.ctx);
      if ('p' in a && hs.some((x) => x.type === 'rotate')) {
        const c = v.toScreen((a as { p: Pt }).p);
        const r = v.toScreen(hs.find((x) => x.type === 'rotate')!.p);
        out += `<line class="rot-line" x1="${c.x}" y1="${c.y}" x2="${r.x}" y2="${r.y}"/>`;
      }
      for (const hd of hs) out += handleMarkup(v.toScreen(hd.p), hd);
    }
    out += this.tool.overlay?.() ?? '';
    if (this.snapMark) {
      const s = v.toScreen(this.snapMark.p);
      const k = this.snapMark.kind;
      if (k === 'end') out += `<rect class="snap" x="${s.x - 5}" y="${s.y - 5}" width="10" height="10"/>`;
      else if (k === 'mid') out += `<path class="snap" d="M${s.x} ${s.y - 6}L${s.x + 6} ${s.y + 5}L${s.x - 6} ${s.y + 5}Z"/>`;
      else if (k === 'cross') out += `<path class="snap" d="M${s.x - 5} ${s.y - 5}L${s.x + 5} ${s.y + 5}M${s.x + 5} ${s.y - 5}L${s.x - 5} ${s.y + 5}"/>`;
      else out += `<circle class="snap" cx="${s.x}" cy="${s.y}" r="4.5"/>`;
    }
    return out;
  }

  private updateInspector() {
    const sel = this.selectedAnnots();
    const key = [this.toolId, this.pageIndex, this.hasDoc, this.settings.unit, this.currentScale.ptPerM, this.detected.get(this.pageIndex) ?? '', ...sel.map((a) => a.id)].join('|');
    const selKey = sel;
    if (key === this.inspectorKey && sameRefs(selKey, this.lastInspected)) return;
    // Nicht neu aufbauen, solange der Nutzer im Panel tippt
    const active = document.activeElement;
    if (key === this.inspectorKey && active && this.inspector.contains(active) && isEditable(active)) {
      this.lastInspected = selKey;
      return;
    }
    this.inspectorKey = key;
    this.lastInspected = selKey;
    const scroll = this.inspector.scrollTop;
    renderInspector(this, this.inspector);
    this.inspector.scrollTop = scroll;
  }
  private lastInspected: Annot[] = [];

  private updateChrome() {
    const dirty = this.hist.dirty;
    const name = this.fileName || 'Grundriss';
    this.titleEl.textContent = this.hasDoc ? `${name}${dirty ? ' — bearbeitet' : ''}` : 'Grundriss';
    document.title = this.hasDoc ? `${dirty ? '• ' : ''}${name} – Grundriss` : 'Grundriss';
    this.pageTotal.textContent = `/ ${this.pageCount}`;
    this.palette.querySelectorAll<HTMLElement>('.tool-btn').forEach((b) => b.classList.toggle('active', b.dataset.tool === this.toolId));
    this.toolbar.querySelector<HTMLButtonElement>('[data-cmd="undo"]')!.disabled = !this.hist.canUndo;
    this.toolbar.querySelector<HTMLButtonElement>('[data-cmd="redo"]')!.disabled = !this.hist.canRedo;
    this.toolbar.querySelector<HTMLButtonElement>('[data-cmd="save"]')!.disabled = !this.hasDoc;
    this.toolbar.querySelector<HTMLButtonElement>('[data-cmd="page-prev"]')!.disabled = this.pageIndex <= 0;
    this.toolbar.querySelector<HTMLButtonElement>('[data-cmd="page-next"]')!.disabled = this.pageIndex >= this.pageCount - 1;
    this.statusSnap.innerHTML = `${icon('magnet')}<span>Fang ${this.snapEnabled ? 'ein' : 'aus'}</span>`;
    this.statusSnap.classList.toggle('off', !this.snapEnabled);
    const sc = this.currentScale;
    const explicit = !!this.hist.pages[this.pageIndex]?.scale;
    const detected = !explicit && !!this.detected.get(this.pageIndex);
    this.statusScale.textContent = this.hasDoc
      ? `Maßstab ${sc.label.startsWith('kalibriert') ? `kalibriert (≈1:${fmtNum(ratioOf(sc), 0)})` : sc.label}${explicit ? '' : detected ? ' (aus Plan)' : ' (angenommen)'}`
      : '';
    this.statusScale.classList.toggle('warn', this.hasDoc && !explicit && !detected);
    this.updateZoomLabel();
    this.updateHint();
    this.view.stage.style.cursor = this.spaceDown ? 'grab' : this.tool.cursor;
    if (bridge) {
      const st = { hasDoc: this.hasDoc, dirty, title: this.hasDoc ? name : 'Grundriss', path: this.savePath ?? this.filePath };
      const key = JSON.stringify(st);
      if (key !== this.lastDocState) {
        this.lastDocState = key;
        bridge.setDocState(st);
      }
    }
  }
  private lastDocState = '';

  private updateZoomLabel() {
    const z = Math.round(this.view.cam.z * 100);
    this.zoomLabel.textContent = `${z} %`;
    this.statusZoom.textContent = this.hasDoc ? `${z} %` : '';
  }

  private onDocChange() {
    // Auswahl bereinigen
    const ids = new Set(this.annots.map((a) => a.id));
    for (const id of [...this.selection]) if (!ids.has(id)) this.selection.delete(id);
    this.redraw();
    this.updateChrome();
    this.updateThumbBadges();
  }

  // =====================================================================
  // Werkzeuge & Interaktion
  // =====================================================================

  setTool(id: ToolId) {
    if (!TOOLS.some((t) => t.id === id)) return;
    this.finishTextEdit();
    this.tool.cancel?.();
    if (this.toolId !== id && this.toolId !== 'calibrate') this.prevTool = this.toolId;
    this.toolId = id;
    switch (id) {
      case 'select':
        this.tool = new SelectTool(this);
        break;
      case 'hand':
        this.tool = new HandTool();
        break;
      case 'line':
      case 'arrow':
      case 'measure':
      case 'calibrate':
        this.tool = new TwoPointTool(this, id);
        break;
      case 'rect':
      case 'ellipse':
      case 'cloud':
      case 'eraser':
        this.tool = new BoxTool(this, id);
        break;
      case 'polyline':
      case 'pathlen':
      case 'area':
      case 'wall':
      case 'room':
        this.tool = new PolyTool(this, id);
        break;
      case 'pen':
      case 'highlight':
        this.tool = new FreehandTool(this, id);
        break;
      case 'text':
        this.tool = new TextTool(this);
        break;
      default:
        this.tool = new PlaceTool(this, id);
    }
    if (id !== 'select' && id !== 'hand') this.selection.clear();
    this.snapMark = null;
    this.view.showTooltip(null);
    this.updateChrome();
    this.redraw();
  }

  private onDown(e: PtrEvent) {
    if (!this.hasDoc) return;
    if (this.editing) {
      this.finishTextEdit();
      if (this.toolId === 'text') return;
    }
    this.tool.down?.(e);
    this.redraw();
  }

  private onMove(e: PtrEvent, pressed: boolean) {
    if (!this.hasDoc) return;
    this.tool.move?.(e, pressed);
    if (!this.tool.lastScreen) this.view.showTooltip(null);
  }

  private onUp(e: PtrEvent) {
    if (!this.hasDoc) return;
    this.tool.up?.(e);
    this.redraw();
  }

  clearSnap() {
    this.snapMark = null;
  }

  private annotSegments(exclude?: Set<string>): [Pt, Pt][] {
    const ctx = this.ctx;
    const key = `${ctx.ptPerM}|${ctx.settings.unit}`;
    const out: [Pt, Pt][] = [];
    for (const a of this.annots) {
      if (exclude?.has(a.id) || a.kind === 'whiteout' || a.kind === 'freehand') continue;
      let c = this.annotSegCache.get(a);
      if (!c || c.key !== key) {
        const segs: [Pt, Pt][] = [];
        for (const p of primsOf(a, ctx)) {
          if (p.t !== 'path' || p.noHit || p.mask) continue;
          for (const poly of flattenPath(p.d, 4)) for (let i = 1; i < poly.length; i++) segs.push([poly[i - 1], poly[i]]);
        }
        c = { key, segs };
        this.annotSegCache.set(a, c);
      }
      out.push(...c.segs);
    }
    return out;
  }

  snap(e: PtrEvent, from?: Pt | null, exclude?: Set<string>, extra?: Pt[]): Pt {
    let p = e.p;
    const constrained = !!from && e.shift;
    if (constrained) p = snapAngle(from!, p, 45);
    if (!this.snapEnabled || e.meta) {
      this.snapMark = null;
      return p;
    }
    const idx = this.segIndex.get(this.pageIndex);
    const s = findSnap(e.p, this.view.px(10), {
      pdf: idx instanceof SegmentIndex ? idx : null,
      annotSegs: this.annotSegments(exclude),
      extraPoints: extra,
    });
    if (!s) {
      this.snapMark = null;
      return p;
    }
    if (constrained) {
      const d = norm(sub(p, from!));
      if (dist(p, from!) < 1e-9) return p;
      const q = add(from!, mul(d, dot(sub(s.p, from!), d)));
      this.snapMark = { p: q, kind: s.kind };
      return q;
    }
    this.snapMark = s;
    return s.p;
  }

  hitTest(p: Pt): Annot | null {
    const tol = this.view.px(5);
    const ctx = this.ctx;
    const list = drawOrder(this.annots);
    for (let i = list.length - 1; i >= 0; i--) {
      if (hitPrims(primsOf(list[i], ctx), p, tol)) return list[i];
    }
    return null;
  }

  handleAt(sx: number, sy: number): { annot: Annot; index: number; handle: Handle } | null {
    const sel = this.selectedAnnots();
    if (sel.length > 30) return null;
    for (const a of sel) {
      const hs = defOf(a).handles(a as never, this.ctx);
      for (let i = hs.length - 1; i >= 0; i--) {
        const s = this.view.toScreen(hs[i].p);
        if (Math.hypot(s.x - sx, s.y - sy) <= 7) return { annot: a, index: i, handle: hs[i] };
      }
    }
    return null;
  }

  focusParam(key: string) {
    requestAnimationFrame(() => {
      const el = this.inspector.querySelector<HTMLInputElement>(`[data-key="${key}"]`);
      el?.focus();
      el?.select?.();
    });
  }

  private focusScale() {
    if (this.root.classList.contains('no-inspector')) this.command('toggle-inspector');
    this.setTool(this.toolId);
    requestAnimationFrame(() => this.inspector.querySelector<HTMLSelectElement>('[data-key="page-scale"]')?.focus());
  }

  private toggleSnap() {
    this.snapEnabled = !this.snapEnabled;
    this.saveUi();
    this.updateChrome();
  }

  // ---- Panel-Callbacks ----

  applyToSelection(fn: (a: Annot) => Annot, live: boolean) {
    const sel = this.selectedAnnots();
    if (!sel.length) return;
    if (live) this.hist.begin();
    this.hist.replace(this.pageIndex, sel.map(fn));
    if (!live && this.hist.inTxn) this.hist.commit();
  }

  toolDefaultsChanged() {
    saveToolDefaults(this.toolDefaults);
    this.inspectorKey = '';
    this.redraw();
  }

  resetToolDefaults(tool: ToolId) {
    this.toolDefaults[tool] = structuredClone(DEFAULTS[tool]);
    this.toolDefaultsChanged();
  }

  eraserChanged() {
    this.inspectorKey = '';
    this.redraw();
  }

  setPageScaleRatio(n: number) {
    this.hist.updatePage(this.pageIndex, (p) => ({ ...p, scale: scaleFromRatio(n) }));
    this.inspectorKey = '';
    this.status(`Maßstab 1:${n} für Seite ${this.pageIndex + 1} festgelegt`);
  }

  applyScaleToAllPages() {
    const sc = this.currentScale;
    this.hist.set(this.hist.pages.map((p) => ({ ...p, scale: sc })));
    this.status(`Maßstab ${sc.label} für alle ${this.pageCount} Seiten übernommen`);
  }

  setUnit(u: Unit) {
    this.settings = { ...this.settings, unit: u };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* ignorieren */
    }
    this.inspectorKey = '';
    this.redraw();
  }

  async calibrate(lenPt: number) {
    const unit = this.settings.unit;
    const current = lenPt / this.ctx.ptPerM;
    const inp = h('input', { type: 'text', inputmode: 'decimal', value: fmtLen(current, this.settings, false) });
    const all = h('input', { type: 'checkbox', checked: this.pageCount > 1 && this.hist.pages.every((p) => !p.scale) });
    const paperMm = lenPt / MM_TO_PT;
    const body = h(
      'div',
      { class: 'calib' },
      h('p', {}, `Abgegriffene Strecke: ${fmtNum(paperMm, 1)} mm auf dem Papier.`),
      h('label', { class: 'insp-row' }, h('span', { class: 'insp-label' }, 'Reale Länge'), h('span', { class: 'insp-control' }, inp, h('span', { class: 'suffix' }, unit))),
      this.pageCount > 1 ? h('label', { class: 'insp-check' }, all, h('span', {}, 'Für alle Seiten übernehmen')) : null,
    );
    const res = await dialog('Maßstab kalibrieren', body, [
      { label: 'Abbrechen', value: 'cancel' },
      { label: 'Übernehmen', value: 'ok', primary: true },
    ]);
    if (res !== 'ok') return;
    const m = parseLength(inp.value, unit);
    if (!m || m <= 0) {
      toast('Ungültige Länge', 'error');
      return;
    }
    const scale: Scale = { ptPerM: lenPt / m, label: 'kalibriert' };
    const ratio = ratioOf(scale);
    // Nahe an einem Normmaßstab? Dann diesen verwenden (z. B. 1:100 statt 1:99,7)
    const near = [1, 2, 5, 10, 20, 25, 50, 75, 100, 200, 250, 500, 1000].find((n) => Math.abs(ratio - n) / n < 0.004);
    const final = near ? scaleFromRatio(near) : scale;
    if (all.checked && this.pageCount > 1) this.hist.set(this.hist.pages.map((p) => ({ ...p, scale: final })));
    else this.hist.updatePage(this.pageIndex, (p) => ({ ...p, scale: final }));
    toast(near ? `Maßstab 1:${near} erkannt und übernommen.` : `Kalibriert: 1 m ≙ ${fmtNum(final.ptPerM / MM_TO_PT, 2)} mm (≈ 1:${fmtNum(ratio, 1)})`);
    this.setTool(this.prevTool === 'calibrate' || this.prevTool === 'select' ? 'measure' : this.prevTool);
  }

  symbolPreviewSvg(k: SymbolKind): string {
    const info = SYMBOLS[k];
    const ptPerM = 40 / Math.max(info.w, info.d);
    const a = makeAnnot<SymbolA>(this.toolDefaults.symbol, { ...symbolDefaults(k), p: { x: 0, y: 0 }, angle: 0, mirror: false, chairs: true } as never, 'p');
    a.style = { ...a.style, stroke: 'currentColor', width: 0.4 };
    const prims = primsOf(a, { ptPerM, settings: this.settings });
    const bb = primsBBox(prims);
    const pad = 2;
    return `<svg viewBox="${bb.x - pad} ${bb.y - pad} ${bb.w + 2 * pad} ${bb.h + 2 * pad}" width="44" height="44">${primsToSvg(prims).replace(/#ffffff/g, 'transparent')}</svg>`;
  }

  // =====================================================================
  // Text bearbeiten
  // =====================================================================

  editText(id: string, isNew: boolean) {
    this.finishTextEdit();
    const a = this.annots.find((x) => x.id === id);
    if (!a || a.kind !== 'text') return;
    this.setSelection([id]);
    this.hist.begin();
    const el = h('textarea', { class: 'text-editor', spellcheck: 'false' }) as HTMLTextAreaElement;
    el.value = a.text;
    this.view.stage.append(el);
    this.editing = { id, el, isNew };
    this.positionTextEditor();
    el.addEventListener('input', () => {
      const cur = this.annots.find((x) => x.id === id);
      if (cur && cur.kind === 'text') this.hist.replace(this.pageIndex, [{ ...cur, text: el.value }]);
      this.positionTextEditor();
    });
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        this.finishTextEdit();
      }
    });
    el.addEventListener('blur', () => setTimeout(() => this.finishTextEdit(), 0));
    el.focus();
    el.select();
    requestAnimationFrame(() => {
      if (this.editing?.el === el && document.activeElement !== el) el.focus();
    });
    this.redraw();
  }

  private positionTextEditor() {
    if (!this.editing) return;
    const a = this.annots.find((x) => x.id === this.editing!.id);
    if (!a || a.kind !== 'text') return;
    const el = this.editing.el;
    const z = this.view.cam.z;
    const s = this.view.toScreen(a.p);
    const fs = a.size * z;
    el.style.fontSize = `${fs}px`;
    el.style.lineHeight = '1.2';
    el.style.color = a.style.stroke;
    el.style.fontWeight = a.bold ? 'bold' : 'normal';
    el.style.left = `${s.x}px`;
    el.style.top = `${s.y - fs * 0.05}px`;
    el.style.transform = a.angle ? `rotate(${a.angle}deg)` : '';
    const lines = el.value.split('\n');
    el.style.width = `${Math.max(4, ...lines.map((l) => l.length + 2)) * fs * 0.6}px`;
    el.style.height = `${lines.length * fs * 1.2 + fs * 0.4}px`;
  }

  private finishTextEdit() {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    ed.el.remove();
    const a = this.annots.find((x) => x.id === ed.id);
    const empty = !a || (a.kind === 'text' && !a.text.trim());
    if (empty) {
      this.hist.rollback();
      if (ed.isNew) this.hist.undo();
      else this.hist.remove(this.pageIndex, new Set([ed.id]));
      this.selection.delete(ed.id);
    } else this.hist.commit();
    this.view.stage.focus({ preventScroll: true });
    this.redraw();
  }

  // =====================================================================
  // Befehle
  // =====================================================================

  async command(cmd: string) {
    const active = document.activeElement;
    const inField = isEditable(active) && !this.view.stage.contains(active as Node);
    const nativeMap: Record<string, string> = { undo: 'undo', redo: 'redo', cut: 'cut', copy: 'copy', paste: 'paste', 'select-all': 'selectAll' };
    if ((inField || this.editing) && nativeMap[cmd]) {
      if (bridge) bridge.nativeEdit(nativeMap[cmd]);
      else document.execCommand(nativeMap[cmd] === 'selectAll' ? 'selectAll' : nativeMap[cmd]);
      return;
    }
    switch (cmd) {
      case 'open':
        if (bridge) await bridge.showOpenDialog();
        else {
          const f = await pickFileInBrowser();
          if (f) await this.openBytes(new Uint8Array(await f.arrayBuffer()), f.name, null);
        }
        break;
      case 'save':
        await this.save(false);
        break;
      case 'save-as':
        await this.save(true);
        break;
      case 'export-flat':
        await this.save(true, true);
        break;
      case 'save-and-close':
        if (await this.save(false)) bridge?.closeWindow();
        break;
      case 'undo':
        this.tool.cancel?.();
        this.hist.undo();
        break;
      case 'redo':
        this.hist.redo();
        break;
      case 'delete':
        if (this.selection.size) {
          this.hist.remove(this.pageIndex, this.selection);
          this.selection = new Set();
        }
        break;
      case 'select-all':
        if (!this.hasDoc) break;
        if (this.toolId !== 'select') this.setTool('select');
        this.setSelection(this.annots.map((a) => a.id));
        break;
      case 'copy':
      case 'cut': {
        const sel = this.selectedAnnots();
        if (!sel.length) break;
        this.clipboard = structuredClone(sel);
        this.pasteCount = 0;
        if (cmd === 'cut') {
          this.hist.remove(this.pageIndex, this.selection);
          this.selection = new Set();
        }
        this.status(`${sel.length} Element${sel.length === 1 ? '' : 'e'} ${cmd === 'cut' ? 'ausgeschnitten' : 'kopiert'}`);
        break;
      }
      case 'paste':
        this.paste();
        break;
      case 'duplicate': {
        const sel = this.selectedAnnots();
        if (!sel.length) break;
        const off = { x: this.view.px(12), y: this.view.px(12) };
        const copies = sel.map((a) => defOf(a).translate({ ...structuredClone(a), id: uid() } as never, off) as Annot);
        this.hist.add(this.pageIndex, copies);
        this.setSelection(copies.map((c) => c.id));
        break;
      }
      case 'bring-front':
      case 'send-back': {
        if (!this.selection.size) break;
        this.hist.updateAnnots(this.pageIndex, (arr) => {
          const sel = arr.filter((a) => this.selection.has(a.id));
          const rest = arr.filter((a) => !this.selection.has(a.id));
          return cmd === 'bring-front' ? [...rest, ...sel] : [...sel, ...rest];
        });
        break;
      }
      case 'zoom-in':
        this.view.zoomBy(1.25);
        break;
      case 'zoom-out':
        this.view.zoomBy(1 / 1.25);
        break;
      case 'zoom-fit':
        this.view.fit('page');
        break;
      case 'zoom-width':
        this.view.fit('width');
        break;
      case 'zoom-100':
        this.view.setZoom(1);
        break;
      case 'page-prev':
        this.showPage(this.pageIndex - 1);
        break;
      case 'page-next':
        this.showPage(this.pageIndex + 1);
        break;
      case 'toggle-sidebar':
        this.root.classList.toggle('no-sidebar');
        this.saveUi();
        break;
      case 'toggle-inspector':
        this.root.classList.toggle('no-inspector');
        this.saveUi();
        break;
      case 'show-help':
        this.showHelp();
        break;
    }
    this.redraw();
  }

  private paste() {
    if (!this.clipboard.length || !this.hasDoc) return;
    this.pasteCount++;
    const off = { x: this.view.px(12) * this.pasteCount, y: this.view.px(12) * this.pasteCount };
    const ids = new Set(this.annots.map((a) => a.id));
    const sameIds = this.clipboard.every((a) => ids.has(a.id));
    const items = this.clipboard.map((a) => {
      const c = { ...structuredClone(a), id: uid() } as Annot;
      return sameIds ? (defOf(c).translate(c as never, off) as Annot) : c;
    });
    this.hist.add(this.pageIndex, items);
    if (this.toolId !== 'select') this.setTool('select');
    this.setSelection(items.map((a) => a.id));
  }

  // =====================================================================
  // Sichern
  // =====================================================================

  private async renderRaster(i: number) {
    const page = this.pageCache.get(i)!;
    const g = this.geoms[i];
    const dpi = 200;
    let scale = dpi / 72;
    const maxSide = 9000;
    const maxPx = 60e6;
    scale = Math.min(scale, maxSide / Math.max(g.w, g.h), Math.sqrt(maxPx / (g.w * g.h)));
    const c = document.createElement('canvas');
    c.width = Math.round(g.w * scale);
    c.height = Math.round(g.h * scale);
    await renderPage(page, c, scale).promise;
    const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('JPEG-Erzeugung fehlgeschlagen'))), 'image/jpeg', 0.9));
    return { jpeg: new Uint8Array(await blob.arrayBuffer()), w: g.w, h: g.h };
  }

  private async save(as: boolean, flat = false): Promise<boolean> {
    if (!this.hasDoc || !this.baseBytes) return false;
    this.finishTextEdit();
    this.tool.cancel?.();
    let bytes: Uint8Array;
    this.loading.querySelector('span')!.textContent = 'PDF wird gesichert …';
    this.loading.classList.add('show');
    try {
      const opts = { embedData: !flat };
      // nicht festgelegte Maßstäbe mit dem tatsächlich verwendeten Wert speichern
      const pages = this.hist.pages.map((p, i) => (p.scale ? p : { ...p, scale: this.effectiveScale(i) }));
      const raster = () => buildRasterPdf(this.baseBytes!, (i) => this.renderRaster(i), this.pageCount, pages, this.settings, opts);
      if (this.encrypted) bytes = await raster();
      else {
        try {
          bytes = await buildPdf(
            this.baseBytes,
            pages,
            this.geoms.map((g) => g.transform),
            this.settings,
            opts,
          );
        } catch (e) {
          // PDF-Struktur nicht beschreibbar (z. B. beschädigt/geschützt) → als Bild-PDF sichern
          console.warn('Vektor-Sichern nicht möglich, verwende Bild-PDF', e);
          bytes = await raster();
          this.encrypted = true;
          toast('Diese PDF lässt sich nicht direkt verändern – die Seiten wurden als Bild (200 dpi) übernommen.');
        }
      }
    } catch (e) {
      console.error(e);
      await alertDialog('Sichern fehlgeschlagen', String((e as Error).message ?? e));
      return false;
    } finally {
      this.loading.classList.remove('show');
      this.loading.querySelector('span')!.textContent = 'PDF wird geladen …';
    }
    const stem = this.fileName.replace(/\.pdf$/i, '');
    const suggested = flat ? `${stem} (flach).pdf` : this.savePath ? basename(this.savePath) : `${stem} annotiert.pdf`;
    if (bridge) {
      let target = !as && !flat ? this.savePath : null;
      if (!target) {
        const dir = this.filePath ? dirname(this.filePath) : '';
        target = await bridge.showSaveDialog(dir ? `${dir}/${suggested}` : suggested);
        if (!target) return false;
      }
      try {
        await bridge.writeFile(target, bytes);
      } catch (e) {
        await alertDialog('Sichern fehlgeschlagen', String((e as Error).message ?? e));
        return false;
      }
      if (!flat) {
        this.savePath = target;
        this.filePath = target;
        this.fileName = basename(target);
        this.hist.markSaved();
      }
      toast(flat ? `Exportiert: ${basename(target)}` : `Gesichert: ${basename(target)}`);
    } else {
      downloadInBrowser(bytes, suggested);
      if (!flat) this.hist.markSaved();
      toast(`Heruntergeladen: ${suggested}`);
    }
    this.updateChrome();
    return true;
  }

  // =====================================================================
  // Tastatur, Drag & Drop
  // =====================================================================

  private bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (document.querySelector('.modal-back')) return;
      const active = document.activeElement;
      const inField = isEditable(active);
      const metaKey = isMac ? e.metaKey : e.ctrlKey;
      if (inField) {
        if (e.key === 'Escape') (active as HTMLElement).blur();
        // ⌘-Kürzel im Browser-Modus trotzdem für Sichern/Öffnen zulassen
        if (!bridge && metaKey && ['s', 'o'].includes(e.key.toLowerCase())) {
          e.preventDefault();
          this.command(e.key.toLowerCase() === 's' ? (e.shiftKey ? 'save-as' : 'save') : 'open');
        }
        return;
      }
      if (e.key === ' ' && !e.repeat) {
        this.spaceDown = true;
        this.view.stage.style.cursor = 'grab';
        e.preventDefault();
        return;
      }
      if (metaKey) {
        if (!bridge) this.browserShortcut(e);
        return;
      }
      if (!this.hasDoc) return;
      if (this.tool.key?.(e)) {
        e.preventDefault();
        return;
      }
      switch (e.key) {
        case 'Escape':
          if (this.tool.busy?.()) this.tool.cancel?.();
          else if (this.selection.size) this.setSelection([]);
          else if (this.toolId !== 'select') this.setTool('select');
          this.snapMark = null;
          this.redraw();
          e.preventDefault();
          return;
        case 'Delete':
        case 'Backspace':
          this.command('delete');
          e.preventDefault();
          return;
        case 'PageUp':
          this.command('page-prev');
          e.preventDefault();
          return;
        case 'PageDown':
          this.command('page-next');
          e.preventDefault();
          return;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          e.preventDefault();
          const step = this.view.px(e.shiftKey ? 10 : 1);
          const d = { x: e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, y: e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0 };
          if (this.selection.size) this.hist.replace(this.pageIndex, this.selectedAnnots().map((a) => defOf(a).translate(a as never, d) as Annot));
          else this.view.panBy(-d.x * this.view.cam.z * 20, -d.y * this.view.cam.z * 20);
          return;
        }
      }
      if (e.key.length === 1 && !e.altKey) {
        const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
        if (t) {
          this.setTool(t.id);
          e.preventDefault();
        }
      }
    });
    document.addEventListener('keyup', (e) => {
      if (e.key === ' ') {
        this.spaceDown = false;
        this.view.stage.style.cursor = this.tool.cursor;
      }
    });
    window.addEventListener('blur', () => {
      this.spaceDown = false;
    });
  }

  /** Tastenkürzel, wenn kein natives Menü vorhanden ist (Browser). */
  private browserShortcut(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    const map: Record<string, string> = {
      z: e.shiftKey ? 'redo' : 'undo',
      y: 'redo',
      s: e.shiftKey ? 'save-as' : 'save',
      o: 'open',
      c: 'copy',
      x: 'cut',
      v: 'paste',
      d: 'duplicate',
      a: 'select-all',
      '+': 'zoom-in',
      '=': 'zoom-in',
      '-': 'zoom-out',
      '0': 'zoom-fit',
      '9': 'zoom-width',
      '1': 'zoom-100',
      '/': 'show-help',
    };
    const cmd = map[k];
    if (cmd) {
      e.preventDefault();
      this.command(cmd);
    }
  }

  private bindDrop() {
    const root = this.root;
    root.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        root.classList.add('dragging');
      }
    });
    root.addEventListener('dragleave', (e) => {
      if (e.target === root || !root.contains(e.relatedTarget as Node)) root.classList.remove('dragging');
    });
    root.addEventListener('drop', async (e) => {
      e.preventDefault();
      root.classList.remove('dragging');
      const files = [...(e.dataTransfer?.files ?? [])].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
      if (!files.length) {
        toast('Bitte eine PDF-Datei ablegen.', 'error');
        return;
      }
      for (const f of files) {
        const path = bridge?.pathForFile(f) ?? null;
        if (bridge && path) {
          if (this.hasDoc) bridge.openPath(path);
          else await this.openPath(path);
        } else if (!this.hasDoc || !bridge) {
          await this.openBytes(new Uint8Array(await f.arrayBuffer()), f.name, null);
          break;
        }
      }
    });
  }

  private showHelp() {
    const rows: [string, string][] = [
      ...TOOLS.map((t) => [t.key.toUpperCase(), t.label] as [string, string]),
      ['Leertaste + Ziehen', 'Ansicht verschieben'],
      ['Zwei-Finger-Scrollen', 'Ansicht verschieben'],
      [`Pinch / ${mod}+Scrollen`, 'Zoomen'],
      ['⇧ beim Zeichnen', '45°-Winkel / Quadrat / Kreis'],
      [`${mod} gedrückt halten`, 'Fang vorübergehend aus'],
      ['Zahl + ↩ beim Zeichnen', 'Länge eingeben (z. B. 3,65 oder 120cm)'],
      ['↩ / Doppelklick', 'Polylinie, Wand, Fläche, Raum abschließen'],
      ['⌫', 'Auswahl löschen / letzten Punkt entfernen'],
      ['Esc', 'Abbrechen / Auswahl aufheben / zurück zur Auswahl'],
      ['Pfeiltasten', 'Auswahl verschieben (⇧ = ×10)'],
      ['⌥ + Ziehen', 'Kopie verschieben'],
      ['R / X / F (Platzieren)', 'drehen / spiegeln (Anschlag) / Aufschlag'],
      [`${mod}Z / ⇧${mod}Z`, 'Widerrufen / Wiederholen'],
      [`${mod}C / ${mod}V / ${mod}D`, 'Kopieren / Einsetzen / Duplizieren'],
      [`${mod}S / ⇧${mod}S`, 'Sichern / Sichern unter'],
      [`${mod}0 / ${mod}1`, 'Ganze Seite / 100 %'],
    ];
    const table = h('table', { class: 'help-table' }, ...rows.map(([k, v]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, v))));
    dialog('Tastaturkürzel', h('div', { class: 'help-body' }, table), [{ label: 'Schließen', value: 'ok', primary: true }]);
  }
}

function sameRefs(a: Annot[], b: Annot[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function handleMarkup(s: Pt, hd: Handle): string {
  switch (hd.type) {
    case 'rotate':
      return `<circle class="handle rot" cx="${s.x}" cy="${s.y}" r="5.5"/>`;
    case 'offset':
      return `<path class="handle" d="M${s.x} ${s.y - 6}L${s.x + 6} ${s.y}L${s.x} ${s.y + 6}L${s.x - 6} ${s.y}Z"/>`;
    case 'label':
      return `<circle class="handle label" cx="${s.x}" cy="${s.y}" r="4.5"/>`;
    case 'size':
      return `<rect class="handle size" x="${s.x - 5}" y="${s.y - 5}" width="10" height="10"/>`;
    default:
      return `<rect class="handle" x="${s.x - 4.5}" y="${s.y - 4.5}" width="9" height="9"/>`;
  }
}

