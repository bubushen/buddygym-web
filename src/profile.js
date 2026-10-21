import { LB_IN_KG, unitLabel } from './units.js';

const SEX_VALUES = new Set(['male', 'female', 'other', 'prefer_not_to_say']);

// Il peso si salva sempre in kg; `unit` è l'unità in cui l'utente ha scritto il valore.
export function normalizeProfile(values, today = new Date().toISOString().slice(0, 10), unit = 'kg') {
  const firstName = String(values.firstName ?? '').trim();
  const lastName = String(values.lastName ?? '').trim();
  const birthDate = String(values.birthDate ?? '').trim();
  const weightRaw = String(values.weightKg ?? '').trim();
  const sex = String(values.sex ?? '').trim();
  if (firstName.length > 100 || lastName.length > 100) throw new Error('Nome e cognome devono avere al massimo 100 caratteri.');
  if (birthDate && (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)
    || Number.isNaN(Date.parse(`${birthDate}T00:00:00Z`))
    || new Date(`${birthDate}T00:00:00Z`).toISOString().slice(0, 10) !== birthDate
    || birthDate < '1900-01-01' || birthDate > today)) {
    throw new Error('Inserisci una data di nascita valida, non futura.');
  }
  const weight = weightRaw ? Number(weightRaw.replace(',', '.')) : null;
  // Il limite resta 1000 kg, quindi in lb sono ~2204,6; una cifra decimale vale sul valore scritto.
  const maxWeight = unit === 'lb' ? 1000 / LB_IN_KG : 1000;
  if (weightRaw && (!Number.isFinite(weight) || weight <= 0 || weight > maxWeight || Math.round(weight * 10) !== weight * 10)) {
    throw new Error(`Inserisci il peso in ${unitLabel(unit)} con al massimo una cifra decimale.`);
  }
  if (sex && !SEX_VALUES.has(sex)) throw new Error('Seleziona un valore valido per il sesso.');
  return {
    first_name: firstName || null,
    last_name: lastName || null,
    birth_date: birthDate || null,
    weight_kg: weight === null ? null : (unit === 'lb' ? weight * LB_IN_KG : weight),
    sex: sex || null,
  };
}

export async function loadProfile(client, userId) {
  const { data, error } = await client.from('buddy_profiles')
    .select('first_name,last_name,birth_date,weight_kg,sex,alias,share_stats,share_loads,mode,settings')
    .eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

// true = libero, false = già preso, null = non verificabile (es. senza rete).
export async function aliasAvailable(client, alias) {
  try {
    const { data, error } = await client.rpc('alias_available', { candidate: alias });
    return error ? null : data;
  } catch { return null; }
}

export async function saveAlias(client, userId, alias) {
  const { error } = await client.from('buddy_profiles').upsert({ user_id: userId, alias, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}

export async function saveBirthDate(client, userId, birthDate) {
  const { error } = await client.from('buddy_profiles').upsert({ user_id: userId, birth_date: birthDate, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}

// Modalità dell'account (Palestra o Pilates): all'accesso l'app entra in questa.
export async function saveMode(client, userId, mode) {
  const { error } = await client.from('buddy_profiles').upsert({ user_id: userId, mode, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}

// Privacy verso gli amici: statistiche e carichi visibili sì/no.
export async function savePrivacy(client, userId, privacy) {
  const { error } = await client.from('buddy_profiles').upsert({ user_id: userId, ...privacy, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}

export async function saveProfile(client, userId, profile) {
  const { error } = await client.from('buddy_profiles').upsert({
    user_id: userId, ...profile, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw error;
}
