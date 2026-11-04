// Dokumentzustand mit Rückgängig/Wiederholen.
import type { Annot, PageState } from '../types';

const MAX_HISTORY = 300;

export class History {
  pages: PageState[];
  private past: PageState[][] = [];
  private future: PageState[][] = [];
  private txn: PageState[] | null = null;
  private saved: PageState[];
  onChange: () => void = () => {};

  constructor(pages: PageState[]) {
    this.pages = pages;
    this.saved = pages;
  }

  get dirty() {
    return this.pages !== this.saved;
  }

  markSaved() {
    this.saved = this.pages;
    this.onChange();
  }

  /** Änderungen ab jetzt zu einem Schritt zusammenfassen (z. B. während Ziehen). */
  begin() {
    if (!this.txn) this.txn = this.pages;
  }

  commit() {
    if (this.txn && this.txn !== this.pages) this.pushPast(this.txn);
    this.txn = null;
    this.onChange();
  }

  rollback() {
    if (this.txn) {
      this.pages = this.txn;
      this.txn = null;
      this.onChange();
    }
  }

  get inTxn() {
    return !!this.txn;
  }

  set(pages: PageState[]) {
    if (pages === this.pages) return;
    if (!this.txn) this.pushPast(this.pages);
    this.pages = pages;
    this.onChange();
  }

  private pushPast(p: PageState[]) {
    this.past.push(p);
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.future = [];
  }

  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }

  undo() {
    if (this.txn) this.rollback();
    const p = this.past.pop();
    if (!p) return false;
    this.future.push(this.pages);
    this.pages = p;
    this.onChange();
    return true;
  }

  redo() {
    const p = this.future.pop();
    if (!p) return false;
    this.past.push(this.pages);
    this.pages = p;
    this.onChange();
    return true;
  }

  // ---- Hilfsfunktionen ----

  updatePage(i: number, fn: (p: PageState) => PageState) {
    const cur = this.pages[i];
    const next = fn(cur);
    if (next === cur) return;
    const pages = this.pages.slice();
    pages[i] = next;
    this.set(pages);
  }

  updateAnnots(i: number, fn: (a: Annot[]) => Annot[]) {
    this.updatePage(i, (p) => {
      const annots = fn(p.annots);
      return annots === p.annots ? p : { ...p, annots };
    });
  }

  /** Ersetzt Elemente anhand der ID. */
  replace(i: number, changed: Annot[]) {
    if (!changed.length) return;
    const map = new Map(changed.map((a) => [a.id, a]));
    this.updateAnnots(i, (arr) => arr.map((a) => map.get(a.id) ?? a));
  }

  add(i: number, items: Annot[]) {
    if (!items.length) return;
    this.updateAnnots(i, (arr) => [...arr, ...items]);
  }

  remove(i: number, ids: Set<string>) {
    if (!ids.size) return;
    this.updateAnnots(i, (arr) => {
      const next = arr.filter((a) => !ids.has(a.id));
      return next.length === arr.length ? arr : next;
    });
  }
}
