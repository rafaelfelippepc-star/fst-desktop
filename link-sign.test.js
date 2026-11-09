// Teste da assinatura do link do servidor. Rode com:  node link-sign.test.js
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { signLink, verifyLink, loadPublicKey, MAX_FUTURE_MS } = require('./link-sign');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const pair = () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return { priv: privateKey.export({ type: 'pkcs8', format: 'pem' }), pub: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
};
const URL1 = 'https://alpha-beta.trycloudflare.com';
const T1 = '2026-11-08T12:00:00.000Z';
const NOW = Date.parse('2026-11-08T12:05:00.000Z');
const mk = (k, url = URL1, updated = T1) => ({ url, updated, sig: signLink(k.priv, url, updated) });

test('assinatura válida é aceita e devolve o link e a data', () => {
  const k = pair();
  const r = verifyLink(k.pub, mk(k), { now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.url, URL1);
  assert.equal(r.updatedMs, Date.parse(T1));
});

test('o formato assinado bate com o do publicar-link.js (fst-link-v1, url e data em linhas separadas)', () => {
  const k = pair();
  // exatamente o que o publicar-link.js faz
  const sig = crypto.sign(null, Buffer.from(`fst-link-v1\n${URL1}\n${T1}`), crypto.createPrivateKey(k.priv)).toString('base64');
  assert.equal(verifyLink(k.pub, { url: URL1, updated: T1, sig }, { now: NOW }).ok, true);
});

test('trocar o link, a data ou a chave invalida a assinatura', () => {
  const k = pair(), other = pair();
  const good = mk(k);
  assert.equal(verifyLink(k.pub, { ...good, url: 'https://evil.trycloudflare.com' }, { now: NOW }).ok, false);
  assert.equal(verifyLink(k.pub, { ...good, updated: '2026-11-09T12:00:00.000Z' }, { now: NOW }).ok, false);
  assert.equal(verifyLink(other.pub, good, { now: NOW }).ok, false, 'assinado por outra chave');
  assert.equal(verifyLink(k.pub, mk(other), { now: NOW }).ok, false, 'atacante com a própria chave');
});

test('sem assinatura, sem data, sem link ou lixo: recusa', () => {
  const k = pair();
  for (const bad of [{ url: URL1, updated: T1 }, { url: URL1, sig: 'x' }, { updated: T1, sig: 'x' }, {}, null, undefined, 'lixo', 5, { ...mk(k), sig: '!!!' }, { ...mk(k), updated: 'ontem' }]) {
    assert.equal(verifyLink(k.pub, bad, { now: NOW }).ok, false, JSON.stringify(bad));
  }
});

test('repetição: data MENOR que a já aceita é recusada; igual (mesmo link relido) e maior valem', () => {
  const k = pair();
  const last = Date.parse(T1);
  assert.equal(verifyLink(k.pub, mk(k, URL1, '2026-11-08T11:00:00.000Z'), { lastMs: last, now: NOW }).ok, false, 'link antigo reposto');
  assert.equal(verifyLink(k.pub, mk(k), { lastMs: last, now: NOW }).ok, true, 'o mesmo, lido de novo');
  assert.equal(verifyLink(k.pub, mk(k, URL1, '2026-11-08T12:01:00.000Z'), { lastMs: last, now: NOW }).ok, true, 'mais novo');
});

test('data no futuro (mais de 1 dia) é recusada; um pouco adiantada passa', () => {
  const k = pair();
  const far = new Date(NOW + MAX_FUTURE_MS + 60000).toISOString();
  assert.equal(verifyLink(k.pub, mk(k, URL1, far), { now: NOW }).ok, false);
  const near = new Date(NOW + 60 * 60 * 1000).toISOString();
  assert.equal(verifyLink(k.pub, mk(k, URL1, near), { now: NOW }).ok, true);
});

test('chave pública inválida ou vazia: recusa tudo (nunca aceita sem conferir)', () => {
  const k = pair();
  for (const bad of ['', null, undefined, 'lixo', 'AAAA']) {
    assert.equal(loadPublicKey(bad), null, String(bad));
    assert.equal(verifyLink(bad, mk(k), { now: NOW }).ok, false, String(bad));
  }
});

test('barra final do link é tirada depois de conferir a assinatura', () => {
  const k = pair();
  assert.equal(verifyLink(k.pub, mk(k, URL1 + '/'), { now: NOW }).url, URL1);
});

(async () => {
  let fail = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('  ok  ', name); } catch (e) { fail++; console.log('  FALHOU', name, '\n       ', e.message.split('\n').join('\n        ')); }
  }
  console.log(fail ? `\n${fail} teste(s) falharam` : `\n${tests.length} testes passaram`);
  process.exit(fail ? 1 : 0);
})();
