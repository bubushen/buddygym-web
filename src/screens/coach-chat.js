// Chat coach ↔ cliente: lista delle conversazioni dentro l'area coach e
// schermata della singola chat. Costruita con el() e i componenti del design system.
import { button, el, emptyState, textField, topBar } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import {
  acceptLink, clockTime, findClient, inviteClient, linkSections, loadCoachLinks, loadLink,
  loadMessages, markRead, messageGroups, messageProblem, removeLink, sendMessage,
  subscribeChat, subscribeLinks,
} from '../coach-chat.js';

// Ora se è oggi, altrimenti giorno e mese brevi.
function when(iso) {
  const date = new Date(iso);
  const now = new Date();
  return date.toDateString() === now.toDateString()
    ? clockTime(iso)
    : new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' }).format(date);
}

function entry(link, onOpen) {
  return el('button', { type: 'button', className: 'bg-exrow coach-chat__entry', onClick: () => onOpen(link.id) },
    el('span', { className: 'bg-exrow__body' },
      el('span', { className: 'bg-exrow__name', text: link.alias }),
      el('span', { className: 'bg-exrow__meta coach-chat__preview', text: link.last?.body ?? 'Nessun messaggio' })),
    el('span', { className: 'coach-chat__side' },
      link.last ? el('span', { className: 'coach-chat__time', text: when(link.last.createdAt) }) : null,
      link.unread ? el('span', { className: 'coach-chat__badge', text: String(link.unread), 'aria-label': `${link.unread} messaggi non letti` }) : null));
}

function request(link, actions) {
  return el('div', { className: 'bg-exrow coach-chat__entry coach-chat__entry--request' },
    el('span', { className: 'bg-exrow__body' },
      el('span', { className: 'bg-exrow__name', text: link.alias }),
      el('span', { className: 'bg-exrow__meta', text: 'vuole essere il tuo coach' })),
    el('span', { className: 'coach-chat__actions' },
      el('button', { type: 'button', className: 'bg-btn bg-btn--outline bg-btn--small', onClick: () => actions.run(() => removeLink(actions.client, link.id), 'Richiesta rifiutata.'), text: 'Rifiuta' }),
      el('button', { type: 'button', className: 'bg-btn bg-btn--primary bg-btn--small', onClick: () => actions.run(() => acceptLink(actions.client, link.id), 'Ora siete in contatto.'), text: 'Accetta' })));
}

function sent(link, actions) {
  return el('div', { className: 'bg-exrow coach-chat__entry' },
    el('span', { className: 'bg-exrow__body' },
      el('span', { className: 'bg-exrow__name', text: link.alias }),
      el('span', { className: 'bg-exrow__meta', text: 'Invito in attesa' })),
    el('button', { type: 'button', className: 'bg-link', onClick: () => actions.run(() => removeLink(actions.client, link.id), 'Invito annullato.'), text: 'Annulla' }));
}

// Lista chat: richieste ricevute, conversazioni, inviti. Restituisce { destroy }.
export function renderChatList(host, { client, me, onOpen, onUnread = () => {} }) {
  let destroyed = false;
  let links = [];
  let loading = true;
  let loadError = false;
  let status = '';
  let inviteStatus = '';
  let inviteValue = '';
  let busy = false;
  let unsubscribe = null;

  function draw() {
    if (destroyed) return;
    const sections = linkSections(links, me);
    const nodes = [];
    if (loading) nodes.push(el('p', { className: 'bg-note', role: 'status', text: 'Carico le chat…' }));
    else if (loadError) nodes.push(el('p', { className: 'bg-note', role: 'status', text: 'Chat non disponibile. Controlla la connessione.' }));
    else if (status) nodes.push(el('p', { className: 'bg-note', role: 'status', text: status }));

    if (sections.requests.length) {
      nodes.push(el('h2', { className: 'bg-section', text: `Richieste · ${sections.requests.length}` }));
      nodes.push(el('div', { className: 'bg-exlist' }, sections.requests.map((link) => request(link, actions))));
    }
    if (sections.coaches.length) {
      nodes.push(el('h2', { className: 'bg-section', text: 'Il mio coach' }));
      nodes.push(el('div', { className: 'bg-exlist' }, sections.coaches.map((link) => entry(link, onOpen))));
    }
    if (sections.clients.length) {
      nodes.push(el('h2', { className: 'bg-section', text: `I miei clienti · ${sections.clients.length}` }));
      nodes.push(el('div', { className: 'bg-exlist' }, sections.clients.map((link) => entry(link, onOpen))));
    }
    if (!loading && !loadError && !sections.requests.length && !sections.coaches.length && !sections.clients.length && !sections.sent.length) {
      nodes.push(emptyState('Nessuna chat ancora. Invita un cliente o aspetta una richiesta.'));
    }

    nodes.push(el('h2', { className: 'bg-section', text: 'Invita un cliente' }));
    nodes.push(inviteForm());

    if (sections.sent.length) {
      nodes.push(el('h2', { className: 'bg-section', text: `In attesa · ${sections.sent.length}` }));
      nodes.push(el('div', { className: 'bg-exlist' }, sections.sent.map((link) => sent(link, actions))));
    }

    host.replaceChildren(...nodes);
    onUnread(sections.requests.length + links.reduce((sum, link) => sum + (link.unread ?? 0), 0));
  }

  function inviteForm() {
    const field = textField({
      id: 'coachChatAlias', label: 'Alias del cliente', icon: 'person',
      placeholder: 'es. marco_lifts', autocomplete: 'off', value: inviteValue,
    });
    field.input.addEventListener('input', () => { inviteValue = field.input.value; });
    const form = el('form', { className: 'bg-form coach-chat__invite', noValidate: true },
      field,
      button({ label: 'Invita', type: 'submit' }),
      inviteStatus ? el('p', { className: 'bg-formstatus', role: 'status', text: inviteStatus }) : null);
    form.addEventListener('submit', (event) => { event.preventDefault(); void invite(); });
    return form;
  }

  async function refresh() {
    try {
      links = await loadCoachLinks(client, me);
      loading = false;
      loadError = false;
    } catch {
      loading = false;
      loadError = true;
    }
    draw();
  }

  async function invite() {
    if (busy) return;
    const alias = inviteValue.trim().replace(/^@/, '');
    if (!alias) { inviteStatus = 'Scrivi l’alias del cliente.'; draw(); return; }
    busy = true; inviteStatus = '';
    try {
      const found = await findClient(client, alias);
      if (!found) inviteStatus = 'Alias non trovato.';
      else if (found.status === 'accepted') inviteStatus = 'Questo cliente è già tuo.';
      else if (found.status === 'pending') inviteStatus = 'Hai già invitato questo cliente.';
      else {
        await inviteClient(client, me, found.user_id);
        inviteValue = '';
        inviteStatus = 'Invito inviato.';
      }
    } catch (error) {
      inviteStatus = error?.code === '23505' ? 'Hai già invitato questo cliente.' : 'Invito non riuscito. Riprova.';
    } finally {
      busy = false;
      await refresh();
    }
  }

  const actions = {
    client,
    async run(run, done) {
      if (busy) return;
      busy = true; status = '';
      try { await run(); status = done; }
      catch { status = 'Operazione non riuscita. Riprova.'; }
      finally { busy = false; await refresh(); }
    },
  };

  async function start() {
    draw();
    await refresh();
    if (destroyed) return;
    try { unsubscribe = subscribeLinks(client, () => { void refresh(); }); }
    catch { /* Senza realtime resta ciò che è già caricato. */ }
  }
  void start();

  return {
    destroy() {
      destroyed = true;
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}

// Schermata della singola chat. Restituisce { destroy } per chiudere il canale.
export function renderCoachChatThread(root, dock, { client, me, linkId, onBack }) {
  let destroyed = false;
  let unsubscribe = null;
  let link = null;
  let messages = [];
  let messagesHost = null;
  let input = null;
  let send = null;
  let errorNode = null;
  let sending = false;

  function scrollEnd() {
    const scroller = root.closest('.app-scroll');
    if (!scroller) return;
    requestAnimationFrame(() => { if (!destroyed) scroller.scrollTop = scroller.scrollHeight; });
  }

  function unavailable() {
    root.replaceChildren(
      topBar({ title: 'Chat', onBack }),
      el('main', {},
        emptyState('Chat non disponibile'),
        el('div', { className: 'bg-form' },
          button({ label: 'Torna al Coaching', variant: 'outline', onClick: onBack }))));
    dock.replaceChildren();
  }

  function renderMessages() {
    if (!messagesHost) return;
    if (!messages.length) {
      messagesHost.replaceChildren(el('p', { className: 'bg-empty bg-empty--inset', text: 'Ancora nessun messaggio. Scrivi tu il primo.' }));
      return;
    }
    const lastMine = [...messages].reverse().find((message) => message.sender === me);
    messagesHost.replaceChildren(...messageGroups(messages).flatMap((group) => [
      el('div', { className: 'coach-chat__day', text: group.label }),
      ...group.messages.map((message) => {
        const mine = message.sender === me;
        return el('div', { className: `coach-chat__message${mine ? ' coach-chat__message--mine' : ''}` },
          el('div', { className: 'coach-chat__bubble' },
            el('p', { className: 'coach-chat__text', text: message.body })),
          el('span', { className: 'coach-chat__meta' },
            el('span', { text: clockTime(message.created_at) }),
            mine && message.id === lastMine?.id && message.read_at ? el('span', { text: 'Letto' }) : null));
      }),
    ]));
  }

  function resize() {
    if (!input) return;
    input.style.height = 'auto';
    const style = getComputedStyle(input);
    const line = parseFloat(style.lineHeight) || 21;
    const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    input.style.height = `${Math.min(input.scrollHeight, line * 4 + padding)}px`;
  }

  function syncSend() {
    if (send) send.disabled = sending || !input.value.trim();
    resize();
  }

  async function markReadQuietly() {
    try {
      await markRead(client, linkId);
      const now = new Date().toISOString();
      for (const message of messages) {
        if (message.sender !== me && !message.read_at) message.read_at = now;
      }
    } catch { /* Si riproverà al prossimo messaggio. */ }
  }

  async function receive(message) {
    if (destroyed || !message?.id) return;
    if (messages.some((item) => item.id === message.id)) return;
    messages.push(message);
    if (message.sender !== me) await markReadQuietly();
    if (destroyed) return;
    renderMessages();
    scrollEnd();
  }

  async function submit() {
    const body = input.value;
    const problem = messageProblem(body);
    if (problem) { errorNode.textContent = problem; return; }
    if (sending) return;
    sending = true;
    errorNode.textContent = '';
    syncSend();
    try {
      const saved = await sendMessage(client, me, linkId, body);
      if (destroyed) return;
      messages.push(saved);
      input.value = '';
      renderMessages();
      scrollEnd();
    } catch (failure) {
      if (!destroyed) errorNode.textContent = failure?.message || 'Invio non riuscito. Riprova.';
    } finally {
      if (!destroyed) {
        sending = false;
        syncSend();
        input.focus();
      }
    }
  }

  function buildComposer() {
    input = el('textarea', {
      className: 'coach-chat__input', rows: '1', maxlength: '2000',
      placeholder: 'Scrivi un messaggio', 'aria-label': 'Scrivi un messaggio',
    });
    send = el('button', { type: 'submit', className: 'coach-chat__send', 'aria-label': 'Invia', disabled: true }, icon('arrowRight'));
    errorNode = el('p', { className: 'coach-chat__error', role: 'alert' });
    const form = el('form', { className: 'coach-chat__composer' },
      errorNode,
      el('div', { className: 'coach-chat__field' }, input, send));
    input.addEventListener('input', syncSend);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); }
    });
    form.addEventListener('submit', (event) => { event.preventDefault(); void submit(); });
    dock.replaceChildren(form);
    syncSend();
  }

  function draw() {
    messagesHost = el('div', { className: 'coach-chat__thread' });
    root.replaceChildren(
      topBar({ title: link?.alias ?? 'Chat', onBack }),
      el('main', {},
        messagesHost,
        el('div', { className: 'bg-exspacer bg-exspacer--form', 'aria-hidden': 'true' })));
    renderMessages();
    buildComposer();
    scrollEnd();
  }

  async function start() {
    root.replaceChildren(
      topBar({ title: 'Chat', onBack }),
      el('main', {}, el('p', { className: 'bg-note', text: 'Carico la chat…' })));
    dock.replaceChildren();
    try {
      const found = await loadLink(client, me, linkId);
      if (destroyed) return;
      if (!found || found.status !== 'accepted') { unavailable(); return; }
      link = found;
      messages = await loadMessages(client, linkId);
      if (destroyed) return;
      await markReadQuietly();
      if (destroyed) return;
      draw();
      try { unsubscribe = subscribeChat(client, linkId, (message) => { void receive(message); }); }
      catch { /* I messaggi restano aggiornabili riaprendo la chat. */ }
    } catch (error) {
      if (destroyed) return;
      console.error('BUDDYGYM coach chat unavailable', error);
      unavailable();
    }
  }
  void start();

  return {
    destroy() {
      destroyed = true;
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
