// Teste da lógica das Novidades. Rode com:  node news-core.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseVer, cmpVer, cleanNews, pickUnseen, tailText } = require('./news-core');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const E = (versao, ...textos) => ({ versao, itens: textos.map((t) => ({ tipo: 'novo', texto: t })) });

test('versões: aceita x.y.z e v x.y.z, recusa o resto', () => {
  assert.deepEqual(parseVer('1.0.26'), [1, 0, 26]);
  assert.deepEqual(parseVer('v2.10.3'), [2, 10, 3]);
  for (const bad of ['', null, undefined, '1.0', '1.0.x', 'abc', '1.0.26-beta', '1.0.26.1']) assert.equal(parseVer(bad), null, String(bad));
});

test('comparação é numérica, não de texto (1.0.9 < 1.0.10)', () => {
  assert.equal(cmpVer('1.0.9', '1.0.10'), -1);
  assert.equal(cmpVer('1.0.10', '1.0.9'), 1);
  assert.equal(cmpVer('v1.2.3', '1.2.3'), 0);
  assert.equal(cmpVer('2.0.0', '1.99.99'), 1);
});

test('cleanNews: aceita objeto com "versoes" ou lista, ordena da mais nova para a mais antiga', () => {
  const a = cleanNews({ versoes: [E('1.0.9', 'a'), E('1.0.10', 'b'), E('1.0.2', 'c')] });
  assert.deepEqual(a.map((e) => e.version), ['1.0.10', '1.0.9', '1.0.2']);
  const b = cleanNews([E('v1.0.1', 'x')]);
  assert.equal(b[0].version, '1.0.1', 'tira o "v"');
});

test('cleanNews: descarta o que está torto sem quebrar', () => {
  const r = cleanNews({ versoes: [
    null, 'texto', 42,
    { versao: 'abc', itens: [{ texto: 'x' }] }, // versão inválida
    { versao: '1.0.5', itens: [] }, // sem itens
    { versao: '1.0.6' }, // sem lista de itens
    { versao: '1.0.7', itens: [null, { texto: '   ' }, 5] }, // itens vazios
    E('1.0.8', 'vale'),
  ] });
  assert.deepEqual(r.map((e) => e.version), ['1.0.8']);
  assert.deepEqual(cleanNews(null), []);
  assert.deepEqual(cleanNews({}), []);
  assert.deepEqual(cleanNews('lixo'), []);
});

test('cleanNews: itens normalizados (tipo inválido vira "melhorado", texto aparado e limitado)', () => {
  const [e] = cleanNews([{ versao: '1.0.1', data: '2026-11-07', itens: [
    { tipo: 'NOVO', texto: '  muito   espaço \n aqui ' },
    { tipo: 'sei lá', texto: 'outro' },
    'só texto',
    { tipo: 'corrigido', texto: 'x'.repeat(1000) },
  ] }]);
  assert.deepEqual(e.itens[0], { tipo: 'novo', texto: 'muito espaço aqui' });
  assert.equal(e.itens[1].tipo, 'melhorado');
  assert.deepEqual(e.itens[2], { tipo: 'melhorado', texto: 'só texto' });
  assert.equal(e.itens[3].texto.length, 300);
  assert.equal(e.date, '2026-11-07');
});

test('cleanNews: data inválida some, versão repetida vale a primeira, limites', () => {
  const r = cleanNews([{ versao: '1.0.1', data: 'ontem', itens: [{ texto: 'a' }] }, E('1.0.1', 'repetida')]);
  assert.equal(r.length, 1);
  assert.equal(r[0].date, '');
  assert.equal(r[0].itens[0].texto, 'a');
  const many = Array.from({ length: 150 }, (_, i) => E(`1.0.${i}`, 'x'));
  assert.equal(cleanNews(many).length, 100);
  const items = cleanNews([{ versao: '1.0.1', itens: Array.from({ length: 80 }, (_, i) => ({ texto: 'i' + i })) }]);
  assert.equal(items[0].itens.length, 30);
});

const list = cleanNews([E('1.0.24', 'a'), E('1.0.25', 'b'), E('1.0.26', 'c'), E('1.0.27', 'futura')]);

test('pickUnseen: mostra o que veio depois da última versão vista, até a atual', () => {
  assert.deepEqual(pickUnseen(list, '1.0.24', '1.0.26').map((e) => e.version), ['1.0.26', '1.0.25']);
  assert.deepEqual(pickUnseen(list, '1.0.25', '1.0.26').map((e) => e.version), ['1.0.26']);
});

test('pickUnseen: nunca mostra versão que a pessoa ainda não tem', () => {
  assert.ok(!pickUnseen(list, '1.0.20', '1.0.26').some((e) => e.version === '1.0.27'));
});

test('pickUnseen: já viu a atual, ou voltou para uma versão antiga: nada', () => {
  assert.deepEqual(pickUnseen(list, '1.0.26', '1.0.26'), []);
  assert.deepEqual(pickUnseen(list, '1.0.30', '1.0.26'), []);
});

test('pickUnseen: sem registro da última versão (já usava o app antes), só a atual', () => {
  assert.deepEqual(pickUnseen(list, '', '1.0.26').map((e) => e.version), ['1.0.26']);
  assert.deepEqual(pickUnseen(list, null, '1.0.99'), [], 'sem notas para a atual: nada');
});

test('pickUnseen: versão atual inválida não mostra nada', () => {
  assert.deepEqual(pickUnseen(list, '1.0.1', 'xyz'), []);
});

test('tailText: só o final, sem linha cortada, e vazio vira vazio', () => {
  const linhas = Array.from({ length: 1000 }, (_, i) => `linha ${i}`).join('\n');
  const t = tailText(linhas, 5);
  assert.equal(t, 'linha 995\nlinha 996\nlinha 997\nlinha 998\nlinha 999');
  assert.equal(tailText(''), '');
  assert.equal(tailText(null), '');
  assert.equal(tailText('a\r\nb\r\n'), 'a\nb');
  const cut = tailText('aaaa\nbbbb\ncccc\ndddd', 400, 12);
  assert.ok(!cut.startsWith('a') && cut.endsWith('dddd'), cut);
  assert.ok(cut.split('\n').every((l) => /^[a-d]{4}$/.test(l)), 'nenhuma linha pela metade: ' + JSON.stringify(cut));
});

// Protege o arquivo que você edita à mão: um erro de vírgula/aspas derruba a publicação aqui, não no app dos outros.
test('novidades.json do projeto é válido e a versão mais nova tem notas', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'novidades.json'), 'utf8'));
  const all = cleanNews(raw);
  assert.ok(all.length >= 1, 'precisa ter ao menos uma versão com itens');
  assert.equal(all.length, raw.versoes.length, 'alguma entrada foi descartada por estar torta: confira versao/itens/texto');
  for (const e of all) assert.ok(e.itens.length >= 1);
});

(async () => {
  let fail = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('  ok  ', name); } catch (e) { fail++; console.log('  FALHOU', name, '\n       ', e.message.split('\n').join('\n        ')); }
  }
  console.log(fail ? `\n${fail} teste(s) falharam` : `\n${tests.length} testes passaram`);
  process.exit(fail ? 1 : 0);
})();
