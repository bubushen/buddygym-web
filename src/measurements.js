// Dati corporei della pagina Account: definizioni, storico su Supabase e grafico.

export const METRICS = [
  { id: 'peso', group: 0, label: 'Peso', unit: 'kg', chart: true, hint: 'Pesati al mattino, a digiuno.' },
  { id: 'altezza', group: 0, label: 'Altezza', unit: 'cm', chart: false, hint: 'Senza scarpe.' },
  { id: 'petto', group: 1, label: 'Petto', unit: 'cm', chart: true, hint: 'Sotto le ascelle, all\'altezza dei capezzoli.' },
  { id: 'addome', group: 1, label: 'Addome', unit: 'cm', chart: true, hint: 'All\'altezza dell\'ombelico, a fine espirazione.' },
  { id: 'braccio', group: 1, label: 'Braccio', unit: 'cm', chart: true, hint: 'Bicipite contratto, sempre lo stesso lato.' },
  { id: 'quadricipite', group: 1, label: 'Quadricipite', unit: 'cm', chart: true, hint: 'A metà coscia, sempre lo stesso lato.' },
  { id: 'polpaccio', group: 1, label: 'Polpaccio', unit: 'cm', chart: true, hint: 'Nel punto più largo, in piedi.' },
];

const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

export const formatValue = (value) => value.toLocaleString('it-IT', { maximumFractionDigits: 1 });
export const monthLabel = (date) => MONTHS[new Date(date).getMonth()];

// «79,4» o «79.4» → 79.4; null se non è un valore valido (come nel database).
export function parseMeasure(text) {
  const clean = String(text ?? '').trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const value = Math.round(Number(clean) * 10) / 10;
  return value > 0 && value <= 1000 ? value : null;
}

// Disegno del grafico in coordinate SVG 300×84, come nel design system.
export function chartModel(points) {
  if (points.length < 2) return null;
  const W = 300; const H = 84; const L = 30; const T = 6; const B = 18;
  const values = points.map((point) => point.value);
  const low = Math.min(...values); const high = Math.max(...values);
  let min = low; let max = high;
  if (max === min) { max += 1; min -= 1; }
  const pad = (max - min) * 0.15; min -= pad; max += pad;
  const x = (index) => L + index * (W - L - 8) / (points.length - 1);
  const y = (value) => T + (H - T - B) * (1 - (value - min) / (max - min));
  const delta = Math.round((values.at(-1) - values[0]) * 10) / 10;
  return {
    width: W, height: H, left: L, base: H - B,
    points: points.map((point, index) => ({ x: x(index), y: y(point.value), label: monthLabel(point.at) })),
    high: { value: high, y: y(high) + 3 },
    low: { value: low, y: y(low) + 3 },
    since: monthLabel(points[0].at),
    delta,
  };
}

export async function loadMeasurements(client, userId) {
  const { data, error } = await client.from('buddy_measurements')
    .select('metric,value,measured_at').eq('user_id', userId).order('measured_at', { ascending: true });
  if (error) throw error;
  const byMetric = Object.fromEntries(METRICS.map((metric) => [metric.id, []]));
  for (const row of data) byMetric[row.metric]?.push({ value: Number(row.value), at: row.measured_at });
  return byMetric;
}

export async function addMeasurement(client, userId, metric, value) {
  const { data, error } = await client.from('buddy_measurements')
    .insert({ user_id: userId, metric, value }).select('value,measured_at').single();
  if (error) throw error;
  return { value: Number(data.value), at: data.measured_at };
}
