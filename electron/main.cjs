// Grundriss – Electron-Hauptprozess
// Fenster, Menüs, Dateizugriff und Integration in macOS (Dock, Finder "Öffnen mit").

const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, net, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const isMac = process.platform === 'darwin';
const DEV_URL = process.env.VITE_DEV_SERVER_URL || '';
const RENDERER_DIR = path.join(__dirname, '..', 'out', 'renderer');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

/** @type {Map<number, {hasDoc: boolean, dirty: boolean, path: string|null, forceClose: boolean}>} */
const winState = new Map();
/** Dateien, die vor "ready" geöffnet werden sollen (macOS open-file, argv). */
const pendingPaths = [];
/** App wird gerade beendet (⌘Q) – nach bestätigtem Schließen weiter beenden. */
let quitting = false;

function continueQuit() {
  if (quitting) setImmediate(() => app.quit());
}

function stateOf(win) {
  let s = winState.get(win.id);
  if (!s) {
    s = { hasDoc: false, dirty: false, path: null, forceClose: false };
    winState.set(win.id, s);
  }
  return s;
}

function createWindow(filePath) {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#1f2124',
    title: 'Grundriss',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 14, y: 14 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  const st = stateOf(win);

  win.once('ready-to-show', () => win.show());
  win.webContents.once('did-finish-load', () => {
    if (filePath) sendOpen(win, filePath);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.on('close', async (e) => {
    if (st.forceClose || !st.dirty) return;
    e.preventDefault();
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Sichern', 'Abbrechen', 'Nicht sichern'],
      defaultId: 0,
      cancelId: 1,
      message: 'Möchtest du die Änderungen sichern?',
      detail: 'Deine Änderungen gehen verloren, wenn du sie nicht sicherst.',
    });
    if (response === 0) {
      win.webContents.send('menu', 'save-and-close');
    } else if (response === 2) {
      st.forceClose = true;
      win.close();
      continueQuit();
    } else {
      quitting = false;
    }
  });
  win.on('closed', () => winState.delete(win.id));

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadURL('app://grundriss/index.html');
  return win;
}

function sendOpen(win, filePath) {
  stateOf(win).hasDoc = true;
  win.webContents.send('open-file', filePath);
  if (isMac) app.addRecentDocument(filePath);
}

/** Öffnet eine Datei im fokussierten leeren Fenster oder in einem neuen Fenster. */
function openPath(filePath) {
  if (!app.isReady()) {
    pendingPaths.push(filePath);
    return;
  }
  // Bereits geöffnet? Dann nur nach vorne holen.
  for (const w of BrowserWindow.getAllWindows()) {
    if (stateOf(w).path === filePath) {
      w.show();
      w.focus();
      return;
    }
  }
  const target = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (target && !stateOf(target).hasDoc && !target.webContents.isLoading()) {
    sendOpen(target, filePath);
    target.focus();
  } else {
    createWindow(filePath);
  }
}

async function showOpenDialog(win) {
  const res = await dialog.showOpenDialog(win, {
    title: 'PDF öffnen',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF-Dokumente', extensions: ['pdf'] }],
  });
  if (res.canceled) return;
  for (const p of res.filePaths) openPath(p);
}

function send(cmd, arg) {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.webContents.send('menu', cmd, arg);
}

function buildMenu() {
  const item = (label, cmd, accelerator, extra = {}) => ({ label, accelerator, click: () => send(cmd), ...extra });
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about', label: 'Über Grundriss' },
              { type: 'separator' },
              { role: 'services', label: 'Dienste' },
              { type: 'separator' },
              { role: 'hide', label: 'Grundriss ausblenden' },
              { role: 'hideOthers', label: 'Andere ausblenden' },
              { role: 'unhide', label: 'Alle einblenden' },
              { type: 'separator' },
              { role: 'quit', label: 'Grundriss beenden' },
            ],
          },
        ]
      : []),
    {
      label: 'Ablage',
      submenu: [
        { label: 'Neues Fenster', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
        { label: 'Öffnen …', accelerator: 'CmdOrCtrl+O', click: () => showOpenDialog(BrowserWindow.getFocusedWindow()) },
        ...(isMac
          ? [{ role: 'recentDocuments', label: 'Zuletzt benutzt', submenu: [{ role: 'clearRecentDocuments', label: 'Liste löschen' }] }]
          : []),
        { type: 'separator' },
        { label: 'Fenster schließen', accelerator: 'CmdOrCtrl+W', role: 'close' },
        item('Sichern', 'save', 'CmdOrCtrl+S'),
        item('Sichern unter …', 'save-as', 'Shift+CmdOrCtrl+S'),
        item('Als PDF exportieren (nicht mehr bearbeitbar) …', 'export-flat', 'Alt+CmdOrCtrl+E'),
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit', label: 'Beenden' }]),
      ],
    },
    {
      label: 'Bearbeiten',
      submenu: [
        item('Widerrufen', 'undo', 'CmdOrCtrl+Z'),
        item('Wiederholen', 'redo', 'Shift+CmdOrCtrl+Z'),
        { type: 'separator' },
        item('Ausschneiden', 'cut', 'CmdOrCtrl+X'),
        item('Kopieren', 'copy', 'CmdOrCtrl+C'),
        item('Einsetzen', 'paste', 'CmdOrCtrl+V'),
        item('Duplizieren', 'duplicate', 'CmdOrCtrl+D'),
        item('Löschen', 'delete'),
        item('Alles auswählen', 'select-all', 'CmdOrCtrl+A'),
      ],
    },
    {
      label: 'Darstellung',
      submenu: [
        item('Vergrößern', 'zoom-in', 'CmdOrCtrl+Plus'),
        item('Vergrößern', 'zoom-in', 'CmdOrCtrl+=', { visible: false, acceleratorWorksWhenHidden: true }),
        item('Verkleinern', 'zoom-out', 'CmdOrCtrl+-'),
        item('Ganze Seite', 'zoom-fit', 'CmdOrCtrl+0'),
        item('Seitenbreite', 'zoom-width', 'CmdOrCtrl+9'),
        item('Originalgröße (100 %)', 'zoom-100', 'CmdOrCtrl+1'),
        { type: 'separator' },
        item('Vorherige Seite', 'page-prev', 'CmdOrCtrl+Up'),
        item('Nächste Seite', 'page-next', 'CmdOrCtrl+Down'),
        { type: 'separator' },
        item('Seitenleiste ein/aus', 'toggle-sidebar', 'Alt+CmdOrCtrl+S'),
        item('Eigenschaften ein/aus', 'toggle-inspector', 'Alt+CmdOrCtrl+I'),
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Vollbild' },
        { role: 'toggleDevTools', label: 'Entwicklerwerkzeuge', accelerator: isMac ? 'Alt+Cmd+J' : 'Ctrl+Shift+J' },
      ],
    },
    {
      label: 'Fenster',
      submenu: [
        { role: 'minimize', label: 'Im Dock ablegen' },
        { role: 'zoom', label: 'Zoomen' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front', label: 'Alle nach vorne bringen' }] : []),
      ],
    },
    {
      role: 'help',
      label: 'Hilfe',
      submenu: [item('Tastaturkürzel', 'show-help', 'CmdOrCtrl+/')],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC ----------

ipcMain.handle('dialog:open', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  await showOpenDialog(win);
});

ipcMain.handle('dialog:save', async (e, defaultPath) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const res = await dialog.showSaveDialog(win, {
    title: 'PDF sichern',
    defaultPath,
    filters: [{ name: 'PDF-Dokument', extensions: ['pdf'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  });
  return res.canceled ? null : res.filePath;
});

ipcMain.handle('file:read', async (_e, filePath) => {
  const buf = await fs.promises.readFile(filePath);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
});

ipcMain.handle('file:write', async (_e, filePath, bytes) => {
  // Atomar schreiben: erst temporäre Datei, dann umbenennen.
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  await fs.promises.writeFile(tmp, Buffer.from(bytes));
  await fs.promises.rename(tmp, filePath);
  return true;
});

ipcMain.on('open-path', (_e, filePath) => openPath(filePath));

ipcMain.on('doc:state', (e, s) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  const st = stateOf(win);
  st.hasDoc = !!s.hasDoc;
  st.dirty = !!s.dirty;
  st.path = s.path || null;
  win.setTitle(s.title || 'Grundriss');
  if (isMac) {
    win.setDocumentEdited(st.dirty);
    win.setRepresentedFilename(st.path || '');
  }
});

ipcMain.on('window:close-confirmed', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  stateOf(win).forceClose = true;
  win.close();
  continueQuit();
});

ipcMain.on('native-edit', (e, cmd) => {
  const wc = e.sender;
  if (['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll', 'delete'].includes(cmd)) wc[cmd]();
});

// ---------- App-Lebenszyklus ----------

app.on('before-quit', () => {
  quitting = true;
});

app.on('open-file', (e, filePath) => {
  e.preventDefault();
  openPath(filePath);
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const files = argv.slice(1).filter((a) => a.toLowerCase().endsWith('.pdf') && fs.existsSync(a));
    if (files.length) files.forEach(openPath);
    else BrowserWindow.getAllWindows()[0]?.focus();
  });

  app.whenReady().then(() => {
    app.setName('Grundriss');
    protocol.handle('app', (req) => {
      const { pathname } = new URL(req.url);
      const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
      const full = path.normalize(path.join(RENDERER_DIR, rel));
      if (!full.startsWith(RENDERER_DIR)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(full).toString());
    });
    buildMenu();

    const argvFiles = process.argv.slice(1).filter((a) => a.toLowerCase().endsWith('.pdf') && fs.existsSync(a));
    const initial = [...pendingPaths.splice(0), ...argvFiles];
    if (initial.length) initial.forEach((p) => createWindow(p));
    else createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
}
