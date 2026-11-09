'use strict';
// Links do chat que vão abrir no navegador do computador: confere o endereço e prepara o que mostrar na confirmação.
// Separado do Electron para poder ser testado.
const { domainToUnicode } = require('url');

const MAX_SHOWN = 400;

function checkExternalUrl(raw) {
  let u;
  try { u = new URL(String(raw == null ? '' : raw).trim()); } catch { return { ok: false, reason: 'endereço inválido' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, reason: 'só links http e https abrem' };
  if (!u.hostname) return { ok: false, reason: 'endereço sem site' };
  if (u.username || u.password) return { ok: false, reason: 'o endereço traz usuário e senha (golpe comum)' };
  const idn = u.hostname.split('.').some((l) => l.startsWith('xn--')); // nome com caracteres especiais: pode imitar outro site
  const href = u.href;
  return {
    ok: true,
    href,
    shown: href.length > MAX_SHOWN ? href.slice(0, MAX_SHOWN) + '…' : href,
    hostname: u.hostname,
    unicodeHost: idn ? domainToUnicode(u.hostname) : '',
    idn,
    insecure: u.protocol === 'http:',
  };
}

module.exports = { checkExternalUrl, MAX_SHOWN };
