const { contextBridge, ipcRenderer } = require('electron');

// Usado só pela janela de escolha do que compartilhar (picker.html)
contextBridge.exposeInMainWorld('picker', {
  sources: () => ipcRenderer.invoke('picker:sources'),
  choose: (id) => ipcRenderer.send('picker:choose', id),
  cancel: () => ipcRenderer.send('picker:choose', null),
});
