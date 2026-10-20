// Recupero tra le serie: parte alla spunta di una serie (non dell'ultima) e
// conta all'indietro fino a endsAt. Lo stato si salva sul dispositivo, così
// sopravvive a cambi di pagina e alla riapertura dell'app.
export const ACTIVE_REST_KEY = 'buddygym:active-rest:v1';

export function createRest({ workoutId, exerciseId, nextIndex, seconds, now = Date.now() }) {
  return { workoutId, exerciseId, nextIndex, total: seconds, endsAt: now + seconds * 1000 };
}

export function restRemaining(rest, now = Date.now()) {
  return Math.max(0, Math.ceil((rest.endsAt - now) / 1000));
}

// −15 s / +15 s: l'anello si riferisce al totale, che cresce se si aggiunge tempo.
export function adjustRest(rest, deltaSeconds, now = Date.now()) {
  const remaining = Math.max(0, restRemaining(rest, now) + deltaSeconds);
  return { ...rest, endsAt: now + remaining * 1000, total: Math.max(rest.total, remaining) };
}

export function formatRest(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// La prossima serie da fare dopo quella appena spuntata; null se era l'ultima.
export function nextOpenSet(rows, index) {
  for (let next = index + 1; next < rows.length; next += 1) if (!rows[next].done) return next;
  return null;
}

export function loadRest(storage) {
  try {
    const value = JSON.parse(storage.getItem(ACTIVE_REST_KEY));
    if (value && typeof value.workoutId === 'string' && typeof value.exerciseId === 'string'
      && Number.isFinite(value.endsAt) && Number.isInteger(value.nextIndex) && value.total > 0) return value;
  } catch { /* Nessun recupero da riprendere. */ }
  return null;
}
