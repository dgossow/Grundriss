// Primitive → SVG-Markup (Bildschirmdarstellung)
import { sanitize } from '../font';
import { textLayout, type Prim, type Seg } from './prims';

const f = (n: number) => (Math.round(n * 100) / 100).toString();

export function segsToD(d: Seg[]): string {
  let s = '';
  for (const c of d) {
    switch (c[0]) {
      case 'M':
        s += `M${f(c[1])} ${f(c[2])}`;
        break;
      case 'L':
        s += `L${f(c[1])} ${f(c[2])}`;
        break;
      case 'C':
        s += `C${f(c[1])} ${f(c[2])} ${f(c[3])} ${f(c[4])} ${f(c[5])} ${f(c[6])}`;
        break;
      case 'Z':
        s += 'Z';
        break;
    }
  }
  return s;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function primsToSvg(prims: Prim[]): string {
  let out = '';
  for (const p of prims) {
    if (p.t === 'path') {
      const attrs = [`d="${segsToD(p.d)}"`, `fill="${p.fill ?? 'none'}"`];
      if (p.evenOdd) attrs.push('fill-rule="evenodd"');
      if (p.stroke && p.width > 0) {
        attrs.push(`stroke="${p.stroke}"`, `stroke-width="${f(p.width)}"`);
        if (p.cap !== 'butt') attrs.push(`stroke-linecap="${p.cap}"`);
        if (p.join !== 'miter') attrs.push(`stroke-linejoin="${p.join}"`);
        else attrs.push('stroke-miterlimit="6"');
        if (p.dash) attrs.push(`stroke-dasharray="${p.dash.map(f).join(' ')}"`);
      }
      out += `<path ${attrs.join(' ')}/>`;
    } else {
      const L = textLayout(p);
      let g = `<g transform="translate(${f(p.x)} ${f(p.y)})${p.angle ? ` rotate(${f(p.angle)})` : ''}">`;
      if (p.bg || p.frame) {
        g += `<rect x="${f(L.box.x)}" y="${f(L.box.y)}" width="${f(L.box.w)}" height="${f(L.box.h)}" fill="${p.bg ?? 'none'}"${
          p.frame ? ` stroke="${p.frame}" stroke-width="${f(p.frameWidth)}"` : ''
        }/>`;
      }
      g += `<text font-size="${f(p.size)}"${p.bold ? ' font-weight="bold"' : ''} fill="${p.color}">`;
      for (const l of L.lines) g += `<tspan x="${f(l.x)}" y="${f(l.y)}">${esc(sanitize(l.s))}</tspan>`;
      g += '</text></g>';
      out += g;
    }
  }
  return out;
}
