// Einfache Linien-Icons (24×24, currentColor)
const P = (d: string, extra = '') => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
const path = (d: string, attrs = '') => `<path d="${d}" ${attrs}/>`;

export const ICONS: Record<string, string> = {
  select: P(path('M6 3.5l12 7.2-5.3 1.4-2.6 5.4z', 'fill="currentColor" fill-opacity=".15"')),
  hand: P(
    path(
      'M8.5 12.5V6a1.4 1.4 0 012.8 0v5M11.3 10.5V4.6a1.4 1.4 0 012.8 0v5.9M14.1 10.5V6a1.4 1.4 0 012.8 0v5.5M16.9 10.5a1.4 1.4 0 012.8 0V15a6 6 0 01-6 6h-1a6 6 0 01-4.7-2.3l-3.3-4.3a1.4 1.4 0 012.1-1.8l1.7 1.7',
    ),
  ),
  pen: P(path('M4.5 19.5l1-4L16 5l3 3L8.5 18.5z') + path('M14 7l3 3')),
  highlight: P(path('M9.5 14.5l-4 4.5h5.5l1.2-1.4') + path('M8.5 13.5l7.5-9 4 3.4-7.5 9z', 'fill="currentColor" fill-opacity=".15"')),
  text: P(path('M5 7V4.5h14V7M12 4.5v15M9 19.5h6')),
  line: P(path('M5 19L19 5')),
  arrow: P(path('M5 19L19 5M11 5h8v8')),
  polyline: P(path('M4 18l5-9 5 6 6-10') + '<circle cx="4" cy="18" r="1.3" fill="currentColor"/><circle cx="9" cy="9" r="1.3" fill="currentColor"/><circle cx="14" cy="15" r="1.3" fill="currentColor"/><circle cx="20" cy="5" r="1.3" fill="currentColor"/>'),
  rect: P('<rect x="4" y="6" width="16" height="12" rx="0.5"/>'),
  ellipse: P('<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>'),
  cloud: P(path('M6.5 18a3 3 0 01-.4-6 4.2 4.2 0 018-2.2 3.4 3.4 0 015.4 3 2.6 2.6 0 01-.8 5.2z')),
  calibrate: P(path('M3.5 15.5l12-12 5 5-12 12z') + path('M7 12l1.8 1.8M10 9l1.8 1.8M13 6l1.8 1.8')),
  measure: P(path('M4 12h16M4 8v8M20 8v8') + path('M7.5 13.8L5 12l2.5-1.8M16.5 10.2L19 12l-2.5 1.8')),
  pathlen: P(path('M4 18l6-8 4 4 6-8') + path('M2.5 21.5h19', 'stroke-dasharray="2 2"')),
  area: P(path('M4 8l8-4 8 5-3 11H6z', 'fill="currentColor" fill-opacity=".18"') + path('M9 13h6')),
  wall: P(path('M4 4h4.5v11.5H20V20H4z', 'fill="currentColor" fill-opacity=".35"')),
  door: P(path('M3.5 20.5h17') + path('M6 20.5V6') + path('M6 6a14.5 14.5 0 0114.5 14.5', 'stroke-dasharray="2 1.8"')),
  window: P('<rect x="3" y="9" width="18" height="6"/>' + path('M3 12h18M12 9v6')),
  stairs: P('<rect x="4" y="4" width="16" height="16"/>' + path('M4 8h16M4 12h16M4 16h16') + path('M12 18.5V5.5M9.8 7.5L12 5.2l2.2 2.3')),
  room: P('<rect x="4" y="5" width="16" height="14"/>' + path('M8.5 10.5h7M9.5 13.5h5')),
  column: P('<rect x="7" y="7" width="10" height="10" fill="currentColor" fill-opacity=".85"/>' + path('M4 4l3 3M20 4l-3 3M4 20l3-3M20 20l-3-3', 'stroke-dasharray="1.5 1.5"')),
  symbol: P(path('M3 18.5V12a2 2 0 012-2h14a2 2 0 012 2v6.5M3 15h18') + path('M6 10V7.2h5V10')),
  eraser: P('<rect x="4" y="4" width="16" height="16" stroke-dasharray="2.5 2"/>' + path('M9 9l6 6M15 9l-6 6')),
  open: P(path('M3.5 7V5.5a1 1 0 011-1h5l2 2h8a1 1 0 011 1V18a1 1 0 01-1 1h-15a1 1 0 01-1-1z')),
  save: P(path('M5 4h11l3 3v12a1 1 0 01-1 1H6a1 1 0 01-1-1z') + path('M8 4v5h7V4M8 20v-6h8v6')),
  undo: P(path('M9 6L4.5 10.5 9 15') + path('M4.5 10.5H15a5 5 0 010 10h-3')),
  redo: P(path('M15 6l4.5 4.5L15 15') + path('M19.5 10.5H9a5 5 0 000 10h3')),
  zoomIn: P('<circle cx="10.5" cy="10.5" r="6.5"/>' + path('M15.5 15.5L20 20M10.5 7.5v6M7.5 10.5h6')),
  zoomOut: P('<circle cx="10.5" cy="10.5" r="6.5"/>' + path('M15.5 15.5L20 20M7.5 10.5h6')),
  fit: P(path('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5') + '<rect x="8" y="8" width="8" height="8"/>'),
  sidebar: P('<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/>' + path('M9 4.5v15')),
  inspector: P('<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/>' + path('M15 4.5v15')),
  prev: P(path('M14.5 6l-6 6 6 6')),
  next: P(path('M9.5 6l6 6-6 6')),
  magnet: P(path('M6 4v8a6 6 0 0012 0V4h-4v8a2 2 0 01-4 0V4z') + path('M6 8h4M14 8h4')),
  trash: P(path('M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5')),
  duplicate: P('<rect x="8" y="8" width="11" height="11" rx="1"/>' + path('M5 15.5V6a1 1 0 011-1h9.5')),
  front: P('<rect x="4" y="4" width="10" height="10" fill="currentColor" fill-opacity=".2"/>' + '<rect x="10" y="10" width="10" height="10" fill="currentColor" fill-opacity=".85"/>'),
  back: P('<rect x="4" y="4" width="10" height="10" fill="currentColor" fill-opacity=".85"/>' + '<rect x="10" y="10" width="10" height="10" fill="currentColor" fill-opacity=".2"/>'),
  help: P('<circle cx="12" cy="12" r="8.5"/>' + path('M9.6 9.5a2.5 2.5 0 014.8 1c0 1.7-2.4 2-2.4 3.5M12 16.8v.2')),
};

export function icon(name: string): string {
  return ICONS[name] ?? '';
}
