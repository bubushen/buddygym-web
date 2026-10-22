// Analisi video: le quattro schermate del percorso (carica, analisi in corso,
// video analizzato, risultato). Nessuna logica di analisi vive qui: i dati
// arrivano già calcolati tramite props. Stili in src/ui/components.css (blocco .bg-va-).
import { button, el, link, topBar } from '../ui/components.js';
import { icon } from '../ui/icons.js';

// «18» → «0:18». Solo minuti e secondi, come il tempo mostrato nel player.
function clock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// ——— 1 · Carica il video —————————————————————————————————————————————————————————
// Due modi per scegliere il video (registrazione o galleria) e i consigli per una
// ripresa utile. I pulsanti grandi affiancati: primario per registrare, outline per la galleria.
export function renderAnalysisUpload(root, { exerciseTitle, onBack, onRecord, onGallery }) {
  const bigAction = (label, iconName, variant, onClick) => el('button', {
    type: 'button',
    className: `bg-va-action bg-va-action--${variant}`,
    onClick,
  }, icon(iconName), el('span', { text: label }));

  const tips = [
    ['Inquadratura di lato', 'il braccio che lavora verso la camera'],
    ['Corpo intero o dalla testa ai fianchi', 'nessuna parte tagliata'],
    ['Telefono fermo', 'appoggiato, all’altezza del petto'],
    ['Da 1 a 12 ripetizioni', 'massimo 60 secondi'],
  ];

  root.replaceChildren(
    topBar({ title: 'Analisi video', onBack }),
    el('main', {},
      el('div', { className: 'bg-va-head' },
        el('p', { className: 'bg-va-over', text: exerciseTitle }),
        el('h1', { text: 'Carica il tuo video' })),
      el('div', { className: 'bg-va-actions' },
        bigAction('Registra ora', 'video', 'primary', onRecord),
        bigAction('Dalla galleria', 'upload', 'outline', onGallery)),
      el('h2', { className: 'bg-section', text: 'Per un’analisi precisa' }),
      el('ul', { className: 'bg-va-tips' }, tips.map(([title, detail]) => el('li', { className: 'bg-va-tip' },
        icon('check', { small: true }),
        el('span', {}, el('b', { text: title }), el('small', { text: detail }))))),
      el('p', { className: 'bg-note', text: 'Il video resta privato: lo vedi solo tu (e il tuo coach, se condividi il risultato).' })));
}

// ——— 2 · Analisi in corso —————————————————————————————————————————————————————————
// `preview` è un elemento già collegato (video o canvas): va nel riquadro in alto.
// Restituisce { update } per aggiornare barra, passi ed eventuale errore.
export function renderAnalysisProgress(root, { preview, onBack, onRetry }) {
  const fill = el('i', { className: 'bg-va-bar__fill' });
  const bar = el('div', {
    className: 'bg-va-bar', role: 'progressbar',
    'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0',
    'aria-label': 'Avanzamento dell’analisi',
  }, fill);
  const stepsList = el('ul', { className: 'bg-va-steps' });
  const warn = el('div', { className: 'bg-va-warn', hidden: true });
  const retry = button({ label: 'Riprova', onClick: onRetry });
  retry.hidden = true;

  const stepNode = (step) => el('li', { className: `bg-va-step${step.done ? ' bg-va-step--done' : ''}` },
    el('span', { className: 'bg-va-step__mark', 'aria-hidden': 'true' }, step.done ? icon('check', { small: true }) : null),
    el('span', { text: step.label }));

  root.replaceChildren(
    topBar({ title: 'Analisi video', onBack }),
    el('main', {},
      fitToVideo(el('div', { className: 'bg-va-preview' }, preview ?? null), preview),
      el('div', { className: 'bg-va-head bg-va-head--progress' },
        el('h1', { text: 'Sto analizzando…' }),
        el('p', { className: 'bg-va-sub', text: 'Tieni l’app aperta: ci vuole circa un minuto.' })),
      bar,
      stepsList,
      warn,
      retry));

  const state = { progress: 0, steps: [], error: null };
  const update = ({ progress = state.progress, steps = state.steps, error = state.error } = {}) => {
    state.progress = progress;
    state.steps = steps;
    state.error = error;
    const failed = !!error;
    bar.hidden = failed;
    stepsList.hidden = failed;
    warn.hidden = !failed;
    retry.hidden = !failed;
    if (failed) {
      warn.replaceChildren(
        el('b', { text: error.title }),
        error.advice ? el('span', { text: error.advice }) : null);
    }
    const percent = Math.round(Math.max(0, Math.min(1, Number(progress) || 0)) * 100);
    fill.style.width = `${percent}%`;
    bar.setAttribute('aria-valuenow', String(percent));
    stepsList.replaceChildren(...(steps ?? []).map(stepNode));
  };
  update();
  return { update };
}

// ——— 3 · Video analizzato —————————————————————————————————————————————————————————
// Casella di una ripetizione, riusata anche nel risultato. `clean` decide olive o
// warning; la selezionata ha l'anello scuro (aria-pressed).
export function repBoxes(reps, selected, onSelect) {
  return el('div', { className: 'bg-va-reps' }, (reps ?? []).map((rep) => el('button', {
    type: 'button',
    className: `bg-va-rep${rep.clean === false ? ' bg-va-rep--warn' : ''}`,
    dataset: { index: String(rep.index) },
    'aria-label': `Ripetizione ${rep.index}, ${rep.clean === false ? 'da migliorare' : 'pulita'}`,
    'aria-pressed': rep.index === selected ? 'true' : 'false',
    onClick: () => onSelect?.(rep.index),
  }, String(rep.index))));
}

// Il riquadro prende le proporzioni del video (spesso verticale): niente tagli, e il
// tracciamento disegnato sul canvas resta allineato al corpo.
function fitToVideo(box, media) {
  const apply = () => { if (media.videoWidth && media.videoHeight) { box.style.setProperty('--va-ratio', `${media.videoWidth} / ${media.videoHeight}`); box.style.setProperty('--va-ratio-n', media.videoWidth); box.style.setProperty('--va-ratio-d', media.videoHeight); } };
  if (media?.tagName === 'VIDEO') { apply(); media.addEventListener('loadedmetadata', apply); }
  return box;
}

// Player con tracciamento: il video è senza controlli nativi, i comandi sono qui sotto.
// Restituisce { select } per spostare la selezione (e l'avviso) dalla barra ripetizioni.
export function renderAnalysisPlayer(root, { title, video, canvas, reps, selected, warning, onSelect, onBack, onResult }) {
  const stage = fitToVideo(el('div', { className: 'bg-va-stage' }, video ?? null, canvas ?? null), video);

  const playBtn = el('button', {
    type: 'button', className: 'bg-va-play', 'aria-label': 'Riproduci',
    onClick: () => { if (video) { if (video.paused) video.play(); else video.pause(); } },
  }, icon('play'));
  const syncPlay = () => {
    if (!video) return;
    playBtn.replaceChildren(icon(video.paused ? 'play' : 'pause'));
    playBtn.setAttribute('aria-label', video.paused ? 'Riproduci' : 'Metti in pausa');
  };
  video?.addEventListener('play', syncPlay);
  video?.addEventListener('pause', syncPlay);

  const time = el('span', { className: 'bg-va-time', text: clock(video?.currentTime) });
  const seek = el('input', {
    className: 'bg-va-seek', type: 'range', min: '0', max: '100', step: '0.1', value: '0',
    'aria-label': 'Posizione del video',
  });
  let seeking = false;
  seek.addEventListener('input', () => {
    seeking = true;
    if (video?.duration) video.currentTime = (Number(seek.value) / 100) * video.duration;
  });
  seek.addEventListener('change', () => { seeking = false; });
  video?.addEventListener('timeupdate', () => {
    if (!video.duration) return;
    if (!seeking) seek.value = String((video.currentTime / video.duration) * 100);
    time.textContent = clock(video.currentTime);
  });
  video?.addEventListener('loadedmetadata', () => { time.textContent = clock(video.currentTime); });

  let rate = 0.5;
  if (video) video.playbackRate = rate;
  const speed = el('button', {
    type: 'button', className: 'bg-va-speed', text: '0,5×',
    'aria-label': 'Velocità di riproduzione: 0,5×',
    onClick: () => {
      rate = rate === 0.5 ? 1 : 0.5;
      if (video) video.playbackRate = rate;
      const label = rate === 0.5 ? '0,5×' : '1×';
      speed.textContent = label;
      speed.setAttribute('aria-label', `Velocità di riproduzione: ${label}`);
    },
  });

  let currentWarning = warning;
  const boxes = repBoxes(reps, selected, onSelect);
  const warn = el('div', { className: 'bg-va-warn', hidden: true });
  const setWarning = (value) => {
    currentWarning = value;
    warn.hidden = !value;
    if (value) warn.replaceChildren(el('b', { text: value.title }), value.hint ? el('span', { text: value.hint }) : null);
  };
  setWarning(warning);

  root.replaceChildren(
    topBar({ title, onBack }),
    el('main', {},
      stage,
      el('div', { className: 'bg-va-controls' }, playBtn, seek, time, speed),
      el('h2', { className: 'bg-section', text: 'Ripetizioni · tocca per saltare' }),
      boxes,
      warn,
      el('div', { className: 'bg-va-foot' }, button({ label: 'Vedi il risultato', onClick: onResult }))));

  syncPlay();
  return {
    select(index, nextWarning = currentWarning) {
      for (const box of boxes.children) box.setAttribute('aria-pressed', box.dataset.index === String(index) ? 'true' : 'false');
      setWarning(nextWarning);
    },
  };
}

// ——— 4 · Risultato ————————————————————————————————————————————————————————————————
// Riassunto senza numeri tecnici: ripetizioni pulite, cosa va bene, cosa migliorare.
export function renderAnalysisResult(root, { overline, result, onBack, onRep, onWatch, onReplay, onShare }) {
  const reps = result.reps ?? [];
  const total = result.total ?? reps.length;
  const good = result.good ?? [];
  const improve = result.improve ?? [];

  const goodList = el('ul', { className: 'bg-va-good' }, good.map((item) => el('li', {},
    icon('check', { small: true }),
    el('span', {}, el('b', { text: item.title }), item.detail ? el('small', { text: item.detail }) : null))));

  const improveList = el('ul', { className: 'bg-va-improve' }, improve.map((item) => el('li', {},
    el('span', { className: 'bg-va-improve__dot', 'aria-hidden': 'true' }),
    el('span', {}, el('b', { text: item.title }), item.detail ? el('small', { text: item.detail }) : null),
    onWatch ? el('span', { className: 'bg-va-improve__go' }, link({ label: 'Guarda', onClick: () => onWatch(item.at) })) : null)));

  const sections = [];
  if (good.length) sections.push(el('h2', { className: 'bg-section', text: 'Cosa va bene' }), goodList);
  if (improve.length) sections.push(el('h2', { className: 'bg-section', text: 'Da migliorare' }), improveList);

  root.replaceChildren(
    topBar({ title: 'Risultato', onBack }),
    el('main', {},
      el('p', { className: 'bg-va-over bg-va-over--head', text: overline }),
      el('div', { className: 'bg-va-score' },
        el('b', { text: String(result.clean) }),
        el('span', { text: `su ${total} ripetizioni pulite` })),
      repBoxes(reps, result.selected ?? null, onRep),
      ...sections,
      el('div', { className: 'bg-va-foot bg-va-foot--result' },
        onReplay ? button({ label: 'Rivedi il video', onClick: onReplay }) : null,
        onShare ? button({ label: 'Condividi col coach', variant: 'outline', onClick: onShare }) : null)));
}
