// Schede assegnate dal coach a clienti reali: copia della scheda, unione con
// quelle del cliente e riepilogo dei progressi. Le regole di accesso stanno
// in supabase/coach-assignments.sql.
import { prescription } from './coach-data.js';
import { liftedRows } from './records.js';
import { validWorkout } from './workouts.js';

function ok(result) {
  if (result.error) throw result.error;
  return result.data;
}

// ── Funzioni pure ──────────────────────────────────────────────────────

// Copia indipendente del template nel formato della scheda (senza clientId).
// Gli id degli esercizi sono quelli del template: restano uguali tra un
// aggiornamento e l'altro, così lo storico del cliente non si perde.
export function assignmentWorkout(coachData, templateId, previous = null) {
  const template = coachData?.templates?.find((item) => item.id === templateId);
  if (!template || !template.exercises?.length) throw new Error('Aggiungi almeno un esercizio al template.');
  const workout = {
    title: template.title,
    mode: 'gym',
    exercises: template.exercises.map((item) => {
      const source = coachData.exercises?.find((exercise) => exercise.id === item.libraryId);
      if (!source) throw new Error('Un esercizio del template non è più disponibile.');
      return {
        id: item.id,
        libraryId: source.id,
        title: source.title,
        ...prescription(item),
        instructions: source.instructions,
        coachReference: structuredClone(source.reference),
      };
    }),
  };
  // `previous` serve solo a riusare un id valido per il controllo: la scheda
  // salvata non lo contiene, perché l'id è quello dell'assegnazione.
  const checkId = typeof previous?.id === 'string' ? previous.id : 'assignment';
  if (!validWorkout({ id: checkId, ...workout })) throw new Error('La scheda non è valida.');
  return workout;
}

// Scheda come la vede il cliente nella Home.
export function toClientWorkout(assignment, coachAlias) {
  if (!assignment || typeof assignment !== 'object') throw new Error('Assegnazione non trovata.');
  const source = assignment.workout ?? {};
  const workout = {
    id: assignment.id,
    title: source.title,
    mode: source.mode ?? 'gym',
    exercises: structuredClone(source.exercises ?? []),
    source: 'coach',
    coachAlias,
    assignmentVersion: assignment.version,
    linkId: assignment.link_id ?? null,
  };
  if (!validWorkout(workout)) throw new Error('La scheda assegnata non è valida.');
  return workout;
}

function lookupAlias(aliasByCoach, coach) {
  if (typeof aliasByCoach === 'function') return aliasByCoach(coach);
  if (aliasByCoach instanceof Map) return aliasByCoach.get(coach);
  return aliasByCoach && Object.prototype.hasOwnProperty.call(aliasByCoach, coach) ? aliasByCoach[coach] : undefined;
}

const aliasFor = (aliasByCoach, coach) => lookupAlias(aliasByCoach, coach) ?? 'Coach';

// Una scheda è del coach se lo dice la fonte o se porta la versione assegnata.
const isCoachCard = (workout) => workout.source === 'coach' || workout.assignmentVersion != null;

// Toglie i riferimenti al coach: la scheda rilasciata diventa del cliente.
function makeOwn(workout) {
  const own = { ...workout, source: 'own' };
  delete own.coachAlias;
  delete own.assignmentVersion;
  delete own.linkId;
  return own;
}

// Unisce le assegnazioni del coach alle schede locali. Le schede dell'utente
// non toccate restano com'erano; le nuove vengono aggiunte in coda.
export function mergeAssignedWorkouts(localWorkouts, assignments, aliasByCoach) {
  const locals = Array.isArray(localWorkouts) ? localWorkouts : [];
  const rows = Array.isArray(assignments) ? assignments.filter(Boolean) : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const localIds = new Set(locals.map((workout) => workout?.id).filter((id) => id != null));

  const workouts = locals.map((workout) => {
    if (!workout || typeof workout !== 'object') return workout;
    const assignment = byId.get(workout.id);

    if (!assignment) {
      // Il coach ha tolto la scheda: lo storico resta, la scheda non è più attiva.
      if (isCoachCard(workout) && workout.linkId) return { ...workout, deleted: true };
      return workout;
    }

    if (assignment.link_id === null) {
      if (!isCoachCard(workout)) return workout;
      const clientWorkout = toClientWorkout(assignment, aliasFor(aliasByCoach, assignment.coach));
      return makeOwn({
        ...workout,
        title: clientWorkout.title,
        mode: clientWorkout.mode,
        exercises: clientWorkout.exercises,
      });
    }

    if (!isCoachCard(workout)) return workout;
    if (Number(assignment.version ?? 0) > Number(workout.assignmentVersion ?? 0)) {
      const coachAlias = lookupAlias(aliasByCoach, assignment.coach) ?? workout.coachAlias ?? 'Coach';
      const clientWorkout = toClientWorkout(assignment, coachAlias);
      return {
        ...workout,
        title: clientWorkout.title,
        mode: clientWorkout.mode,
        exercises: clientWorkout.exercises,
        coachAlias: clientWorkout.coachAlias,
        assignmentVersion: clientWorkout.assignmentVersion,
        linkId: clientWorkout.linkId,
      };
    }
    return workout;
  });

  for (const assignment of rows) {
    if (localIds.has(assignment.id)) continue;
    const clientWorkout = toClientWorkout(assignment, aliasFor(aliasByCoach, assignment.coach));
    workouts.push(assignment.link_id === null ? makeOwn(clientWorkout) : clientWorkout);
  }

  // Le righe rilasciate vanno cancellate dal database dopo che la scheda è
  // diventata del cliente. L'ordine è quello delle assegnazioni, senza doppioni.
  const releasedIds = [];
  const seen = new Set();
  for (const assignment of rows) {
    if (assignment.link_id !== null || seen.has(assignment.id)) continue;
    seen.add(assignment.id);
    releasedIds.push(assignment.id);
  }

  return { workouts, releasedIds };
}

const numberOrNull = (value) => {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  const date = Date.parse(value);
  return Number.isFinite(date) ? date : null;
};

const rowList = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

const topSet = (rows) => {
  let top = null;
  for (const row of rows) {
    if (!top || row.load > top.load || (row.load === top.load && row.reps > top.reps)) top = row;
  }
  return top ? { load: top.load, reps: top.reps } : null;
};

const historyFields = (row) => ({
  workoutId: row?.workout_id ?? row?.workoutId,
  exerciseId: row?.exercise_id ?? row?.exerciseId,
  sessionId: row?.session_id ?? row?.sessionId,
  endedAt: numberOrNull(row?.ended_at ?? row?.endedAt),
  rows: rowList(row?.set_rows ?? row?.setRows ?? row?.rows),
});

// Riepilogo dei progressi per il coach: una voce per assegnazione, con le
// ultime cinque sedute e la serie migliore/ultima per ogni esercizio.
export function progressSummary(sessions, history, assignments) {
  const sessionRows = Array.isArray(sessions) ? sessions : [];
  const historyRows = Array.isArray(history) ? history : [];
  const assignmentRows = Array.isArray(assignments) ? assignments : [];

  const byExercise = new Map();
  for (const row of historyRows) {
    const fields = historyFields(row);
    if (fields.workoutId == null || fields.exerciseId == null) continue;
    const key = `${fields.workoutId}\u0000${fields.exerciseId}`;
    const entries = byExercise.get(key) ?? [];
    entries.push(fields);
    byExercise.set(key, entries);
  }

  return assignmentRows.map((assignment) => {
    const id = assignment.id ?? assignment.assignmentId;
    const source = typeof assignment.workout === 'string'
      ? (() => { try { return JSON.parse(assignment.workout); } catch { return null; } })()
      : assignment.workout;
    const title = source?.title ?? assignment.title ?? '';
    const exercises = source?.exercises ?? assignment.exercises ?? [];

    const mine = sessionRows
      .filter((session) => session && String(session.workout_id ?? session.workoutId) === String(id))
      .map((session) => {
        const startedAt = numberOrNull(session.started_at ?? session.startedAt);
        const endedAt = numberOrNull(session.ended_at ?? session.endedAt);
        const at = endedAt ?? startedAt;
        const durationMin = startedAt !== null && endedAt !== null && endedAt >= startedAt
          ? Math.max(0, Math.round((endedAt - startedAt) / 60000))
          : 0;
        return { at, durationMin };
      })
      .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));

    const exerciseSummaries = exercises.map((exercise) => {
      const key = `${id}\u0000${exercise.id}`;
      const entries = (byExercise.get(key) ?? []).slice()
        .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
      const allRows = entries.flatMap((entry) => liftedRows(entry.rows));
      let lastTop = null;
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        lastTop = topSet(liftedRows(entries[index].rows));
        if (lastTop) break;
      }
      return { title: exercise.title, best: topSet(allRows), lastTop };
    });

    return {
      assignmentId: id,
      title,
      lastAt: mine.length ? mine[0].at : null,
      count: mine.length,
      lastSessions: mine.slice(0, 5),
      exercises: exerciseSummaries,
    };
  });
}

// ── Supabase ───────────────────────────────────────────────────────────

const ASSIGNMENT_FIELDS = 'id,link_id,coach,client,workout,template_id,version,assigned_at,updated_at';

// Schede assegnate da me (coach) ai miei clienti.
export async function loadCoachAssignments(client, me) {
  return ok(await client.from('buddy_coach_assignments')
    .select(ASSIGNMENT_FIELDS)
    .eq('coach', me));
}

// Le mie schede da cliente, comprese quelle rilasciate dal coach.
export async function loadMyAssignments(client, me) {
  return ok(await client.from('buddy_coach_assignments')
    .select(ASSIGNMENT_FIELDS)
    .eq('client', me));
}

// Assegna una copia della scheda al cliente del legame.
export async function assignToClient(client, me, link, workout, templateId) {
  return ok(await client.from('buddy_coach_assignments').insert({
    link_id: link.id,
    coach: me,
    client: link.otherId,
    workout,
    template_id: templateId,
  }));
}

// Il database aggiorna versione e data da solo.
export async function updateAssignment(client, id, workout) {
  return ok(await client.from('buddy_coach_assignments').update({ workout }).eq('id', id));
}

export async function removeAssignment(client, id) {
  return ok(await client.from('buddy_coach_assignments').delete().eq('id', id));
}

// Cancella una riga rilasciata che il cliente ha ormai copiato tra le sue schede.
export async function deleteReleased(client, id) {
  return ok(await client.from('buddy_coach_assignments').delete().eq('id', id));
}

// Sedute e serie del cliente, limitate alle schede che gli ho assegnato.
export async function loadClientProgress(client, clientId, assignmentIds) {
  const ids = [...new Set((Array.isArray(assignmentIds) ? assignmentIds : []).filter((id) => id != null))];
  if (!ids.length) return { sessions: [], history: [] };
  const [sessions, history] = await Promise.all([
    client.from('buddy_sessions')
      .select('id,workout_id,workout_title,started_at,ended_at,summary')
      .eq('user_id', clientId)
      .in('workout_id', ids),
    client.from('buddy_exercise_history')
      .select('workout_id,exercise_id,session_id,started_at,ended_at,set_rows')
      .eq('user_id', clientId)
      .in('workout_id', ids),
  ]);
  return { sessions: ok(sessions), history: ok(history) };
}

let channelSeq = 0;
const nextChannel = () => `coach-assignments-${++channelSeq}-${Math.random().toString(36).slice(2)}`;

// Cambi alle mie schede assegnate (nuove, aggiornate o rilasciate).
export function subscribeMyAssignments(client, me, onChange) {
  const channel = client.channel(nextChannel())
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'buddy_coach_assignments', filter: `client=eq.${me}` },
      (payload) => { if (typeof onChange === 'function') onChange(payload); })
    .subscribe();
  return () => { if (channel) client.removeChannel(channel); };
}
