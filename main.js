const { app, BrowserWindow, Menu, ipcMain, session, desktopCapturer, powerMonitor, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { createPttCore } = require('./ptt-core');

// Atualização automática pelo GitHub (só no app instalado, não no "npm start").
let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch (e) { console.warn('electron-updater não carregou:', e && e.message); }

// Mantém a pasta de dados antiga (endereço do servidor e atalho do push to talk salvos),
// mesmo com o app agora se chamando FST.
app.setPath('userData', path.join(app.getPath('appData'), 'resenha-desktop'));

// O app fica escondido atrás de jogos e outros programas. Sem estas opções o Chromium
// "adormece" a página em segundo plano (timers atrasados, até 1 minuto), e o push to talk
// podia demorar a fechar o microfone.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const cfgFile = () => path.join(app.getPath('userData'), 'server.json');
const readServer = () => {
  try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')).url || ''; } catch { return ''; }
};
const writeServer = (url) => fs.writeFileSync(cfgFile(), JSON.stringify({ url }));
const clearServer = () => { try { fs.unlinkSync(cfgFile()); } catch {} };
// Endereço padrão que vem junto com o app (server-default.json). O endereço salvo pelo usuário ("Trocar servidor") vale mais.
const defaultServer = () => {
  try {
    const u = String(JSON.parse(fs.readFileSync(path.join(__dirname, 'server-default.json'), 'utf8')).url || '').trim();
    return /^https?:\/\//i.test(u) ? u : '';
  } catch { return ''; }
};

let win;

/* ---------- push to talk global ---------- */

// Carrega o hook de teclado/mouse. Se falhar (módulo nativo ausente, sem permissão...),
// o app continua abrindo e o painel do push to talk mostra o motivo.
let uIOhook = null;
let UiohookKey = {};
let hookStatus = { ok: false, error: 'ainda não iniciado' };
try {
  ({ uIOhook, UiohookKey } = require('uiohook-napi'));
} catch (e) {
  hookStatus = { ok: false, error: 'módulo uiohook-napi não carregou: ' + (e && e.message ? e.message : e) };
}

// uiohook: 1 esquerdo, 2 direito, 3 meio, 4 voltar, 5 avançar
const MOUSE_LABELS = { 2: 'Botão direito', 3: 'Botão do meio', 4: 'Botão lateral (voltar)', 5: 'Botão lateral (avançar)' };
const KEY_LABELS = {
  Ctrl: 'Ctrl esq.', CtrlRight: 'Ctrl dir.', Alt: 'Alt esq.', AltRight: 'Alt dir.',
  Shift: 'Shift esq.', ShiftRight: 'Shift dir.', Meta: 'Win esq.', MetaRight: 'Win dir.', Space: 'Espaço',
};
const keyName = (code) => {
  const hit = Object.entries(UiohookKey).find(([, v]) => v === code);
  return hit ? KEY_LABELS[hit[0]] || hit[0] : `Tecla ${code}`;
};

const toPage = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

const core = createPttCore({
  send: (state) => toPage('ptt:state', state),
  describe: (type, id) => (type === 'key' ? keyName(id) : MOUSE_LABELS[id] || `Botão ${id} do mouse`),
  isEscape: (type, id) => type === 'key' && id === UiohookKey.Escape,
  isLeftClick: (type, id) => type === 'mouse' && id === 1,
});

// Tecla de congelar/descongelar a imagem (overlay do jogo): "]". Só é vigiada enquanto se
// compartilha UM PROGRAMA (janela). Avisa a página quando "]" / Esc são apertados; nenhuma outra
// tecla sai do app. O "]" muda de lugar conforme o teclado: no ABNT2 (português do Brasil) ele fica
// na tecla à esquerda do Enter (código "Backslash"); no teclado americano, ao lado do "[" (BracketRight).
const OVERLAY_KEYS = { abnt2: 'Backslash', us: 'BracketRight' };
const OVERLAY_FALLBACK = { Backslash: 0x2b, BracketRight: 0x1b };
const overlayFile = () => path.join(app.getPath('userData'), 'overlay-key.json');
function readOverlayLayout() {
  try {
    const v = JSON.parse(fs.readFileSync(overlayFile(), 'utf8')).layout;
    if (OVERLAY_KEYS[v]) return v;
  } catch {}
  return /^pt/i.test(app.getLocale()) ? 'abnt2' : 'us'; // padrão: português = ABNT2
}
let overlayLayout = 'us';
const overlayCode = () => {
  const name = OVERLAY_KEYS[overlayLayout];
  return UiohookKey[name] !== undefined ? UiohookKey[name] : OVERLAY_FALLBACK[name];
};

let overlayGuard = false;
function overlayKey(code, isDown) {
  if (!overlayGuard || !isDown) return;
  if (code === overlayCode()) toPage('overlay', 'toggle');
  else if (code === UiohookKey.Escape) toPage('overlay', 'escape');
}
ipcMain.on('overlay:guard', (_e, on) => { overlayGuard = !!on; });

if (uIOhook) {
  uIOhook.on('keydown', (e) => { core.onEvent('key', e.keycode, true); overlayKey(e.keycode, true); });
  uIOhook.on('keyup', (e) => { core.onEvent('key', e.keycode, false); overlayKey(e.keycode, false); });
  uIOhook.on('mousedown', (e) => core.onEvent('mouse', e.button, true));
  uIOhook.on('mouseup', (e) => core.onEvent('mouse', e.button, false));
}

// Importante: a página só recebe 'down'/'up' do atalho escolhido por ela.
// As demais teclas digitadas no computador nunca são enviadas à página.
ipcMain.on('ptt:set-binding', (_e, b) => core.setBinding(b));
ipcMain.handle('ptt:capture', () => core.captureNext());
// segundos sem mexer no teclado/mouse no computador inteiro (usado para mandar para o AFK)
ipcMain.handle('system:idle', () => powerMonitor.getSystemIdleTime());
ipcMain.handle('ptt:status', () => ({ ...hookStatus, platform: process.platform }));

/* ---------- servidor e janela ---------- */

ipcMain.handle('server:get', () => readServer() || defaultServer());
ipcMain.on('server:save', (_e, url) => {
  // se for o mesmo endereço padrão do app, não "trava" esse valor: assim, se o padrão mudar numa versão nova, a pessoa recebe junto
  if (url === defaultServer()) clearServer();
  else writeServer(url);
  win.loadURL(url);
});

/* ---------- atualização do app (GitHub Releases) ---------- */

let updateReady = false;
const box = (message, detail) => {
  const opts = { type: 'info', buttons: ['OK'], title: 'FST', message, detail };
  return win && !win.isDestroyed() ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
};

function setupAutoUpdate() {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // se escolher "Depois", instala quando fechar o FST
  autoUpdater.on('error', (e) => console.warn('atualização:', e && e.message ? e.message : e));
  autoUpdater.on('update-downloaded', async (info) => {
    updateReady = true;
    buildMenu();
    const opts = {
      type: 'info', buttons: ['Reiniciar agora', 'Depois'], defaultId: 1, cancelId: 1,
      title: 'Atualização do FST', message: `A versão ${info.version} do FST foi baixada.`,
      detail: 'Reiniciar instala agora (e tira você do canal de voz por alguns segundos). Se escolher "Depois", ela é instalada quando você fechar o FST.',
    };
    const r = win && !win.isDestroyed() ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    if (r.response === 0) autoUpdater.quitAndInstall();
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 4 * 60 * 60 * 1000); // e de novo a cada 4 horas
}

async function manualCheck() {
  if (!autoUpdater || !app.isPackaged) return box('A verificação de atualização só existe no app instalado (baixado do GitHub).');
  try {
    const r = await autoUpdater.checkForUpdates();
    if (!r || !r.isUpdateAvailable) box('Você já está na versão mais recente.');
    else box('Há uma versão nova. Ela está sendo baixada e você será avisado quando estiver pronta.');
  } catch (e) {
    box('Não consegui verificar agora.', e && e.message ? e.message : String(e));
  }
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'FST',
      submenu: [
        { label: `FST versão ${app.getVersion()}${updateReady ? ' (atualização pronta, reinicie)' : ''}`, enabled: false },
        { label: 'Procurar atualizações', click: manualCheck },
        { type: 'separator' },
        { label: 'Trocar servidor…', click: () => win.loadFile(path.join(__dirname, 'connect.html')) },
        {
          label: 'Tecla "]" do overlay do jogo',
          submenu: [
            { label: 'Teclado português (ABNT2)', type: 'radio', checked: overlayLayout === 'abnt2', click: () => setOverlayLayout('abnt2') },
            { label: 'Teclado americano', type: 'radio', checked: overlayLayout === 'us', click: () => setOverlayLayout('us') },
          ],
        },
        { label: 'Recarregar', accelerator: 'CmdOrCtrl+R', click: () => win.reload() },
        { label: 'Ferramentas do desenvolvedor', accelerator: 'F12', click: () => win.webContents.toggleDevTools() },
        { role: 'quit', label: 'Sair' },
      ],
    },
  ]));
}

function setOverlayLayout(layout) {
  overlayLayout = layout;
  try { fs.writeFileSync(overlayFile(), JSON.stringify({ layout })); } catch {}
  buildMenu();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0f1014',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  // A página foi recarregada ou trocada: o microfone da página antiga não existe mais,
  // e qualquer captura de atalho pendente deve ser descartada.
  win.webContents.on('did-start-navigation', (_e, _url, _inPlace, isMainFrame) => {
    if (!isMainFrame) return;
    core.cancelCapture();
    core.reset({ notify: false });
  });
  win.webContents.on('did-finish-load', () => toPage('ptt:status', { ...hookStatus, platform: process.platform }));
  // Servidor fora do ar (o PC do host está desligado, link errado...): em vez de tela branca, mostra a tela de endereço com o aviso.
  win.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = carregamento cancelado (troca de página)
    win.loadFile(path.join(__dirname, 'connect.html'), { query: { erro: desc || String(code) } });
  });

  const url = process.env.FST_URL || process.env.RESENHA_URL || process.argv.find((a) => /^https?:\/\//.test(a)) || readServer() || defaultServer();
  if (url) win.loadURL(url);
  else win.loadFile(path.join(__dirname, 'connect.html'));

  buildMenu();
}

// Compartilhar tela: abre uma janela própria com duas abas, "Tela inteira" e "Um programa (janela)".
let pickerWin = null;
let pickerDone = null; // (sourceId | null) => void, do pedido em andamento
let pickerList = []; // fontes mostradas no seletor

async function listSources() {
  const self = win && !win.isDestroyed() ? win.getMediaSourceId() : '';
  const raw = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });
  pickerList = raw.filter((s) => s.id !== self); // não oferece a própria janela do FST
  return pickerList.map((s) => ({
    id: s.id,
    kind: s.id.startsWith('screen:') ? 'screen' : 'window',
    name: s.name || 'Sem título',
    thumb: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
    icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : '',
  }));
}

ipcMain.handle('picker:sources', () => listSources());
ipcMain.on('picker:choose', (_e, id) => {
  const done = pickerDone;
  pickerDone = null;
  if (done) done(id || null);
  if (pickerWin && !pickerWin.isDestroyed()) pickerWin.close();
});

function askWhatToShare() {
  return new Promise((resolve) => {
    if (pickerDone) pickerDone(null); // havia outro pedido aberto: cancela
    pickerDone = resolve;
    pickerWin = new BrowserWindow({
      width: 780, height: 580, minWidth: 560, minHeight: 420,
      parent: win, modal: true, show: false,
      title: 'Compartilhar tela', backgroundColor: '#0f1014',
      webPreferences: { preload: path.join(__dirname, 'picker-preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    pickerWin.removeMenu();
    pickerWin.once('ready-to-show', () => pickerWin.show());
    pickerWin.on('closed', () => {
      pickerWin = null;
      if (pickerDone === resolve) { pickerDone = null; resolve(null); } // fechou no X
    });
    pickerWin.loadFile(path.join(__dirname, 'picker.html'));
  });
}

function setupScreenShare() {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    // Cancelar: as versões novas do Electron lançam erro com callback({}); tenta as formas aceitas.
    const cancel = () => {
      for (const args of [[], [null]]) {
        try { callback(...args); return; } catch {}
      }
    };
    try {
      const id = await askWhatToShare();
      const src = id && pickerList.find((s) => s.id === id);
      if (!src) { overlayGuard = false; return cancel(); }
      overlayGuard = src.id.startsWith('window:'); // overlay do jogo só existe ao compartilhar um programa
      // áudio do sistema (loopback) só existe no Windows
      callback(process.platform === 'win32' && request.audioRequested ? { video: src, audio: 'loopback' } : { video: src });
    } catch (e) {
      console.error('seletor de tela:', e);
      cancel();
    }
  });
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  overlayLayout = readOverlayLayout();
  createWindow();
  setupScreenShare();
  setupAutoUpdate();
  if (uIOhook) {
    try {
      uIOhook.start();
      hookStatus = { ok: true, error: null };
    } catch (e) {
      hookStatus = { ok: false, error: 'o hook de teclado/mouse não iniciou: ' + (e && e.message ? e.message : e) };
    }
    toPage('ptt:status', { ...hookStatus, platform: process.platform });
  }
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { try { if (uIOhook) uIOhook.stop(); } catch {} });
