// Kleine DOM-Helfer
type Attrs = Record<string, string | number | boolean | null | undefined | ((e: any) => void)>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k === 'value' && 'value' in el) (el as HTMLInputElement).value = String(v);
    else if (k === 'checked' && 'checked' in el) (el as HTMLInputElement).checked = !!v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const t = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'range', 'color'].includes(t);
  }
  if (tag === 'SELECT') return true;
  return (el as HTMLElement).isContentEditable;
}

let toastTimer = 0;
export function toast(msg: string, kind: 'info' | 'error' = 'info') {
  let el = document.querySelector<HTMLDivElement>('.toast');
  if (!el) {
    el = h('div', { class: 'toast' });
    document.body.append(el);
  }
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), kind === 'error' ? 6000 : 2600);
}

export interface DialogButton {
  label: string;
  value: string;
  primary?: boolean;
  danger?: boolean;
}

/** Modaler Dialog; liefert den Wert des gewählten Buttons (Esc = 'cancel'). */
export function dialog(title: string, body: Node | string, buttons: DialogButton[], onOpen?: (root: HTMLElement) => void): Promise<string> {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const back = h('div', { class: 'modal-back' });
    const close = (v: string) => {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      prevFocus?.focus?.();
      resolve(v);
    };
    const btns = buttons.map((b) =>
      h('button', { class: `btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}`, type: 'button', onclick: () => close(b.value) }, b.label),
    );
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-label': title }, h('h2', {}, title), h('div', { class: 'modal-body' }, typeof body === 'string' ? h('p', {}, body) : body), h('div', { class: 'modal-buttons' }, btns));
    back.append(box);
    document.body.append(back);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close('cancel');
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
        const p = buttons.find((b) => b.primary);
        if (p) {
          e.preventDefault();
          e.stopPropagation();
          close(p.value);
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('pointerdown', (e) => {
      if (e.target === back) close('cancel');
    });
    onOpen?.(box);
    const first = box.querySelector<HTMLElement>('input, select, textarea') ?? btns.find((b) => b.classList.contains('primary')) ?? btns[0];
    setTimeout(() => {
      first?.focus();
      if (first instanceof HTMLInputElement) first.select();
    }, 0);
  });
}

export async function alertDialog(title: string, msg: string) {
  await dialog(title, msg, [{ label: 'OK', value: 'ok', primary: true }]);
}
