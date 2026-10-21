// ProfileScreen: profilo, dati corporei con storico (MetricRow) e azioni dell'account.
import { button, el, topBar } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { METRICS, chartModel, formatValue, parseMeasure } from '../measurements.js';
import { ageFromBirthDate, birthDateProblem } from '../account-rules.js';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attributes, text) => {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
};

// Una sola riga aperta per volta, anche dopo un nuovo disegno della pagina.
let openId = null;

function chart(metric, history) {
  if (history.length < 2) {
    return el('div', { className: 'bg-chart' }, el('p', { className: 'bg-chart__empty', text: history.length
      ? 'Salva un\'altra misura per vedere l\'andamento.'
      : 'Salva la prima misura: da quella successiva vedrai il grafico.' }));
  }
  const model = chartModel(history);
  // Neutro di proposito: la freccia dice solo la direzione, senza rosso o verde.
  const delta = model.delta === 0
    ? el('span', { className: 'bg-chart__delta', text: 'stabile' })
    : el('span', { className: 'bg-chart__delta' }, icon(model.delta > 0 ? 'arrowUp' : 'arrowDown', { small: true }),
      `${model.delta > 0 ? '+' : '−'}${formatValue(Math.abs(model.delta))} ${metric.unit}`);
  const drawing = svg('svg', { viewBox: `0 0 ${model.width} ${model.height}`, role: 'img', 'aria-label': `Andamento ${metric.label}` });
  const coords = model.points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`);
  const last = model.points.at(-1);
  drawing.append(
    svg('line', { class: 'bg-chart__grid', x1: model.left, x2: model.width, y1: model.base, y2: model.base }),
    svg('text', { class: 'bg-chart__y', x: 0, y: model.high.y }, formatValue(model.high.value)),
    svg('text', { class: 'bg-chart__y', x: 0, y: model.low.y }, formatValue(model.low.value)),
    svg('path', { class: 'bg-chart__area', d: `M${model.points[0].x},${model.base} L${coords.join(' L')} L${last.x},${model.base} Z` }),
    svg('polyline', { class: 'bg-chart__line', points: coords.join(' '), pathLength: 1 }),
    ...model.points.flatMap((point) => [
      svg('circle', point === last
        ? { class: 'bg-chart__last', cx: point.x, cy: point.y, r: 5 }
        : { class: 'bg-chart__dot', cx: point.x, cy: point.y, r: 3.5 }),
      svg('text', { class: 'bg-chart__x', x: point.x, y: model.height, 'text-anchor': 'middle' }, point.label),
    ]));
  return el('div', { className: 'bg-chart' },
    el('div', { className: 'bg-chart__head' }, el('span', { text: `Da ${model.since} · ${history.length} misure` }), delta),
    drawing);
}

function value(current, unit) {
  return current === undefined
    ? el('span', { className: 'bg-metric__value bg-metric__value--empty', text: 'Aggiungi' })
    : el('span', { className: 'bg-metric__value' }, current === null ? '…' : formatValue(current), el('small', { text: unit }));
}

// Riga apribile: nome e ultimo valore; aperta mostra suggerimento, campo + Salva e grafico.
function metricRow({ id, label, unit, hint, current, input, onSave, extra, rerender }) {
  const open = openId === id;
  const panelId = `metric-${id}`;
  const status = el('p', { className: 'bg-metric__hint', role: 'status', hidden: true });
  const form = el('form', { className: 'bg-metric__edit', noValidate: true },
    el('label', { className: 'bg-field__box' }, input, unit ? el('span', { className: 'bg-field__unit', text: unit }) : null),
    button({ label: 'Salva', type: 'submit', block: false }));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button');
    submit.disabled = true;
    const problem = await onSave(input.value).finally(() => { submit.disabled = false; });
    if (problem) { status.textContent = problem; status.hidden = false; input.focus(); } else rerender();
  });
  return el('div', { className: `bg-metric${open ? ' bg-metric--open' : ''}`, dataset: { id } },
    el('button', {
      type: 'button', className: 'bg-metric__row', 'aria-expanded': String(open), 'aria-controls': panelId,
      onClick: () => { openId = open ? null : id; rerender(true); },
    }, el('span', { className: 'bg-metric__label', text: label }), value(current, unit), icon('chevronRight', { small: true, className: 'bg-metric__chev' })),
    el('div', { className: 'bg-metric__panel', id: panelId },
      el('p', { className: 'bg-metric__hint', text: hint }), form, status, extra));
}

function measureInput(metric, current) {
  return el('input', {
    inputmode: 'decimal', 'aria-label': `${metric.label} in ${metric.unit}`,
    placeholder: current ? formatValue(current) : '0', autocomplete: 'off',
  });
}

export function renderProfile(root, props) {
  const {
    alias, email, birthDate, measurements, status, canRunBench, privacy, onPrivacy,
    onBack, onChooseAlias, onSaveMeasure, onSaveBirthDate, onRetrySync, onExport, onImport, onBench, onDelete, onSignOut,
  } = props;
  const rerender = (focus) => {
    renderProfile(root, props);
    if (focus) root.querySelector('.bg-metric--open input')?.focus({ preventScroll: true });
  };

  const rows = (group) => METRICS.filter((metric) => metric.group === group).map((metric) => {
    const history = measurements?.[metric.id];
    const current = !measurements ? null : history.at(-1)?.value;
    return metricRow({
      ...metric, current, rerender,
      input: measureInput(metric, current),
      onSave: async (text) => {
        const parsed = parseMeasure(text);
        if (parsed === null) return `Scrivi un valore valido in ${metric.unit}, per esempio ${metric.unit === 'kg' ? '72,5' : '38'}.`;
        return onSaveMeasure(metric.id, parsed);
      },
      extra: metric.chart && measurements ? chart(metric, history) : null,
    });
  });

  // Età: si calcola dalla data di nascita; senza data si può aggiungere qui.
  const age = ageFromBirthDate(birthDate);
  const ageRow = birthDate
    ? el('div', { className: 'bg-metric' }, el('div', { className: 'bg-metric__row bg-metric__row--static' },
      el('span', { className: 'bg-metric__label' }, 'Età',
        el('span', { className: 'bg-metric__sub', text: `Dalla data di nascita · ${birthDate.split('-').reverse().join('/')}` })),
      value(age, 'anni')))
    : metricRow({
      id: 'eta', label: 'Età', hint: 'Inserisci la data di nascita: l\'età si calcola da sola. Non sarà visibile agli altri.',
      current: undefined, rerender,
      input: el('input', { type: 'date', 'aria-label': 'Data di nascita', max: new Date().toISOString().slice(0, 10), min: '1900-01-01', autocomplete: 'bday' }),
      onSave: async (text) => birthDateProblem(text) ?? onSaveBirthDate(text),
    });

  const importInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (file) await onImport(file);
  });
  // Azioni lente: il pulsante resta disattivato finché non finiscono.
  const action = (label, onClick, { danger = false } = {}) => el('div', { className: 'bg-metric' },
    el('button', {
      type: 'button', className: `bg-metric__row${danger ? ' bg-metric__row--danger' : ''}`,
      onClick: async (event) => {
        const target = event.currentTarget;
        target.disabled = true;
        try { await onClick(); } finally { target.disabled = false; }
      },
    }, el('span', { className: 'bg-metric__label', text: label }), icon('chevronRight', { small: true, className: 'bg-metric__chev' })));

  const name = alias
    ? el('h1', { className: 'bg-profile__name', text: alias })
    : el('h1', { className: 'bg-profile__name' }, el('button', { type: 'button', className: 'bg-link bg-profile__choose', text: 'Scegli il tuo alias', onClick: onChooseAlias }));

  root.replaceChildren(
    topBar({ title: 'Account', onBack }),
    el('main', {},
      el('div', { className: 'bg-profile' },
        el('div', { className: 'bg-profile__avatar', 'aria-hidden': 'true', text: (alias || email || '?').charAt(0).toLocaleUpperCase('it') }),
        el('div', {}, name, el('p', { className: 'bg-profile__mail', text: email }))),
      props.modeSection ?? null,
      el('h2', { className: 'bg-section', text: 'Dati principali' }),
      el('div', { className: 'bg-metrics' }, ageRow, rows(0)),
      el('h2', { className: 'bg-section' }, 'Circonferenze ', el('span', { text: 'facoltative' })),
      el('div', { className: 'bg-metrics' }, rows(1)),
      // Cosa vedono gli amici nel Social. Le misure corporee non sono mai visibili.
      privacy ? [
        el('h2', { className: 'bg-section', text: 'Privacy con gli amici' }),
        el('div', { className: 'bg-metrics bg-metrics--toggles' },
          [['shareStats', 'Mostra le statistiche', 'Allenamenti e tempo in palestra'], ['shareLoads', 'Mostra i carichi', 'Volume, kg e record']].map(([key, label, hint]) => {
            const toggle = el('button', { type: 'button', className: 'bg-switch', role: 'switch', 'aria-checked': String(privacy[key]), 'aria-label': label });
            toggle.addEventListener('click', async () => {
              const value = toggle.getAttribute('aria-checked') !== 'true';
              toggle.setAttribute('aria-checked', String(value));
              toggle.disabled = true;
              if (!(await onPrivacy(key, value))) toggle.setAttribute('aria-checked', String(!value));
              toggle.disabled = false;
            });
            return el('div', { className: 'bg-toggle bg-toggle--row' }, el('span', {}, label, el('small', { text: hint })), toggle);
          })),
        el('p', { className: 'bg-section__note bg-section__note--after', text: 'Le misure corporee non sono mai visibili agli altri.' }),
      ] : null,
      el('h2', { className: 'bg-section', text: 'Dati e sincronizzazione' }),
      el('p', { className: 'bg-section__note', role: 'status', id: 'profileStatus', text: status }),
      el('div', { className: 'bg-metrics' },
        action('Riprova sincronizzazione', onRetrySync),
        action('Esporta i dati locali', onExport),
        action('Importa un backup', () => importInput.click()),
        canRunBench ? action('Prova modelli (versione di prova)', onBench) : null,
        action('Elimina account', onDelete, { danger: true })),
      importInput,
      el('div', { className: 'bg-authfoot' }, button({ label: 'Esci', variant: 'outline', onClick: onSignOut })),
      props.version ? el('p', { className: 'bg-note bg-note--center bg-version', text: props.version }) : null));
}
