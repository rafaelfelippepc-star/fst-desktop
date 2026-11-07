const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, session, desktopCapturer, powerMonitor, dialog, shell, safeStorage } = require('electron');
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
let quitting = false; // o app está mesmo saindo (e não só escondendo a janela na bandeja)

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
ipcMain.on('ptt:set-delay', (_e, ms) => core.setReleaseDelay(ms));
ipcMain.handle('ptt:capture', () => core.captureNext());
// segundos sem mexer no teclado/mouse no computador inteiro (usado para mandar para o AFK)
ipcMain.handle('system:idle', () => powerMonitor.getSystemIdleTime());
ipcMain.handle('ptt:status', () => ({ ...hookStatus, platform: process.platform }));

/* ---------- login lembrado (mesmo quando o link do túnel muda) ---------- */

// O login da conta é um cookie, e cada link novo (trycloudflare.com) é um "site" novo, sem cookie.
// Por isso o app guarda o login (criptografado pelo Windows) e o entrega a cada link novo do túnel.
const LOGIN_COOKIE = 'fst_sid';
const sessFile = () => path.join(app.getPath('userData'), 'session.bin');
let savedSession = null; // { value, expires }
function loadSavedSession() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return;
    const s = JSON.parse(safeStorage.decryptString(fs.readFileSync(sessFile())));
    if (s && typeof s.value === 'string' && s.value && (!s.expires || s.expires * 1000 > Date.now())) savedSession = s;
  } catch {}
}
function persistSession(s) {
  savedSession = s;
  try {
    if (!s) { fs.unlinkSync(sessFile()); return; }
    if (safeStorage.isEncryptionAvailable()) fs.writeFileSync(sessFile(), safeStorage.encryptString(JSON.stringify(s)));
  } catch {}
}
function watchLoginCookie() {
  session.defaultSession.cookies.on('changed', (_e, cookie, cause, removed) => {
    if (cookie.name !== LOGIN_COOKIE) return;
    if (!removed) {
      if (cookie.value) persistSession({ value: cookie.value, expires: cookie.expirationDate || 0 });
    } else if (savedSession && cookie.value === savedSession.value && cause !== 'overwrite') {
      persistSession(null); // saiu da conta (ou o login expirou)
    }
  });
}
// o login só é entregue a links de túnel (trycloudflare.com), nunca a um endereço qualquer
const carriesLogin = (url) => { try { return /\.trycloudflare\.com$/i.test(new URL(url).hostname); } catch { return false; } };
async function loadServer(url) {
  try {
    const jar = session.defaultSession.cookies;
    const have = await jar.get({ url, name: LOGIN_COOKIE });
    if (have.length && !savedSession) {
      // quem já estava logado antes desta versão: guarda o login atual
      persistSession({ value: have[0].value, expires: have[0].expirationDate || 0 });
    } else if (savedSession && carriesLogin(url)) {
      if (!have.length || have[0].value !== savedSession.value) {
        await jar.set({
          url, name: LOGIN_COOKIE, value: savedSession.value, path: '/', httpOnly: true, sameSite: 'lax',
          secure: url.startsWith('https'),
          ...(savedSession.expires ? { expirationDate: savedSession.expires } : {}),
        });
      }
    }
  } catch (e) { console.warn('login lembrado:', e && e.message ? e.message : e); }
  if (win && !win.isDestroyed()) win.loadURL(url);
}

/* ---------- servidor e janela ---------- */

ipcMain.handle('server:get', () => readServer() || defaultServer());
ipcMain.on('server:save', (_e, url) => {
  // se for o mesmo endereço padrão do app, não "trava" esse valor: assim, se o padrão mudar numa versão nova, a pessoa recebe junto
  if (url === defaultServer()) clearServer();
  else writeServer(url);
  loadServer(url);
});

/* ---------- atualização do app (GitHub Releases) ---------- */

let updateReady = false;
let readyVersion = '';
let checking = false;

// Registro das atualizações (pasta de dados do app, update.log): se a atualização falhar, o motivo fica aqui.
const updLogFile = () => path.join(app.getPath('userData'), 'update.log');
const updLog = (msg) => { try { fs.appendFileSync(updLogFile(), `[${new Date().toLocaleString('pt-BR')}] ${msg}\n`); } catch {} };
// A página mostra o andamento na barra de cima: { state: 'downloading' | 'ready' | 'error', version?, percent?, message? }
const sendUpdate = (s) => toPage('app:update', s);

// Fecha o app DE VERDADE e roda o instalador da versão baixada, abrindo o app de novo no fim.
function installUpdate() {
  quitting = true; // com a bandeja ligada, o X só esconde a janela: aqui precisa fechar de verdade
  updLog('instalando a atualização ' + readyVersion);
  try { if (uIOhook) uIOhook.stop(); } catch {} // o gancho de teclado não pode segurar o processo aberto
  try {
    autoUpdater.quitAndInstall(true, true); // silencioso, e abre o FST Beta de novo quando terminar
  } catch (e) {
    updLog('falha ao instalar: ' + (e && e.message ? e.message : e));
    quitting = false;
    sendUpdate({ state: 'error', message: e && e.message ? e.message : String(e) });
    return;
  }
  setTimeout(() => app.exit(0), 5000); // se o app não fechar sozinho, força (o instalador já foi iniciado)
}
// janela principal, só se estiver visível (um aviso preso a uma janela escondida na bandeja não apareceria)
const visibleWin = () => (win && !win.isDestroyed() && win.isVisible() ? win : null);
const box = (message, detail) => {
  const opts = { type: 'info', buttons: ['OK'], title: 'FST Beta', message, detail };
  const w = visibleWin();
  return w ? dialog.showMessageBox(w, opts) : dialog.showMessageBox(opts);
};

// Pergunta se a pessoa quer reiniciar para instalar a atualização que já foi baixada.
async function promptRestart(version) {
  const opts = {
    type: 'info', buttons: ['Reiniciar agora', 'Depois'], defaultId: 1, cancelId: 1,
    title: 'Atualização do FST Beta', message: `A versão ${version} do FST Beta foi baixada.`,
    detail: 'Reiniciar instala agora (e tira você do canal de voz por alguns segundos). Se escolher "Depois", ela é instalada quando você fechar o FST Beta.',
  };
  const w = visibleWin();
  const r = w ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts);
  if (r.response === 0) installUpdate();
}

function setupAutoUpdate() {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // se escolher "Depois", instala quando fechar o FST
  autoUpdater.on('error', (e) => {
    const msg = e && e.message ? e.message : String(e);
    console.warn('atualização:', msg);
    updLog('erro: ' + msg);
    sendUpdate({ state: 'error', message: msg });
  });
  autoUpdater.on('update-available', (info) => {
    updLog('versão nova encontrada: ' + info.version + ' (baixando)');
    sendUpdate({ state: 'downloading', version: info.version, percent: 0 });
  });
  autoUpdater.on('update-not-available', () => updLog('nenhuma versão nova'));
  autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => {
    updateReady = true;
    readyVersion = info.version;
    updLog('versão ' + info.version + ' baixada e pronta');
    buildMenu();
    sendUpdate({ state: 'ready', version: info.version });
    promptRestart(info.version);
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 4 * 60 * 60 * 1000); // e de novo a cada 4 horas
}

// Procura atualização agora. Devolve { state, version, message? }, com state:
// 'dev' (app não instalado), 'ready' (já baixada), 'checking' (já procurando), 'available', 'none' ou 'error'.
async function updateCheck() {
  if (!autoUpdater || !app.isPackaged) return { state: 'dev', version: app.getVersion() };
  if (updateReady) return { state: 'ready', version: readyVersion };
  if (checking) return { state: 'checking', version: app.getVersion() };
  checking = true;
  try {
    const r = await autoUpdater.checkForUpdates();
    return r && r.isUpdateAvailable
      ? { state: 'available', version: r.updateInfo.version }
      : { state: 'none', version: app.getVersion() };
  } catch (e) {
    return { state: 'error', version: app.getVersion(), message: e && e.message ? e.message : String(e) };
  } finally {
    checking = false;
  }
}

// Item "Procurar atualizações" do menu de cima.
async function manualCheck() {
  const r = await updateCheck();
  if (r.state === 'ready') return promptRestart(r.version);
  if (r.state === 'dev') return box('A verificação de atualização só existe no app instalado (baixado do GitHub).');
  if (r.state === 'checking') return box('Já estou procurando. Aguarde um instante.');
  if (r.state === 'available') return box(`Há uma versão nova (${r.version}).`, 'Ela está sendo baixada e você será avisado quando estiver pronta.');
  if (r.state === 'error') return box('Não consegui verificar agora.', r.message);
  return box('Você já está na versão mais recente.', `Versão ${r.version}.`);
}

// Botão "Procurar atualizações" que fica dentro da página (configurações).
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:update-check', async (_e, opts) => {
  const r = await updateCheck();
  if (r.state === 'ready' && !(opts && opts.silent)) promptRestart(r.version); // silent: a página mostra o próprio botão
  return r;
});
// botão "Reiniciar e instalar" da barra de cima da página
ipcMain.on('app:update-install', () => { if (updateReady) installUpdate(); });

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Menu',
      submenu: [
        { label: `FST Beta versão ${app.getVersion()}${updateReady ? ' (atualização pronta, reinicie)' : ''}`, enabled: false },
        { label: 'Procurar atualizações', click: manualCheck },
        {
          label: 'Ver registro das atualizações',
          click: () => {
            try { if (!fs.existsSync(updLogFile())) fs.writeFileSync(updLogFile(), '(ainda sem registros)\n'); } catch {}
            shell.openPath(updLogFile());
          },
        },
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

/* ---------- bandeja do sistema (clicar no X minimiza em vez de fechar) ---------- */

const trayFile = () => path.join(app.getPath('userData'), 'tray.json');
const readTray = () => { try { return JSON.parse(fs.readFileSync(trayFile(), 'utf8')).on === true; } catch { return false; } };
let trayOn = false; // padrão: desligado (o X fecha o app, como sempre foi)
let tray = null;

function showWin() {
  if (!win || win.isDestroyed()) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function syncTray() {
  if (trayOn && !tray) {
    try {
      const img = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 32, height: 32 });
      if (img.isEmpty()) throw new Error('ícone não encontrado');
      tray = new Tray(img);
      tray.setToolTip('FST Beta');
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Abrir o FST Beta', click: showWin },
        { type: 'separator' },
        { label: 'Sair', click: () => { quitting = true; app.quit(); } },
      ]));
      tray.on('click', showWin);
    } catch (e) {
      console.warn('bandeja:', e && e.message ? e.message : e);
      tray = null;
      trayOn = false; // sem o ícone não há como reabrir: não esconde a janela
    }
  } else if (!trayOn && tray) {
    tray.destroy();
    tray = null;
    if (win && !win.isDestroyed() && !win.isVisible()) win.show();
  }
}
ipcMain.handle('tray:get', () => trayOn);
ipcMain.on('tray:set', (_e, on) => {
  trayOn = !!on;
  try { fs.writeFileSync(trayFile(), JSON.stringify({ on: trayOn })); } catch {}
  syncTray();
});
app.on('before-quit', () => { quitting = true; });

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0f1014',
    icon: path.join(__dirname, 'icon.png'), // ícone da janela/barra de tarefas (o instalador e o atalho usam build/icon.ico)
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  // Com a bandeja ligada, o X só esconde a janela (a chamada e o push to talk continuam funcionando).
  win.on('close', (e) => {
    if (trayOn && tray && !quitting) {
      e.preventDefault();
      win.hide();
    }
  });

  // Links clicados no chat abrem no navegador do computador (e não numa janela nova do FST).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
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
  if (url) loadServer(url);
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

app.on('second-instance', () => showWin()); // abrir o FST de novo traz de volta a janela escondida na bandeja

app.whenReady().then(() => {
  overlayLayout = readOverlayLayout();
  trayOn = readTray();
  loadSavedSession();
  watchLoginCookie();
  createWindow();
  syncTray();
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
