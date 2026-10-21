// Sedute finite (Storico). Ogni seduta conserva il suo riepilogo com'era quel giorno.
import { workoutSessions } from './workout-insights.js';
import { workoutSummary } from './workout-summary.js';

export const SESSIONS_KEY = 'buddygym:sessions:v1';

export function loadSessions(storage) {
  try {
    const saved = JSON.parse(storage.getItem(SESSIONS_KEY));
    return Array.isArray(saved) ? saved.filter((item) => item && typeof item.id === 'string' && Number.isFinite(item.endedAt)) : [];
  } catch { return []; }
}

export function saveSessions(storage, sessions) {
  try {
    storage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    return true;
  } catch { return false; }
}

export function sessionFromSummary(workout, sessionId, startedAt, endedAt, summary) {
  return { id: sessionId, workoutId: workout.id, title: workout.title, startedAt, endedAt, summary, effort: null, mode: workout.mode === 'pilates' ? 'pilates' : 'gym' };
}

// Palestra e Pilates restano separati: ogni schermata vede solo la sua modalità.
export const sessionMode = (session) => (session.mode === 'pilates' ? 'pilates' : 'gym');

export function upsertSession(storage, session) {
  const sessions = loadSessions(storage).filter((item) => item.id !== session.id);
  sessions.push(session);
  return saveSessions(storage, sessions);
}

// Sedute fatte prima che esistesse lo Storico: ricostruite una volta dallo storico delle serie.
export function backfillSessions(storage, workouts) {
  const sessions = loadSessions(storage);
  const known = new Set(sessions.map((item) => item.id));
  let added = 0;
  for (const workout of workouts.filter((item) => item.mode !== 'pilates')) {
    for (const session of workoutSessions(storage, workout)) {
      if (known.has(session.sessionId) || !Number.isFinite(session.startedAt)) continue;
      const summary = workoutSummary(storage, workout, session.sessionId, workouts);
      sessions.push(sessionFromSummary(workout, session.sessionId, session.startedAt, session.endedAt, summary));
      known.add(session.sessionId);
      added += 1;
    }
  }
  if (added) saveSessions(storage, sessions);
  return added;
}

const DAY = 86_400_000;
const startOfDay = (time) => { const date = new Date(time); date.setHours(0, 0, 0, 0); return date.getTime(); };
// Lunedì della settimana di quel giorno.
export function weekStart(time) {
  const date = new Date(startOfDay(time));
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
}

// Dati della schermata Storico per un mese e un filtro per scheda.
export function historyView(sessions, { year, month, workoutTitle = null, now = Date.now() }) {
  const filtered = sessions.filter((item) => !workoutTitle || item.title === workoutTitle);
  const inMonth = filtered.filter((item) => {
    const date = new Date(item.endedAt);
    return date.getFullYear() === year && date.getMonth() === month;
  }).sort((a, b) => b.endedAt - a.endedAt);
  const days = new Map();
  for (const item of inMonth) {
    const day = new Date(item.endedAt).getDate();
    // Giorno in evidenza: record di carico (Palestra) o traguardo (Pilates).
    const record = (item.summary?.records?.length ?? 0) > 0 || (item.summary?.milestones?.length ?? 0) > 0;
    days.set(day, days.get(day) === 'pr' || record ? 'pr' : 'on');
  }
  const thisWeek = weekStart(now);
  const groups = [];
  for (const item of inMonth) {
    const start = weekStart(item.endedAt);
    let group = groups.find((entry) => entry.start === start);
    if (!group) {
      const label = start === thisWeek ? 'Questa settimana'
        : start === thisWeek - 7 * DAY ? 'Settimana scorsa'
          : `Settimana del ${new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' }).format(start)}`;
      group = { start, label, sessions: [] };
      groups.push(group);
    }
    group.sessions.push(item);
  }
  return {
    count: inMonth.length,
    records: inMonth.reduce((sum, item) => sum + (item.summary?.records?.length ?? 0), 0),
    minutes: Math.round(inMonth.reduce((sum, item) => sum + Math.max(0, item.endedAt - item.startedAt), 0) / 60_000),
    days,
    groups,
  };
}

// Schede presenti nello Storico, per i filtri: prima nell'ordine delle schede attuali.
export function historyTitles(sessions, workouts) {
  const titles = [...new Set(sessions.map((item) => item.title))];
  const order = workouts.map((workout) => workout.title);
  return titles.sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999) || a.localeCompare(b, 'it'));
}

// ——— Storico per giorno (HistoryScreen): entrambe le modalità, filtro Tutto/Palestra/Pilates ———
const sameMonth = (time, year, month) => { const date = new Date(time); return date.getFullYear() === year && date.getMonth() === month; };
const isRecordDay = (item) => (item.summary?.records?.length ?? 0) > 0 || (item.summary?.milestones?.length ?? 0) > 0;

// Caselle del mese: per ogni giorno con allenamenti, palestra / Pilates e se c'è un record
// o un traguardo. Con un filtro l'altra modalità sparisce dal calendario.
export function calendarMonth(sessions, { year, month, filter = 'all' }) {
  const shown = sessions.filter((item) => filter === 'all' || sessionMode(item) === filter);
  const days = new Map();
  for (const item of shown) {
    if (!sameMonth(item.endedAt, year, month)) continue;
    const day = new Date(item.endedAt).getDate();
    const entry = days.get(day) ?? { gym: false, pilates: false, record: false };
    entry[sessionMode(item)] = true;
    entry.record ||= isRecordDay(item);
    days.set(day, entry);
  }
  return { days, trainingDays: days.size };
}

// Allenamenti di un giorno, in ordine di orario.
export function daySessions(sessions, { year, month, day, filter = 'all' }) {
  return sessions.filter((item) => (filter === 'all' || sessionMode(item) === filter)
    && sameMonth(item.endedAt, year, month) && new Date(item.endedAt).getDate() === day)
    .sort((a, b) => (a.startedAt ?? a.endedAt) - (b.startedAt ?? b.endedAt));
}

// Giorno selezionato all'apertura: oggi, o l'ultimo giorno con un allenamento (nel mese mostrato).
export function defaultDay(sessions, { year, month, filter = 'all', now = Date.now() }) {
  const today = new Date(now);
  const { days } = calendarMonth(sessions, { year, month, filter });
  if (today.getFullYear() === year && today.getMonth() === month && days.has(today.getDate())) return today.getDate();
  const worked = [...days.keys()].filter((day) => !(today.getFullYear() === year && today.getMonth() === month) || day <= today.getDate());
  if (worked.length) return Math.max(...worked);
  return today.getFullYear() === year && today.getMonth() === month ? today.getDate() : 1;
}
