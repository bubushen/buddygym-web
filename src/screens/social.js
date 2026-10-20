// Social: feed degli amici con classifica, post con commenti, profilo di un amico,
// trova amici e pannello Pubblica. Testi e struttura dai preview del design system.
import { appBar, button, el, emptyState, link, openSheet, textField, topBar } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { formatDuration } from '../workout-summary.js';
import { thousands } from '../format.js';

// Colore dell'avatar: il tuo è quello tenue, gli amici alternano lime e scuro (stabile per persona).
let currentMe = null;
export function setSocialUser(userId) { currentMe = userId; }
const VARIANTS = ['bg-av--b', 'bg-av--c'];
function avatar(userId, name, size = '') {
  const hash = [...String(userId)].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const variant = userId === currentMe ? '' : VARIANTS[hash % 2];
  return el('span', { className: ['bg-av', size, variant].filter(Boolean).join(' '), 'aria-hidden': 'true', text: (name || '?').charAt(0).toLocaleUpperCase('it') });
}

const timeOf = (date) => new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' }).format(date);
// «Oggi · 07:42», «Ieri · 19:05», «sab 17 ott · 07:42».
export function postWhen(iso, now = new Date()) {
  const date = new Date(iso);
  const day = (value) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diff = Math.round((day(now) - day(date)) / 86_400_000);
  const label = diff === 0 ? 'Oggi' : diff === 1 ? 'Ieri' : new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }).format(date);
  return `${label} · ${timeOf(date)}`;
}
// Data di un record: «oggi», «ieri», «12 ott».
function recordDate(time, now = new Date()) {
  const label = postWhen(new Date(time).toISOString(), now).split(' · ')[0];
  if (label === 'Oggi' || label === 'Ieri') return label.toLocaleLowerCase('it');
  return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' }).format(time);
}

// «2 h», «40 min», «ora», «3 g».
export function ago(iso, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'ora';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h` : `${Math.round(hours / 24)} g`;
}

function stats(post) {
  if (post.mode === 'pilates') {
    const items = [];
    if (post.stats.duration !== undefined) items.push(['Durata', formatDuration(post.stats.duration)], ['Esercizi', String(post.stats.exercises ?? 0)]);
    if (post.stats.equipment) items.push(['Attrezzo', post.stats.equipment]);
    if (!items.length) return null;
    return el('div', { className: `bg-post__stats${items.length === 2 ? ' bg-post__stats--two' : items.length === 1 ? ' bg-post__stats--one' : ''}` },
      items.map(([label, value]) => el('div', {}, el('span', { text: label }), el('b', { text: value }))));
  }
  const items = [['Durata', formatDuration(post.stats.duration ?? 0)]];
  if (post.showLoads && post.stats.volume !== undefined) items.push(['Volume', `${thousands(post.stats.volume)} kg`]);
  items.push(['Serie', String(post.stats.sets ?? 0)]);
  return el('div', { className: `bg-post__stats${items.length === 2 ? ' bg-post__stats--two' : ''}` },
    items.map(([label, value]) => el('div', {}, el('span', { text: label }), el('b', { text: value }))));
}

export function postCard(post, names, { onStrength, onComments, onOpen, onAuthor, onMenu, preview = true }) {
  const name = names.get(post.userId) ?? 'Utente';
  const pilates = post.mode === 'pilates';
  const records = post.showLoads && !pilates ? (post.stats.records ?? []) : [];
  const milestones = pilates ? (post.stats.milestones ?? []) : [];
  const last = post.comments.at(-1);
  const strength = el('button', {
    type: 'button', className: 'bg-post__act', 'aria-pressed': String(post.strengthByMe),
    'aria-label': `${post.strengthByMe ? 'Togli Forza' : 'Dai Forza'}, ${post.strength}`, onClick: onStrength,
  }, icon('bolt', { small: true }), `Forza · ${post.strength}`);
  return el('article', { className: 'bg-post' },
    el('div', { className: 'bg-post__head' },
      el('button', { type: 'button', className: 'bg-post__author', 'aria-label': `Profilo di ${name}`, onClick: onAuthor }, avatar(post.userId, name)),
      el('span', { className: 'bg-post__who' },
        el('button', { type: 'button', className: 'bg-post__name', onClick: onAuthor, text: post.mine ? 'Tu' : name }),
        el('span', { className: 'bg-post__when', text: `${postWhen(post.createdAt)} · ${pilates && post.stats.equipment ? post.stats.equipment : post.workoutTitle}${post.visibility === 'private' ? ' · solo io' : ''}` })),
      onMenu ? el('button', { type: 'button', className: 'bg-iconbtn bg-iconbtn--ghost', 'aria-label': 'Altre azioni', onClick: onMenu }, icon('more')) : null),
    el('button', { type: 'button', className: 'bg-post__open', onClick: onOpen, disabled: !onOpen },
      el('h3', { className: 'bg-post__title', text: post.title }),
      post.body ? el('p', { className: 'bg-post__text', text: post.body }) : null),
    stats(post),
    records.length ? el('div', { className: 'bg-post__chips' }, records.map((record) => el('span', { className: 'bg-chip' },
      icon('trophy', { small: true }), `${record.title} · ${thousands(record.load)} kg × ${record.reps}`))) : null,
    milestones.length ? el('div', { className: 'bg-post__chips' }, milestones.map((item) => el('span', { className: 'bg-chip' },
      icon('star', { small: true }), item.title))) : null,
    el('div', { className: 'bg-post__foot' }, strength,
      el('button', { type: 'button', className: 'bg-post__act', 'aria-label': `Commenti, ${post.comments.length}`, onClick: onComments ?? onOpen },
        icon('comment', { small: true }), String(post.comments.length))),
    preview && last ? el('p', { className: 'bg-post__comment' }, el('b', { text: names.get(last.user_id) ?? 'Utente' }), ` ${last.body}`) : null);
}

// Menu di azioni dal basso (… sui post, sul profilo, pressione lunga sui commenti).
export function openActions(label, actions) {
  const view = openSheet({
    label,
    content: el('div', { className: 'bg-sheet__body' },
      el('h2', { text: label }),
      el('div', { className: 'bg-sheet__actions' }, actions.map(({ text, danger, run }) => {
        const item = button({ label: text, variant: 'outline' });
        if (danger) item.classList.add('bg-btn--danger');
        item.addEventListener('click', () => { view.close(); run(); });
        return item;
      }), button({ label: 'Annulla', variant: 'outline', onClick: () => view.close() }))),
  });
  return view;
}

export function renderSocialFeed(root, { me, initial, leaderboard, notifications, requests = [], posts, names, status, onAccount, onFindFriends, onNotification, onRequest, onRequester, onPost, onAuthor, onStrength, onMenu, onLeaderboard }) {
  const top = leaderboard.slice(0, 3);
  if (!top.some((row) => row.user_id === me)) {
    const mine = leaderboard.find((row) => row.user_id === me);
    if (mine) top.push(mine);
  }
  // Classifica tra persone della stessa modalità: kg in Palestra, minuti in Pilates.
  const pilatesBoard = leaderboard[0]?.mode === 'pilates';
  const score = (row) => (pilatesBoard ? `${thousands(Number(row.minutes ?? 0))} min` : `${thousands(Number(row.volume))} kg`);
  const ranking = leaderboard.length > 1 ? el('button', { type: 'button', className: 'bg-weekstrip', onClick: onLeaderboard, 'aria-label': 'Classifica della settimana, apri la classifica completa' },
    el('span', { className: 'bg-weekstrip__title' }, 'Classifica della settimana', el('span', { text: pilatesBoard ? 'minuti di pratica' : 'volume sollevato' })),
    top.map((row) => el('span', { className: `bg-rank${row.user_id === me ? ' bg-rank--me' : ''}` },
      el('i', { text: String(leaderboard.indexOf(row) + 1) }),
      avatar(row.user_id, row.alias, 'bg-av--sm'),
      el('span', { text: row.user_id === me ? 'Tu' : row.alias }),
      el('b', { text: score(row) })))) : null;
  // Le richieste di amicizia hanno il loro riquadro: restano finché non si accetta o rifiuta.
  const news = notifications.filter((group) => group.unread && group.kind !== 'friend_request').slice(0, 4);
  const pending = requests.length ? el('div', { className: 'bg-news', role: 'region', 'aria-label': 'Richieste di amicizia' },
    requests.map((item) => el('div', { className: 'bg-news__row bg-news__row--request' },
      el('button', { type: 'button', className: 'bg-news__who', 'aria-label': `Profilo di ${item.alias}`, onClick: () => onRequester(item.userId) },
        avatar(item.userId, item.alias, 'bg-av--sm'),
        el('span', { text: `${item.alias} vuole aggiungerti agli amici` })),
      el('span', { className: 'bg-news__actions' },
        el('button', { type: 'button', className: 'bg-btn bg-btn--outline bg-btn--small', 'aria-label': `Rifiuta ${item.alias}`, onClick: () => onRequest(item.userId, false), text: 'Rifiuta' }),
        el('button', { type: 'button', className: 'bg-btn bg-btn--primary bg-btn--small', 'aria-label': `Accetta ${item.alias}`, onClick: () => onRequest(item.userId, true), text: 'Accetta' }))))) : null;
  root.replaceChildren(
    appBar({
      initial, onAccount, title: 'Social',
      action: el('button', { type: 'button', className: 'bg-iconbtn bg-iconbtn--dot', 'aria-label': requests.length ? `Trova amici, ${requests.length} richieste` : 'Trova amici', onClick: onFindFriends },
        icon('addFriend'), requests.length ? el('span', { className: 'bg-tab__dot' }) : null),
    }),
    el('main', {},
      status ? el('p', { className: 'bg-note bg-note--center', role: 'status', text: status }) : null,
      pending,
      news.length ? el('div', { className: 'bg-news', role: 'region', 'aria-label': 'Novità' },
        news.map((group) => el('button', { type: 'button', className: 'bg-news__row', onClick: () => onNotification(group) },
          avatar(group.actor, group.items[0].actorName, 'bg-av--sm'),
          el('span', { text: group.text }),
          el('small', { text: ago(group.at) })))) : null,
      ranking,
      posts.length
        ? el('div', { className: 'bg-feed' }, posts.map((post) => postCard(post, names, {
          onStrength: () => onStrength(post), onOpen: () => onPost(post), onAuthor: () => onAuthor(post.userId), onMenu: () => onMenu(post),
        })))
        : el('div', { className: 'bg-form' }, emptyState('Ancora nessun allenamento dei tuoi amici'), button({ label: 'Trova amici', onClick: onFindFriends }))));
}

export function renderLeaderboard(root, { me, rows, onBack, onAuthor }) {
  const pilatesBoard = rows[0]?.mode === 'pilates';
  root.replaceChildren(
    topBar({ title: 'Classifica', onBack }),
    el('main', {},
      el('div', { className: 'bg-pagehead bg-pagehead--tight' }, el('h1', { text: 'Classifica' }), el('p', { text: pilatesBoard ? 'Minuti di pratica da lunedì' : 'Volume sollevato da lunedì' })),
      el('div', { className: 'bg-weekstrip bg-weekstrip--full' }, rows.map((row, index) => el('button', {
        type: 'button', className: `bg-rank${row.user_id === me ? ' bg-rank--me' : ''}`, onClick: () => onAuthor(row.user_id),
      }, el('i', { text: String(index + 1) }), avatar(row.user_id, row.alias, 'bg-av--sm'),
      el('span', { text: row.user_id === me ? 'Tu' : row.alias }), el('b', { text: pilatesBoard ? `${thousands(Number(row.minutes ?? 0))} min` : `${thousands(Number(row.volume))} kg` }))))));
}

export function renderPostDetail(root, dock, { me, post, names, onBack, onStrength, onAuthor, onMenu, onSend, onCommentMenu }) {
  const input = el('input', { placeholder: 'Scrivi un commento', 'aria-label': 'Scrivi un commento', maxlength: 1000, autocomplete: 'off' });
  const send = el('button', { type: 'submit', 'aria-label': 'Invia', disabled: true }, icon('arrowRight'));
  input.addEventListener('input', () => { send.disabled = !input.value.trim(); });
  const form = el('form', { className: 'bg-composer' }, input, send);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    send.disabled = true;
    if (await onSend(body)) input.value = '';
    else send.disabled = false;
  });
  const comments = post.comments.map((comment) => {
    const mine = comment.user_id === me;
    const name = mine ? 'Tu' : names.get(comment.user_id) ?? 'Utente';
    const body = el('div', { className: 'bg-comment__body', tabindex: '0', 'aria-label': `${name}: ${comment.body}. Tieni premuto per altre azioni` },
      el('b', { text: name }), el('small', { text: `${ago(comment.created_at)}${comment.edited_at ? ' · modificato' : ''}` }), el('p', { text: comment.body }));
    // Pressione lunga (o tasto destro / menu da tastiera): modifica ed elimina, oppure segnala.
    let timer;
    body.addEventListener('pointerdown', () => { timer = setTimeout(() => onCommentMenu(comment), 500); });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) body.addEventListener(type, () => clearTimeout(timer));
    body.addEventListener('contextmenu', (event) => { event.preventDefault(); onCommentMenu(comment); });
    body.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === 'ContextMenu') onCommentMenu(comment); });
    return el('div', { className: 'bg-comment' }, avatar(comment.user_id, names.get(comment.user_id) ?? name, 'bg-av--sm'), body);
  });
  root.replaceChildren(
    topBar({ title: 'Post', onBack }),
    el('main', {},
      el('div', { className: 'bg-feed bg-feed--single' }, postCard(post, names, {
        onStrength, onComments: () => input.focus(), onAuthor: () => onAuthor(post.userId), onMenu, preview: false,
      })),
      el('div', { className: 'bg-blocktitle bg-blocktitle--comments' }, el('h2', { text: 'Commenti' }), el('span', { text: String(post.comments.length) })),
      comments.length ? el('div', { className: 'bg-comments' }, comments) : el('p', { className: 'bg-empty bg-empty--inset', text: 'Ancora nessun commento.' })));
  dock.replaceChildren(form);
  return { focus: () => input.focus() };
}

function pilatesFriendStats(stats, weeks, top) {
  const milestones = stats.milestones ?? [];
  return [
    el('div', { className: 'bg-grid2' },
      el('div', { className: 'bg-stat' }, el('b', { text: String(stats.minutes ?? 0) }), el('span', { text: 'minuti di pratica' })),
      el('div', { className: 'bg-stat' }, el('b', { text: String(stats.workouts ?? 0) }), el('span', { text: stats.workouts === 1 ? 'sessione' : 'sessioni' })),
      el('div', { className: 'bg-stat' }, el('b', { text: String(stats.weeksStreak ?? 0) }), el('span', { text: 'settimane di fila' })),
      el('div', { className: 'bg-stat' }, el('b', { text: String(milestones.length) }), el('span', { text: 'traguardi' }))),
    el('div', { className: 'bg-month bg-month--spaced' },
      el('div', { className: 'bg-month__head' }, el('b', { text: 'Minuti per settimana' }), el('span', { text: 'ultime 8' })),
      el('div', { className: 'bg-bars', role: 'img', 'aria-label': `Minuti delle ultime 8 settimane: ${weeks.map((value) => `${Number(value)} min`).join(', ')}` },
        weeks.map((value, index) => el('i', { className: index === weeks.length - 1 ? 'on' : '', style: `height:${Math.max(4, Math.round(Number(value) / top * 100))}%` }))),
      el('div', { className: 'bg-bars__x', 'aria-hidden': 'true' }, weeks.map((_, index) => el('span', { text: `S${index + 1}` })))),
    milestones.length ? [
      el('div', { className: 'bg-blocktitle bg-blocktitle--rows' }, el('h2', { text: 'Traguardi' })),
      el('div', { className: 'bg-exlist' }, milestones.slice(0, 6).map((item) => el('div', { className: 'bg-exrow' },
        el('span', { className: 'bg-exrow__num' }, icon('star', { small: true })),
        el('span', { className: 'bg-exrow__body' }, el('span', { className: 'bg-exrow__name', text: item.title }),
          el('span', { className: 'bg-exrow__meta', text: recordDate(Number(item.at)) }))))),
    ] : null,
  ];
}

export function renderFriendProfile(root, { friend, stats, period, posts, names, onBack, onPeriod, onFriendship, onMenu, onPost, onStrength }) {
  const since = stats?.since ? `amici da ${new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' }).format(new Date(stats.since))}` : '';
  const hidden = !stats || stats.hidden;
  const weeks = stats?.weeks ?? [];
  const top = Math.max(1, ...weeks.map(Number));
  const hours = Math.floor((stats?.seconds ?? 0) / 3600);
  const minutes = Math.round(((stats?.seconds ?? 0) % 3600) / 60);
  root.replaceChildren(
    el('header', { className: 'bg-topbar' },
      el('button', { type: 'button', className: 'bg-iconbtn', 'aria-label': 'Indietro', onClick: onBack }, icon('back')),
      el('span', { className: 'bg-topbar__title', text: 'Profilo' }),
      onMenu ? el('button', { type: 'button', className: 'bg-iconbtn', 'aria-label': 'Altre azioni', onClick: onMenu }, icon('more')) : el('span')),
    el('main', {},
      el('div', { className: 'bg-friend' },
        avatar(friend.userId, friend.alias, 'bg-av--lg'),
        el('h1', { text: friend.alias }),
        // Agli amici arriva solo l'alias (nome e cognome restano privati): niente «@alias» ripetuto.
        el('p', { text: since || '\u00a0' }),
        onFriendship ? button({ label: friend.kind === 'friend' ? 'Amici ✓' : friend.kind === 'sent' ? 'Richiesta inviata' : friend.kind === 'received' ? 'Accetta amicizia' : 'Aggiungi agli amici', variant: friend.kind === 'friend' || friend.kind === 'sent' ? 'outline' : 'primary', block: false, onClick: onFriendship }) : null),
      hidden
        ? el('p', { className: 'bg-empty bg-empty--inset', text: friend.kind === 'friend' ? `${friend.alias} non condivide le statistiche.` : 'Le statistiche sono visibili solo agli amici.' })
        : [
          el('div', { className: 'bg-seg', role: 'tablist' }, [['week', 'Settimana'], ['month', 'Mese'], ['year', 'Anno']].map(([id, label]) => el('button', {
            type: 'button', role: 'tab', 'aria-selected': String(period === id), onClick: () => onPeriod(id), text: label,
          }))),
          // Amico in modalità Pilates: minuti, sessioni, settimane di fila e traguardi (mai kg).
          stats.mode === 'pilates' ? pilatesFriendStats(stats, weeks, top) : null,
          stats.mode === 'pilates' ? null : el('div', { className: 'bg-grid2' },
            el('div', { className: 'bg-stat' }, el('b', { text: String(stats.workouts ?? 0) }), el('span', { text: 'allenamenti' })),
            el('div', { className: 'bg-stat' }, el('b', { text: stats.volume == null ? '—' : thousands(Number(stats.volume)) }), el('span', { text: 'kg di volume' })),
            el('div', { className: 'bg-stat' }, el('b', { text: hours ? `${hours} h ${minutes}` : `${minutes} min` }), el('span', { text: 'tempo in palestra' })),
            el('div', { className: 'bg-stat' }, el('b', { text: stats.records == null ? '—' : String(stats.records) }), el('span', { text: 'nuovi record' }))),
          stats.volume == null || stats.mode === 'pilates' ? null : el('div', { className: 'bg-month bg-month--spaced' },
            el('div', { className: 'bg-month__head' }, el('b', { text: 'Volume per settimana' }), el('span', { text: 'ultime 8' })),
            el('div', { className: 'bg-bars', role: 'img', 'aria-label': `Volume delle ultime 8 settimane: ${weeks.map((value) => `${thousands(Number(value))} kg`).join(', ')}` },
              weeks.map((value, index) => el('i', { className: index === weeks.length - 1 ? 'on' : '', style: `height:${Math.max(4, Math.round(Number(value) / top * 100))}%` }))),
            el('div', { className: 'bg-bars__x', 'aria-hidden': 'true' }, weeks.map((_, index) => el('span', { text: `S${index + 1}` })))),
          stats.bests?.length ? [
            el('div', { className: 'bg-blocktitle bg-blocktitle--rows' }, el('h2', { text: 'Record personali' })),
            el('div', { className: 'bg-exlist' }, stats.bests.map((best) => el('div', { className: 'bg-exrow' },
              el('span', { className: 'bg-exrow__num' }, icon('trophy', { small: true })),
              el('span', { className: 'bg-exrow__body' }, el('span', { className: 'bg-exrow__name', text: best.title }),
                el('span', { className: 'bg-exrow__meta', text: recordDate(Number(best.at)) })),
              el('span', { className: 'bg-exrow__target', text: `${thousands(Number(best.load))} kg × ${best.reps}` })))),
          ] : null,
        ],
      posts.length ? [
        el('div', { className: 'bg-blocktitle bg-blocktitle--rows' }, el('h2', { text: 'Allenamenti pubblicati' })),
        el('div', { className: 'bg-feed' }, posts.map((post) => postCard(post, names, { onOpen: () => onPost(post), onStrength: () => onStrength(post), onAuthor: () => {} }))),
      ] : null,
      el('div', { className: 'bg-exspacer bg-exspacer--form', 'aria-hidden': 'true' })));
}

export function renderFindFriends(root, { friends, inviteLink, status, onBack, onSearch, onOpen, onAccept, onDecline, onInvite }) {
  const field = textField({ id: 'friendAlias', label: 'Cerca per alias', icon: 'person', placeholder: 'es. marco_lifts', autocomplete: 'off' });
  const result = el('div', { className: 'bg-find__result', role: 'status' });
  const form = el('form', { className: 'bg-form', noValidate: true }, field, button({ label: 'Cerca', type: 'submit' }), result);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = field.input.value.trim().replace(/^@/, '');
    if (!value) { field.setError('Scrivi l\'alias di un amico.'); return; }
    field.setError('');
    result.replaceChildren(await onSearch(value));
  });
  const received = friends.filter((item) => item.kind === 'received');
  const sent = friends.filter((item) => item.kind === 'sent');
  const accepted = friends.filter((item) => item.kind === 'friend');
  const person = (item, extra) => el('div', { className: 'bg-exrow' },
    avatar(item.userId, item.alias, 'bg-av--sm'),
    el('button', { type: 'button', className: 'bg-exrow__body bg-exrow__bodybtn', onClick: () => onOpen(item.userId) }, el('span', { className: 'bg-exrow__name', text: item.alias })),
    extra);
  root.replaceChildren(
    topBar({ title: 'Trova amici', onBack }),
    el('main', {},
      el('div', { className: 'bg-pagehead bg-pagehead--tight' }, el('h1', { text: 'Trova amici' }), el('p', { text: 'Cerca un amico per alias o mandagli il tuo link di invito.' })),
      form,
      el('div', { className: 'bg-form' },
        button({ label: inviteLink ? 'Copia il link di invito' : 'Crea il link di invito', variant: 'outline', iconBefore: 'share', onClick: onInvite }),
        status ? el('p', { className: 'bg-formstatus', role: 'status', text: status }) : null),
      received.length ? [el('h2', { className: 'bg-section', text: 'Richieste ricevute' }), el('div', { className: 'bg-exlist' }, received.map((item) => person(item,
        el('span', { className: 'bg-find__actions' },
          button({ label: 'Accetta', block: false, onClick: () => onAccept(item.userId) }),
          button({ label: 'Rifiuta', variant: 'outline', block: false, onClick: () => onDecline(item.userId) })))))] : null,
      accepted.length ? [el('h2', { className: 'bg-section', text: `I tuoi amici · ${accepted.length}` }), el('div', { className: 'bg-exlist' }, accepted.map((item) => person(item, icon('chevronRight', { small: true }))))] : null,
      sent.length ? [el('h2', { className: 'bg-section', text: 'Richieste inviate' }), el('div', { className: 'bg-exlist' }, sent.map((item) => person(item,
        link({ label: 'Annulla', onClick: () => onDecline(item.userId) }))))] : null,
      el('div', { className: 'bg-exspacer bg-exspacer--form', 'aria-hidden': 'true' })));
}

// PublishSheet: pubblicare è sempre una scelta dell'utente.
export function openPublishSheet({ session, suggested, onPublish }) {
  let showLoads = true;
  let visibility = 'friends';
  const title = el('input', { id: 'publishTitle', className: 'bg-input bg-input--sheet', value: suggested, maxlength: 80, autocomplete: 'off' });
  const body = el('textarea', { className: 'bg-textarea', placeholder: 'Scrivi qualcosa ai tuoi amici (facoltativo)', maxlength: 1000, 'aria-label': 'Testo del post' });
  const status = el('p', { className: 'bg-formstatus bg-formstatus--error', role: 'alert' });
  const summary = session.summary ?? {};
  const preview = el('div', { className: 'bg-post__stats bg-post__stats--sheet' });
  // In Pilates l'interruttore diventa «Mostra durata ed esercizi»: spento resta l'attrezzo.
  const pilates = session.mode === 'pilates';
  const renderPreview = () => {
    const items = [];
    if (pilates) {
      if (showLoads) items.push(['Durata', formatDuration(session.endedAt - session.startedAt)], ['Esercizi', String(summary.exercisesDone ?? 0)]);
      items.push(['Attrezzo', (summary.equipment ?? []).join(', ') || '—']);
    } else {
      items.push(['Durata', formatDuration(session.endedAt - session.startedAt)]);
      if (showLoads) items.push(['Volume', `${thousands(summary.volume ?? 0)} kg`]);
      items.push(['Serie', String(summary.sets ?? 0)]);
    }
    preview.classList.toggle('bg-post__stats--one', items.length === 1);
    preview.classList.toggle('bg-post__stats--two', items.length === 2);
    preview.replaceChildren(...items.map(([label, value]) => el('div', {}, el('span', { text: label }), el('b', { text: value }))));
  };
  renderPreview();
  const loadsLabel = pilates ? 'Mostra durata ed esercizi' : 'Mostra i carichi';
  const loads = el('button', { type: 'button', className: 'bg-switch', role: 'switch', 'aria-checked': 'true', 'aria-label': loadsLabel });
  loads.addEventListener('click', () => { showLoads = !showLoads; loads.setAttribute('aria-checked', String(showLoads)); renderPreview(); });
  const audienceValue = el('span', { className: 'bg-toggle__value' }, 'Amici', icon('chevronRight', { small: true }));
  const audienceHint = el('small', { text: 'Solo i tuoi amici' });
  const audience = el('button', { type: 'button', className: 'bg-toggle bg-toggle--button', 'aria-label': 'Chi può vederlo: Amici. Tocca per cambiare' },
    el('span', {}, 'Chi può vederlo', audienceHint), audienceValue);
  audience.addEventListener('click', () => {
    visibility = visibility === 'friends' ? 'private' : 'friends';
    const friends = visibility === 'friends';
    audienceValue.firstChild.textContent = friends ? 'Amici' : 'Solo io';
    audienceHint.textContent = friends ? 'Solo i tuoi amici' : 'Resta nel tuo Storico come post privato';
    audience.setAttribute('aria-label', `Chi può vederlo: ${friends ? 'Amici' : 'Solo io'}. Tocca per cambiare`);
  });
  const publish = button({ label: 'Pubblica', iconBefore: 'share' });
  const close = el('button', { type: 'button', className: 'bg-iconbtn bg-iconbtn--sm', 'aria-label': 'Chiudi' }, icon('close'));
  const view = openSheet({
    label: 'Pubblica sul Social',
    content: el('div', { className: 'bg-sheet__body' },
      el('div', { className: 'bg-sheet__head' }, el('h2', { text: 'Pubblica sul Social' }), close),
      el('div', {}, el('label', { className: 'bg-flabel', for: 'publishTitle', text: 'Titolo' }), title),
      body, preview,
      el('div', {},
        el('div', { className: 'bg-toggle' }, el('span', {}, loadsLabel, el('small', { text: pilates ? 'durata, esercizi fatti e traguardi' : 'kg di ogni esercizio e il record' })), loads),
        audience),
      status, publish),
  });
  close.addEventListener('click', () => view.close());
  publish.addEventListener('click', async () => {
    if (!title.value.trim()) { status.textContent = 'Dai un titolo al post.'; title.focus(); return; }
    publish.disabled = true;
    status.textContent = '';
    const problem = await onPublish({ title: title.value, body: body.value, visibility, showLoads });
    publish.disabled = false;
    if (problem) status.textContent = problem;
    else view.close();
  });
  title.focus();
  return view;
}
