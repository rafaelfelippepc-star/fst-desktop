'use strict';
// Usado pela publicação (GitHub Actions): AVISA, sem barrar, se o novidades.json não tem notas
// para a versão que está sendo publicada. Uso: node check-news.js 1.0.26
const fs = require('fs');
const path = require('path');
const { cleanNews, parseVer } = require('./news-core');

const v = parseVer(process.argv[2]);
if (!v) {
  console.log(`::warning::Versão inválida para conferir as novidades: ${process.argv[2]}`);
  process.exit(0);
}
const version = v.join('.');
try {
  const list = cleanNews(JSON.parse(fs.readFileSync(path.join(__dirname, 'novidades.json'), 'utf8')));
  if (list.some((e) => e.version === version)) console.log(`Notas de novidades encontradas para a versão ${version}.`);
  else console.log(`::warning::O novidades.json não tem notas para a versão ${version}. Quem atualizar não verá o que mudou.`);
} catch (e) {
  console.log(`::warning::Não consegui ler o novidades.json: ${e.message}`);
}
