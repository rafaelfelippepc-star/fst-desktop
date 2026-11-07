'use strict';
// Em quais endereços o app confia, separado do Electron para poder ser testado.
//
// Três coisas dependem disso:
//  - o LOGIN lembrado (cookie fst_sid) só é entregue ao link que veio do gist (ou ao padrão do app), nunca a um
//    link digitado à mão: qualquer pessoa consegue abrir um túnel trycloudflare.com;
//  - as FERRAMENTAS DO DESKTOP (push to talk global, bandeja, atualização...) só respondem à página do servidor do FST;
//  - o MICROFONE, a tela e as demais permissões do Chromium só são liberados à página do servidor do FST.
// Servidor do FST = link do gist, link padrão do app (server-default.json), link aberto pela linha de comando
// (FST_URL ou argumento) e o localhost do próprio host. Um link digitado em "Trocar servidor" abre, mas como um
// site comum, sem nada disso.

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

const parse = (u) => { try { return new URL(String(u)); } catch { return null; } };
const web = (x) => !!x && (x.protocol === 'https:' || x.protocol === 'http:');

// api.trycloudflare.com é o serviço do cloudflared, não um túnel de alguém
function isTunnelHost(h) {
  const host = String(h || '').toLowerCase();
  return /^[a-z0-9-]+\.trycloudflare\.com$/.test(host) && host !== 'api.trycloudflare.com';
}
function isTunnelUrl(u) {
  const x = parse(u);
  return !!x && x.protocol === 'https:' && !x.username && !x.password && isTunnelHost(x.hostname);
}
function isLoopbackUrl(u) {
  const x = parse(u);
  return web(x) && LOOPBACK.has(x.hostname.toLowerCase());
}
const originOf = (u) => { const x = parse(u); return web(x) ? x.origin.toLowerCase() : ''; };

// load() devolve o endereço (origem) do último link vindo do gist; save(origem) guarda para a próxima abertura.
// defaultUrl() devolve o link do server-default.json.
function createTrust({ load = () => '', save = () => {}, defaultUrl = () => '' } = {}) {
  let gist = '';
  let pinned = '';
  const g = load();
  if (isTunnelUrl(g)) gist = originOf(g);
  const def = () => { const u = defaultUrl(); return web(parse(u)) ? originOf(u) : ''; };

  return {
    // o app foi para este link porque o GITHUB (gist) disse que é o do servidor
    trustGist(url) {
      if (!isTunnelUrl(url)) return false;
      gist = originOf(url);
      try { save(gist); } catch {}
      return true;
    },
    // o link veio de quem abriu o app (FST_URL ou argumento na linha de comando)
    pin(url) { pinned = originOf(url); },
    // servidor do FST: ferramentas do desktop e permissões
    isTrusted(url) {
      if (isLoopbackUrl(url)) return true;
      const o = originOf(url);
      if (!o) return false;
      if (o.startsWith('http:')) return o === pinned; // sem HTTPS só vale se foi o usuário quem abriu assim
      return o === gist || o === def() || o === pinned;
    },
    // o login lembrado pode ser ENTREGUE a este link? (só túnel do gist ou o padrão do app)
    carriesLogin(url) {
      if (!isTunnelUrl(url)) return false;
      const o = originOf(url);
      return o === gist || o === def();
    },
    // este cookie (domain = nome do site, com ou sem ponto na frente) pode ser guardado como "o login"?
    // Só o do link do gist, o do padrão do app e o do localhost do host: um site qualquer não troca o login guardado.
    mayStoreLoginFrom(domain) {
      const h = String(domain || '').replace(/^\./, '').toLowerCase();
      if (!h) return false;
      if (LOOPBACK.has(h)) return true;
      const ok = (o) => { const x = parse(o); return !!x && x.hostname.toLowerCase() === h; };
      return ok(gist) || ok(def());
    },
    get gist() { return gist; },
  };
}

// Permissões do Chromium (microfone, tela, tela cheia...). topUrl = página principal da janela;
// requestingUrl = quem está pedindo (pode ser um iframe, como o player do YouTube).
const OWN_PAGE_ONLY = new Set(['media', 'display-capture', 'speaker-selection', 'clipboard-sanitized-write']);
const TOP_PAGE_MAY_DELEGATE = new Set(['fullscreen']); // o botão de tela cheia do player do YouTube
function permissionAllowed(trust, permission, topUrl, requestingUrl) {
  if (!trust.isTrusted(topUrl)) return false;
  if (OWN_PAGE_ONLY.has(permission)) return trust.isTrusted(requestingUrl || topUrl) && originOf(requestingUrl || topUrl) === originOf(topUrl);
  return TOP_PAGE_MAY_DELEGATE.has(permission);
}

// A janela do app nunca deve ir sozinha para outro site (link sem target, redirecionamento, script da página).
// Quando a página (clique, redirecionamento, script) pede para navegar, só vale ficar no MESMO endereço (origem) da
// página aberta, ou recarregar a mesma página. Quem troca de página de verdade é o próprio app (loadURL/loadFile),
// que não passa por esta conferência. Páginas do app (file:) não navegam sozinhas para lugar nenhum.
function navigationAllowed(currentUrl, targetUrl) {
  const noHash = (u) => String(u == null ? '' : u).split('#')[0];
  if (noHash(currentUrl) && noHash(currentUrl) === noHash(targetUrl)) return true;
  const a = originOf(currentUrl);
  return !!a && a === originOf(targetUrl);
}

module.exports = { createTrust, isTunnelUrl, isTunnelHost, isLoopbackUrl, originOf, permissionAllowed, navigationAllowed };
