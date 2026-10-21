// Vibrazioni (motion.md): leggera per spunta, «Fatto» Pilates e cambio tab; «success» per
// record e fine allenamento; 3 brevi negli ultimi 3 secondi di recupero o pausa. Mai durante
// lo scroll. Restano anche con «Riduci movimento». Nell'app: @capacitor/haptics; sul web:
// navigator.vibrate dove esiste (Android), sull'iPhone il browser non può vibrare.
const plugin = () => globalThis.Capacitor?.Plugins?.Haptics;
const web = (pattern) => { try { navigator.vibrate?.(pattern); } catch { /* Nessuna vibrazione disponibile. */ } };

export function hapticLight() {
  const haptics = plugin();
  if (haptics?.impact) haptics.impact({ style: 'LIGHT' }).catch(() => web(10));
  else web(10);
}

export function hapticSuccess() {
  const haptics = plugin();
  if (haptics?.notification) haptics.notification({ type: 'SUCCESS' }).catch(() => web([30, 60, 40]));
  else web([30, 60, 40]);
}

// Una delle tre brevi vibrazioni di fine conto alla rovescia.
export function hapticTick() {
  const haptics = plugin();
  if (haptics?.vibrate) haptics.vibrate({ duration: 40 }).catch(() => web(40));
  else web(40);
}

export const reducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
