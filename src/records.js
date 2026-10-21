// Record e storico dei massimali (Palestra), regole di PersonalBest:
// - di carico: kg più alti di qualsiasi serie precedente di quell'esercizio;
// - di ripetizioni: a un carico già usato, più ripetizioni di sempre a quel carico;
// - una serie record sia di carico sia di ripetizioni conta come record di carico;
// - il primo allenamento con l'esercizio è il punto di partenza (la sua prima serie
//   completa), non un record; le serie senza kg o senza ripetizioni non contano;
// - un solo storico per nome: maiuscole, spazi in più e accenti non contano.
// Il confronto è serie per serie: se la serie 3 batte di nuovo la serie 2, è un altro record.
import { readExerciseHistory } from './workout-history.js';

const num = (value) => Number(String(value ?? '').replace(',', '.'));

export function exerciseKey(title) {
  return String(title ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Serie complete, nell'ordine in cui sono state fatte.
export const liftedRows = (rows) => rows
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

function createState() {
  return { maxLoad: 0, repsAt: new Map() };
}

// Record della serie rispetto a tutto ciò che c'era prima (null se non lo è).
function judge(state, row) {
  if (row.load > state.maxLoad) return { kind: 'load', gain: Math.round((row.load - state.maxLoad) * 100) / 100 };
  const best = state.repsAt.get(row.load);
  if (best !== undefined && row.reps > best) return { kind: 'reps', gain: row.reps - best };
  return null;
}

function remember(state, row) {
  state.maxLoad = Math.max(state.maxLoad, row.load);
  state.repsAt.set(row.load, Math.max(state.repsAt.get(row.load) ?? 0, row.reps));
}

// Storico dei massimali: punto di partenza, record in ordine di tempo e massimale attuale.
export function recordTimeline(entries) {
  const state = createState();
  const events = [];
  let start = null;
  let top = null;
  for (const entry of entries) {
    const rows = liftedRows(entry.rows);
    if (!rows.length) continue;
    const baseline = !start;
    if (baseline) start = { at: entry.endedAt, sessionId: entry.sessionId, ...rows[0] };
    for (const row of rows) {
      const record = baseline ? null : judge(state, row);
      if (record) events.push({ ...record, at: entry.endedAt, sessionId: entry.sessionId, load: row.load, reps: row.reps });
      remember(state, row);
      // Massimale attuale: il carico più alto con le ripetizioni migliori, e quando è stato fatto.
      if (!top || row.load > top.load || (row.load === top.load && row.reps >= top.reps)) top = { load: row.load, reps: row.reps, at: entry.endedAt };
    }
  }
  return { start, events, top };
}

// Record di una seduta, per il riepilogo: tutti, serie per serie.
export function sessionRecords(entries, sessionId) {
  return recordTimeline(entries).events.filter((event) => event.sessionId === sessionId);
}

// Durante l'allenamento: la serie appena spuntata è un record? `earlier` sono le serie
// già spuntate oggi prima di questa. Senza allenamenti precedenti oggi è il punto di partenza.
export function judgeSet(entries, earlier, row) {
  const [current] = liftedRows([row]);
  if (!current || !entries.some((entry) => liftedRows(entry.rows).length)) return null;
  const state = createState();
  for (const entry of entries) for (const item of liftedRows(entry.rows)) remember(state, item);
  for (const item of liftedRows(earlier)) remember(state, item);
  const record = judge(state, current);
  return record ? { ...record, load: current.load, reps: current.reps } : null;
}
