// Schermo acceso mentre l'app lavora su un video (analisi, riduzione): se lo schermo
// si spegne, il telefono sospende la pagina e il lavoro si ferma a metà.
// Nell'app Android lo fa il plugin nativo; sul web la Screen Wake Lock API.
let holders = 0;
let lock = null;

const nativeTimer = () => globalThis.Capacitor?.Plugins?.WorkoutTimer;

async function acquire() {
  const plugin = nativeTimer();
  if (plugin?.keepAwake) { await plugin.keepAwake({ on: true }).catch(() => {}); return; }
  try {
    lock = await navigator.wakeLock?.request('screen') ?? null;
    lock?.addEventListener?.('release', () => { lock = null; });
  } catch { lock = null; }
}

function release() {
  const plugin = nativeTimer();
  if (plugin?.keepAwake) { plugin.keepAwake({ on: false }).catch(() => {}); return; }
  lock?.release?.().catch?.(() => {});
  lock = null;
}

// Il browser rilascia il blocco quando la pagina va in background: lo riprende al ritorno.
globalThis.document?.addEventListener('visibilitychange', () => {
  if (!document.hidden && holders > 0 && !nativeTimer()?.keepAwake && !lock) void acquire();
});

export async function withScreenOn(task) {
  holders += 1;
  if (holders === 1) await acquire();
  try {
    return await task();
  } finally {
    holders -= 1;
    if (holders === 0) release();
  }
}
