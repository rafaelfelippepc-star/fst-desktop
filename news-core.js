'use strict';
// Lógica das "Novidades" (o que mudou em cada versão), separada do Electron para poder ser testada.
//
// As notas vêm do arquivo novidades.json, que vai dentro do instalador. Cada versão publicada leva
// as notas dela; quem atualiza vê só o que é novo para si (as versões entre a que tinha e a atual).

const TIPOS = ['novo', 'melhorado', 'corrigido'];
const MAX_ENTRIES = 100;
const MAX_ITEMS = 30;
const MAX_TEXT = 300;

// "1.0.26" ou "v1.0.26" -> [1, 0, 26]. Qualquer outra coisa -> null.
function parseVer(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v == null ? '' : v).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// -1, 0 ou 1. Versões inválidas contam como iguais (quem chama já filtrou).
function cmpVer(a, b) {
  const x = parseVer(a);
  const y = parseVer(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

function cleanItem(it) {
  if (typeof it === 'string') it = { texto: it };
  if (!it || typeof it !== 'object') return null;
  const texto = String(it.texto == null ? '' : it.texto).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  if (!texto) return null;
  const tipo = String(it.tipo == null ? '' : it.tipo).toLowerCase();
  return { tipo: TIPOS.includes(tipo) ? tipo : 'melhorado', texto };
}

const validDate = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d == null ? '' : d)) ? String(d) : '');

// Aceita { versoes: [...] } ou direto a lista. Descarta o que estiver torto em vez de quebrar a janela.
// Devolve [{ version, date, itens: [{ tipo, texto }] }], da versão mais nova para a mais antiga.
function cleanNews(raw) {
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.versoes) ? raw.versoes : [];
  const out = [];
  const seen = new Set();
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const v = parseVer(e.versao);
    if (!v) continue;
    const version = v.join('.');
    if (seen.has(version)) continue; // versão repetida: vale a primeira
    const itens = (Array.isArray(e.itens) ? e.itens : []).map(cleanItem).filter(Boolean).slice(0, MAX_ITEMS);
    if (!itens.length) continue;
    seen.add(version);
    out.push({ version, date: validDate(e.data), itens });
  }
  out.sort((a, b) => cmpVer(b.version, a.version));
  return out.slice(0, MAX_ENTRIES);
}

// O que a pessoa ainda não viu: versões depois da última que ela abriu, até a atual.
// Sem registro da última (quem já usava o app antes das Novidades existirem): só a atual.
function pickUnseen(entries, lastSeen, current) {
  if (!parseVer(current)) return [];
  const hasLast = !!parseVer(lastSeen);
  return entries.filter((e) => {
    if (cmpVer(e.version, current) > 0) return false; // nunca mostra versão que a pessoa ainda não tem
    return hasLast ? cmpVer(e.version, lastSeen) > 0 : cmpVer(e.version, current) === 0;
  });
}

// Só o final do registro técnico: o arquivo cresce para sempre e a janela não precisa de tudo.
function tailText(text, maxLines = 400, maxChars = 80000) {
  let s = String(text == null ? '' : text).replace(/\r\n/g, '\n').trimEnd();
  if (!s) return '';
  let lines = s.split('\n');
  if (lines.length > maxLines) lines = lines.slice(-maxLines);
  s = lines.join('\n');
  if (s.length > maxChars) {
    s = s.slice(-maxChars);
    const nl = s.indexOf('\n');
    if (nl >= 0) s = s.slice(nl + 1); // descarta a linha cortada no meio
  }
  return s;
}

module.exports = { parseVer, cmpVer, cleanNews, pickUnseen, tailText, TIPOS };
