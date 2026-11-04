// Abstraktion für Dateizugriff: Electron (Mac-App) oder reiner Browser (Entwicklung/Tests).

export interface DocState {
  hasDoc: boolean;
  dirty: boolean;
  title: string;
  path: string | null;
}

interface ElectronBridge {
  platform: string;
  showOpenDialog(): Promise<void>;
  showSaveDialog(defaultPath: string): Promise<string | null>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array): Promise<boolean>;
  pathForFile(file: File): string | null;
  openPath(path: string): void;
  setDocState(s: DocState): void;
  nativeEdit(cmd: string): void;
  closeWindow(): void;
  onMenu(cb: (cmd: string, arg?: unknown) => void): void;
  onOpenFile(cb: (path: string) => void): void;
}

declare global {
  interface Window {
    grundriss?: ElectronBridge;
  }
}

export const bridge: ElectronBridge | undefined = window.grundriss;
export const isElectron = !!bridge;
export const isMac = bridge ? bridge.platform === 'darwin' : /Mac/.test(navigator.platform);

export function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

export function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(0, i) : '';
}

/** Browser-Fallback: Datei-Dialog über <input type=file>. */
export function pickFileInBrowser(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/** Browser-Fallback: Download auslösen. */
export function downloadInBrowser(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
