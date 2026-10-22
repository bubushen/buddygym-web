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

// Tutti i miei legami con l'alias dell'altra persona, il mio ruolo e i non letti.
export async function loadCoachLinks(client, me) {
  const links = ok(await client.from('buddy_coach_links')
    .select('id,coach,client,status,created_at,accepted_at')
    .order('created_at', { ascending: false }));
  if (!links.length) return [];
  const ids = links.map((link) => link.id);
  const messages = ok(await client.from('buddy_coach_messages')
    .select('id,link_id,sender,body,created_at,read_at')
    .in('link_id', ids)
    .order('created_at', { ascending: true }));
  const byLink = new Map();
  for (const message of messages) {
    const rows = byLink.get(message.link_id) ?? [];
    rows.push(message);
    byLink.set(message.link_id, rows);
  }
  const otherIds = links.map((link) => (link.coach === me ? link.client : link.coach));
  const names = await loadNames(client, otherIds);
  return links.map((link) => {
    const otherId = link.coach === me ? link.client : link.coach;
    const rows = byLink.get(link.id) ?? [];
    const last = rows.at(-1) ?? null;
    return {
      id: link.id,
      coach: link.coach,
      client: link.client,
      status: link.status,
      createdAt: link.created_at,
      acceptedAt: link.accepted_at,
      role: link.coach === me ? 'coach' : 'client',
      otherId,
      alias: names.get(otherId) ?? 'Utente',
      unread: unreadCount(rows, me),
      last: last ? { id: last.id, body: last.body, sender: last.sender, createdAt: last.created_at } : null,
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

export async function loadMessages(client, linkId) {
  return ok(await client.from('buddy_coach_messages')
    .select('id,link_id,sender,body,created_at,read_at')
    .eq('link_id', linkId)
    .order('created_at', { ascending: true }));
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
