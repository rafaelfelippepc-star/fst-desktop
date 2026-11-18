// Teste da conferência dos links externos. Rode com:  node extlink-core.test.js
const assert = require('node:assert/strict');
const { checkExternalUrl, MAX_SHOWN } = require('./extlink-core');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('https comum: vale, mostra o endereço inteiro e o site', () => {
  const r = checkExternalUrl('https://exemplo.com/a/b?x=1#topo');
  assert.equal(r.ok, true);
  assert.equal(r.hostname, 'exemplo.com');
  assert.equal(r.shown, 'https://exemplo.com/a/b?x=1#topo');
  assert.equal(r.insecure, false);
  assert.equal(r.idn, false);
});

test('http vale, mas é marcado como sem proteção', () => {
  const r = checkExternalUrl('http://exemplo.com');
  assert.ok(r.ok && r.insecure);
});

test('outros protocolos nunca abrem (file, javascript, data, ftp, ms-...)', () => {
  for (const bad of ['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'data:text/html,<b>x</b>', 'ftp://x.com', 'ms-msdt:/id', 'steam://run/1', '\\\\servidor\\pasta']) {
    assert.equal(checkExternalUrl(bad).ok, false, bad);
  }
});

test('lixo, vazio e nulo: recusa', () => {
  for (const bad of ['', null, undefined, 'lixo', '://x', 5]) assert.equal(checkExternalUrl(bad).ok, false, String(bad));
});

test('usuário e senha no endereço (https://banco.com@evil.com) é recusado', () => {
  assert.equal(checkExternalUrl('https://banco.com@evil.com/').ok, false);
  assert.equal(checkExternalUrl('https://user:pw@exemplo.com/').ok, false);
});

test('nome de site com caracteres especiais (punycode) é marcado e mostra a forma real', () => {
  const r = checkExternalUrl('https://xn--80ak6aa92e.com/'); // imita "apple.com" com letras cirílicas
  assert.ok(r.ok && r.idn);
  assert.notEqual(r.unicodeHost, r.hostname);
  assert.ok(r.unicodeHost.endsWith('.com'));
});

test('endereço gigante é cortado só na exibição; o que abre continua inteiro', () => {
  const long = 'https://exemplo.com/' + 'a'.repeat(2000);
  const r = checkExternalUrl(long);
  assert.ok(r.ok);
  assert.equal(r.href, long);
  assert.ok(r.shown.length <= MAX_SHOWN + 1 && r.shown.endsWith('…'));
});

(async () => {
  let fail = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('  ok  ', name); } catch (e) { fail++; console.log('  FALHOU', name, '\n       ', e.message.split('\n').join('\n        ')); }
  }
  console.log(fail ? `\n${fail} teste(s) falharam` : `\n${tests.length} testes passaram`);
  process.exit(fail ? 1 : 0);
})();
