// Sichere Brücke zwischen Renderer und Hauptprozess.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('grundriss', {
  platform: process.platform,
  showOpenDialog: () => ipcRenderer.invoke('dialog:open'),
  showSaveDialog: (defaultPath) => ipcRenderer.invoke('dialog:save', defaultPath),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  writeFile: (filePath, bytes) => ipcRenderer.invoke('file:write', filePath, bytes),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || null;
    } catch {
      return null;
    }
  },
  openPath: (filePath) => ipcRenderer.send('open-path', filePath),
  setDocState: (state) => ipcRenderer.send('doc:state', state),
  nativeEdit: (cmd) => ipcRenderer.send('native-edit', cmd),
  closeWindow: () => ipcRenderer.send('window:close-confirmed'),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, cmd, arg) => cb(cmd, arg)),
  onOpenFile: (cb) => ipcRenderer.on('open-file', (_e, filePath) => cb(filePath)),
});
