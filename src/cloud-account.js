import { loadSessions, saveSessions } from './sessions.js';
import { exampleWorkouts, loadWorkouts, WORKOUT_STORAGE_KEY } from './workouts.js';
import { exerciseHistoryKey, readExerciseHistory } from './workout-history.js';
import { COACH_BUCKET } from './coach-data.js';
import { authRedirectUrl, isNativeApp, nativePlugin, NATIVE_AUTH_REDIRECT } from './native-app.js';

export const SUPABASE_URL = 'https://muovkovljsdtsbmqlvgd.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Sy-_GOUeFcLJ5fTFN1wLyQ_6cz3KPd8';
// Libreria inclusa nell'app (npm run vendor): build UMD che definisce window.supabase.
const SDK_URL = new URL('../vendor/supabase.js', import.meta.url).href;
const prefix = (userId) => `buddygym:account:${userId}:`;

export function accountStorage(backing, userId, onChange = () => {}) {
  const head = prefix(userId);
  const keys = () => {
    const result = [];
    for (let index = 0; index < backing.length; index += 1) {
      const key = backing.key(index);
      if (key?.startsWith(head)) result.push(key);
    }
    return result;
  };
  return {
    get length() { return keys().length; },
    key(index) { const key = keys()[index]; return key ? key.slice(head.length) : null; },
    getItem(key) { return backing.getItem(head + key); },
    setItem(key, value) { backing.setItem(head + key, value); onChange(key); },
    removeItem(key) { backing.removeItem(head + key); onChange(key); },
  };
}

function loadSdk() {
  if (globalThis.supabase?.createClient) return Promise.resolve(globalThis.supabase);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.onload = () => (globalThis.supabase?.createClient ? resolve(globalThis.supabase) : reject(new Error('Supabase non disponibile.')));
    script.onerror = () => reject(new Error('Impossibile caricare Supabase.'));
    document.head.append(script);
  });
}

export async function createCloudClient() {
  const { createClient } = await loadSdk();
  // PKCE: il ritorno porta un codice monouso legato a questo dispositivo, non i token.
  // Nell'app nativa il codice arriva tramite deep link e viene scambiato a mano.
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { flowType: 'pkce', detectSessionInUrl: !isNativeApp(), persistSession: true, autoRefreshToken: true },
  });
}

// Google e Apple bloccano l'accesso dentro una WebView: nell'app si apre il browser
// di sistema (SFSafariViewController / Custom Tabs) e si torna con il deep link.
export async function signInWithProvider(client, provider) {
  if (!isNativeApp()) return client.auth.signInWithOAuth({ provider, options: { redirectTo: authRedirectUrl() } });
  const { data, error } = await client.auth.signInWithOAuth({
    provider, options: { redirectTo: NATIVE_AUTH_REDIRECT, skipBrowserRedirect: true },
  });
  if (error) return { error };
  await nativePlugin('Browser').open({ url: data.url, presentationStyle: 'popover' });
  return { error: null };
}

async function listAll(bucket, folder) {
  const items = [];
  for (let offset = 0; ; offset += 100) {
    const page = assertOk(await bucket.list(folder, { limit: 100, offset }));
    items.push(...page);
    if (page.length < 100) return items;
  }
}

// I file del coach si eliminano con la Storage API: il database non può cancellarli.
// Poi la funzione delete_own_account (supabase/account-deletion.sql) elimina l'utente
// e, a cascata, schede, storico, profilo e area coach.
export async function deleteAccount(client, userId) {
  const bucket = client.storage.from(COACH_BUCKET);
  const paths = [];
  for (const entry of await listAll(bucket, userId)) {
    // Le voci senza id sono cartelle: una per esercizio.
    if (entry.id) paths.push(`${userId}/${entry.name}`);
    else for (const file of await listAll(bucket, `${userId}/${entry.name}`)) paths.push(`${userId}/${entry.name}/${file.name}`);
  }
  for (let offset = 0; offset < paths.length; offset += 100) assertOk(await bucket.remove(paths.slice(offset, offset + 100)));
  assertOk(await client.rpc('delete_own_account'));
}

function assertOk(result) {
  if (result.error) throw result.error;
  return result.data;
}

async function readAll(client, table, fields, userId, orderColumns) {
  const all = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    let query = client.from(table).select(fields).eq('user_id', userId);
    for (const column of orderColumns) query = query.order(column, { ascending: true });
    const page = assertOk(await query.range(offset, offset + pageSize - 1));
    all.push(...page);
    if (page.length < pageSize) return all;
  }
}

async function upsertBatches(client, table, rows, onConflict) {
  for (let offset = 0; offset < rows.length; offset += 200) {
    assertOk(await client.from(table).upsert(rows.slice(offset, offset + 200), { onConflict }));
  }
}

export async function downloadAccount(client, userId, storage) {
  const [remoteWorkouts, remoteHistory, remoteSessions] = await Promise.all([
    readAll(client, 'buddy_workouts', 'id,title,source,mode,exercises', userId, ['id']),
    readAll(client, 'buddy_exercise_history', 'workout_id,exercise_id,session_id,started_at,ended_at,set_rows', userId, ['workout_id', 'exercise_id', 'session_id']),
    readAll(client, 'buddy_sessions', 'id,workout_id,workout_title,started_at,ended_at,summary,effort,mode', userId, ['ended_at']),
  ]);
  // Storico delle sedute: quello del cloud, se c'è; altrimenti si ricostruisce sul dispositivo.
  if (remoteSessions.length) {
    saveSessions(storage, remoteSessions.map((row) => ({
      id: row.id, workoutId: row.workout_id, title: row.workout_title,
      startedAt: Number(row.started_at), endedAt: Number(row.ended_at), summary: row.summary, effort: row.effort, mode: row.mode ?? 'gym',
    })));
  }
  const workouts = remoteWorkouts.length ? remoteWorkouts.map((row) => ({ id: row.id, title: row.title, source: row.source, exercises: row.exercises, ...(row.mode === 'pilates' ? { mode: 'pilates' } : {}) })) : exampleWorkouts();
  storage.setItem(WORKOUT_STORAGE_KEY, JSON.stringify(workouts));
  for (const workout of workouts) for (const exercise of workout.exercises) {
    const entries = remoteHistory.filter((row) => row.workout_id === workout.id && row.exercise_id === exercise.id)
      .map((row) => ({ sessionId: row.session_id, startedAt: row.started_at, endedAt: row.ended_at, rows: row.set_rows }));
    storage.setItem(exerciseHistoryKey(workout.id, exercise.id), JSON.stringify(entries));
  }
  return { workouts, hasRemoteWorkouts: remoteWorkouts.length > 0 };
}

export async function uploadAccount(client, userId, storage, removedIds = [], removedExercises = []) {
  const workouts = loadWorkouts(storage);
  const rows = workouts.map((workout) => ({
    user_id: userId, id: workout.id, title: workout.title, source: workout.source,
    mode: workout.mode === 'pilates' ? 'pilates' : 'gym', exercises: workout.exercises, updated_at: new Date().toISOString(),
  }));
  await upsertBatches(client, 'buddy_workouts', rows, 'user_id,id');
  const historyRows = workouts.flatMap((workout) => workout.exercises.flatMap((exercise) =>
    readExerciseHistory(storage, workout.id, exercise.id).map((entry) => ({
      user_id: userId, workout_id: workout.id, exercise_id: exercise.id,
      session_id: entry.sessionId, started_at: entry.startedAt ?? null,
      ended_at: entry.endedAt ?? null, set_rows: entry.rows,
    }))));
  await upsertBatches(client, 'buddy_exercise_history', historyRows, 'user_id,workout_id,exercise_id,session_id');
  const sessionRows = loadSessions(storage).map((session) => ({
    user_id: userId, id: session.id, workout_id: session.workoutId, workout_title: session.title,
    started_at: session.startedAt, ended_at: session.endedAt, summary: session.summary ?? {},
    effort: session.effort ?? null, mode: session.mode === 'pilates' ? 'pilates' : 'gym', updated_at: new Date().toISOString(),
  }));
  await upsertBatches(client, 'buddy_sessions', sessionRows, 'user_id,id');
  for (const { workoutId, exerciseId } of removedExercises) {
    assertOk(await client.from('buddy_exercise_history').delete().eq('user_id', userId).eq('workout_id', workoutId).eq('exercise_id', exerciseId));
  }
  for (const id of removedIds) assertOk(await client.from('buddy_workouts').delete().eq('user_id', userId).eq('id', id));
  return workouts.map((workout) => workout.id);
}
