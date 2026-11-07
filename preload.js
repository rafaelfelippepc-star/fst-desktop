const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('resenhaDesktop', {
  // { type: 'key'|'mouse', id, label } ou null
  setBinding: (b) => ipcRenderer.send('ptt:set-binding', b),
  // bandeja do sistema: clicar no X minimiza em vez de fechar (a escolha fica neste computador)
  getTray: () => ipcRenderer.invoke('tray:get'),
  setTray: (on) => ipcRenderer.send('tray:set', !!on),
  // atraso (ms) para fechar o microfone depois de soltar o atalho (0 a 2000)
  setPttDelay: (ms) => ipcRenderer.send('ptt:set-delay', ms),
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
  // silent = true: não abre a janelinha "Reiniciar agora" (a página mostra o próprio botão)
  checkUpdate: (silent) => ipcRenderer.invoke('app:update-check', { silent: !!silent }),
  // andamento da atualização do app: cb({ state: 'downloading' | 'ready' | 'error', version, percent, message })
  onUpdate: (cb) => ipcRenderer.on('app:update', (_e, s) => cb(s)),
  installUpdate: () => ipcRenderer.send('app:update-install'),
});

// usado só pela tela inicial (connect.html)
contextBridge.exposeInMainWorld('resenhaConnect', {
  save: (url) => ipcRenderer.send('server:save', url),
  current: () => ipcRenderer.invoke('server:get'),
});
