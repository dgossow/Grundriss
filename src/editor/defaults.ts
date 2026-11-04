// Werkzeuge und ihre Standardwerte für neue Elemente.
import { SYMBOLS } from '../elements/symbols';
import type { Annot, Kind, Style, SymbolKind } from '../types';

export type ToolId =
  | 'select'
  | 'hand'
  | 'pen'
  | 'highlight'
  | 'text'
  | 'line'
  | 'arrow'
  | 'polyline'
  | 'rect'
  | 'ellipse'
  | 'cloud'
  | 'calibrate'
  | 'measure'
  | 'pathlen'
  | 'area'
  | 'wall'
  | 'door'
  | 'window'
  | 'stairs'
  | 'room'
  | 'column'
  | 'symbol'
  | 'eraser';

export interface ToolInfo {
  id: ToolId;
  label: string;
  key: string;
  group: 'nav' | 'markup' | 'measure' | 'plan' | 'erase';
  /** Elementtyp, den das Werkzeug erzeugt */
  kind?: Kind;
  hint: string;
}

export const TOOLS: ToolInfo[] = [
  { id: 'select', label: 'Auswahl', key: 'v', group: 'nav', hint: 'Klicken = auswählen · Ziehen = verschieben/Rahmen · ⇧ = hinzufügen · Doppelklick = bearbeiten / Punkt einfügen · ⌥-Klick auf Punkt = löschen' },
  { id: 'hand', label: 'Hand (Leertaste)', key: 'h', group: 'nav', hint: 'Ziehen = Ansicht verschieben · ⌘ + Scrollen / Zwei-Finger-Zoom = zoomen' },
  { id: 'pen', label: 'Stift', key: 'p', group: 'markup', kind: 'freehand', hint: 'Ziehen = freihand zeichnen' },
  { id: 'highlight', label: 'Textmarker', key: 'i', group: 'markup', kind: 'freehand', hint: 'Ziehen = markieren' },
  { id: 'text', label: 'Text', key: 't', group: 'markup', kind: 'text', hint: 'Klicken = Text einfügen · ⌘↩ oder Klick daneben = fertig' },
  { id: 'line', label: 'Linie', key: 'l', group: 'markup', kind: 'line', hint: 'Klicken/Ziehen = Linie · ⇧ = 45°-Schritte · Zahl tippen = Länge eingeben' },
  { id: 'arrow', label: 'Pfeil', key: 'a', group: 'markup', kind: 'line', hint: 'Klicken/Ziehen = Pfeil · ⇧ = 45°-Schritte' },
  { id: 'polyline', label: 'Polylinie', key: 'y', group: 'markup', kind: 'polyline', hint: 'Klicken = Punkt · Doppelklick/↩ = fertig · Klick auf Startpunkt = schließen · ⌫ = letzter Punkt zurück' },
  { id: 'rect', label: 'Rechteck', key: 'r', group: 'markup', kind: 'rect', hint: 'Ziehen = Rechteck · ⇧ = Quadrat' },
  { id: 'ellipse', label: 'Ellipse', key: 'o', group: 'markup', kind: 'ellipse', hint: 'Ziehen = Ellipse · ⇧ = Kreis' },
  { id: 'cloud', label: 'Revisionswolke', key: 'c', group: 'markup', kind: 'cloud', hint: 'Ziehen = Wolke um einen Bereich' },
  { id: 'calibrate', label: 'Maßstab kalibrieren', key: 'k', group: 'measure', hint: 'Strecke mit bekannter Länge abgreifen (z. B. eine Bemaßung im Plan), dann reale Länge eingeben' },
  { id: 'measure', label: 'Distanz messen', key: 'm', group: 'measure', kind: 'measure', hint: 'Zwei Punkte klicken · ⇧ = 45°-Schritte · Fang auf Linienenden des Plans' },
  { id: 'pathlen', label: 'Kettenmaß / Länge', key: 'j', group: 'measure', kind: 'pathlen', hint: 'Punkte klicken · Doppelklick/↩ = fertig' },
  { id: 'area', label: 'Fläche messen', key: 'f', group: 'measure', kind: 'area', hint: 'Eckpunkte klicken · Doppelklick/↩ oder Klick auf Startpunkt = fertig' },
  { id: 'wall', label: 'Wand', key: 'w', group: 'plan', kind: 'wall', hint: 'Punkte der Wandachse klicken · Länge tippen + ↩ · ⇧ = orthogonal · Doppelklick/↩ = fertig · Startpunkt = geschlossen' },
  { id: 'door', label: 'Tür', key: 'd', group: 'plan', kind: 'door', hint: 'Klicken = setzen (rastet auf Wände ein) · Entlang der Wand ziehen = Öffnung abgreifen · R = drehen · X = Anschlag · F = Aufschlag' },
  { id: 'window', label: 'Fenster', key: 'n', group: 'plan', kind: 'window', hint: 'Klicken = setzen (rastet auf Wände ein) · Entlang der Wand ziehen = Öffnung abgreifen · R = drehen' },
  { id: 'stairs', label: 'Treppe', key: 's', group: 'plan', kind: 'stairs', hint: 'Klicken = setzen · Ziehen = Laufrichtung und Länge · R = drehen · X = Richtung umkehren' },
  { id: 'room', label: 'Raum', key: 'b', group: 'plan', kind: 'room', hint: 'Raumecken klicken · Doppelklick/↩ = fertig – Fläche wird automatisch berechnet' },
  { id: 'column', label: 'Stütze', key: 'u', group: 'plan', kind: 'column', hint: 'Klicken = setzen · R = drehen' },
  { id: 'symbol', label: 'Einrichtung', key: 'g', group: 'plan', kind: 'symbol', hint: 'Objekt in der Bibliothek wählen · Klicken = setzen · Ziehen = ausrichten · R = drehen · X = spiegeln' },
  { id: 'eraser', label: 'Bereich löschen', key: 'e', group: 'erase', kind: 'whiteout', hint: 'Rechteck aufziehen = Elemente darin löschen und/oder Plan weiß abdecken (Optionen rechts)' },
];

export const toolInfo = (id: ToolId) => TOOLS.find((t) => t.id === id)!;

const RED = '#e53935';
const BLUE = '#1565c0';
const INK = '#1a1a1a';

const st = (s: Partial<Style>): Style => ({ stroke: INK, fill: null, width: 0.35, dash: 'solid', opacity: 1, ...s });

/** Standardwerte je Werkzeug (ohne id und Geometrie). */
export const DEFAULTS: Record<string, Record<string, unknown>> = {
  pen: { kind: 'freehand', style: st({ stroke: RED, width: 0.5 }) },
  highlight: { kind: 'freehand', style: st({ stroke: '#ffd600', width: 5, opacity: 0.4 }) },
  text: { kind: 'text', style: st({ stroke: RED }), size: 10, bold: false, bg: false, frame: false, angle: 0, text: '' },
  line: { kind: 'line', style: st({ stroke: RED }), arrowStart: false, arrowEnd: false },
  arrow: { kind: 'line', style: st({ stroke: RED }), arrowStart: false, arrowEnd: true },
  polyline: { kind: 'polyline', style: st({ stroke: RED }), closed: false },
  rect: { kind: 'rect', style: st({ stroke: RED }) },
  ellipse: { kind: 'ellipse', style: st({ stroke: RED }) },
  cloud: { kind: 'cloud', style: st({ stroke: RED, width: 0.35 }), arc: 6 },
  measure: { kind: 'measure', style: st({ stroke: BLUE, width: 0.18 }), offset: 0, end: 'tick', textSize: 7 },
  pathlen: { kind: 'pathlen', style: st({ stroke: BLUE, width: 0.25 }), textSize: 7 },
  area: { kind: 'area', style: st({ stroke: BLUE, width: 0.25, fill: '#1565c02e' }), showPerimeter: false, textSize: 7 },
  wall: { kind: 'wall', style: st({ stroke: INK, fill: RED, width: 0.35 }), thickness: 0.115, align: 'center', fillMode: 'solid', closed: false },
  door: {
    kind: 'door',
    style: st({ width: 0.25 }),
    doorType: 'single',
    width: 0.885,
    height: 2.01,
    wall: 0.175,
    flip: false,
    mirror: false,
    angle: 0,
    showLabel: false,
    textSize: 6,
  },
  window: {
    kind: 'window',
    style: st({ width: 0.25 }),
    width: 1.26,
    height: 1.385,
    sill: 0.9,
    wall: 0.365,
    panes: 2,
    mirror: false,
    angle: 0,
    showLabel: false,
    textSize: 6,
  },
  stairs: {
    kind: 'stairs',
    style: st({ width: 0.25 }),
    width: 1.0,
    length: 4.2,
    steps: 16,
    rise: 2.8,
    mirror: false,
    angle: 0,
    showLabel: true,
    textSize: 6,
  },
  room: {
    kind: 'room',
    style: st({ width: 0, fill: '#fff17666' }),
    name: 'Raum',
    showArea: true,
    showPerimeter: false,
    height: 0,
    textSize: 8,
    label: null,
  },
  column: { kind: 'column', style: st({ fill: INK, width: 0.25 }), w: 0.24, d: 0.24, round: false, fillMode: 'solid', angle: 0, mirror: false },
  symbol: { kind: 'symbol', style: st({ width: 0.18 }), symbol: 'bed', w: SYMBOLS.bed.w, d: SYMBOLS.bed.d, chairs: true, angle: 0, mirror: false },
  eraser: { kind: 'whiteout', style: st({ stroke: '#ffffff', fill: '#ffffff', width: 0 }) },
};

export interface EraserOptions {
  deleteMode: 'touch' | 'inside' | 'none';
  cover: boolean;
}

const LS_KEY = 'grundriss.toolDefaults.v1';

export function loadToolDefaults(): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = structuredClone(DEFAULTS);
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    for (const k of Object.keys(out)) {
      if (saved[k] && typeof saved[k] === 'object') {
        out[k] = { ...out[k], ...saved[k], kind: out[k].kind, style: { ...(out[k].style as object), ...(saved[k].style || {}) } };
      }
    }
  } catch {
    /* ignorieren */
  }
  return out;
}

export function saveToolDefaults(d: Record<string, Record<string, unknown>>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(d));
  } catch {
    /* ignorieren */
  }
}

export function symbolDefaults(sym: SymbolKind) {
  return { symbol: sym, w: SYMBOLS[sym].w, d: SYMBOLS[sym].d };
}

/** Neues Element aus Werkzeug-Standardwerten. */
export function makeAnnot<A extends Annot>(defaults: Record<string, unknown>, geom: Partial<A>, id: string): A {
  const base = structuredClone(defaults);
  return { ...base, ...geom, id } as unknown as A;
}
