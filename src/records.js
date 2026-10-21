// Record e storico dei massimali (Palestra). Un record è:
// - di carico: più kg di sempre in quell'esercizio;
// - di ripetizioni: più ripetizioni di sempre a un carico già usato prima.
// Lo stesso esercizio in schede diverse (stesso nome, maiuscole e spazi ignorati)
// ha un solo storico. La prima volta fissa il punto di partenza, non è un record.
import { readExerciseHistory } from './workout-history.js';

const num = (value) => Number(String(value ?? '').replace(',', '.'));

export function exerciseKey(title) {
  return String(title ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Serie valide di una seduta: carico e ripetizioni maggiori di zero.
const liftedRows = (entry) => entry.rows
  .map((row) => ({ load: num(row.load), reps: num(row.reps) }))
  .filter((row) => row.load > 0 && row.reps > 0 && Number.isFinite(row.load) && Number.isFinite(row.reps));

// Tutte le sedute finite di un esercizio, da ogni scheda in cui compare con lo stesso nome.
export function exerciseEntries(storage, workouts, title) {
  const key = exerciseKey(title);
  return workouts.filter((workout) => workout.mode !== 'pilates').flatMap((workout) => workout.exercises
    .filter((exercise) => exercise.mode === 'reps' && exerciseKey(exercise.title) === key)
    .flatMap((exercise) => readExerciseHistory(storage, workout.id, exercise.id)
      .filter((entry) => Number.isFinite(entry.endedAt))
      .map((entry) => ({ sessionId: entry.sessionId, endedAt: entry.endedAt, rows: entry.rows }))))
    .sort((a, b) => a.endedAt - b.endedAt);
}

// Storico dei massimali: per ogni seduta, al massimo un record di carico e uno di ripetizioni.
// `start` è il punto di partenza (prima seduta), poi gli eventi in ordine di tempo.
export function recordTimeline(entries) {
  let maxLoad = 0;
  const repsAt = new Map();
  const events = [];
  let start = null;
  for (const entry of entries) {
    const rows = liftedRows(entry);
    if (!rows.length) continue;
    const best = [...rows].sort((a, b) => b.load - a.load || b.reps - a.reps)[0];
    if (!start) {
      start = { at: entry.endedAt, sessionId: entry.sessionId, load: best.load, reps: best.reps };
    } else {
      if (best.load > maxLoad) {
        events.push({ kind: 'load', at: entry.endedAt, sessionId: entry.sessionId, load: best.load, reps: best.reps, gain: Math.round((best.load - maxLoad) * 10) / 10 });
      }
      // Ripetizioni: al carico più alto (già usato prima) in cui si è fatto meglio di sempre.
      const repsRecord = rows
        .filter((row) => row.load <= maxLoad && repsAt.has(row.load) && row.reps > repsAt.get(row.load))
        .sort((a, b) => b.load - a.load || b.reps - a.reps)[0];
      if (repsRecord) {
        events.push({ kind: 'reps', at: entry.endedAt, sessionId: entry.sessionId, load: repsRecord.load, reps: repsRecord.reps, gain: repsRecord.reps - repsAt.get(repsRecord.load) });
      }
    }
    for (const row of rows) {
      maxLoad = Math.max(maxLoad, row.load);
      repsAt.set(row.load, Math.max(repsAt.get(row.load) ?? 0, row.reps));
    }
  }
  const top = maxLoad ? { load: maxLoad, reps: repsAt.get(maxLoad) } : null;
  // Data del massimale attuale: l'ultima volta che è stato raggiunto o migliorato.
  if (top) {
    const reached = [...entries].reverse().find((entry) => liftedRows(entry).some((row) => row.load === top.load && row.reps === top.reps));
    top.at = reached?.endedAt ?? null;
  }
  return { start, events, top };
}

// Record di una seduta, per il riepilogo: nuovi rispetto a tutto ciò che c'era prima.
export function sessionRecords(entries, sessionId) {
  return recordTimeline(entries).events.filter((event) => event.sessionId === sessionId);
}
