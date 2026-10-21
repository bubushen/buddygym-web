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

// Aspetto (Impostazioni): chiaro, scuro o come il telefono. Vale per entrambe le modalità.
export const THEME_KEY = 'buddygym:theme';
let appearance = (() => { try { return localStorage.getItem(THEME_KEY) || 'system'; } catch { return 'system'; } })();
const isDark = () => (appearance === 'dark' ? true : appearance === 'light' ? false : (darkQuery ? darkQuery.matches : true));
export function setAppearance(value) {
  appearance = ['light', 'dark'].includes(value) ? value : 'system';
  try { localStorage.setItem(THEME_KEY, appearance); } catch { /* Vale per questa apertura. */ }
  applyMode(current, { fade: true });
}

let current = null;
export const currentMode = () => current ?? 'gym';
export const isPilates = () => current === 'pilates';

// Cambio dall'Account: il nuovo tema si allarga a cerchio dal punto toccato (400 ms, CSS
// ::view-transition-new); con «Riduci movimento» diventa una dissolvenza.
export function applyMode(mode, { fade = false, origin = null } = {}) {
  current = MODES.includes(mode) ? mode : null;
  const root = document.documentElement;
  const theme = themeFor(currentMode(), isDark());
  if (root.dataset.theme === theme) return;
  if (origin) {
    root.style.setProperty('--reveal-x', `${Math.round(origin.x)}px`);
    root.style.setProperty('--reveal-y', `${Math.round(origin.y)}px`);
  } else {
    root.style.removeProperty('--reveal-x');
    root.style.removeProperty('--reveal-y');
  }
  if (fade && document.startViewTransition) document.startViewTransition(() => { root.dataset.theme = theme; });
  else root.dataset.theme = theme;
}

export function saveMode(storage, mode, origin = null) {
  try { storage?.setItem(MODE_KEY, mode); } catch { /* Vale per questa apertura. */ }
  applyMode(mode, { fade: true, origin });
}

darkQuery?.addEventListener?.('change', () => applyMode(current));
