'use strict';
// Lógica do push to talk global, separada do Electron/uiohook para poder ser testada.
//
// Recebe os eventos brutos de teclado/mouse (onEvent) e decide quando o app deve
// ABRIR ou FECHAR o microfone, avisando por send('down') e send('up').
//
// Garantias para o microfone nunca ficar preso aberto:
//  1. A "folga" depois de soltar (para não cortar o fim da palavra) é contada AQUI,
//     no processo principal. No renderer, um setTimeout pode atrasar muito (até 1 min)
//     quando a janela está escondida atrás de um jogo.
//  2. Se a tecla soltar e o Windows não avisar (ex.: jogo rodando como administrador),
//     a falta dos eventos de repetição da tecla segurada fecha o microfone sozinha.
//  3. Trocar o atalho ou recarregar a página sempre fecha o microfone.

const RELEASE_GRACE_MS = 250; // padrão: quanto tempo o mic continua aberto depois de soltar (o usuário ajusta de 0 a 2000 ms)
const MAX_RELEASE_DELAY_MS = 2000;
const LINUX_MIN_GRACE_MS = 80; // no X11 a repetição da tecla vira pares soltar+apertar; abaixo disso o mic piscaria
const BLIND_GUARD_MS = 2500; // sem NENHUM evento por tanto tempo com a tecla "segurada" = perdeu o keyup
const GUARD_TICK_MS = 500;

function createPttCore({
  send, // (state: 'down' | 'up') => void
  describe, // (type, id) => rótulo legível
  isEscape, // (type, id) => boolean
  isLeftClick, // (type, id) => boolean
  platform = process.platform,
  now = Date.now,
  timers = { setTimeout, clearTimeout, setInterval, clearInterval },
}) {
  let binding = null; // { type, id, label }
  let capture = null; // resolve da captura em andamento
  let held = false; // o atalho está fisicamente apertado (segundo o hook)
  let down = false; // o último estado enviado ao app foi 'down'
  let graceTimer = null;
  let guardTimer = null;
  let lastEvent = 0;
  let sawRepeat = false;
  let releaseMs = RELEASE_GRACE_MS;

  const emit = (state) => {
    if (state === 'down') {
      if (down) return;
      down = true;
    } else {
      if (!down) return;
      down = false;
    }
    send(state);
  };

  function stopGuard() {
    if (guardTimer) timers.clearInterval(guardTimer);
    guardTimer = null;
  }

  function cancelGrace() {
    if (graceTimer) timers.clearTimeout(graceTimer);
    graceTimer = null;
  }

  function startGrace() {
    cancelGrace();
    const ms = platform === 'linux' ? Math.max(releaseMs, LINUX_MIN_GRACE_MS) : releaseMs;
    if (ms <= 0) return emit('up');
    graceTimer = timers.setTimeout(() => {
      graceTimer = null;
      emit('up');
    }, ms);
  }

  // Só no Windows e só para teclas: o teclado repete a tecla segurada várias vezes por
  // segundo. Se já vimos repetição e ela parou de repente, a tecla foi solta sem aviso.
  function startGuard() {
    stopGuard();
    if (platform !== 'win32' || !binding || binding.type !== 'key') return;
    guardTimer = timers.setInterval(() => {
      if (held && sawRepeat && now() - lastEvent > BLIND_GUARD_MS) {
        held = false;
        stopGuard();
        startGrace();
      }
    }, GUARD_TICK_MS);
  }

  function onEvent(type, id, isDown) {
    if (capture) {
      if (!isDown) return;
      if (isLeftClick(type, id)) return; // botão esquerdo nunca vira atalho
      const resolve = capture;
      capture = null;
      if (isEscape(type, id)) return resolve(null); // Esc cancela
      return resolve({ type, id, label: describe(type, id) });
    }

    if (!binding || binding.type !== type || binding.id !== id) return;

    if (isDown) {
      lastEvent = now();
      if (held) {
        sawRepeat = true; // repetição automática do teclado
        return;
      }
      held = true;
      sawRepeat = false;
      cancelGrace(); // apertou de novo durante a folga: segue falando
      emit('down');
      startGuard();
    } else {
      if (!held) return;
      held = false;
      stopGuard();
      startGrace();
    }
  }

  // Zera tudo. Se o microfone estava aberto, manda fechar (a menos que notify = false,
  // usado quando a página que ouviria o aviso já não existe).
  function reset({ notify = true } = {}) {
    stopGuard();
    cancelGrace();
    held = false;
    sawRepeat = false;
    if (notify) emit('up');
    else down = false;
  }

  function setBinding(b) {
    reset();
    binding = b && b.type ? { type: b.type, id: b.id, label: b.label } : null;
  }

  // Atraso (ms) para fechar o microfone depois de soltar o atalho. Vale na próxima soltada.
  function setReleaseDelay(ms) {
    const n = Number(ms);
    releaseMs = Number.isFinite(n) ? Math.min(MAX_RELEASE_DELAY_MS, Math.max(0, Math.round(n))) : RELEASE_GRACE_MS;
  }

  function captureNext() {
    if (capture) capture(null); // havia outra captura pendente: cancela
    return new Promise((resolve) => {
      capture = resolve;
    });
  }

  function cancelCapture() {
    if (capture) capture(null);
    capture = null;
  }

  return { onEvent, setBinding, setReleaseDelay, captureNext, cancelCapture, reset, get binding() { return binding; } };
}

module.exports = { createPttCore, RELEASE_GRACE_MS, BLIND_GUARD_MS, MAX_RELEASE_DELAY_MS, LINUX_MIN_GRACE_MS };
