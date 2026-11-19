import { createCloudClient } from '../../src/cloud-account.js';

const byId = (id) => document.getElementById(id);
const authId = new URLSearchParams(location.search).get('authorization_id');
const returnToConsent = `${location.origin}${location.pathname}?authorization_id=${encodeURIComponent(authId ?? '')}`;
let client;
let busy = false;

function show(name) {
  for (const section of ['loading', 'login', 'decision', 'error']) byId(section).hidden = section !== name;
}

function status(message) { byId('status').textContent = message; }

function redirect(url) {
  if (!url) throw new Error('Indirizzo di ritorno mancante.');
  location.assign(url);
}

async function loadDecision() {
  status('');
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError || !user) { show('login'); return; }
  const { data, error } = await client.auth.oauth.getAuthorizationDetails(authId);
  if (error) throw error;
  if (data.redirect_url) { redirect(data.redirect_url); return; }
  if (data.user.id !== user.id) throw new Error('La richiesta non corrisponde all’account attivo.');
  byId('clientName').textContent = data.client?.name || 'Applicazione senza nome';
  byId('clientUri').textContent = data.client?.uri || '';
  byId('accountEmail').textContent = user.email || '';
  byId('scopes').textContent = data.scope || 'nessuno';
  show('decision');
}

async function decide(allow) {
  if (busy) return;
  busy = true;
  byId('approve').disabled = byId('deny').disabled = true;
  status(allow ? 'Autorizzazione in corso…' : 'Rifiuto in corso…');
  try {
    const action = allow ? client.auth.oauth.approveAuthorization : client.auth.oauth.denyAuthorization;
    const { data, error } = await action(authId, { skipBrowserRedirect: true });
    if (error) throw error;
    redirect(data.redirect_url);
  } catch (error) {
    status(error.message || 'Operazione non riuscita.');
    busy = false;
    byId('approve').disabled = byId('deny').disabled = false;
  }
}

byId('approve').addEventListener('click', () => void decide(true));
byId('deny').addEventListener('click', () => void decide(false));
for (const provider of ['google', 'apple']) {
  byId(provider).addEventListener('click', async () => {
    status('Apro l’accesso…');
    const { error } = await client.auth.signInWithOAuth({ provider, options: { redirectTo: returnToConsent } });
    if (error) status(error.message);
  });
}
byId('passwordForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  status('Accesso in corso…');
  const { error } = await client.auth.signInWithPassword({ email: byId('email').value, password: byId('password').value });
  if (error) { status(error.message); return; }
  try { await loadDecision(); } catch (failure) { status(failure.message); }
});

if (!authId || !/^[a-zA-Z0-9-]{8,200}$/.test(authId)) {
  show('error');
  status('Richiesta di autorizzazione mancante o non valida.');
} else {
  try {
    client = await createCloudClient();
    await loadDecision();
  } catch (error) {
    show('error');
    status(error.message || 'Impossibile caricare la richiesta.');
  }
}
