// Teste da lógica do push to talk global. Rode com:  node ptt-core.test.js
const assert = require('node:assert/strict');
const { createPttCore, RELEASE_GRACE_MS, BLIND_GUARD_MS } = require('./ptt-core');

const KEY_V = 47, KEY_ESC = 1, MOUSE_LEFT = 1, MOUSE_SIDE = 4;

function make(platform = 'win32') {
  let t = 0;
  let nextId = 1;
  const timeouts = new Map();
  const intervals = new Map();
  const sent = [];
  const fake = {
    setTimeout: (fn, ms) => { const id = nextId++; timeouts.set(id, { fn, at: t + ms }); return id; },
    clearTimeout: (id) => timeouts.delete(id),
    setInterval: (fn, ms) => { const id = nextId++; intervals.set(id, { fn, ms, next: t + ms }); return id; },
    clearInterval: (id) => intervals.delete(id),
  };
  const core = createPttCore({
    send: (s) => sent.push(s),
    describe: (type, id) => `${type}:${id}`,
    isEscape: (type, id) => type === 'key' && id === KEY_ESC,
    isLeftClick: (type, id) => type === 'mouse' && id === MOUSE_LEFT,
    platform,
    now: () => t,
    timers: fake,
  });
  // avança o relógio disparando timers na ordem certa
  const advance = (ms) => {
    const end = t + ms;
    for (;;) {
      let best = null;
      for (const [id, x] of timeouts) if (x.at <= end && (!best || x.at < best.at)) best = { id, at: x.at, kind: 'to', x };
      for (const [id, x] of intervals) if (x.next <= end && (!best || x.next < best.at)) best = { id, at: x.next, kind: 'iv', x };
      if (!best) break;
      t = best.at;
      if (best.kind === 'to') { timeouts.delete(best.id); best.x.fn(); } else { best.x.next += best.x.ms; best.x.fn(); }
    }
    t = end;
  };
  return { core, sent, advance, pending: () => timeouts.size + intervals.size };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('segurar abre e soltar fecha depois da folga', () => {
  const { core, sent, advance } = make();
  core.setBinding({ type: 'key', id: KEY_V, label: 'V' });
  core.onEvent('key', KEY_V, true);
  assert.deepEqual(sent, ['down']);
  core.onEvent('key', KEY_V, false);
  advance(RELEASE_GRACE_MS - 10);
  assert.deepEqual(sent, ['down'], 'ainda na folga');
  advance(20);
  assert.deepEqual(sent, ['down', 'up']);
});

test('repetição automática do teclado não reabre nem fecha', () => {
  const { core, sent, advance } = make();
  core.setBinding({ type: 'key', id: KEY_V, label: 'V' });
  core.onEvent('key', KEY_V, true);
  for (let i = 0; i < 20; i++) { advance(33); core.onEvent('key', KEY_V, true); }
  assert.deepEqual(sent, ['down']);
});

test('apertar de novo durante a folga continua falando (sem fechar)', () => {
  const { core, sent, advance } = make();
  core.setBinding({ type: 'key', id: KEY_V, label: 'V' });
  core.onEvent('key', KEY_V, true);
  core.onEvent('key', KEY_V, false);
  advance(100);
  core.onEvent('key', KEY_V, true);
  advance(1000);
  assert.deepEqual(sent, ['down'], 'não pode ter fechado nem reaberto');
  core.onEvent('key', KEY_V, false);
  advance(RELEASE_GRACE_MS + 10);
  assert.deepEqual(sent, ['down', 'up']);
});

test('Linux/X11: repetição vira pares soltar+apertar e o mic não pisca', () => {
  const { core, sent, advance } = make('linux');
  core.setBinding({ type: 'key', id: KEY_V, label: 'V' });
  core.onEvent('key', KEY_V, true);
  for (let i = 0; i < 15; i++) { advance(30); core.onEvent('key', KEY_V, false); core.onEvent('key', KEY_V, true); }
  assert.deepEqual(sent, ['down']);
});

test('teclas que não são o atalho são ignoradas', () => {
  const { core, sent, advance } = make();
  core.setBinding({ type: 'key', id: KEY_V, label: 'V' });
  core.onEvent('key', 30, true);
  core.onEvent('mouse', KEY_V, true);
  advance(1000);
  assert.deepEqual(sent, []);
});

test('botão lateral do mouse funciona como atalho', () => {
  const { core, sent, advance } = make();
  core.setBinding({ type: 'mouse', id: MOUSE_SIDE, label: 'lateral' });
  core.onEvent('mouse', MOUSE_SIDE, true);
  core.onEvent('mouse', MOUSE_SIDE, false);
  advance(RELEASE_GRACE_MS + 1);
  assert.deepEqual(sent, ['down', 'up']);
});

test('Windows: keyup perdido (jogo como admin) fecha o mic sozinho', () => {
  const { core, sent, advance } = make('win32');
  core.setBinding({ type: 'key', id: KEY_V, label: 'V' });
  core.onEvent('key', KEY_V, true);
  for (let i = 0; i < 10; i++) { advance(50); core.onEvent('key', KEY_V, true); } // repetições normais
  assert.deepEqual(sent, ['down']);
  // o hook fica cego: não chega mais nada, nem o keyup
  advance(BLIND_GUARD_MS + 1500);
  assert.deepEqual(sent, ['down', 'up'], 'mic fechou sozinho');
});

test('Windows: segurar com repetição normal NÃO é cortado pela proteção', () => {
  const { core, sent, advance } = make('win32');
  core.setBinding({ type: 'key', id: KEY_V, label: 'V' });
  core.onEvent('key', KEY_V, true);
  for (let i = 0; i < 400; i++) { advance(33); core.onEvent('key', KEY_V, true); } // ~13 s
  assert.deepEqual(sent, ['down']);
});

test('Windows: sem repetição nenhuma (repetição desligada) a proteção não corta', () => {
  const { core, sent, advance } = make('win32');
  core.setBinding({ type: 'key', id: KEY_V, label: 'V' });
  core.onEvent('key', KEY_V, true);
  advance(30000);
  assert.deepEqual(sent, ['down']);
});

test('mouse segurado parado por muito tempo NÃO é cortado', () => {
  const { core, sent, advance } = make('win32');
  core.setBinding({ type: 'mouse', id: MOUSE_SIDE, label: 'lateral' });
  core.onEvent('mouse', MOUSE_SIDE, true);
  advance(60000);
  assert.deepEqual(sent, ['down']);
});

test('trocar o atalho com o mic aberto fecha na hora', () => {
  const { core, sent } = make();
  core.setBinding({ type: 'key', id: KEY_V, label: 'V' });
  core.onEvent('key', KEY_V, true);
  core.setBinding({ type: 'key', id: 48, label: 'B' });
  assert.deepEqual(sent, ['down', 'up']);
  core.onEvent('key', KEY_V, false); // o keyup do atalho antigo não pode causar nada
  assert.deepEqual(sent, ['down', 'up']);
});

test('remover o atalho (null) fecha o mic', () => {
  const { core, sent } = make();
  core.setBinding({ type: 'key', id: KEY_V, label: 'V' });
  core.onEvent('key', KEY_V, true);
  core.setBinding(null);
  assert.deepEqual(sent, ['down', 'up']);
});

test('reset sem aviso (página recarregada) não envia nada e deixa tudo limpo', () => {
  const { core, sent, advance, pending } = make();
  core.setBinding({ type: 'key', id: KEY_V, label: 'V' });
  core.onEvent('key', KEY_V, true);
  core.reset({ notify: false });
  advance(10000);
  assert.deepEqual(sent, ['down']);
  assert.equal(pending(), 0, 'sem timers sobrando');
  core.onEvent('key', KEY_V, true); // depois do reset volta a funcionar
  assert.deepEqual(sent, ['down', 'down']);
});

test('captura: ignora botão esquerdo, aceita tecla, e o keyup depois não dispara nada', async () => {
  const { core, sent } = make();
  const p = core.captureNext();
  core.onEvent('mouse', MOUSE_LEFT, true);
  core.onEvent('key', KEY_V, false); // soltar não conta
  core.onEvent('key', KEY_V, true);
  const got = await p;
  assert.deepEqual(got, { type: 'key', id: KEY_V, label: `key:${KEY_V}` });
  core.setBinding(got);
  core.onEvent('key', KEY_V, false); // keyup da captura
  assert.deepEqual(sent, []);
});

test('captura: Esc cancela e devolve null', async () => {
  const { core } = make();
  const p = core.captureNext();
  core.onEvent('key', KEY_ESC, true);
  assert.equal(await p, null);
});

test('captura: segunda captura cancela a primeira', async () => {
  const { core } = make();
  const p1 = core.captureNext();
  const p2 = core.captureNext();
  assert.equal(await p1, null);
  core.onEvent('mouse', MOUSE_SIDE, true);
  assert.deepEqual(await p2, { type: 'mouse', id: MOUSE_SIDE, label: `mouse:${MOUSE_SIDE}` });
});

test('durante a captura o atalho antigo não abre o mic', async () => {
  const { core, sent } = make();
  core.setBinding({ type: 'key', id: KEY_V, label: 'V' });
  const p = core.captureNext();
  core.onEvent('key', KEY_V, true);
  assert.deepEqual(sent, []);
  assert.equal((await p).id, KEY_V);
});

(async () => {
  let fail = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('  ok  ', name); } catch (e) { fail++; console.log('  FALHOU', name, '\n       ', e.message.split('\n').join('\n        ')); }
  }
  console.log(fail ? `\n${fail} teste(s) falharam` : `\n${tests.length} testes passaram`);
  process.exit(fail ? 1 : 0);
})();
