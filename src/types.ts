// Datenmodell. Alle Koordinaten sind in "Seitenpunkten": PDF-Punkte (1/72 Zoll) im
// angezeigten (ggf. gedrehten) Seitenraum, Ursprung oben links, y nach unten.
// Reale Maße von Grundriss-Elementen werden in Metern gespeichert und über den
// Seitenmaßstab in Punkte umgerechnet.

export interface Pt {
  x: number;
  y: number;
}

export type Dash = 'solid' | 'dashed' | 'dotted' | 'dashdot';

export interface Style {
  stroke: string;
  fill: string | null;
  /** Linienstärke auf dem Papier in mm */
  width: number;
  dash: Dash;
  opacity: number;
}

export type Kind =
  | 'line'
  | 'polyline'
  | 'rect'
  | 'ellipse'
  | 'cloud'
  | 'freehand'
  | 'text'
  | 'measure'
  | 'pathlen'
  | 'area'
  | 'whiteout'
  | 'wall'
  | 'door'
  | 'window'
  | 'stairs'
  | 'room'
  | 'column'
  | 'symbol';

interface Base {
  id: string;
  kind: Kind;
  style: Style;
}

export interface LineA extends Base {
  kind: 'line';
  p1: Pt;
  p2: Pt;
  arrowStart: boolean;
  arrowEnd: boolean;
}
export interface PolylineA extends Base {
  kind: 'polyline';
  pts: Pt[];
  closed: boolean;
}
export interface BoxBase extends Base {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface RectA extends BoxBase {
  kind: 'rect';
}
export interface EllipseA extends BoxBase {
  kind: 'ellipse';
}
export interface CloudA extends BoxBase {
  kind: 'cloud';
  /** Bogengröße in mm auf dem Papier */
  arc: number;
}
export interface WhiteoutA extends BoxBase {
  kind: 'whiteout';
}
export interface FreehandA extends Base {
  kind: 'freehand';
  pts: Pt[];
}
export interface TextA extends Base {
  kind: 'text';
  p: Pt;
  text: string;
  /** Schriftgröße in pt */
  size: number;
  bold: boolean;
  bg: boolean;
  frame: boolean;
  angle: number;
}

export type DimEnd = 'tick' | 'arrow' | 'dot';
export interface MeasureA extends Base {
  kind: 'measure';
  p1: Pt;
  p2: Pt;
  /** senkrechter Versatz der Maßlinie in pt (Vorzeichen = Seite) */
  offset: number;
  end: DimEnd;
  textSize: number;
}
export interface PathLenA extends Base {
  kind: 'pathlen';
  pts: Pt[];
  textSize: number;
}
export interface AreaA extends Base {
  kind: 'area';
  pts: Pt[];
  showPerimeter: boolean;
  textSize: number;
}

export type WallAlign = 'center' | 'left' | 'right';
export type WallFill = 'solid' | 'hatch' | 'none';
export interface WallA extends Base {
  kind: 'wall';
  pts: Pt[];
  closed: boolean;
  /** Wandstärke in m */
  thickness: number;
  align: WallAlign;
  fillMode: WallFill;
}

/** Gemeinsame Felder für platzierte Bauteile/Objekte (Mittelpunkt + Drehung). */
export interface PlacedBase extends Base {
  p: Pt;
  /** Drehung in Grad, im Uhrzeigersinn (Bildschirm) */
  angle: number;
  mirror: boolean;
}

export type DoorType = 'single' | 'double' | 'sliding';
export interface DoorA extends PlacedBase {
  kind: 'door';
  doorType: DoorType;
  /** lichte Breite in m */
  width: number;
  /** Durchgangshöhe in m (für Beschriftung) */
  height: number;
  /** Wanddicke in m */
  wall: number;
  /** Aufschlagrichtung: Seite der Wand, zu der die Tür öffnet */
  flip: boolean;
  showLabel: boolean;
  textSize: number;
}
export interface WindowA extends PlacedBase {
  kind: 'window';
  width: number;
  wall: number;
  panes: number;
  /** Brüstungshöhe in m */
  sill: number;
  /** Fensterhöhe in m */
  height: number;
  showLabel: boolean;
  textSize: number;
}
export interface StairsA extends PlacedBase {
  kind: 'stairs';
  /** Laufbreite in m */
  width: number;
  /** Lauflänge in m */
  length: number;
  steps: number;
  /** zu überwindende Höhe in m */
  rise: number;
  showLabel: boolean;
  textSize: number;
}
export interface RoomA extends Base {
  kind: 'room';
  pts: Pt[];
  name: string;
  showArea: boolean;
  showPerimeter: boolean;
  /** lichte Raumhöhe in m, 0 = nicht anzeigen */
  height: number;
  textSize: number;
  /** Position des Raumstempels (null = Schwerpunkt) */
  label: Pt | null;
}
export interface ColumnA extends PlacedBase {
  kind: 'column';
  w: number;
  d: number;
  round: boolean;
  fillMode: WallFill;
}

export type SymbolKind =
  | 'bed'
  | 'sofa'
  | 'table'
  | 'wc'
  | 'sink'
  | 'shower'
  | 'bathtub'
  | 'kitchen'
  | 'wardrobe'
  | 'washer'
  | 'car';
export interface SymbolA extends PlacedBase {
  kind: 'symbol';
  symbol: SymbolKind;
  w: number;
  d: number;
  /** Tisch: Stühle anzeigen */
  chairs: boolean;
}

export type Annot =
  | LineA
  | PolylineA
  | RectA
  | EllipseA
  | CloudA
  | WhiteoutA
  | FreehandA
  | TextA
  | MeasureA
  | PathLenA
  | AreaA
  | WallA
  | DoorA
  | WindowA
  | StairsA
  | RoomA
  | ColumnA
  | SymbolA;

export type AnnotOf<K extends Kind> = Extract<Annot, { kind: K }>;

export interface Scale {
  /** Seitenpunkte pro realem Meter */
  ptPerM: number;
  /** Anzeige, z. B. "1:100" oder "kalibriert" */
  label: string;
}

export interface PageState {
  annots: Annot[];
  scale: Scale | null;
}

export type Unit = 'm' | 'cm' | 'mm';

export interface Settings {
  unit: Unit;
  decimals: number;
}

/** Was in die PDF eingebettet wird, um die Bearbeitung später fortzusetzen. */
export interface SavedData {
  app: 'Grundriss';
  version: 1;
  pages: PageState[];
  settings: Settings;
}
