// HistoryScreen: calendario del mese e, sotto, solo gli allenamenti del giorno toccato.
// Mostra Palestra e Pilates insieme (filtro Tutto / Palestra / Pilates); le caselle hanno
// colori fissi in tutti i temi: verde palestra, rosa Pilates, metà e metà se entrambi.
import { appBar, el } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { formatDuration } from '../workout-summary.js';
import { thousands } from '../format.js';
import { liftText } from '../records.js';
import { displayNumber, toDisplay, unitLabel } from '../units.js';

const WEEKDAYS = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];
const FILTERS = [['all', 'Tutto'], ['gym', 'Palestra'], ['pilates', 'Pilates']];
const monthName = (year, month) => new Intl.DateTimeFormat('it-IT', { month: 'long' }).format(new Date(year, month, 1));
const capitalized = (text) => text.charAt(0).toLocaleUpperCase('it') + text.slice(1);
const longDay = (date) => capitalized(new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }).format(date));
const timeOf = (time) => new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' }).format(time);
const count = (value) => `${value} ${value === 1 ? 'allenamento' : 'allenamenti'}`;

function dayCell({ year, month, day, info, today, selected, titles, onDay }) {
  const kind = info ? (info.gym && info.pilates ? 'both' : info.gym ? 'gym' : 'pil') : null;
  const className = ['bg-day', kind ? `bg-day--${kind}` : '', info?.record ? 'bg-day--rec' : '', today ? 'bg-day--today' : ''].filter(Boolean).join(' ');
  const date = new Date(year, month, day);
  const label = `${longDay(date)}: ${titles.length ? titles.join(', ') : 'riposo'}${info?.record ? ', con record o traguardo' : ''}${today ? ', oggi' : ''}`;
  return el('button', { type: 'button', className, 'aria-pressed': String(selected), 'aria-label': label, onClick: () => onDay(day) },
    kind === 'both' ? el('b', { text: String(day) }) : String(day));
}

function sessionCard(session, onOpen, unit) {
  const pilates = session.mode === 'pilates';
  const summary = session.summary ?? {};
  const duration = formatDuration(session.endedAt - session.startedAt);
  const stats = pilates
    ? [['Durata', duration], ['Pratica', `${Math.round((session.endedAt - session.startedAt) / 60_000)} min`], ['Esercizi', String(summary.exercisesDone ?? 0)]]
    : [['Durata', duration], ['Volume', `${thousands(displayNumber(summary.volume ?? 0, unit, { volume: true }))} ${unitLabel(unit)}`], ['Esercizi', String(summary.exercisesDone ?? 0)]];
  const record = summary.records?.[0];
  const milestone = summary.milestones?.[0];
  const more = (list) => (list?.length > 1 ? ` · +${list.length - 1}` : '');
  return el('button', { type: 'button', className: 'bg-dcard', onClick: () => onOpen(session), 'aria-label': `${pilates ? 'Pilates' : 'Palestra'}, ${session.title}, ${timeOf(session.startedAt ?? session.endedAt)}: apri il riepilogo` },
    icon('chevronRight', { small: true, className: 'bg-dcard__chev' }),
    el('span', { className: 'bg-dcard__top' },
      el('span', { className: `bg-mtag bg-mtag--${pilates ? 'pil' : 'gym'}`, text: pilates ? 'Pilates' : 'Palestra' }),
      el('span', { text: timeOf(session.startedAt ?? session.endedAt) })),
    el('h3', { text: session.title }),
    el('div', { className: 'bg-dcard__stats' }, stats.map(([label, value]) => el('span', {}, label, el('b', { text: value })))),
    !pilates && record ? el('span', { className: 'bg-chip' }, icon('trophy', { small: true }), `Record · ${record.title} · ${liftText(record.load, record.reps, unit)}${more(summary.records)}`) : null,
    pilates && milestone ? el('span', { className: 'bg-chip' }, icon('star', { small: true }), `Traguardo · ${milestone.title}${more(summary.milestones)}`) : null);
}

function analysisCard(analysis, onOpen) {
  const result = analysis.result ?? {};
  const clean = result.clean ?? 0;
  const total = result.total ?? 0;
  return el('button', {
    type: 'button', className: 'bg-dcard', onClick: () => onOpen?.(analysis),
    'aria-label': `Analisi video, ${analysis.exerciseTitle}: ${clean} su ${total} ripetizioni pulite`,
  },
  icon('chevronRight', { small: true, className: 'bg-dcard__chev' }),
  el('span', { className: 'bg-dcard__top' },
    el('span', { className: 'bg-mtag bg-mtag--gym', text: 'Analisi video' }),
    el('span', { text: timeOf(new Date(analysis.analyzedAt)) })),
  el('h3', { text: analysis.exerciseTitle }),
  el('div', { className: 'bg-dcard__stats' },
    el('span', {}, 'Ripetizioni pulite', el('b', { text: `${clean} su ${total}` }))));
}

export function renderHistory(root, { year, month, day, filter, calendar, sessions, analyses = [], initial, onAccount, onFilter, onMonth, onDay, onOpen, onOpenAnalysis, unit = 'kg' }) {
  const now = new Date();
  const isThisMonth = now.getFullYear() === year && now.getMonth() === month;
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const total = new Date(year, month + 1, 0).getDate();
  const cells = [
    ...WEEKDAYS.map((name) => el('span', { 'aria-hidden': 'true', text: name })),
    ...Array.from({ length: offset }, () => el('span', { className: 'bg-day bg-day--empty', 'aria-hidden': 'true' })),
  ];
  for (let value = 1; value <= total; value += 1) {
    cells.push(dayCell({
      year, month, day: value, info: calendar.days.get(value), today: isThisMonth && now.getDate() === value,
      selected: value === day, titles: calendar.titles.get(value) ?? [], onDay,
    }));
  }
  const selectedDate = new Date(year, month, day);
  const isToday = isThisMonth && now.getDate() === day;
  const dayPanel = sessions.length
    ? [
      el('div', { className: 'bg-dayhead' }, el('h2', { text: longDay(selectedDate) }), el('span', { text: `${count(sessions.length)}${isToday ? ' · oggi' : ''}` })),
      el('div', { className: 'bg-daylist bg-focuslist' }, sessions.map((session) => sessionCard(session, onOpen, unit))),
    ]
    : [
      el('div', { className: 'bg-dayhead' }, el('h2', { text: longDay(selectedDate) }), el('span', { text: isToday ? 'oggi' : 'riposo' })),
      el('div', { className: 'bg-dayempty' }, el('b', { text: 'Nessun allenamento' }), 'Giorno di riposo. Tocca un giorno colorato per vedere cosa hai fatto.'),
    ];
  const analysisPanel = analyses.length
    ? [
      el('div', { className: 'bg-dayhead' }, el('h2', { text: 'Analisi video' }), el('span', { text: `${analyses.length} analisi` })),
      el('div', { className: 'bg-daylist bg-focuslist' }, analyses.map((analysis) => analysisCard(analysis, onOpenAnalysis))),
    ]
    : [];
  const panel = [...dayPanel, ...analysisPanel];
  const trainingDays = calendar.trainingDays;
  root.replaceChildren(
    appBar({ initial, onAccount, showAdd: false, title: 'Storico' }),
    el('main', {},
      el('div', { className: 'bg-chips', role: 'group', 'aria-label': 'Filtra per modalità' },
        FILTERS.map(([value, label]) => el('button', { type: 'button', className: 'bg-fchip', 'aria-pressed': String(filter === value), onClick: () => onFilter(value), text: label }))),
      el('div', { className: 'bg-month' },
        el('div', { className: 'bg-month__head' },
          el('b', { text: `${capitalized(monthName(year, month))} ${year}` }),
          el('span', { className: 'bg-month__nav' },
            el('span', { className: 'bg-month__count', text: `${trainingDays} ${trainingDays === 1 ? 'giorno' : 'giorni'} di allenamento` }),
            el('button', { type: 'button', 'aria-label': 'Mese precedente', onClick: () => onMonth(-1) }, '‹'),
            el('button', { type: 'button', 'aria-label': 'Mese successivo', onClick: () => onMonth(1) }, '›'))),
        el('div', { className: 'bg-cal2' }, cells),
        el('div', { className: 'bg-legend2' },
          el('span', {}, el('i', { className: 'bg-legend2__gym' }), 'Palestra'),
          el('span', {}, el('i', { className: 'bg-legend2__pil' }), 'Pilates'),
          el('span', {}, el('i', { className: 'bg-legend2__both' }), 'Entrambi'),
          el('span', { text: '● record o traguardo' }))),
      el('section', { 'aria-live': 'polite', 'aria-label': 'Allenamenti del giorno' }, panel),
      el('div', { className: 'bg-exspacer bg-exspacer--form', 'aria-hidden': 'true' })));
}
