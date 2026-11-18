'use strict';
// Assinatura do link do servidor publicado no gist, separada do Electron para poder ser testada.
//
// O host (publicar-link.js) assina { url, updated } com uma chave PRIVADA que fica só no PC dele. O app embute a chave
// PÚBLICA (server-default.json, campo "pubkey") e só segue para o link do gist se a assinatura for válida. Assim, quem
// conseguir escrever no gist (token vazado) não consegue mandar os apps para outro endereço.
// Contra repetição de um link antigo (também assinado), o app guarda o "updated" mais novo que já aceitou e recusa menores.
//
// ATENÇÃO: o formato da mensagem assinada precisa ser IGUAL ao do publicar-link.js (signLink de lá).
const crypto = require('crypto');

const PREFIX = 'fst-link-v1';
const MAX_FUTURE_MS = 24 * 60 * 60 * 1000; // relógio do host adiantado além de 1 dia: recusa

const message = (url, updated) => Buffer.from(`${PREFIX}\n${url}\n${updated}`, 'utf8');

// privatePem: chave privada Ed25519 em PEM (pkcs8). Devolve a assinatura em base64.
function signLink(privatePem, url, updated) {
  return crypto.sign(null, message(url, updated), crypto.createPrivateKey(privatePem)).toString('base64');
}

// pubB64: chave pública Ed25519 em DER (spki) codificada em base64. null se for inválida.
function loadPublicKey(pubB64) {
  try {
    const buf = Buffer.from(String(pubB64 == null ? '' : pubB64).trim(), 'base64');
    if (!buf.length) return null;
    return crypto.createPublicKey({ key: buf, format: 'der', type: 'spki' });
  } catch { return null; }
}

// payload = o conteúdo do gist ({ url, updated, sig }). lastMs = o "updated" mais novo já aceito (em ms).
// Devolve { ok: true, url, updatedMs } ou { ok: false, reason }.
function verifyLink(pubB64, payload, { lastMs = 0, now = Date.now() } = {}) {
  const key = loadPublicKey(pubB64);
  if (!key) return { ok: false, reason: 'a chave pública do app é inválida' };
  const p = payload && typeof payload === 'object' ? payload : {};
  const rawUrl = String(p.url == null ? '' : p.url);
  const updated = String(p.updated == null ? '' : p.updated);
  const sig = String(p.sig == null ? '' : p.sig);
  if (!rawUrl || !updated || !sig) return { ok: false, reason: 'o gist não está assinado' };
  const ms = Date.parse(updated);
  if (!Number.isFinite(ms)) return { ok: false, reason: 'data do gist inválida' };
  let valid = false;
  try { valid = crypto.verify(null, message(rawUrl, updated), key, Buffer.from(sig, 'base64')); } catch {}
  if (!valid) return { ok: false, reason: 'assinatura do gist inválida' };
  if (ms > now + MAX_FUTURE_MS) return { ok: false, reason: 'data do gist está no futuro' };
  if (ms < lastMs) return { ok: false, reason: 'link mais antigo que o já aceito (repetição)' };
  return { ok: true, url: rawUrl.trim().replace(/\/+$/, ''), updatedMs: ms };
}

module.exports = { signLink, verifyLink, loadPublicKey, PREFIX, MAX_FUTURE_MS };
