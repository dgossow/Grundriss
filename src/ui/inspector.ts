// Eigenschaften-Panel: Parameter der Auswahl bzw. Voreinstellungen des Werkzeugs, Seitenmaßstab.
import { defOf, type ParamDef, type StyleKey } from '../elements';
import { SYMBOLS } from '../elements/symbols';
import { symbolDefaults, toolInfo, TOOLS, type ToolId } from '../editor/defaults';
import type { Annot, Kind, Style, SymbolKind } from '../types';
import { fmtNum, parseLength, parseNumber, ratioOf, SCALE_PRESETS } from '../units';
import type { App } from '../app';
import { h } from './dom';
import { icon } from './icons';

const COLOR_PRESETS = ['#1a1a1a', '#757575', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#1565c0', '#8e24aa', '#ffffff'];
const WIDTH_PRESETS = [0, 0.1, 0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1, 1.4, 2, 3, 5, 8];

const UNIT_LABEL = { m: 'm', cm: 'cm', mm: 'mm' } as const;
const UNIT_FACTOR = { m: 1, cm: 100, mm: 1000 } as const;

/** Wert, der bearbeitet wird: Auswahl oder Voreinstellung eines Werkzeugs */
interface Target {
  kind: Kind | null;
  get(key: string): unknown;
  getStyle(): Style;
  set(key: string, v: unknown, live: boolean): void;
  setStyle(patch: Partial<Style>, live: boolean): void;
}

function selectionTarget(app: App, sel: Annot[]): Target {
  const kinds = new Set(sel.map((a) => a.kind));
  return {
    kind: kinds.size === 1 ? sel[0].kind : null,
    get: (k) => (sel[0] as unknown as Record<string, unknown>)[k],
    getStyle: () => sel[0].style,
    set: (k, v, live) =>
      app.applyToSelection((a) => {
        if (a.kind === 'symbol' && k === 'symbol') return { ...a, ...symbolDefaults(v as SymbolKind) } as Annot;
        return { ...a, [k]: v } as Annot;
      }, live),
    setStyle: (patch, live) => app.applyToSelection((a) => ({ ...a, style: { ...a.style, ...patch } }) as Annot, live),
  };
}

function defaultsTarget(app: App, tool: ToolId): Target {
  const d = () => app.toolDefaults[tool];
  return {
    kind: (d().kind as Kind) ?? null,
    get: (k) => d()[k],
    getStyle: () => d().style as Style,
    set: (k, v) => {
      if (tool === 'symbol' && k === 'symbol') Object.assign(d(), symbolDefaults(v as SymbolKind));
      else d()[k] = v;
      app.toolDefaultsChanged();
    },
    setStyle: (patch) => {
      d().style = { ...(d().style as Style), ...patch };
      app.toolDefaultsChanged();
    },
  };
}

function section(title: string, ...children: (Node | null | false)[]) {
  return h('section', { class: 'insp-section' }, h('h3', {}, title), ...children);
}

function row(label: string, control: Node, suffix?: string) {
  return h('label', { class: 'insp-row' }, h('span', { class: 'insp-label' }, label), h('span', { class: 'insp-control' }, control, suffix ? h('span', { class: 'suffix' }, suffix) : null));
}

function paramControl(app: App, t: Target, p: ParamDef): Node {
  const v = t.get(p.key);
  const unit = app.settings.unit;
  switch (p.type) {
    case 'bool': {
      const cb = h('input', { type: 'checkbox', checked: !!v, 'data-key': p.key });
      cb.addEventListener('change', () => t.set(p.key, cb.checked, false));
      return h('label', { class: 'insp-check' }, cb, h('span', {}, p.label));
    }
    case 'select': {
      const sel = h('select', { 'data-key': p.key }, ...(p.options ?? []).map(([val, lab]) => h('option', { value: val, selected: val === v }, lab)));
      sel.value = String(v);
      sel.addEventListener('change', () => t.set(p.key, sel.value, false));
      return row(p.label, sel);
    }
    case 'text':
    case 'textarea': {
      const inp =
        p.type === 'textarea' ? h('textarea', { rows: 3, 'data-key': p.key }) : (h('input', { type: 'text', 'data-key': p.key }) as HTMLInputElement | HTMLTextAreaElement);
      inp.value = String(v ?? '');
      inp.addEventListener('input', () => t.set(p.key, inp.value, true));
      inp.addEventListener('change', () => t.set(p.key, inp.value, false));
      return p.type === 'textarea' ? h('div', { class: 'insp-block' }, h('span', { class: 'insp-label' }, p.label), inp) : row(p.label, inp);
    }
    case 'length': {
      const f = UNIT_FACTOR[unit];
      const dec = unit === 'm' ? 3 : unit === 'cm' ? 1 : 0;
      const fmt = (m: number) => fmtNum(m * f, dec).replace(/(,\d*?)0+$/, '$1').replace(/,$/, '');
      const listId = `dl-${p.key}`;
      const inp = h('input', { type: 'text', inputmode: 'decimal', value: fmt(Number(v) || 0), list: p.presets ? listId : null, 'data-key': p.key });
      const commit = () => {
        let m = parseLength(inp.value, unit);
        if (m === null) {
          inp.value = fmt(Number(t.get(p.key)) || 0);
          return;
        }
        if (p.min !== undefined) m = Math.max(p.min, m);
        if (p.max !== undefined) m = Math.min(p.max, m);
        t.set(p.key, m, false);
        inp.value = fmt(m);
      };
      inp.addEventListener('change', commit);
      const dl = p.presets ? h('datalist', { id: listId }, ...p.presets.map((m) => h('option', { value: fmt(m) }))) : null;
      return h('div', {}, row(p.label, inp, UNIT_LABEL[unit]), dl);
    }
    default: {
      // number, int, angle, pt, mm
      const suffix = p.type === 'angle' ? '°' : p.type === 'pt' ? 'pt' : p.type === 'mm' ? 'mm' : '';
      const dec = p.type === 'int' ? 0 : 2;
      const fmt = (n: number) => fmtNum(n, dec).replace(/(,\d*?)0+$/, '$1').replace(/,$/, '');
      const inp = h('input', { type: 'text', inputmode: 'decimal', value: fmt(Number(v) || 0), 'data-key': p.key });
      inp.addEventListener('change', () => {
        let n = parseNumber(inp.value);
        if (n === null) {
          inp.value = fmt(Number(t.get(p.key)) || 0);
          return;
        }
        if (p.type === 'int') n = Math.round(n);
        if (p.type === 'angle') n = ((n % 360) + 360) % 360;
        if (p.min !== undefined) n = Math.max(p.min, n);
        if (p.max !== undefined) n = Math.min(p.max, n);
        t.set(p.key, n, false);
        inp.value = fmt(n);
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const step = (p.type === 'angle' ? 15 : p.step ?? 1) * (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
          inp.value = fmt((parseNumber(inp.value) ?? 0) + step);
          inp.dispatchEvent(new Event('change'));
        }
      });
      return row(p.label, inp, suffix);
    }
  }
}

function splitColor(c: string | null): { hex: string; alpha: number } {
  if (!c) return { hex: '#ffffff', alpha: 1 };
  const hex = c.slice(0, 7);
  const alpha = c.length === 9 ? parseInt(c.slice(7, 9), 16) / 255 : 1;
  return { hex, alpha };
}

function joinColor(hex: string, alpha: number): string {
  if (alpha >= 0.999) return hex;
  return hex + Math.round(alpha * 255).toString(16).padStart(2, '0');
}

function colorControl(value: string, onInput: (hex: string, live: boolean) => void): HTMLElement {
  const inp = h('input', { type: 'color', value: value.slice(0, 7) });
  inp.addEventListener('input', () => onInput(inp.value, true));
  inp.addEventListener('change', () => onInput(inp.value, false));
  const sw = COLOR_PRESETS.map((c) =>
    h('button', {
      class: `swatch ${c.toLowerCase() === value.slice(0, 7).toLowerCase() ? 'active' : ''}`,
      type: 'button',
      title: c,
      style: `background:${c}`,
      onclick: () => onInput(c, false),
    }),
  );
  return h('div', { class: 'color-row' }, inp, h('div', { class: 'swatches' }, sw));
}

function styleSection(t: Target, keys: StyleKey[]): HTMLElement | null {
  if (!keys.length) return null;
  const s = t.getStyle();
  const out: Node[] = [];
  const isText = t.kind === 'text';
  if (keys.includes('stroke')) out.push(h('div', { class: 'insp-block' }, h('span', { class: 'insp-label' }, isText ? 'Farbe' : 'Linienfarbe'), colorControl(s.stroke, (c, live) => t.setStyle({ stroke: c }, live))));
  if (keys.includes('fill')) {
    const { hex, alpha } = splitColor(s.fill);
    const on = h('input', { type: 'checkbox', checked: !!s.fill });
    on.addEventListener('change', () => t.setStyle({ fill: on.checked ? joinColor(hex, alpha) : null }, false));
    const block = h('div', { class: 'insp-block' }, h('label', { class: 'insp-check' }, on, h('span', {}, t.kind === 'whiteout' ? 'Abdeckfarbe' : 'Füllung')));
    if (s.fill || t.kind === 'whiteout') {
      block.append(colorControl(hex, (c, live) => t.setStyle({ fill: joinColor(c, alpha) }, live)));
      if (t.kind !== 'whiteout') {
        const rng = h('input', { type: 'range', min: 0, max: 100, value: Math.round(alpha * 100) });
        const lab = h('span', { class: 'suffix' }, `${Math.round(alpha * 100)} %`);
        rng.addEventListener('input', () => {
          lab.textContent = `${rng.value} %`;
          t.setStyle({ fill: joinColor(hex, Number(rng.value) / 100) }, true);
        });
        rng.addEventListener('change', () => t.setStyle({ fill: joinColor(hex, Number(rng.value) / 100) }, false));
        block.append(row('Deckkraft Füllung', rng), lab);
      }
    }
    out.push(block);
  }
  if (keys.includes('width')) {
    const sel = h('select', {}, ...WIDTH_PRESETS.map((w) => h('option', { value: String(w), selected: Math.abs(w - s.width) < 1e-6 }, w === 0 ? 'keine' : `${fmtNum(w, 2)} mm`)));
    if (!WIDTH_PRESETS.some((w) => Math.abs(w - s.width) < 1e-6)) sel.prepend(h('option', { value: String(s.width), selected: true }, `${fmtNum(s.width, 2)} mm`));
    sel.addEventListener('change', () => t.setStyle({ width: Number(sel.value) }, false));
    out.push(row('Linienstärke', sel));
  }
  if (keys.includes('dash')) {
    const opts: [string, string][] = [
      ['solid', 'durchgezogen'],
      ['dashed', 'gestrichelt'],
      ['dotted', 'gepunktet'],
      ['dashdot', 'Strich-Punkt'],
    ];
    const sel = h('select', {}, ...opts.map(([v, l]) => h('option', { value: v, selected: v === s.dash }, l)));
    sel.addEventListener('change', () => t.setStyle({ dash: sel.value as Style['dash'] }, false));
    out.push(row('Linienart', sel));
  }
  if (keys.includes('opacity')) {
    const rng = h('input', { type: 'range', min: 5, max: 100, value: Math.round(s.opacity * 100) });
    const lab = h('span', { class: 'suffix' }, `${Math.round(s.opacity * 100)} %`);
    rng.addEventListener('input', () => {
      lab.textContent = `${rng.value} %`;
      t.setStyle({ opacity: Number(rng.value) / 100 }, true);
    });
    rng.addEventListener('change', () => t.setStyle({ opacity: Number(rng.value) / 100 }, false));
    out.push(h('label', { class: 'insp-row' }, h('span', { class: 'insp-label' }, 'Deckkraft'), h('span', { class: 'insp-control' }, rng, lab)));
  }
  return section('Darstellung', ...out);
}

function symbolLibrary(app: App): HTMLElement {
  const cur = app.toolDefaults.symbol.symbol as SymbolKind;
  const grid = h(
    'div',
    { class: 'symbol-grid' },
    ...(Object.keys(SYMBOLS) as SymbolKind[]).map((k) =>
      h(
        'button',
        {
          type: 'button',
          class: `symbol-btn ${k === cur ? 'active' : ''}`,
          'data-symbol': k,
          onclick: () => {
            Object.assign(app.toolDefaults.symbol, symbolDefaults(k));
            app.toolDefaultsChanged();
          },
        },
        h('span', { class: 'symbol-preview', html: app.symbolPreviewSvg(k) }),
        h('span', {}, SYMBOLS[k].label),
      ),
    ),
  );
  return section('Objekt wählen', grid);
}

function eraserSection(app: App): HTMLElement {
  const o = app.eraser;
  const radio = (val: typeof o.deleteMode, label: string) => {
    const r = h('input', { type: 'radio', name: 'erase-mode', value: val, checked: o.deleteMode === val });
    r.addEventListener('change', () => {
      o.deleteMode = val;
      app.eraserChanged();
    });
    return h('label', { class: 'insp-check' }, r, h('span', {}, label));
  };
  const cover = h('input', { type: 'checkbox', checked: o.cover });
  cover.addEventListener('change', () => {
    o.cover = cover.checked;
    app.eraserChanged();
  });
  return section(
    'Bereich löschen',
    h('p', { class: 'insp-note' }, 'Ziehe ein Rechteck über den Bereich. Eigene Elemente können gelöscht und der Planinhalt (PDF) weiß abgedeckt werden.'),
    h('div', { class: 'insp-sub' }, 'Eigene Elemente'),
    radio('touch', 'löschen, wenn berührt'),
    radio('inside', 'nur vollständig enthaltene löschen'),
    radio('none', 'nicht löschen'),
    h('div', { class: 'insp-sub' }, 'Plan (PDF-Inhalt)'),
    h('label', { class: 'insp-check' }, cover, h('span', {}, 'weiß abdecken (radieren)')),
  );
}

function pageSection(app: App): HTMLElement | null {
  if (!app.hasDoc) return null;
  const ps = app.hist.pages[app.pageIndex];
  const scale = app.currentScale;
  const ratio = ratioOf(scale);
  const isPreset = SCALE_PRESETS.some((n) => Math.abs(n - ratio) < 1e-6) && !scale.label.startsWith('kalibriert');
  const sel = h(
    'select',
    { 'data-key': 'page-scale' },
    ...SCALE_PRESETS.map((n) => h('option', { value: String(n), selected: isPreset && Math.abs(n - ratio) < 1e-6 }, `1:${n}`)),
  );
  if (!isPreset) sel.prepend(h('option', { value: 'custom', selected: true }, `${scale.label} (≈ 1:${fmtNum(ratio, ratio < 10 ? 2 : 0)})`));
  sel.addEventListener('change', () => {
    if (sel.value !== 'custom') app.setPageScaleRatio(Number(sel.value));
  });
  const unitSel = h('select', {}, ...(['m', 'cm', 'mm'] as const).map((u) => h('option', { value: u, selected: app.settings.unit === u }, u)));
  unitSel.addEventListener('change', () => app.setUnit(unitSel.value as 'm' | 'cm' | 'mm'));
  const detected = app.detectedScale(app.pageIndex);
  const hint =
    detected && (Math.abs(detected - ratio) > 1e-6 || !ps.scale)
      ? h(
          'div',
          { class: 'insp-hint' },
          !ps.scale ? `Maßstab 1:${detected} aus der Planbeschriftung erkannt. ` : `Im Plan steht „1:${detected}“. `,
          h('button', { class: 'link', type: 'button', onclick: () => app.setPageScaleRatio(detected) }, !ps.scale ? 'Bestätigen' : 'Übernehmen'),
        )
      : null;
  const note = !ps.scale
    ? h(
        'p',
        { class: 'insp-note' },
        detected
          ? 'Gilt nur, wenn die PDF maßstabsgetreu (nicht skaliert) erstellt wurde – im Zweifel mit einer bekannten Strecke kalibrieren.'
          : 'Kein Maßstab festgelegt – es wird 1:100 angenommen. Wähle den Maßstab oder kalibriere an einer bekannten Strecke.',
      )
    : null;
  return section(
    `Seite ${app.pageIndex + 1}`,
    row('Maßstab', sel),
    hint,
    note,
    h(
      'div',
      { class: 'insp-buttons' },
      h('button', { class: 'btn small', type: 'button', onclick: () => app.setTool('calibrate') }, 'Kalibrieren …'),
      app.pageCount > 1 ? h('button', { class: 'btn small', type: 'button', onclick: () => app.applyScaleToAllPages() }, 'Für alle Seiten') : null,
    ),
    row('Einheit', unitSel),
  );
}

/** Enter in einzeiligen Feldern: übernehmen und Fokus zurück an die Zeichenfläche. */
function bindEnterBlur(root: HTMLElement, app: App) {
  root.querySelectorAll<HTMLInputElement>('input[type="text"]').forEach((inp) =>
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        inp.blur();
        app.view.stage.focus({ preventScroll: true });
      }
    }),
  );
}

export function renderInspector(app: App, root: HTMLElement) {
  const parts: (HTMLElement | null)[] = [];
  const sel = app.selectedAnnots();
  if (sel.length) {
    const t = selectionTarget(app, sel);
    const def = t.kind ? defOf(t.kind) : null;
    const title = sel.length === 1 ? def!.label : `${sel.length} Elemente${def ? ` (${def.label})` : ''}`;
    const info = sel.length === 1 && def?.info ? def.info(sel[0] as never, app.ctx) : [];
    parts.push(
      section(
        title,
        info.length ? h('div', { class: 'insp-info' }, ...info.map((l) => h('div', {}, l))) : null,
        ...(def ? def.params.map((p) => paramControl(app, t, p)) : []),
      ),
    );
    const keys: StyleKey[] = def ? def.styleKeys : (['stroke', 'width', 'opacity'] as StyleKey[]).filter((k) => sel.every((a) => defOf(a).styleKeys.includes(k)));
    parts.push(styleSection(t, keys));
    parts.push(
      h(
        'div',
        { class: 'insp-actions' },
        h('button', { class: 'icon-btn', type: 'button', title: 'Duplizieren (⌘D)', html: icon('duplicate'), onclick: () => app.command('duplicate') }),
        h('button', { class: 'icon-btn', type: 'button', title: 'Nach vorne', html: icon('front'), onclick: () => app.command('bring-front') }),
        h('button', { class: 'icon-btn', type: 'button', title: 'Nach hinten', html: icon('back'), onclick: () => app.command('send-back') }),
        h('button', { class: 'icon-btn danger', type: 'button', title: 'Löschen (⌫)', html: icon('trash'), onclick: () => app.command('delete') }),
      ),
    );
  } else {
    const tool = app.toolId;
    const info = toolInfo(tool);
    if (tool === 'eraser') parts.push(eraserSection(app));
    else if (info.kind) {
      if (tool === 'symbol') parts.push(symbolLibrary(app));
      const t = defaultsTarget(app, tool);
      const def = defOf(info.kind);
      parts.push(section(`Neu: ${info.label}`, h('p', { class: 'insp-note' }, info.hint), ...def.params.map((p) => paramControl(app, t, p))));
      parts.push(styleSection(t, def.styleKeys));
      parts.push(
        h(
          'div',
          { class: 'insp-buttons' },
          h('button', { class: 'btn small', type: 'button', onclick: () => app.resetToolDefaults(tool) }, 'Voreinstellungen zurücksetzen'),
        ),
      );
    } else if (tool === 'calibrate') {
      parts.push(
        section(
          'Maßstab kalibrieren',
          h('p', { class: 'insp-note' }, 'Greife eine Strecke ab, deren reale Länge du kennst – z. B. eine Bemaßung oder eine Türbreite im Plan. Danach gibst du die reale Länge ein. Der Fang auf Linienenden hilft beim genauen Abgreifen.'),
        ),
      );
    } else {
      parts.push(
        section(
          app.hasDoc ? 'Keine Auswahl' : 'Willkommen',
          h('p', { class: 'insp-note' }, app.hasDoc ? 'Wähle ein Element aus, um seine Maße und Eigenschaften zu bearbeiten, oder wähle links ein Werkzeug.' : 'Öffne eine PDF, um zu beginnen.'),
        ),
      );
    }
  }
  parts.push(pageSection(app));
  root.replaceChildren(...parts.filter((p): p is HTMLElement => !!p));
  bindEnterBlur(root, app);
}

export { TOOLS };
