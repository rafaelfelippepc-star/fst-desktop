const { contextBridge, ipcRenderer } = require('electron');

// Usado só pela janela de Novidades (novidades.html)
contextBridge.exposeInMainWorld('news', {
  get: () => ipcRenderer.invoke('news:get'),
  log: () => ipcRenderer.invoke('news:log'),
  copy: (text) => ipcRenderer.send('news:copy', String(text || '')),
  close: () => ipcRenderer.send('news:close'),
});
