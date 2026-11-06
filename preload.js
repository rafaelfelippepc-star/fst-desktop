const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('resenhaDesktop', {
  // { type: 'key'|'mouse', id, label } ou null
  setBinding: (b) => ipcRenderer.send('ptt:set-binding', b),
  // espera a próxima tecla/botão apertado em qualquer lugar do sistema
  captureNext: () => ipcRenderer.invoke('ptt:capture'),
  // cb('down' | 'up')
  onPtt: (cb) => ipcRenderer.on('ptt:state', (_e, state) => cb(state)),
  // { ok, error, platform }: o hook global de teclado/mouse está funcionando?
  getStatus: () => ipcRenderer.invoke('ptt:status'),
  getIdle: () => ipcRenderer.invoke('system:idle'),
  onStatus: (cb) => ipcRenderer.on('ptt:status', (_e, s) => cb(s)),
  // Overlay do jogo (Steam, Shift+Tab) ao compartilhar um programa: cb('toggle' | 'escape')
  onOverlay: (cb) => ipcRenderer.on('overlay', (_e, k) => cb(k)),
  setOverlayGuard: (on) => ipcRenderer.send('overlay:guard', !!on),
  // Atualização do app: o botão "Procurar atualizações" dentro da página usa estas duas
  getVersion: () => ipcRenderer.invoke('app:version'),
  checkUpdate: () => ipcRenderer.invoke('app:update-check'),
});

// usado só pela tela inicial (connect.html)
contextBridge.exposeInMainWorld('resenhaConnect', {
  save: (url) => ipcRenderer.send('server:save', url),
  current: () => ipcRenderer.invoke('server:get'),
});
