// Chat privata coach ↔ cliente su Supabase: legami, messaggi, realtime e
// funzioni pure per la vista. Le regole di accesso stanno in supabase/coach-chat.sql.
import { loadNames } from './social.js';

function ok(result) {
  if (result.error) throw result.error;
  return result.data;
}

// ── Funzioni pure ──────────────────────────────────────────────────────

// Divide i legami nelle sezioni della scheda Chat.
export function linkSections(links, me) {
  const sections = { requests: [], sent: [], coaches: [], clients: [] };
  for (const link of links ?? []) {
    const role = link.role ?? (link.coach === me ? 'coach' : 'client');
    if (link.status === 'pending') {
      (role === 'client' ? sections.requests : sections.sent).push(link);
    } else if (link.status === 'accepted') {
      (role === 'client' ? sections.coaches : sections.clients).push(link);
    }
  }
  return sections;
}

// Messaggi non letti inviati dall'altra persona.
export function unreadCount(messages, me) {
  return (messages ?? []).filter((message) => message.sender !== me && !message.read_at).length;
}

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

// «Oggi», «Ieri», «12 ottobre».
export function dayLabel(iso, now = new Date()) {
  const date = new Date(iso);
  const diff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (diff === 0) return 'Oggi';
  if (diff === 1) return 'Ieri';
  return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long' }).format(date);
}

// Raggruppa i messaggi per giorno, mantenendo l'ordine di arrivo.
export function messageGroups(messages, now = new Date()) {
  const groups = [];
  for (const message of messages ?? []) {
    const key = startOfDay(new Date(message.created_at));
    let group = groups.at(-1);
    if (!group || group.key !== key) {
      group = { key, label: dayLabel(message.created_at, now), messages: [] };
      groups.push(group);
    }
    group.messages.push(message);
  }
  return groups;
}

// Unisce una pagina più vecchia a quella già mostrata: niente duplicati e ordine di data.
// A parità di id vince il messaggio già mostrato (read_at più aggiornato).
export function mergeMessages(older, current) {
  const byId = new Map();
  for (const message of [...(current ?? []), ...(older ?? [])]) {
    if (message?.id == null || byId.has(message.id)) continue;
    byId.set(message.id, message);
  }
  return [...byId.values()].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

// Testo del messaggio: obbligatorio, al massimo 2000 caratteri (come nel database).
export function messageProblem(body) {
  const text = String(body ?? '').trim();
  if (!text) return 'Scrivi un messaggio.';
  if (text.length > 2000) return 'Il messaggio supera i 2000 caratteri.';
  return null;
}

// «07:42».
export function clockTime(iso) {
  return new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

// ── Dati ───────────────────────────────────────────────────────────────

// Le mie chat con anteprima e non letti già calcolati dal database (RPC).
// Restituisce la stessa forma di sempre: la usano area coach, app e lista chat.
export async function loadCoachLinks(client, me) {
  const rows = ok(await client.rpc('buddy_coach_chats'));
  return (rows ?? []).map((row) => {
    const role = row.coach === me ? 'coach' : 'client';
    return {
      id: row.id,
      coach: row.coach,
      client: row.client,
      status: row.status,
      createdAt: row.created_at,
      acceptedAt: row.accepted_at,
      role,
      otherId: row.other_id ?? (role === 'coach' ? row.client : row.coach),
      alias: row.alias ?? 'Utente',
      unread: Number(row.unread) || 0,
      last: row.last_id
        ? { id: row.last_id, body: row.last_body ?? '', sender: row.last_sender, createdAt: row.last_at }
        : null,
    };
  });
}

// Un singolo legame, con l'alias dell'altra persona.
export async function loadLink(client, me, linkId) {
  const row = ok(await client.from('buddy_coach_links')
    .select('id,coach,client,status,created_at,accepted_at')
    .eq('id', linkId)
    .maybeSingle());
  if (!row) return null;
  const otherId = row.coach === me ? row.client : row.coach;
  const names = await loadNames(client, [otherId]);
  return {
    ...row,
    role: row.coach === me ? 'coach' : 'client',
    otherId,
    alias: names.get(otherId) ?? 'Utente',
  };
}

// Cerca il cliente da invitare: { user_id, alias, status } oppure null.
export async function findClient(client, alias) {
  return ok(await client.rpc('buddy_coach_find', { candidate: alias }))[0] ?? null;
}

// Invito (solo il coach). Un doppione dà errore 23505.
export async function inviteClient(client, me, userId) {
  ok(await client.from('buddy_coach_links').insert({ coach: me, client: userId }));
}

// Accettazione (solo il client).
export async function acceptLink(client, linkId) {
  ok(await client.from('buddy_coach_links').update({ status: 'accepted' }).eq('id', linkId));
}

// Rifiuto, annullamento o chiusura del rapporto.
export async function removeLink(client, linkId) {
  ok(await client.from('buddy_coach_links').delete().eq('id', linkId));
}

// Ultimi messaggi della chat, in ordine crescente: { messages, hasMore }.
// Con `before` (created_at del più vecchio mostrato) carica la pagina precedente.
export async function loadMessages(client, linkId, { before = null, limit = 50 } = {}) {
  const take = Math.max(1, Math.floor(Number(limit) || 50));
  let query = client.from('buddy_coach_messages')
    .select('id,link_id,sender,body,created_at,read_at')
    .eq('link_id', linkId);
  if (before) query = query.lt('created_at', before);
  // Dal più recente, un messaggio in più serve solo a sapere se ce ne sono altri.
  const rows = ok(await query
    .order('created_at', { ascending: false })
    .limit(take + 1));
  const hasMore = rows.length > take;
  return { messages: rows.slice(0, take).reverse(), hasMore };
}

export async function sendMessage(client, me, linkId, body) {
  const problem = messageProblem(body);
  if (problem) throw new Error(problem);
  return ok(await client.from('buddy_coach_messages')
    .insert({ link_id: linkId, sender: me, body: String(body).trim() })
    .select('id,link_id,sender,body,created_at,read_at')
    .single());
}

export async function markRead(client, linkId) {
  return ok(await client.rpc('buddy_coach_mark_read', { link: linkId }));
}

// ── Realtime ───────────────────────────────────────────────────────────

let channelSeq = 0;
const nextChannel = (prefix) => `${prefix}-${++channelSeq}-${Math.random().toString(36).slice(2)}`;

// Nuovi messaggi di una chat. Restituisce la funzione per annullare l'iscrizione.
export function subscribeChat(client, linkId, onInsert) {
  const channel = client.channel(nextChannel(`coach-chat-${linkId}`))
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'buddy_coach_messages', filter: `link_id=eq.${linkId}` },
      (payload) => { if (payload?.new) onInsert(payload.new); })
    .subscribe();
  return () => { if (channel) client.removeChannel(channel); };
}

// Legami nuovi o cambiati (richieste, accettazioni, rimozioni).
export function subscribeLinks(client, onChange) {
  const channel = client.channel(nextChannel('coach-links'))
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'buddy_coach_links' },
      () => onChange())
    .subscribe();
  return () => { if (channel) client.removeChannel(channel); };
}
