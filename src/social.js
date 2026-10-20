// Social su Supabase: post degli amici, Forza, commenti, amicizie, blocchi,
// segnalazioni e notifiche nell'app. Le regole di accesso stanno nel database
// (supabase/social.sql): qui si chiede solo ciò che l'utente può vedere.

function ok(result) {
  if (result.error) throw result.error;
  return result.data;
}

const POST_FIELDS = 'id,user_id,session_id,workout_title,title,body,visibility,show_loads,stats,mode,created_at,buddy_post_strength(user_id),buddy_comments(id,user_id,body,created_at,edited_at)';

// Alias degli utenti citati (autori, commentatori, amici), con una sola chiamata.
export async function loadNames(client, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = ok(await client.rpc('buddy_names', { ids: unique }));
  return new Map(rows.map((row) => [row.user_id, row.alias]));
}

function shapePost(row, me) {
  const comments = [...(row.buddy_comments ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const strength = row.buddy_post_strength ?? [];
  return {
    id: row.id, userId: row.user_id, sessionId: row.session_id, workoutTitle: row.workout_title,
    title: row.title, body: row.body ?? '', visibility: row.visibility, showLoads: row.show_loads,
    stats: row.stats ?? {}, createdAt: row.created_at, mode: row.mode === 'pilates' ? 'pilates' : 'gym',
    strength: strength.length, mine: row.user_id === me, strengthByMe: strength.some((item) => item.user_id === me),
    comments,
  };
}

export async function loadFeed(client, me, { userId = null, limit = 30 } = {}) {
  let query = client.from('buddy_posts').select(POST_FIELDS).order('created_at', { ascending: false }).limit(limit);
  query = userId ? query.eq('user_id', userId) : query.eq('visibility', 'friends');
  const posts = ok(await query).map((row) => shapePost(row, me));
  const names = await loadNames(client, posts.flatMap((post) => [post.userId, ...post.comments.map((comment) => comment.user_id)]));
  return { posts, names };
}

export async function loadPost(client, me, id) {
  const row = ok(await client.from('buddy_posts').select(POST_FIELDS).eq('id', id).maybeSingle());
  if (!row) return null;
  const post = shapePost(row, me);
  const names = await loadNames(client, [post.userId, ...post.comments.map((comment) => comment.user_id)]);
  return { post, names };
}

export async function toggleStrength(client, me, post) {
  if (post.strengthByMe) ok(await client.from('buddy_post_strength').delete().eq('post_id', post.id).eq('user_id', me));
  else ok(await client.from('buddy_post_strength').insert({ post_id: post.id, user_id: me }));
}

export async function addComment(client, me, postId, body) {
  ok(await client.from('buddy_comments').insert({ post_id: postId, user_id: me, body }));
}

export async function editComment(client, id, body) {
  ok(await client.from('buddy_comments').update({ body, edited_at: new Date().toISOString() }).eq('id', id));
}

export async function deleteComment(client, id) {
  ok(await client.from('buddy_comments').delete().eq('id', id));
}

export async function deletePost(client, id) {
  ok(await client.from('buddy_posts').delete().eq('id', id));
}

export async function report(client, me, targetType, targetId, reason = null) {
  ok(await client.from('buddy_reports').insert({ reporter: me, target_type: targetType, target_id: String(targetId), reason }));
}

export async function blockUser(client, me, userId) {
  ok(await client.from('buddy_blocks').upsert({ blocker: me, blocked: userId }, { onConflict: 'blocker,blocked', ignoreDuplicates: true }));
}

export async function loadLeaderboard(client) {
  return ok(await client.rpc('buddy_weekly_leaderboard'));
}

export async function loadFriendStats(client, friendId, period) {
  return ok(await client.rpc('buddy_friend_stats', { friend: friendId, period }));
}

// Amicizie dell'utente: accettate, ricevute e inviate.
export async function loadFriendships(client, me) {
  const rows = ok(await client.from('buddy_friendships').select('requester,addressee,status,created_at,accepted_at'));
  const names = await loadNames(client, rows.map((row) => (row.requester === me ? row.addressee : row.requester)));
  return rows.map((row) => {
    const other = row.requester === me ? row.addressee : row.requester;
    const kind = row.status === 'accepted' ? 'friend' : row.requester === me ? 'sent' : 'received';
    return { userId: other, alias: names.get(other) ?? 'Utente', kind, since: row.accepted_at ?? row.created_at };
  });
}

export async function findByAlias(client, alias) {
  return ok(await client.rpc('buddy_find_by_alias', { candidate: alias }))[0] ?? null;
}

export async function requestFriend(client, me, userId) {
  ok(await client.from('buddy_friendships').insert({ requester: me, addressee: userId }));
}

export async function acceptFriend(client, me, userId) {
  ok(await client.from('buddy_friendships').update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('requester', userId).eq('addressee', me));
}

// Rimuove un amico, rifiuta una richiesta ricevuta o annulla una richiesta inviata.
export async function removeFriend(client, me, userId) {
  ok(await client.from('buddy_friendships').delete().or(`and(requester.eq.${me},addressee.eq.${userId}),and(requester.eq.${userId},addressee.eq.${me})`));
}

export async function createInvite(client, me) {
  return ok(await client.from('buddy_invites').insert({ user_id: me }).select('token').single()).token;
}

export async function acceptInvite(client, token) {
  return ok(await client.rpc('buddy_accept_invite', { invite: token }));
}

export async function loadNotifications(client, limit = 30) {
  const rows = ok(await client.from('buddy_notifications').select('id,kind,actor,post_id,comment_id,created_at,read_at').order('created_at', { ascending: false }).limit(limit));
  const names = await loadNames(client, rows.map((row) => row.actor));
  return rows.map((row) => ({ ...row, actorName: names.get(row.actor) ?? 'Qualcuno' }));
}

export async function markNotificationsRead(client, ids) {
  if (ids.length) ok(await client.from('buddy_notifications').update({ read_at: new Date().toISOString() }).in('id', ids));
}

export async function publishedSessionIds(client, me) {
  return ok(await client.from('buddy_posts').select('session_id').eq('user_id', me)).map((row) => row.session_id);
}

// Pubblica una seduta. Con «mostra i carichi» spento volume e record non lasciano il telefono.
// Pilates: durata, esercizi, attrezzo e traguardi; con «Mostra durata ed esercizi» spento resta l'attrezzo.
export function postStats(session, showLoads) {
  const summary = session.summary ?? {};
  if (session.mode === 'pilates') {
    const stats = { equipment: (summary.equipment ?? []).join(', ') };
    if (showLoads) {
      stats.duration = session.endedAt - session.startedAt;
      stats.exercises = summary.exercisesDone ?? 0;
      stats.milestones = (summary.milestones ?? []).map((item) => ({ title: item.title }));
    }
    return stats;
  }
  const stats = {
    duration: session.endedAt - session.startedAt,
    sets: summary.sets ?? 0,
    exercises: summary.exercisesDone ?? 0,
  };
  if (showLoads) {
    stats.volume = summary.volume ?? 0;
    stats.records = (summary.records ?? []).map((item) => ({ title: item.title, load: item.load, reps: item.reps }));
  }
  return stats;
}

export async function publishSession(client, me, session, { title, body, visibility, showLoads }) {
  ok(await client.from('buddy_posts').insert({
    user_id: me, session_id: session.id, workout_title: session.title,
    title: title.trim(), body: body.trim() || null, visibility, show_loads: showLoads, stats: postStats(session, showLoads),
    mode: session.mode === 'pilates' ? 'pilates' : 'gym',
  }));
}

// Titolo proposto: «Lower con record», altrimenti il nome della scheda.
export function suggestedTitle(session) {
  if (session.mode === 'pilates') return (session.summary?.milestones?.length ?? 0) > 0 ? `${session.title} con traguardo` : session.title;
  return (session.summary?.records?.length ?? 0) > 0 ? `${session.title} con record` : session.title;
}

// Notifiche raggruppate: «Marco e altri 11 ti hanno dato Forza».
export function groupNotifications(items) {
  const groups = [];
  for (const item of items) {
    const key = item.kind === 'strength' ? `strength:${item.post_id}` : item.id;
    const group = groups.find((entry) => entry.key === key);
    if (group) { group.items.push(item); continue; }
    groups.push({ key, kind: item.kind, postId: item.post_id, actor: item.actor, items: [item] });
  }
  return groups.map((group) => {
    const first = group.items[0].actorName;
    const others = group.items.length - 1;
    const who = others ? `${first} e ${others === 1 ? 'un altro' : `altri ${others}`}` : first;
    const plural = others > 0;
    const text = {
      strength: `${who} ${plural ? 'ti hanno' : 'ti ha'} dato Forza`,
      comment: `${first} ha commentato il tuo allenamento`,
      friend_request: `${first} vuole aggiungerti agli amici`,
      friend_accepted: `${first} ha accettato la tua amicizia`,
    }[group.kind];
    return { ...group, text, unread: group.items.some((item) => !item.read_at), at: group.items[0].created_at };
  });
}
