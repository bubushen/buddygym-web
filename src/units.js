// Unità di peso per visualizzazione e inserimento: i dati restano SEMPRE in kg
// (localStorage, Supabase, storico, record, post, misure, profilo). L'unità è solo
// un fatto di schermo, quindi queste funzioni sono pure e ricevono `unit` come parametro.
import { thousands } from './format.js';

// 1 lb = 0,45359237 kg (esatto).
export const LB_IN_KG = 0.45359237;

export const unitLabel = (unit) => (unit === 'lb' ? 'lb' : 'kg');

// Numero nell'unità scelta: 100 kg → 220,462… lb.
export function toDisplay(kg, unit) {
  const value = Number(String(kg ?? '').replace(',', '.'));
  return unit === 'lb' ? value / LB_IN_KG : value;
}

// Numero già convertito e arrotondato per la visualizzazione:
// - kg: valore invariato (comportamento identico a prima).
// - lb, carico singolo: al massimo 1 decimale (220,5).
// - lb, volume (somma kg × ripetizioni): numero intero (3.307).
export function displayNumber(kg, unit, { volume = false } = {}) {
  const value = toDisplay(kg, unit);
  if (unit === 'kg') return value;
  if (volume) return Math.round(value);
  return Math.round(value * 10) / 10;
}

// Quello che l'utente scrive (anche con la virgola decimale) in kg, SENZA arrotondare:
// così 225 lb riaprono a 225. Convenzione esistente: vuoto = vuoto, «0» = 0 (corpo libero).
export function fromInput(value, unit) {
  const clean = String(value ?? '').trim();
  if (clean === '') return '';
  const number = Number(clean.replace(',', '.'));
  if (!Number.isFinite(number)) return '';
  return unit === 'lb' ? number * LB_IN_KG : number;
}

// «100 kg» o «220,5 lb»: in lb al massimo 1 decimale. In kg è identico al formato attuale.
export function formatWeight(kg, unit, { decimals } = {}) {
  const value = displayNumber(kg, unit);
  const rounded = decimals === undefined ? value : Math.round(value * 10 ** decimals) / 10 ** decimals;
  return `${thousands(rounded)} ${unitLabel(unit)}`;
}

// Arrotonda un carico suggerito al passo comodo dell'unità (0,25 kg o 1 lb) e lo torna in kg.
export function roundIncrement(kg, unit) {
  if (unit === 'lb') return Math.round(toDisplay(kg, 'lb')) * LB_IN_KG;
  return Math.round(Number(kg) / 0.25) * 0.25;
}
