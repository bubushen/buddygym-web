// Notifiche push sul telefono (Firebase Cloud Messaging, solo app Android per ora).
// Il telefono registra il suo token sull'account; il server (Edge Function push-notify)
// invia le notifiche del Social. Toccando la notifica si apre la schermata giusta.

// Diventa true quando android/app/google-services.json è presente: senza Firebase
// configurato la registrazione farebbe chiudere l'app.
export const PUSH_ENABLED = false;

const TOKEN_KEY = 'buddygym:push-token';
const plugin = () => globalThis.Capacitor?.Plugins?.PushNotifications;
const platform = () => globalThis.Capacitor?.getPlatform?.();

let listening = false;

export async function enablePush(client, { onOpen, onReceive }) {
  const push = plugin();
  if (!PUSH_ENABLED || !push || platform() !== 'android') return;
  if (!listening) {
    listening = true;
    await push.addListener('registration', async ({ value }) => {
      try {
        const { error } = await client.rpc('buddy_register_push', { push_token: value, push_platform: platform() });
        if (error) throw error;
        localStorage.setItem(TOKEN_KEY, value);
      } catch (error) { console.warn('BUDDYGYM push token not saved', error); }
    });
    await push.addListener('registrationError', (error) => console.warn('BUDDYGYM push registration failed', error));
    await push.addListener('pushNotificationActionPerformed', ({ notification }) => {
      if (notification?.data?.route) onOpen(notification.data.route);
    });
    await push.addListener('pushNotificationReceived', () => onReceive());
  }
  try {
    await push.createChannel({ id: 'social', name: 'Social', description: 'Amicizie, Forza e commenti', importance: 4, visibility: 1 });
    let { receive } = await push.checkPermissions();
    if (receive === 'prompt' || receive === 'prompt-with-rationale') ({ receive } = await push.requestPermissions());
    if (receive === 'granted') await push.register();
  } catch (error) { console.warn('BUDDYGYM push unavailable', error); }
}

// All'uscita dall'account il telefono smette di ricevere le notifiche di quell'account.
export async function disablePush(client) {
  let token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch { /* storage non disponibile */ }
  if (!token) return;
  try { await client.rpc('buddy_unregister_push', { push_token: token }); } catch { /* offline: il server lo pulirà */ }
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage non disponibile */ }
}
