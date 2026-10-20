// HistoryScreen: riepilogo del mese, filtri per scheda, calendario e lista per settimana.
import { appBar, button, el, emptyState, pageHead } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { formatDuration } from '../workout-summary.js';
import { thousands } from '../format.js';

const WEEKDAYS = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];
const monthName = (year, month) => new Intl.DateTimeFormat('it-IT', { month: 'long' }).format(new Date(year, month, 1));
const capitalized = (text) => text.charAt(0).toLocaleUpperCase('it') + text.slice(1);

function calendar({ year, month, days, today, onDay, onMonth }) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const count = new Date(year, month + 1, 0).getDate();
  const cells = [...WEEKDAYS.map((day) => el('span', { text: day, 'aria-hidden': 'true' })),
    ...Array.from({ length: offset }, () => el('i', { className: 'x', 'aria-hidden': 'true' }))];
  for (let day = 1; day <= count; day += 1) {
    const state = days.get(day);
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
    const className = [state ?? '', isToday ? 'today' : ''].filter(Boolean).join(' ');
    const label = `${day} ${monthName(year, month)}${state === 'pr' ? ', allenamento con record' : state ? ', allenamento' : ''}${isToday ? ', oggi' : ''}`;
    cells.push(state
      ? el('button', { type: 'button', className, 'aria-label': label, onClick: () => onDay(day), text: String(day) })
      : el('i', { className, 'aria-label': label, text: String(day) }));
  }
  return el('div', { className: 'bg-month' },
    el('div', { className: 'bg-month__head' },
      el('b', { text: `${capitalized(monthName(year, month))} ${year}` }),
      el('span', { className: 'bg-month__nav' },
        el('button', { type: 'button', 'aria-label': 'Mese precedente', onClick: () => onMonth(-1) }, '‹'),
        el('button', { type: 'button', 'aria-label': 'Mese successivo', onClick: () => onMonth(1) }, '›'))),
    el('div', { className: 'bg-cal' }, cells),
    el('div', { className: 'bg-legend' },
      el('span', {}, el('i', { className: 'bg-legend__on' }), 'allenamento'),
      el('span', {}, el('i', { className: 'bg-legend__pr' }), 'con record')));
}

function historyRow(session, onOpen) {
  const date = new Date(session.endedAt);
  const summary = session.summary ?? {};
  const records = summary.records?.length ?? 0;
  const exercises = summary.exercisesDone ?? 0;
  const sets = summary.sets ?? 0;
  return el('button', { type: 'button', className: 'bg-hrow', dataset: { day: String(date.getDate()) }, onClick: () => onOpen(session) },
    el('span', { className: 'bg-hrow__date' },
      el('b', { text: String(date.getDate()) }),
      el('span', { text: new Intl.DateTimeFormat('it-IT', { weekday: 'short' }).format(date) })),
    el('span', {},
      el('span', { className: 'bg-hrow__name' }, session.title,
        records ? el('span', { className: 'bg-trophy', 'aria-label': 'Record' }, icon('trophy')) : null),
      el('span', { className: 'bg-hrow__meta', text: `${exercises} ${exercises === 1 ? 'esercizio' : 'esercizi'} · ${sets} serie` })),
    el('span', { className: 'bg-hrow__vol' }, `${thousands(summary.volume ?? 0)} kg`,
      el('small', { text: formatDuration(session.endedAt - session.startedAt) })));
}

export function renderHistory(root, { view, year, month, titles, filter, initial, onAccount, onFilter, onMonth, onOpen, onEmpty }) {
  const records = view.records;
  const subtitle = `${view.count} ${view.count === 1 ? 'allenamento' : 'allenamenti'} a ${monthName(year, month)}${records ? ` · ${records} ${records === 1 ? 'record' : 'record'}` : ''}`;
  const list = el('div', {});
  const scrollTo = (day) => list.querySelector(`.bg-hrow[data-day="${day}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  for (const group of view.groups) {
    list.append(
      el('div', { className: 'bg-hgroup' }, group.label, el('span', { text: `${group.sessions.length} ${group.sessions.length === 1 ? 'allenamento' : 'allenamenti'}` })),
      el('div', { className: 'bg-exlist' }, group.sessions.map((session) => historyRow(session, onOpen))));
  }
  const nothingYet = !titles.length;
  root.replaceChildren(
    appBar({ initial, onAccount, showAdd: false, title: 'Storico' }),
    el('main', {},
      pageHead({ title: 'Storico', subtitle: nothingYet ? null : subtitle }),
      nothingYet
        ? el('div', { className: 'bg-form' }, emptyState('Il tuo primo allenamento apparirà qui.'), button({ label: 'Vai alle schede', onClick: onEmpty }))
        : [
          el('div', { className: 'bg-chips', role: 'group', 'aria-label': 'Filtra per scheda' },
            [null, ...titles].map((title) => el('button', {
              type: 'button', className: 'bg-fchip', 'aria-pressed': String(filter === title), onClick: () => onFilter(title),
            }, title ?? 'Tutte'))),
          calendar({ year, month, days: view.days, today: new Date(), onDay: scrollTo, onMonth }),
          view.count ? list : el('p', { className: 'bg-empty bg-empty--spaced', text: 'Nessun allenamento in questo mese.' }),
          el('div', { className: 'bg-exspacer bg-exspacer--form', 'aria-hidden': 'true' }),
        ]));
}
