// Teste de em quais endereços o app confia. Rode com:  node trust-core.test.js
const assert = require('node:assert/strict');
const { createTrust, isTunnelUrl, isLoopbackUrl, originOf, permissionAllowed, navigationAllowed } = require('./trust-core');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const GIST = 'https://alpha-beta.trycloudflare.com';
const OTHER = 'https://evil-link.trycloudflare.com';
const DEFAULT = 'https://fixo.example.com';

function make({ saved = '', def = '' } = {}) {
  const stored = { v: saved };
  const t = createTrust({ load: () => stored.v, save: (o) => { stored.v = o; }, defaultUrl: () => def });
  return { t, stored };
}

test('links de túnel: só https, só trycloudflare.com, nunca o serviço api', () => {
  assert.ok(isTunnelUrl(GIST));
  assert.ok(isTunnelUrl(GIST + '/?sala=x'));
  for (const bad of ['http://alpha-beta.trycloudflare.com', 'https://api.trycloudflare.com', 'https://trycloudflare.com', 'https://alpha.trycloudflare.com.evil.com',
    'https://alpha.trycloudflare.com@evil.com', 'https://user:pw@alpha.trycloudflare.com', 'https://evil.com/alpha.trycloudflare.com', '', null, 'lixo']) {
    assert.equal(isTunnelUrl(bad), false, String(bad));
  }
});

test('localhost do host é confiável em qualquer porta; parecidos não são', () => {
  for (const ok of ['http://localhost:3000', 'http://127.0.0.1:3000/', 'http://localhost', 'http://[::1]:3000']) assert.ok(isLoopbackUrl(ok), ok);
  for (const bad of ['http://localhost.evil.com', 'http://evil.com/localhost', 'http://127.0.0.1.evil.com', 'file:///C:/x/index.html', 'ftp://localhost']) assert.equal(isLoopbackUrl(bad), false, bad);
});

test('link digitado à mão (nunca veio do gist) NÃO é confiável e NÃO recebe o login', () => {
  const { t } = make();
  assert.equal(t.isTrusted(OTHER), false);
  assert.equal(t.carriesLogin(OTHER), false);
  assert.equal(t.mayStoreLoginFrom('evil-link.trycloudflare.com'), false);
});

test('link do gist é confiável, recebe o login, e só ele (o link anterior deixa de valer)', () => {
  const { t, stored } = make();
  assert.ok(t.trustGist(GIST));
  assert.equal(stored.v, GIST, 'guardado para a próxima abertura');
  assert.ok(t.isTrusted(GIST + '/algo?x=1'));
  assert.ok(t.carriesLogin(GIST));
  assert.ok(t.mayStoreLoginFrom('alpha-beta.trycloudflare.com'));
  assert.ok(t.mayStoreLoginFrom('.alpha-beta.trycloudflare.com'), 'cookie de domínio, com ponto na frente');
  assert.ok(t.trustGist(OTHER));
  assert.equal(t.isTrusted(GIST), false, 'o link velho deixa de valer');
  assert.equal(t.carriesLogin(GIST), false);
});

test('o gist só pode confiar em link de túnel válido', () => {
  const { t } = make();
  for (const bad of ['https://evil.com', 'http://alpha.trycloudflare.com', 'https://api.trycloudflare.com', '', 'lixo']) assert.equal(t.trustGist(bad), false, bad);
  assert.equal(t.gist, '');
});

test('o link do gist continua confiável na próxima abertura mesmo sem internet (vem do arquivo guardado)', () => {
  const { t } = make({ saved: GIST });
  assert.ok(t.isTrusted(GIST));
  assert.ok(t.carriesLogin(GIST));
});

test('arquivo guardado adulterado com link que não é de túnel é ignorado', () => {
  for (const bad of ['https://evil.com', 'http://x.trycloudflare.com', 'lixo']) {
    const { t } = make({ saved: bad });
    assert.equal(t.isTrusted(bad), false, bad);
    assert.equal(t.gist, '', bad);
  }
});

test('porta e protocolo diferentes não herdam a confiança', () => {
  const { t } = make();
  t.trustGist(GIST);
  assert.equal(t.isTrusted('https://alpha-beta.trycloudflare.com:8443'), false);
  assert.equal(t.isTrusted('http://alpha-beta.trycloudflare.com'), false);
  assert.equal(t.isTrusted('https://alpha-beta.trycloudflare.com.evil.com'), false);
});

test('link padrão do app (server-default.json) é confiável; se for túnel, recebe o login', () => {
  const a = make({ def: DEFAULT }).t;
  assert.ok(a.isTrusted(DEFAULT));
  assert.equal(a.carriesLogin(DEFAULT), false, 'não é túnel: o login só vai para túnel');
  const b = make({ def: GIST }).t;
  assert.ok(b.isTrusted(GIST));
  assert.ok(b.carriesLogin(GIST));
  assert.ok(b.mayStoreLoginFrom('alpha-beta.trycloudflare.com'));
  assert.equal(make({ def: 'lixo' }).t.isTrusted('lixo'), false);
});

test('link aberto pela linha de comando vale para o app, mas não recebe o login', () => {
  const { t } = make();
  t.pin(OTHER);
  assert.ok(t.isTrusted(OTHER));
  assert.equal(t.carriesLogin(OTHER), false);
  t.pin('http://192.168.0.5:3000');
  assert.ok(t.isTrusted('http://192.168.0.5:3000/x'));
  assert.equal(t.isTrusted('http://192.168.0.5:3001'), false);
  assert.equal(t.isTrusted('http://192.168.0.6:3000'), false);
  assert.equal(t.isTrusted(OTHER), false, 'só o último');
});

test('http fora do localhost nunca é confiável sem ter sido aberto pelo usuário', () => {
  const { t } = make({ saved: GIST, def: DEFAULT });
  assert.equal(t.isTrusted('http://alpha-beta.trycloudflare.com'), false);
  assert.equal(t.isTrusted('http://fixo.example.com'), false);
});

test('o login só é guardado a partir do localhost, do gist e do padrão: site qualquer não troca o login guardado', () => {
  const { t } = make({ saved: GIST });
  assert.ok(t.mayStoreLoginFrom('localhost'));
  assert.ok(t.mayStoreLoginFrom('127.0.0.1'));
  for (const bad of ['', null, undefined, 'evil.com', 'evil-link.trycloudflare.com', 'trycloudflare.com', 'localhost.evil.com']) assert.equal(t.mayStoreLoginFrom(bad), false, String(bad));
});

test('páginas que não são web (file:, about:, data:, javascript:) nunca são confiáveis', () => {
  const { t } = make({ saved: GIST, def: DEFAULT });
  for (const bad of ['file:///C:/app/connect.html', 'about:blank', 'data:text/html,<b>x</b>', 'javascript:alert(1)', 'blob:https://alpha-beta.trycloudflare.com/x', '']) {
    assert.equal(t.isTrusted(bad), false, bad);
  }
});

test('permissões: microfone, tela e som só para a página do servidor, nunca para iframe de outro site', () => {
  const { t } = make({ saved: GIST });
  for (const p of ['media', 'display-capture', 'speaker-selection', 'clipboard-sanitized-write']) {
    assert.ok(permissionAllowed(t, p, GIST + '/', GIST + '/'), p);
    assert.ok(permissionAllowed(t, p, GIST + '/', ''), p + ' (sem requestingUrl)');
    assert.equal(permissionAllowed(t, p, GIST + '/', 'https://www.youtube.com/embed/x'), false, p + ' iframe do YouTube');
    assert.equal(permissionAllowed(t, p, OTHER + '/', OTHER + '/'), false, p + ' página não confiável');
  }
  assert.equal(permissionAllowed(t, 'media', 'file:///C:/app/picker.html', 'file:///C:/app/picker.html'), false, 'janelas do app não precisam');
});

test('permissões: tela cheia pode vir do player do YouTube dentro da página do servidor; o resto é negado', () => {
  const { t } = make({ saved: GIST });
  assert.ok(permissionAllowed(t, 'fullscreen', GIST + '/', 'https://www.youtube.com/embed/x'));
  assert.equal(permissionAllowed(t, 'fullscreen', OTHER + '/', OTHER + '/'), false);
  for (const p of ['geolocation', 'notifications', 'midi', 'midiSysex', 'clipboard-read', 'openExternal', 'idle-detection', 'unknown', 'fileSystem', 'window-management']) {
    assert.equal(permissionAllowed(t, p, GIST + '/', GIST + '/'), false, p);
  }
});

test('permissões: o localhost do host funciona (microfone e tela)', () => {
  const { t } = make();
  assert.ok(permissionAllowed(t, 'media', 'http://localhost:3000/', 'http://localhost:3000/'));
  assert.ok(permissionAllowed(t, 'display-capture', 'http://localhost:3000/', 'http://localhost:3000/'));
});

test('navegação: dentro do mesmo endereço pode (outra rota, query, #), e recarregar a mesma página também', () => {
  assert.ok(navigationAllowed(GIST + '/', GIST + '/outra?x=1'));
  assert.ok(navigationAllowed(GIST + '/?sala=a', GIST + '/#chat'));
  assert.ok(navigationAllowed('https://ALPHA-beta.trycloudflare.com/', GIST + '/x'), 'maiúsculas no nome do site');
  assert.ok(navigationAllowed('http://localhost:3000/', 'http://localhost:3000/api'));
  assert.ok(navigationAllowed('file:///C:/app/connect.html', 'file:///C:/app/connect.html'), 'recarregar a tela do app');
  assert.ok(navigationAllowed('file:///C:/app/connect.html', 'file:///C:/app/connect.html#x'));
});

test('navegação: outro site, outra porta, outro protocolo ou subdomínio NÃO pode', () => {
  for (const bad of [OTHER + '/', 'https://evil.com/', 'https://alpha-beta.trycloudflare.com.evil.com/', 'https://alpha-beta.trycloudflare.com:8443/', 'http://alpha-beta.trycloudflare.com/',
    'https://x.alpha-beta.trycloudflare.com/', 'https://alpha-beta.trycloudflare.com@evil.com/', 'https://user:pw@evil.com/']) {
    assert.equal(navigationAllowed(GIST + '/', bad), false, bad);
  }
  assert.equal(navigationAllowed('http://localhost:3000/', 'http://localhost:3001/'), false);
  assert.equal(navigationAllowed('http://localhost:3000/', 'http://127.0.0.1:3000/'), false, 'localhost e 127.0.0.1 são endereços diferentes');
});

test('navegação: páginas do app (file:) não vão sozinhas para lugar nenhum, e ninguém vai para file:/script/dados', () => {
  assert.equal(navigationAllowed('file:///C:/app/connect.html', GIST + '/'), false);
  assert.equal(navigationAllowed('file:///C:/app/connect.html', 'file:///C:/app/picker.html'), false);
  for (const bad of ['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'data:text/html,<b>x</b>', 'blob:' + GIST + '/uuid', 'about:blank', 'ftp://alpha-beta.trycloudflare.com/', '', null, undefined, 'lixo']) {
    assert.equal(navigationAllowed(GIST + '/', bad), false, String(bad));
  }
  assert.equal(navigationAllowed('', GIST + '/'), false, 'sem página aberta ainda');
  assert.equal(navigationAllowed(null, null), false);
});

test('originOf: só web', () => {
  assert.equal(originOf('https://A.trycloudflare.com/x?y#z'), 'https://a.trycloudflare.com');
  assert.equal(originOf('file:///x'), '');
  assert.equal(originOf('lixo'), '');
});

(async () => {
  let fail = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('  ok  ', name); } catch (e) { fail++; console.log('  FALHOU', name, '\n       ', e.message.split('\n').join('\n        ')); }
  }
  console.log(fail ? `\n${fail} teste(s) falharam` : `\n${tests.length} testes passaram`);
  process.exit(fail ? 1 : 0);
})();
