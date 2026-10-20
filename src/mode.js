// Modalità dell'app: Palestra o Pilates. Decide il tema (data-theme su <html>)
// insieme al chiaro/scuro del telefono: Palestra scuro ↔ Pilates scuro,
// Palestra chiaro ↔ Pilates chiaro. I dati delle due modalità restano separati.
export const MODE_KEY = 'buddygym:mode';
export const MODES = ['gym', 'pilates'];

const darkQuery = globalThis.matchMedia?.('(prefers-color-scheme: dark)');

export function themeFor(mode, dark) {
  if (mode === 'pilates') return dark ? 'pilates-dark' : 'pilates';
  return dark ? 'dark' : 'light';
}

export function readMode(storage) {
  try {
    const value = storage?.getItem(MODE_KEY);
    return MODES.includes(value) ? value : null;
  } catch { return null; }
}

let current = null;
export const currentMode = () => current ?? 'gym';
export const isPilates = () => current === 'pilates';

export function applyMode(mode, { fade = false } = {}) {
  current = MODES.includes(mode) ? mode : null;
  const root = document.documentElement;
  const theme = themeFor(currentMode(), darkQuery ? darkQuery.matches : true);
  if (root.dataset.theme === theme) return;
  // Cambio dall'Account: dissolvenza di 300 ms (salvo «Riduci movimento»).
  const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (fade && !reduce && document.startViewTransition) document.startViewTransition(() => { root.dataset.theme = theme; });
  else root.dataset.theme = theme;
}

export function saveMode(storage, mode) {
  try { storage?.setItem(MODE_KEY, mode); } catch { /* Vale per questa apertura. */ }
  applyMode(mode, { fade: true });
}

darkQuery?.addEventListener?.('change', () => applyMode(current));
