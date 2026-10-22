// Analisi video salvate: solo il risultato, mai il video.
import { repList } from './rep-analysis.js';

export const ANALYSES_KEY = 'buddygym:video-analyses:v1';
const MAX_ANALYSES = 200;
const TABLE = 'buddy_video_analyses';

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanAnalysis(analysis) {
  if (!analysis || typeof analysis !== 'object' || !analysis.id) return null;
  return {
    id: analysis.id,
    exerciseTitle: analysis.exerciseTitle,
    workoutId: analysis.workoutId ?? null,
    exerciseId: analysis.exerciseId ?? null,
    analyzedAt: finiteOr(analysis.analyzedAt, 0),
    result: analysis.result,
  };
}

function sortRecent(list) {
  return [...list].sort((a, b) => finiteOr(b?.analyzedAt, 0) - finiteOr(a?.analyzedAt, 0));
}

export function loadAnalyses(storage) {
  try {
    const raw = storage?.getItem?.(ANALYSES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(cleanAnalysis).filter(Boolean);
  } catch {
    return [];
  }
}

export function saveAnalysis(storage, analysis) {
  const current = loadAnalyses(storage);
  const entry = cleanAnalysis(analysis);
  if (!entry) return current;
  const next = sortRecent([...current.filter((item) => item.id !== entry.id), entry]).slice(0, MAX_ANALYSES);
  try {
    storage?.setItem?.(ANALYSES_KEY, JSON.stringify(next));
  } catch {
    // Quota piena o storage non disponibile: il risultato resta comunque in memoria.
  }
  return next;
}

export function analysesOnDay(list, dateKey) {
  if (!Array.isArray(list) || typeof dateKey !== 'string') return [];
  return list.filter((analysis) => {
    const at = Number(analysis?.analyzedAt);
    if (!Number.isFinite(at)) return false;
    const date = new Date(at);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return key === dateKey;
  });
}

export async function uploadAnalysis(client, userId, analysis) {
  const entry = cleanAnalysis(analysis);
  if (!entry) throw new Error('Analisi non valida.');
  const row = {
    user_id: userId,
    id: entry.id,
    exercise_title: entry.exerciseTitle,
    workout_id: entry.workoutId,
    exercise_id: entry.exerciseId,
    analyzed_at: entry.analyzedAt,
    result: entry.result,
    updated_at: new Date().toISOString(),
  };
  const { error } = await client.from(TABLE).upsert(row, { onConflict: 'user_id,id' });
  if (error) throw error;
  return entry;
}

export async function loadCloudAnalyses(client, userId) {
  const { data, error } = await client.from(TABLE)
    .select('id,exercise_title,workout_id,exercise_id,analyzed_at,result')
    .eq('user_id', userId)
    .order('analyzed_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    exerciseTitle: row.exercise_title,
    workoutId: row.workout_id ?? null,
    exerciseId: row.exercise_id ?? null,
    analyzedAt: finiteOr(row.analyzed_at, 0),
    result: row.result,
  }));
}

export function mergeAnalyses(local, remote) {
  const byId = new Map();
  for (const analysis of [...(Array.isArray(local) ? local : []), ...(Array.isArray(remote) ? remote : [])]) {
    const entry = cleanAnalysis(analysis);
    if (!entry) continue;
    const current = byId.get(entry.id);
    // A parità di analyzedAt resta il dato locale (già presente nella mappa).
    if (!current || entry.analyzedAt > current.analyzedAt) byId.set(entry.id, entry);
  }
  return sortRecent([...byId.values()]);
}

export function coachShareText(analysis, dateLabel) {
  const result = analysis?.result ?? {};
  const head = ['Analisi video', analysis?.exerciseTitle, dateLabel].filter(Boolean).join(' · ');
  const lines = [head, `${result.clean ?? 0} su ${result.total ?? 0} ripetizioni pulite`];
  const good = Array.isArray(result.good) ? result.good.filter((item) => item?.title) : [];
  if (good.length) lines.push(`Va bene: ${good.map((item) => item.title).join(', ')}`);
  const improve = Array.isArray(result.improve) ? result.improve : [];
  if (improve.length) {
    const parts = improve.map((item) => {
      const reps = Array.isArray(item?.reps) && item.reps.length
        ? repList(item.reps)
        : String(item?.detail ?? '').split(' · ')[0];
      return `${item?.title ?? ''}${reps ? ` (${reps})` : ''}`;
    }).filter(Boolean);
    if (parts.length) lines.push(`Da migliorare: ${parts.join(', ')}`);
  }
  return lines.join('\n').slice(0, 2000);
}
