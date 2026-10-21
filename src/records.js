// Record e storico dei massimali (Palestra), regole di PersonalBest:
// - di carico: kg più alti di qualsiasi serie precedente di quell'esercizio;
// - di ripetizioni: a un carico già usato, più ripetizioni di sempre a quel carico;
// - una serie record sia di carico sia di ripetizioni conta come record di carico;
// - il primo allenamento con l'esercizio è il punto di partenza (la sua prima serie
//   completa), non un record; le serie senza kg o senza ripetizioni non contano;
// - un solo storico per nome: maiuscole, spazi in più e accenti non contano;
// - 0 kg scritto esplicitamente = corpo libero: valgono i record di ripetizioni.
// Il confronto è serie per serie: se la serie 3 batte di nuovo la serie 2, è un altro record.
import { readExerciseHistory } from './workout-history.js';
import { thousands } from './format.js';

const num = (value) => Number(String(value ?? '').replace(',', '.'));

export function exerciseKey(title) {
  return String(title ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Serie complete, nell'ordine in cui sono state fatte. Carico vuoto = serie incompleta;
// carico 0 = corpo libero (trazioni, dip senza zavorra).
const filled = (value) => value !== '' && value != null && String(value).trim() !== '';
export const liftedRows = (rows) => rows
  .filter((row) => row && filled(row.load) && filled(row.reps))
  .map((row) => ({ load: num(row.load), reps: num(row.reps) }))
  .filter((row) => row.load >= 0 && row.reps > 0 && Number.isFinite(row.load) && Number.isFinite(row.reps));

// «100 kg × 5», «Corpo libero × 12».
export const liftText = (load, reps) => (Number(load) === 0 ? `Corpo libero × ${reps}` : `${thousands(Number(load))} kg × ${reps}`);

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
  return { maxLoad: -1, repsAt: new Map() };
}

// Record della serie rispetto a tutto ciò che c'era prima (null se non lo è).
function judge(state, row) {
  if (state.maxLoad >= 0 && row.load > state.maxLoad) return { kind: 'load', gain: Math.round((row.load - state.maxLoad) * 100) / 100 };
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

// Nomi già usati negli esercizi della modalità (Palestra o Pilates), una volta sola per nome
// normalizzato e in ordine alfabetico: si suggeriscono mentre si scrive un nuovo esercizio,
// così lo stesso esercizio non finisce in storici separati per un errore di battitura.
export function usedExerciseNames(workouts, { pilates = false, extra = [] } = {}) {
  const names = new Map();
  for (const exercise of [...workouts.flatMap((workout) => workout.exercises), ...extra]) {
    if ((exercise.mode === 'pilates') !== pilates) continue;
    const key = exerciseKey(exercise.title);
    if (key && !names.has(key)) names.set(key, exercise.title.trim().replace(/\s+/g, ' '));
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b, 'it'));
}

// ——— Suggerimento di progressione (ProgressionSuggestion) ————————————————————————
// Dall'ultima volta con l'esercizio (storico unico per nome):
// - tutte le serie a obiettivo → +5% del carico, arrotondato a 0,25 kg;
// - almeno una serie sotto → stesso carico, «punta a N su tutte»;
// - sotto anche la volta prima → «Resta a X kg», consolidare.
// Niente alla prima volta, né per esercizi a tempo.
export const roundQuarter = (value) => Math.round(value / 0.25) * 0.25;

export function progressionSuggestion(entries, exercise) {
  if (exercise?.mode !== 'reps') return null;
  const sessions = entries.map((entry) => liftedRows(entry.rows)).filter((rows) => rows.length);
  const last = sessions.at(-1);
  if (!last) return null;
  const target = exercise.reps;
  const sets = Math.max(exercise.sets ?? last.length, 1);
  const load = Math.max(...last.map((row) => row.load));
  const below = (rows) => rows.some((row) => row.reps < target) || rows.length < sets;
  if (!below(last)) {
    if (load === 0) return null;
    return { kind: 'load', load: roundQuarter(load * 1.05), reps: target, previous: { load, sets: last.length, reps: target } };
  }
  const short = last.findIndex((row) => row.reps < target);
  if (sessions.length >= 2 && below(sessions.at(-2))) return { kind: 'keep', load, reps: target };
  return { kind: 'reps', load, reps: target, sets, stopped: short >= 0 ? { set: short + 1, reps: last[short].reps } : null };
}
