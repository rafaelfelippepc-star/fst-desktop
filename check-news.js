'use strict';
// Usado pela publicação (GitHub Actions): BARRA a publicação se o novidades.json não tem notas para a versão que está
// sendo publicada. Sem isso, quem atualiza vê as notas da versão ANTERIOR (sempre uma atrás).
// Uso: node check-news.js 1.0.37
const fs = require('fs');
const path = require('path');
const { cleanNews, parseVer } = require('./news-core');

const fail = (msg) => { console.log(`::error::${msg}`); process.exit(1); };

const v = parseVer(process.argv[2]);
if (!v) fail(`Versão inválida para conferir as novidades: ${process.argv[2]}`);
const version = v.join('.');

let list;
try {
  list = cleanNews(JSON.parse(fs.readFileSync(path.join(__dirname, 'novidades.json'), 'utf8')));
} catch (e) {
  fail(`Não consegui ler o novidades.json: ${e.message}`);
}

if (!list.some((e) => e.version === version)) {
  fail(`O novidades.json não tem notas para a versão ${version}. Ponha uma entrada com "versao": "${version}" no TOPO da lista, faça o commit e crie a tag de novo (git tag -d v${version}; git push origin --delete v${version}).`);
}
console.log(`Notas de novidades encontradas para a versão ${version}.`);
