// Modalità Pilates: sequenze di esercizi a tempo (durata, livello 1–3, attrezzo, pausa).
// Qui solo logica senza pagina: timer di esercizio e pausa, giorni e settimane di fila,
// traguardi e riepilogo di fine sessione. Mai kg, serie o ripetizioni.
export const EQUIPMENT = ['Mat', 'Reformer', 'Cadillac', 'Chair', 'Ring', 'Palla'];
export const LEVELS = { 1: 'Base', 2: 'Medio', 3: 'Avanzato' };
export const DEFAULT_PAUSE = 20;

export const isPilatesWorkout = (workout) => workout?.mode === 'pilates';

export function validPilatesExercise(exercise) {
  return exercise.mode === 'pilates'
    && Number.isInteger(exercise.seconds) && exercise.seconds >= 10 && exercise.seconds <= 3600
    && Number.isInteger(exercise.pauseSeconds) && exercise.pauseSeconds >= 0 && exercise.pauseSeconds <= 600
    && [1, 2, 3].includes(exercise.level)
    && EQUIPMENT.includes(exercise.equipment)
    && (exercise.howTo === undefined || (typeof exercise.howTo === 'string' && exercise.howTo.length <= 1000));
}

// «3:00», «12:30».
export function clockText(seconds) {
  const value = Math.max(0, Math.round(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

// «3:00» o «3» → 180 secondi; null se non è una durata valida.
export function parseClock(text) {
  const value = String(text ?? '').trim();
  const match = /^(\d{1,2})(?::([0-5]\d))?$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2] ?? 0);
}

export const exerciseMeta = (exercise) => `${exercise.equipment} · livello ${exercise.level}`;

// Durata prevista della sequenza: esercizi più pause tra un esercizio e l'altro.
export function plannedSeconds(workout) {
  return workout.exercises.reduce((sum, exercise, index) => sum + exercise.seconds
    + (index < workout.exercises.length - 1 ? exercise.pauseSeconds ?? DEFAULT_PAUSE : 0), 0);
}

// Durata degli esercizi soltanto (intestazione della nuova sequenza: «3 esercizi · 10 min»).
export const exercisesMinutes = (exercises) => Math.round(exercises.reduce((sum, item) => sum + item.seconds, 0) / 60);

// ——— Timer dell'esercizio e pausa ———————————————————————————————————————————————
// Stato: { workoutId, index, phase: 'exercise' | 'pause', running, startedAt, elapsed, duration }.
// In pausa `index` è l'esercizio che sta per iniziare. Tutto è calcolato dagli orari,
// così il timer resta giusto anche dopo un'app in background o uno schermo spento.
export const PILATES_CLOCK_KEY = 'buddygym:pilates-clock:v1';

export function startExercise(workout, index, now = Date.now()) {
  return { workoutId: workout.id, index, phase: 'exercise', running: true, startedAt: now, elapsed: 0, duration: workout.exercises[index].seconds * 1000 };
}

export function remainingMs(clock, now = Date.now()) {
  return Math.max(0, clock.duration - clock.elapsed - (clock.running ? now - clock.startedAt : 0));
}

export function pauseClock(clock, now = Date.now()) {
  if (!clock.running) return clock;
  return { ...clock, running: false, elapsed: clock.elapsed + (now - clock.startedAt), startedAt: null };
}

export function resumeClock(clock, now = Date.now()) {
  if (clock.running) return clock;
  return { ...clock, running: true, startedAt: now };
}

// Dopo l'esercizio `index`: la sua pausa, oppure subito il successivo; null a fine sequenza.
function afterExercise(workout, clock, at) {
  const next = clock.index + 1;
  if (next >= workout.exercises.length) return null;
  const pause = workout.exercises[clock.index].pauseSeconds ?? DEFAULT_PAUSE;
  if (pause > 0) return { workoutId: workout.id, index: next, phase: 'pause', running: true, startedAt: at, elapsed: 0, duration: pause * 1000 };
  return startExercise(workout, next, at);
}

// Fa avanzare il timer fino a `now`: esercizi finiti (con i secondi fatti), pause finite
// ed esercizi successivi partiti da soli. `finished` è true se la sequenza è terminata.
export function advanceClock(clock, workout, now = Date.now()) {
  const done = [];
  let state = clock;
  let finished = false;
  while (state && state.running && remainingMs(state, now) === 0) {
    const endAt = state.startedAt + state.duration - state.elapsed;
    if (state.phase === 'exercise') {
      done.push({ index: state.index, seconds: Math.round(state.duration / 1000), at: endAt });
      state = afterExercise(workout, state, endAt);
      if (!state) finished = true;
    } else {
      state = startExercise(workout, state.index, endAt);
    }
  }
  return { clock: state, done, finished };
}

// «Fatto»: l'esercizio conta per il tempo fatto davvero, poi parte la pausa.
export function finishExercise(clock, workout, now = Date.now()) {
  const elapsed = clock.duration - remainingMs(clock, now);
  const done = [{ index: clock.index, seconds: Math.max(1, Math.round(elapsed / 1000)), at: now }];
  const next = afterExercise(workout, clock, now);
  return { clock: next, done, finished: !next };
}

// −5 s / +5 s sulla pausa; «Inizia ora» la chiude subito.
export function adjustPause(clock, deltaSeconds, now = Date.now()) {
  const remaining = Math.max(0, remainingMs(clock, now) + deltaSeconds * 1000);
  return { ...clock, duration: clock.duration - remainingMs(clock, now) + remaining };
}

export function skipPause(clock, workout, now = Date.now()) {
  return startExercise(workout, clock.index, now);
}

// Fasi in arrivo per il servizio nativo (vibrazione a schermo spento): finché nessuno
// tocca nulla la sequenza è prevedibile, quindi si calcolano tutte le fini.
export function upcomingPhases(clock, workout, now = Date.now()) {
  const phases = [];
  let state = clock;
  let at = now;
  while (state && state.running && phases.length < 2 * workout.exercises.length) {
    const endsAt = at + remainingMs(state, at);
    const exercise = workout.exercises[state.index];
    phases.push({
      endsAt,
      title: state.phase === 'exercise' ? exercise.title : `Pausa · prossimo ${exercise.title}`,
      detail: `${clockText(exercise.seconds)} · ${exerciseMeta(exercise)}`,
      pause: state.phase === 'pause',
    });
    state = state.phase === 'exercise' ? afterExercise(workout, state, endsAt) : startExercise(workout, state.index, endsAt);
    at = endsAt;
  }
  return phases;
}

export function loadClock(storage) {
  try {
    const value = JSON.parse(storage.getItem(PILATES_CLOCK_KEY));
    if (value && typeof value.workoutId === 'string' && Number.isInteger(value.index)
      && ['exercise', 'pause'].includes(value.phase) && Number.isFinite(value.duration)) return value;
  } catch { /* Nessun timer da riprendere. */ }
  return null;
}

// ——— Costanza: giorni e settimane di fila ——————————————————————————————————————
const DAY = 86_400_000;
const dayStart = (time) => { const date = new Date(time); date.setHours(0, 0, 0, 0); return date.getTime(); };
const weekStartOf = (time) => {
  const date = new Date(dayStart(time));
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
};
const previousDay = (time) => { const date = new Date(time); date.setDate(date.getDate() - 1); return dayStart(date.getTime()); };
const previousWeek = (time) => { const date = new Date(time); date.setDate(date.getDate() - 7); return weekStartOf(date.getTime()); };

// Giorni consecutivi con almeno una sessione, fino a oggi (o fino a ieri se oggi è ancora libero).
export function daysInRow(sessions, now = Date.now()) {
  const days = new Set(sessions.map((item) => dayStart(item.endedAt)));
  let day = dayStart(now);
  if (!days.has(day)) day = previousDay(day);
  let count = 0;
  while (days.has(day)) { count += 1; day = previousDay(day); }
  return count;
}

export function weeksInRow(sessions, now = Date.now()) {
  const weeks = new Set(sessions.map((item) => weekStartOf(item.endedAt)));
  let week = weekStartOf(now);
  if (!weeks.has(week)) week = previousWeek(week);
  let count = 0;
  while (weeks.has(week)) { count += 1; week = previousWeek(week); }
  return count;
}

export const sessionMinutes = (session) => Math.max(0, (session.endedAt - session.startedAt) / 60_000);

export function weekMinutes(sessions, now = Date.now()) {
  const start = weekStartOf(now);
  return Math.round(sessions.filter((item) => item.endedAt >= start && item.endedAt <= now).reduce((sum, item) => sum + sessionMinutes(item), 0));
}

// ——— Traguardi ————————————————————————————————————————————————————————————————
// Settimane di fila (2, 3, 4…), minuti totali (100, 250, 500, 1000, poi ogni 1000)
// e il primo esercizio di livello 3.
export function minuteThresholds(upTo) {
  const list = [100, 250, 500, 1000];
  while (list.at(-1) < upTo) list.push(list.at(-1) + 1000);
  return list;
}

export function milestones({ before, session, now = session.endedAt }) {
  const after = [...before, session];
  const found = [];
  const weeksAfter = weeksInRow(after, now);
  const weeksBefore = weeksInRow(before, now);
  if (weeksAfter >= 2 && weeksAfter > weeksBefore) found.push({ kind: 'weeks', title: `${weeksAfter} settimane di fila` });
  const totalBefore = before.reduce((sum, item) => sum + sessionMinutes(item), 0);
  const totalAfter = totalBefore + sessionMinutes(session);
  const crossed = minuteThresholds(totalAfter).filter((value) => value > totalBefore && value <= totalAfter).at(-1);
  if (crossed) found.push({ kind: 'minutes', title: `${crossed.toLocaleString('it-IT')} minuti totali` });
  const level3Before = before.some((item) => (item.summary?.exercises ?? []).some((row) => row.level === 3 && row.seconds > 0));
  const level3Now = (session.summary?.exercises ?? []).some((row) => row.level === 3 && row.seconds > 0);
  if (level3Now && !level3Before) found.push({ kind: 'level', title: 'Primo esercizio di livello 3' });
  return found;
}

// ——— Riepilogo di fine sessione ————————————————————————————————————————————————
// `done`: per esercizio il tempo fatto oggi ({ seconds, level }) o null.
// `history`: per esercizio le volte precedenti (per «↑ livello»).
// `sessions`: le sessioni Pilates già finite (prima di questa).
export function pilatesSummary({ workout, done, history, sessions, startedAt, endedAt }) {
  const exercises = workout.exercises.map((exercise, index) => {
    const today = done[index];
    const lastLevel = history[index]?.filter((entry) => entry.rows[0]?.level).at(-1)?.rows[0].level ?? null;
    return {
      title: exercise.title, equipment: exercise.equipment,
      seconds: today?.seconds ?? 0, planned: exercise.seconds, level: today?.level ?? exercise.level,
      levelUp: !!today && lastLevel !== null && (today.level ?? exercise.level) > lastLevel,
    };
  });
  const doneCount = exercises.filter((item) => item.seconds > 0).length;
  const session = { startedAt, endedAt, summary: { exercises } };
  const thisWeek = weekMinutes([...sessions, session], endedAt);
  const lastWeekEnd = weekStartOf(endedAt) - 1;
  const lastWeek = weekMinutes(sessions, lastWeekEnd);
  return {
    mode: 'pilates',
    startedAt,
    endedAt,
    duration: endedAt - startedAt,
    minutes: Math.round((endedAt - startedAt) / 60_000),
    exercisesDone: doneCount,
    exercisesTotal: exercises.length,
    weekMinutes: thisWeek,
    previousWeekMinutes: lastWeek,
    weekDelta: thisWeek - lastWeek,
    daysInRow: daysInRow([...sessions, session], endedAt),
    equipment: [...new Set(exercises.filter((item) => item.seconds > 0).map((item) => item.equipment))],
    milestones: milestones({ before: sessions, session }).map(({ title, kind }) => ({ title, kind })),
    exercises,
  };
}

// Numero della settimana ISO («Sett. 42»).
export function isoWeek(time) {
  const date = new Date(dayStart(time));
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const firstThursday = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date - firstThursday) / DAY - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
}

// Conferma di fine sessione: esercizi fatti, minuti di pratica e quelli mancanti (niente serie).
export function endSessionCheck(workout, logs) {
  const done = workout.exercises.map((exercise, index) => (logs[index]?.[0]?.seconds ?? 0));
  const missing = workout.exercises.filter((exercise, index) => !done[index]).map((exercise) => exercise.title);
  const list = missing.length > 1 ? `${missing.slice(0, -1).join(', ')} e ${missing.at(-1)}` : missing[0];
  return {
    done: done.filter(Boolean).length,
    total: workout.exercises.length,
    minutes: Math.round(done.reduce((sum, value) => sum + value, 0) / 60),
    complete: missing.length === 0,
    warning: missing.length ? `Mancano ${list}. Gli esercizi fatti vengono salvati lo stesso.` : '',
  };
}
