// Integrazione con il contenitore nativo Capacitor. Nell'app Android/iOS l'oggetto
// globale Capacitor è iniettato dal contenitore; nel browser non esiste.
export const APP_SCHEME = 'com.buddygym.app';
export const NATIVE_AUTH_REDIRECT = `${APP_SCHEME}://auth/callback`;

export function isNativeApp() {
  return !!globalThis.Capacitor?.isNativePlatform?.();
}

// Il contenitore espone i plugin nativi installati in Capacitor.Plugins; senza il
// pacchetto JavaScript @capacitor/core, registerPlugin non esiste.
export function nativePlugin(name) {
  const plugin = globalThis.Capacitor?.Plugins?.[name];
  if (!plugin) throw new Error(`Funzione nativa ${name} non disponibile in questa versione dell’app.`);
  return plugin;
}

// Indirizzo a cui Supabase rimanda dopo l'accesso o la conferma dell'email.
export function authRedirectUrl(location = globalThis.location) {
  return isNativeApp() ? NATIVE_AUTH_REDIRECT : `${location.origin}${location.pathname}`;
}

export function isAuthCallback(url) {
  return typeof url === 'string' && url.startsWith(NATIVE_AUTH_REDIRECT);
}

// Parametri del ritorno OAuth: con PKCE arrivano nella query, gli errori a volte nel frammento.
export function authCallbackParameters(url) {
  const parsed = new URL(url);
  const parameters = new URLSearchParams(parsed.search);
  for (const [key, value] of new URLSearchParams(parsed.hash.slice(1))) if (!parameters.has(key)) parameters.set(key, value);
  return parameters;
}
