import { makeId, validWorkout } from './workouts.js';

export const COACH_BUCKET = 'coach-reference-videos';

export function initialCoachData() {
  return {
    exercises: [
      { id: 'curl', title: 'Curl con manubrio', instructions: 'Riprendi il movimento di lato.\nMantieni il gomito stabile vicino al busto.\nCompleta salita e discesa con controllo.', reference: { builtin: 'curl' } },
      { id: 'bike', title: 'Bike', instructions: 'Regola la seduta e mantieni un ritmo regolare.', reference: null },
      { id: 'leg-press', title: 'Leg press', instructions: 'Segui le indicazioni del tuo coach.', reference: null },
    ],
    templates: [
      { id: 'upper-base', title: 'Upper · base', exercises: [{ id: 'curl-row', libraryId: 'curl', title: 'Curl con manubrio', mode: 'reps', sets: 3, reps: 10 }] },
      { id: 'lower-base', title: 'Lower · base', exercises: [{ id: 'bike-row', libraryId: 'bike', title: 'Bike', mode: 'time', minutes: 10 }, { id: 'press-row', libraryId: 'leg-press', title: 'Leg press', mode: 'reps', sets: 3, reps: 8 }] },
    ],
    clients: [{ id: 'marta-demo', name: 'Marta Demo' }, { id: 'luca-demo', name: 'Luca Demo' }, { id: 'giulia-demo', name: 'Giulia Demo' }],
    assignments: [],
  };
}

export function prescription(values) {
  if (values.mode === 'time') {
    const minutes = Number(values.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 999) throw new Error('Inserisci una durata tra 0 e 999 minuti.');
    return { mode: 'time', minutes };
  }
  const sets = Number(values.sets);
  const reps = Number(values.reps);
  if (!Number.isInteger(sets) || sets < 1 || sets > 999 || !Number.isInteger(reps) || reps < 1 || reps > 999) throw new Error('Inserisci serie e ripetizioni intere tra 1 e 999.');
  return { mode: 'reps', sets, reps };
}

export function assignmentSnapshot(data, templateId, clientId, previous = null) {
  const template = data.templates.find((item) => item.id === templateId);
  if (!template || !template.exercises.length) throw new Error('Aggiungi almeno un esercizio al template.');
  if (!data.clients.some((item) => item.id === clientId)) throw new Error('Cliente di prova non trovato.');
  const snapshot = {
    id: previous?.id ?? makeId(), clientId, templateId, title: template.title, source: 'coach',
    assignedAt: previous?.assignedAt ?? Date.now(), updatedAt: Date.now(), version: (previous?.version ?? 0) + 1,
    exercises: template.exercises.map((item) => {
      const source = data.exercises.find((exercise) => exercise.id === item.libraryId);
      if (!source) throw new Error('Un esercizio del template non è più disponibile.');
      return { id: item.id, libraryId: source.id, title: source.title, ...prescription(item), instructions: source.instructions, coachReference: structuredClone(source.reference) };
    }),
  };
  if (!validWorkout(snapshot)) throw new Error('La scheda non è valida.');
  return snapshot;
}

export function clientAssignments(data, clientId) {
  return structuredClone(data.assignments.filter((item) => item.clientId === clientId));
}

export function canEditWorkout(workout) { return !!workout && workout.source !== 'coach'; }

export function createCoachStore(client, userId) {
  let revision = null;
  return {
    async load() {
      const { data, error } = await client.from('buddy_coach_workspaces').select('data,revision').eq('user_id', userId).maybeSingle();
      if (error) throw error;
      revision = data?.revision ?? null;
      return data?.data ?? initialCoachData();
    },
    async save(data) {
      const row = { user_id: userId, data, revision: (revision ?? 0) + 1, updated_at: new Date().toISOString() };
      const query = revision === null
        ? client.from('buddy_coach_workspaces').insert(row)
        : client.from('buddy_coach_workspaces').update(row).eq('user_id', userId).eq('revision', revision);
      const result = await query.select('revision');
      if (result.error?.code === '23505' || (!result.error && !result.data?.length)) throw new Error('La tua area coach è stata aggiornata altrove. Ricarica la pagina prima di riprovare.');
      if (result.error) throw result.error;
      revision = result.data[0].revision;
    },
    upload(file, exerciseId) { return uploadReferenceVideo(client, userId, exerciseId, file); },
    removeUpload(path) { return removeReferenceVideo(client, path); },
  };
}

// Video di riferimento sul server: `<utente>/<cartella dell'esercizio>/<file>`. Le regole
// dello spazio privato consentono lettura e scrittura solo nella cartella dell'utente.
export async function uploadReferenceVideo(client, userId, folder, file) {
  if (file.type && !file.type.startsWith('video/')) throw new Error('Scegli un file video.');
  if (file.size > 50 * 1024 * 1024) throw new Error('Il video deve pesare al massimo 50 MB.');
  const type = ['video/quicktime', 'video/webm'].includes(file.type) ? file.type : 'video/mp4';
  const extension = type === 'video/quicktime' ? 'mov' : type === 'video/webm' ? 'webm' : 'mp4';
  const path = `${userId}/${folder}/${makeId()}.${extension}`;
  const { error } = await client.storage.from(COACH_BUCKET).upload(path, file, { contentType: type, upsert: false });
  if (error) throw error;
  return path;
}

export async function removeReferenceVideo(client, path) {
  const { error } = await client.storage.from(COACH_BUCKET).remove([path]);
  if (error) throw error;
}

export async function downloadReferenceVideo(client, path) {
  const { data, error } = await client.storage.from(COACH_BUCKET).download(path);
  if (error) throw error;
  return data;
}

export async function coachVideoUrl(client, reference) {
  if (!reference?.path) return null;
  const { data, error } = await client.storage.from(COACH_BUCKET).createSignedUrl(reference.path, 3600);
  if (error) throw error;
  return data.signedUrl;
}
