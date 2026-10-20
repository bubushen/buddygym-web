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
  return { id: sessionId, workoutId: workout.id, title: workout.title, startedAt, endedAt, summary, effort: null };
}

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
  for (const workout of workouts) {
    for (const session of workoutSessions(storage, workout)) {
      if (known.has(session.sessionId) || !Number.isFinite(session.startedAt)) continue;
      const summary = workoutSummary(storage, workout, session.sessionId);
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
    const record = (item.summary?.records?.length ?? 0) > 0;
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
