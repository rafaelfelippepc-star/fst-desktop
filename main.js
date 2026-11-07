const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, session, desktopCapturer, powerMonitor, dialog, shell, safeStorage, net, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const { createPttCore } = require('./ptt-core');
const { createTrust, isTunnelUrl, permissionAllowed, navigationAllowed, originOf } = require('./trust-core');
const { cleanNews, pickUnseen, tailText, parseVer, cmpVer } = require('./news-core');

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

// Aceleração de hardware (GPU): ligada por padrão. Se a pessoa desligar nas configurações, a escolha fica
// salva aqui e vale na próxima vez que o app abrir (o Electron só aceita mudar isso antes de iniciar).
const hwFile = () => path.join(app.getPath('userData'), 'hwaccel.json');
const readHw = () => { try { return JSON.parse(fs.readFileSync(hwFile(), 'utf8')).on !== false; } catch { return true; } };
if (!readHw()) app.disableHardwareAcceleration();

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

/* ---------- em quem o app confia (login, ferramentas do desktop, microfone) ---------- */

// "Servidor do FST" = o link que o GITHUB (gist) disse, o link padrão do app (server-default.json), o link aberto
// pela linha de comando (FST_URL / argumento) e o localhost do host. Qualquer outro endereço, como um link digitado em
// "Trocar servidor", abre como um site comum: sem login lembrado, sem as funções do desktop (push to talk global,
// bandeja, atualização...) e sem microfone nem tela. Quem tem um túnel trycloudflare.com consegue criar qualquer link.
// A regra fica em trust-core.js (com testes).
const trustFile = () => path.join(app.getPath('userData'), 'trusted-link.json');
const trust = createTrust({
  load: () => { try { return String(JSON.parse(fs.readFileSync(trustFile(), 'utf8')).origin || ''); } catch { return ''; } },
  save: (origin) => { try { fs.writeFileSync(trustFile(), JSON.stringify({ origin })); } catch {} },
  defaultUrl: defaultServer,
});

const frameUrlOf = (e) => { try { return e.senderFrame ? e.senderFrame.url : ''; } catch { return ''; } };
// Quem pediu é a página PRINCIPAL da janela do app (não um iframe nem outra janela) e ela é do servidor do FST?
function fromServerPage(e) {
  try {
    const wc = win && !win.isDestroyed() ? win.webContents : null;
    const f = e.senderFrame;
    return !!wc && !!f && e.sender === wc && !f.parent && trust.isTrusted(f.url);
  } catch { return false; }
}
// Quem pediu é uma tela do próprio app (connect.html, novidades.html, picker.html) dentro da janela `wc`?
const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
function fromOwnPage(e, wc, file) {
  try {
    const f = e.senderFrame;
    if (!wc || wc.isDestroyed() || !f || e.sender !== wc || f.parent) return false;
    const u = new URL(f.url);
    return u.protocol === 'file:' && samePath(path.normalize(fileURLToPath(u)), path.normalize(path.join(__dirname, file)));
  } catch { return false; }
}
// ipcMain.handle / ipcMain.on que só respondem à página do servidor (o resto recebe a resposta "vazia")
const handleServer = (channel, fn, fallback) => ipcMain.handle(channel, (e, ...a) => (fromServerPage(e) ? fn(e, ...a) : (typeof fallback === 'function' ? fallback() : fallback)));
const onServer = (channel, fn) => ipcMain.on(channel, (e, ...a) => { if (fromServerPage(e)) fn(e, ...a); });

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

// Só a página do servidor do FST recebe os avisos do app (atalho apertado, atualização...); um site qualquer não.
const toPage = (channel, payload) => {
  if (win && !win.isDestroyed() && trust.isTrusted(win.webContents.getURL())) win.webContents.send(channel, payload);
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
onServer('overlay:guard', (_e, on) => { overlayGuard = !!on; });

if (uIOhook) {
  uIOhook.on('keydown', (e) => { core.onEvent('key', e.keycode, true); overlayKey(e.keycode, true); });
  uIOhook.on('keyup', (e) => { core.onEvent('key', e.keycode, false); overlayKey(e.keycode, false); });
  uIOhook.on('mousedown', (e) => core.onEvent('mouse', e.button, true));
  uIOhook.on('mouseup', (e) => core.onEvent('mouse', e.button, false));
}

// Importante: a página só recebe 'down'/'up' do atalho escolhido por ela.
// As demais teclas digitadas no computador nunca são enviadas à página.
onServer('ptt:set-binding', (_e, b) => core.setBinding(b));
onServer('ptt:set-delay', (_e, ms) => core.setReleaseDelay(ms));
// Captura da próxima tecla/botão (para escolher o atalho). Só com a janela do FST em foco, por no máximo 15 s e
// uma tecla por vez: sem isso, chamar isto em loop viraria um registrador de teclas do computador inteiro.
const CAPTURE_MAX_MS = 15000;
handleServer('ptt:capture', () => {
  if (!win || win.isDestroyed() || !win.isFocused()) return null;
  const timer = setTimeout(() => core.cancelCapture(), CAPTURE_MAX_MS);
  return core.captureNext().finally(() => clearTimeout(timer));
}, null);
// segundos sem mexer no teclado/mouse no computador inteiro (usado para mandar para o AFK)
handleServer('system:idle', () => powerMonitor.getSystemIdleTime(), 0);
handleServer('ptt:status', () => ({ ...hookStatus, platform: process.platform }),
  () => ({ ok: false, error: 'esta página não é o servidor do FST: o atalho global só funciona no link do servidor', platform: process.platform }));

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
    if (!trust.mayStoreLoginFrom(cookie.domain)) return; // cookie de um site qualquer não troca o login guardado
    if (!removed) {
      if (cookie.value) persistSession({ value: cookie.value, expires: cookie.expirationDate || 0 });
    } else if (savedSession && cookie.value === savedSession.value && cause !== 'overwrite') {
      persistSession(null); // saiu da conta (ou o login expirou)
    }
  });
}
// O login só é entregue ao link do servidor que veio do gist (ou ao padrão do app), nunca a um link digitado:
// qualquer pessoa consegue abrir um túnel trycloudflare.com e, com o login (cookie de 30 dias), entraria na conta.
const carriesLogin = (url) => trust.carriesLogin(url);
async function loadServer(url) {
  try {
    const jar = session.defaultSession.cookies;
    const have = await jar.get({ url, name: LOGIN_COOKIE });
    const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
    if (have.length && !savedSession && trust.mayStoreLoginFrom(host)) {
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

/* ---------- descoberta automática do link (gist) ---------- */

// O PC do host (publicar-link.js) grava o link novo do túnel num gist público do GitHub.
// Aqui o app lê esse gist ao abrir, quando o link salvo não responde e a cada poucos minutos.
// O ID do gist vem em server-default.json ("gist"). Sem ele, nada disso acontece.
const GIST_FILE = 'fst-link.json';
const GIST_POLL_MS = 3 * 60 * 1000;
const defaultGist = () => {
  try {
    const g = String(JSON.parse(fs.readFileSync(path.join(__dirname, 'server-default.json'), 'utf8')).gist || '').trim();
    return /^[0-9a-f]{20,40}$/i.test(g) ? g : '';
  } catch { return ''; }
};
const sameHost = (a, b) => { try { return new URL(a).host === new URL(b).host; } catch { return false; } };
let gistEtag = '';
let gistLast = ''; // último link válido lido do gist (devolvido quando o GitHub responde 304)
let lastDiscovered = ''; // último link que o app já tratou, para o vigia só agir quando mudar
let pinnedUrl = false; // abriu com link na linha de comando/variável de ambiente: não mexe

// Devolve o link atual do gist ('' se não conseguiu ou se não há gist configurado).
async function discoverServer() {
  const id = defaultGist();
  if (!id) return '';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 4000);
  try {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'FST-Desktop' };
    if (gistEtag && gistLast) headers['If-None-Match'] = gistEtag;
    const res = await net.fetch('https://api.github.com/gists/' + id, { headers, signal: ctl.signal });
    if (res.status === 304) return gistLast;
    if (!res.ok) throw new Error('o GitHub respondeu ' + res.status);
    const data = await res.json();
    const url = String(JSON.parse(data.files[GIST_FILE].content).url || '').trim().replace(/\/+$/, '');
    if (!isTunnelUrl(url)) throw new Error('o gist não tem um link de túnel válido');
    trust.trustGist(url); // veio do GitHub: este é o link do servidor
    gistEtag = res.headers.get('etag') || '';
    gistLast = url;
    return url;
  } catch (e) {
    updLog('descoberta do link: ' + (e && e.message ? e.message : e));
    return '';
  } finally {
    clearTimeout(timer);
  }
}

// Endereço para abrir agora. Link salvo que NÃO é de túnel (localhost do host, link fixo...) sempre vale.
// Se for de túnel (ou não houver nada), o do gist vence e fica salvo como último link conhecido.
async function resolveStartUrl() {
  const saved = readServer() || defaultServer();
  if (saved && !isTunnelUrl(saved)) return saved;
  const found = await discoverServer();
  if (!found) return saved;
  lastDiscovered = found;
  if (saved && sameHost(saved, found)) return saved; // mesmo túnel: mantém (e o ?sala= que veio junto)
  writeServer(found);
  return found;
}

// Enquanto o app está aberto: se o host reiniciou o túnel, o gist muda e o app segue para o link novo.
function watchServerLink() {
  if (!defaultGist() || pinnedUrl) return;
  setInterval(async () => {
    const found = await discoverServer();
    if (!found || found === lastDiscovered) return;
    lastDiscovered = found;
    if (!win || win.isDestroyed()) return;
    const cur = win.webContents.getURL();
    const onTunnel = isTunnelUrl(cur) || cur.startsWith('file:'); // 'file:' = tela de endereço/erro
    if (!onTunnel || sameHost(cur, found)) return; // está no localhost do host ou já no link certo
    updLog('link novo encontrado: ' + found);
    writeServer(found);
    loadServer(found);
  }, GIST_POLL_MS);
}

/* ---------- servidor e janela ---------- */

const fromConnectPage = (e) => fromOwnPage(e, win && win.webContents, 'connect.html');
ipcMain.handle('server:get', (e) => (fromConnectPage(e) ? readServer() || defaultServer() : ''));
ipcMain.on('server:save', (e, url) => {
  if (!fromConnectPage(e)) return;
  url = String(url || '').trim();
  if (!/^https?:\/\//i.test(url)) return;
  // se for o mesmo endereço padrão do app, não "trava" esse valor: assim, se o padrão mudar numa versão nova, a pessoa recebe junto
  if (url === defaultServer()) clearServer();
  else writeServer(url);
  loadServer(url);
  if (!trust.isTrusted(url)) {
    // endereço digitado à mão que não é o do servidor do FST: abre, mas só como um site comum
    dialog.showMessageBox(visibleWin() || undefined, {
      type: 'warning', buttons: ['OK'], title: 'FST Beta', message: 'Este endereço não é o do servidor do FST.',
      detail: 'Ele abre só como um site comum: sem login lembrado, sem push to talk global, sem microfone e sem tela. O app acha o link certo sozinho; use "Trocar servidor" só se o host pediu.',
    }).catch(() => {});
  }
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
handleServer('app:version', () => app.getVersion(), '');
handleServer('app:update-check', async (_e, opts) => {
  const r = await updateCheck();
  if (r.state === 'ready' && !(opts && opts.silent)) promptRestart(r.version); // silent: a página mostra o próprio botão
  return r;
}, { state: 'dev', version: '' });
// botão "Reiniciar e instalar" da barra de cima da página
onServer('app:update-install', () => { if (updateReady) installUpdate(); });

/* ---------- novidades: o que mudou em cada versão (janela própria, não o Bloco de Notas) ---------- */

// As notas vêm do novidades.json (vai dentro do instalador). Depois de atualizar, a janela abre sozinha com o que é
// novo para a pessoa; no menu, "Novidades" abre quando quiser; o registro técnico das atualizações fica na aba "Registro técnico" dessa mesma janela
// (o aviso de erro de atualização em app.js manda a pessoa para "menu do app > Novidades > Registro técnico": se mudar, mude lá também).
const NEWS_DELAY_MS = 6000; // espera o app terminar de abrir antes de mostrar a janela
const seenFile = () => path.join(app.getPath('userData'), 'news-seen.json');
const readSeen = () => {
  try {
    const v = JSON.parse(fs.readFileSync(seenFile(), 'utf8')).version;
    return parseVer(v) ? String(v) : '';
  } catch { return ''; }
};
const writeSeen = (v) => { try { fs.writeFileSync(seenFile(), JSON.stringify({ version: v })); } catch {} };
const loadNews = () => {
  try { return cleanNews(JSON.parse(fs.readFileSync(path.join(__dirname, 'novidades.json'), 'utf8'))); } catch (e) {
    console.warn('novidades.json:', e && e.message ? e.message : e);
    return [];
  }
};
let newsUnseen = []; // versões novas desde a última vez que a pessoa abriu o app (só para destacar com "Novo")
let newsWin = null;

function openNews(tab) {
  const query = { tab: tab === 'log' ? 'log' : 'news' };
  const page = path.join(__dirname, 'novidades.html');
  if (newsWin && !newsWin.isDestroyed()) {
    newsWin.loadFile(page, { query });
    if (newsWin.isMinimized()) newsWin.restore();
    newsWin.show();
    newsWin.focus();
    return;
  }
  newsWin = new BrowserWindow({
    width: 680, height: 640, minWidth: 460, minHeight: 420, show: false,
    title: 'Novidades do FST Beta', backgroundColor: '#0f1014',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'novidades-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  newsWin.removeMenu();
  newsWin.once('ready-to-show', () => newsWin && !newsWin.isDestroyed() && newsWin.show());
  newsWin.on('closed', () => { newsWin = null; });
  newsWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  newsWin.webContents.on('will-navigate', (e) => e.preventDefault());
  newsWin.loadFile(page, { query });
}

// Roda uma vez, antes de a janela principal abrir (e antes de qualquer escrita no registro das atualizações).
function initNews() {
  // Quem já usava o app antes das Novidades existirem não tem "última versão vista": vê só a atual.
  // Instalação nova (nenhum arquivo do app ainda) começa do zero e não recebe a janela.
  const wasUsed = [cfgFile(), sessFile(), updLogFile()].some((f) => { try { return fs.existsSync(f); } catch { return false; } });
  const current = app.getVersion();
  const seen = readSeen();
  if (seen || wasUsed) newsUnseen = pickUnseen(loadNews(), seen, current).map((e) => e.version);
  writeSeen(current);
  if (newsUnseen.length && app.isPackaged) setTimeout(() => openNews('news'), NEWS_DELAY_MS);
}

const fromNewsPage = (e) => fromOwnPage(e, newsWin && newsWin.webContents, 'novidades.html');
ipcMain.handle('news:get', (e) => {
  if (!fromNewsPage(e)) return { current: '', entries: [], unseen: [] };
  const current = app.getVersion();
  const all = loadNews();
  // no app instalado, nunca mostra versão que a pessoa ainda não tem (sem spoiler); em teste (npm start) mostra tudo
  const entries = app.isPackaged ? all.filter((e) => cmpVer(e.version, current) <= 0) : all;
  return { current, entries, unseen: newsUnseen };
});
ipcMain.handle('news:log', (e) => {
  if (!fromNewsPage(e)) return '';
  try { return tailText(fs.readFileSync(updLogFile(), 'utf8')); } catch { return ''; }
});
ipcMain.on('news:copy', (e, text) => { if (!fromNewsPage(e)) return; try { clipboard.writeText(String(text || '').slice(0, 200000)); } catch {} });
ipcMain.on('news:close', (e) => { if (fromNewsPage(e) && newsWin && !newsWin.isDestroyed()) newsWin.close(); });

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Menu',
      submenu: [
        { label: `FST Beta versão ${app.getVersion()}${updateReady ? ' (atualização pronta, reinicie)' : ''}`, enabled: false },
        { label: 'Procurar atualizações', click: manualCheck },
        { label: 'Novidades (o que mudou)', click: () => openNews('news') },
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
handleServer('hw:get', () => readHw(), true);
onServer('hw:set', (_e, on) => { try { fs.writeFileSync(hwFile(), JSON.stringify({ on: !!on })); } catch {} });
// reinicia o app para a escolha da aceleração de hardware valer
onServer('app:relaunch', () => {
  quitting = true; // com a bandeja ligada, o X só esconde a janela: aqui precisa fechar de verdade
  try { if (uIOhook) uIOhook.stop(); } catch {}
  app.relaunch();
  app.exit(0);
});
handleServer('tray:get', () => trayOn, false);
onServer('tray:set', (_e, on) => {
  trayOn = !!on;
  try { fs.writeFileSync(trayFile(), JSON.stringify({ on: trayOn })); } catch {}
  syncTray();
});
app.on('before-quit', () => { quitting = true; });

// A janela NÃO navega sozinha para outro site: um clique em link sem target, um redirecionamento ou um script da
// página (de um servidor comprometido, por exemplo) não consegue levar o app para fora do endereço em que está.
// Só o próprio app troca de página (loadURL/loadFile, que não passam por aqui). Links do chat continuam abrindo
// no navegador do computador (setWindowOpenHandler). O que for barrado fica no Registro técnico (só o endereço).
let lastBlockedNav = '';
function guardNavigation(wc) {
  const urlOf = (d, u) => String((d && d.url) || u || ''); // o Electron novo manda o endereço no evento; o antigo, como argumento
  const block = (e, url, what) => {
    e.preventDefault();
    const where = originOf(url) || String(url).split(':')[0] + ':';
    if (where !== lastBlockedNav) { lastBlockedNav = where; updLog(`${what} bloqueado: ${where}`); }
  };
  wc.on('will-navigate', (e, u) => {
    const url = urlOf(e, u);
    if (!navigationAllowed(wc.getURL(), url)) block(e, url, 'navegação');
  });
  // Redirecionamento: confere só quando a página aberta é um site. Saindo de uma página do app (tela de endereço
  // ou de erro), quem escolheu o endereço foi a própria pessoa, e o site dela pode redirecionar normalmente.
  wc.on('will-redirect', (e, u) => {
    const url = urlOf(e, u);
    const cur = wc.getURL();
    if (originOf(cur) && !navigationAllowed(cur, url)) block(e, url, 'redirecionamento');
  });
}
// Nenhuma janela do app aceita <webview> (nem a página do servidor): seria outro jeito de embutir um site.
app.on('web-contents-created', (_e, contents) => contents.on('will-attach-webview', (ev) => ev.preventDefault()));

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

  guardNavigation(win.webContents);

  // Fechar a janela principal de verdade fecha também a de Novidades (senão ela segurava o app aberto).
  win.on('closed', () => { if (newsWin && !newsWin.isDestroyed()) newsWin.close(); });

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
  win.on('blur', () => core.cancelCapture()); // saiu do FST: ninguém fica "escutando" a próxima tecla
  win.webContents.on('did-finish-load', () => toPage('ptt:status', { ...hookStatus, platform: process.platform }));
  // Servidor fora do ar (o PC do host está desligado, link errado...): em vez de tela branca, mostra a tela de endereço com o aviso.
  win.webContents.on('did-fail-load', async (_e, code, desc, failedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = carregamento cancelado (troca de página)
    // Se era um link de túnel, ele pode ter mudado: confere no gist antes de desistir.
    if (!pinnedUrl && isTunnelUrl(failedUrl)) {
      const found = await discoverServer();
      if (found && !sameHost(found, failedUrl) && win && !win.isDestroyed()) {
        lastDiscovered = found;
        updLog('link antigo não respondeu; indo para o link novo: ' + found);
        writeServer(found);
        return loadServer(found);
      }
    }
    if (win && !win.isDestroyed()) win.loadFile(path.join(__dirname, 'connect.html'), { query: { erro: desc || String(code) } });
  });

  const explicit = process.env.FST_URL || process.env.RESENHA_URL || process.argv.find((a) => /^https?:\/\//.test(a));
  pinnedUrl = !!explicit;
  const openConnect = () => { if (win && !win.isDestroyed()) win.loadFile(path.join(__dirname, 'connect.html')); };
  if (explicit) { trust.pin(explicit); loadServer(explicit); }
  else {
    resolveStartUrl().then((url) => {
      if (!win || win.isDestroyed()) return;
      if (url) loadServer(url);
      else openConnect();
    });
  }

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

const fromPickerPage = (e) => fromOwnPage(e, pickerWin && pickerWin.webContents, 'picker.html');
ipcMain.handle('picker:sources', (e) => (fromPickerPage(e) ? listSources() : []));
ipcMain.on('picker:choose', (e, id) => {
  if (!fromPickerPage(e)) return;
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
    pickerWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    pickerWin.webContents.on('will-navigate', (e) => e.preventDefault());
    pickerWin.once('ready-to-show', () => pickerWin.show());
    pickerWin.on('closed', () => {
      pickerWin = null;
      if (pickerDone === resolve) { pickerDone = null; resolve(null); } // fechou no X
    });
    pickerWin.loadFile(path.join(__dirname, 'picker.html'));
  });
}

// Microfone, tela, som... só para a página do servidor do FST (nunca para um site qualquer nem para um iframe).
// Sem isto o Chromium libera tudo para qualquer endereço carregado no app.
function setupPermissions() {
  const ses = session.defaultSession;
  const topUrl = (wc) => { try { return wc ? wc.getURL() : ''; } catch { return ''; } };
  const mine = (wc) => !!wc && !!win && !win.isDestroyed() && wc === win.webContents;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    let ok = false;
    try { ok = mine(wc) && permissionAllowed(trust, permission, topUrl(wc), (details && details.requestingUrl) || ''); } catch {}
    callback(ok);
  });
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
    try { return mine(wc) && permissionAllowed(trust, permission, topUrl(wc), (details && details.requestingUrl) || requestingOrigin || ''); } catch { return false; }
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
      // só a página do servidor do FST pode pedir para compartilhar a tela
      const asker = (request.frame && request.frame.url) || (win && !win.isDestroyed() ? win.webContents.getURL() : '');
      if (!trust.isTrusted(asker)) return cancel();
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
  initNews();
  overlayLayout = readOverlayLayout();
  trayOn = readTray();
  // Quem já usava o app antes desta versão tem o link salvo (que o próprio app gravou ou que a pessoa digitou na época):
  // ele continua valendo até o gist dizer outro, para o app não parar de funcionar se o GitHub estiver fora do ar.
  if (!fs.existsSync(trustFile())) { const saved = readServer(); if (isTunnelUrl(saved)) trust.trustGist(saved); }
  setupPermissions();
  loadSavedSession();
  watchLoginCookie();
  createWindow();
  syncTray();
  setupScreenShare();
  setupAutoUpdate();
  watchServerLink();
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
