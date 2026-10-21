// Impostazioni dell'account (SettingsScreen): salvate subito sul dispositivo e nel profilo
// (buddy_profiles.settings), senza pulsante Salva.
export const SETTINGS_KEY = 'buddygym:settings:v1';
export const DEFAULT_SETTINGS = Object.freeze({
  progression: true,
  restDefault: 90,
  pauseDefault: 20,
  notifySocial: true,
  theme: 'system',
  addMe: 'all',
  unit: 'kg',
});
export const REST_CHOICES = [60, 90, 120, 150, 180];
export const PAUSE_CHOICES = [10, 15, 20, 30, 45];
export const ADD_ME = { all: 'Tutti', fof: 'Amici di amici', none: 'Nessuno' };
export const THEMES = { light: 'Chiaro', dark: 'Scuro', system: 'Sistema' };
export const UNITS = { kg: 'Chilogrammi (kg)', lb: 'Libbre (lb)' };

// Solo valori validi; il resto torna al predefinito.
export function cleanSettings(value = {}) {
  const out = { ...DEFAULT_SETTINGS };
  if (typeof value.progression === 'boolean') out.progression = value.progression;
  if (typeof value.notifySocial === 'boolean') out.notifySocial = value.notifySocial;
  if (REST_CHOICES.includes(value.restDefault)) out.restDefault = value.restDefault;
  if (PAUSE_CHOICES.includes(value.pauseDefault)) out.pauseDefault = value.pauseDefault;
  if (value.theme in THEMES) out.theme = value.theme;
  if (value.addMe in ADD_ME) out.addMe = value.addMe;
  if (value.unit in UNITS) out.unit = value.unit;
  return out;
}

export function loadSettings(storage) {
  try { return cleanSettings(JSON.parse(storage?.getItem(SETTINGS_KEY) || '{}')); } catch { return { ...DEFAULT_SETTINGS }; }
}

export function storeSettings(storage, settings) {
  try { storage?.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Valgono per questa apertura. */ }
}

export async function saveSettingsToProfile(client, userId, settings) {
  const { error } = await client.from('buddy_profiles').upsert({ user_id: userId, settings, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}
