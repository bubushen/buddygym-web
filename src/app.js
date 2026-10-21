import { analyzeCurlVideo, compareCurlVideos } from './curl-analysis.js';
import { CURL_EXERCISE, curlVariant } from './exercise-catalog.js';
import { analysisGrid, SAMPLE_FPS, stabilizePoseFrames } from './pose-stabilization.js';
import { canDecodeSequentially, decodeFrames } from './video-decoder.js';
import { createPoseOverlay, measuredAngles } from './pose-overlay.js';
import { packFrames, unpackFrames } from './pose-frames.js';
import { exerciseSummary, loadWorkouts, makeId, migrateLegacyCurlLogs, saveWorkouts, WORKOUT_STORAGE_KEY } from './workouts.js';
import { ACTIVE_WORKOUT_KEY, formatElapsed, loadActiveWorkout } from './workout-session.js';
import { compareMovement, profileMovement } from './generic-pose.js';
import { deleteCachedPosesWithPrefix, deletePersonalReference, deletePersonalReferencesWithPrefix, getCachedPose, getPersonalReference, saveCachedPose, savePersonalReference } from './reference-store.js';
import { exerciseHistoryKey, exerciseLogKey, finishWorkoutSession, migratePreviousLog, readExerciseHistory, readSetLog, sessionMetric } from './workout-history.js';
import { endWorkoutCheck, plannedSets, restSecondsOf, rowDone, shortDate } from './workout-insights.js';
import { accountStorage, createCloudClient, deleteAccount, downloadAccount, signInWithProvider, uploadAccount } from './cloud-account.js';
import { authCallbackParameters, authRedirectUrl, isAuthCallback, isNativeApp, nativePlugin } from './native-app.js';
import { createLocalBackup, importLocalBackup } from './local-backup.js';
import { aliasAvailable, loadProfile, saveAlias, saveBirthDate, saveMode as saveProfileMode, savePrivacy, saveProfile } from './profile.js';
import { MODE_KEY, applyMode, currentMode, isPilates, readMode, saveMode } from './mode.js';
import { modePicker, renderWelcome } from './screens/mode.js';
import { renderPilatesBlock, renderPilatesExerciseForm, renderPilatesSummary } from './screens/pilates.js';
import { addMeasurement, loadMeasurements } from './measurements.js';
import { renderProfile } from './screens/profile.js';
import { renderWorkoutScreen } from './screens/workout.js';
import { renderNewWorkout } from './screens/new-workout.js';
import { confetti, renderSummary } from './screens/summary.js';
import { renderRest } from './screens/rest.js';
import { renderHistory as renderHistoryView } from './screens/history.js';
import { setSocialUser, openActions, openPublishSheet, renderFindFriends, renderFriendProfile, renderLeaderboard, renderPostDetail, renderSocialFeed } from './screens/social.js';
import * as social from './social.js';
import { openEndWorkoutSheet } from './screens/end-workout.js';
import { withScreenOn } from './screen-awake.js';
import * as pilates from './pilates.js';
import { exerciseEntries, exerciseKey, judgeSet, recordTimeline } from './records.js';
import { daysInRow } from './pilates.js';
import { ACTIVE_REST_KEY, adjustRest, createRest, loadRest, nextOpenSet, restRemaining } from './rest-timer.js';
import { formatDuration, workoutSummary } from './workout-summary.js';
import { SESSIONS_KEY, backfillSessions, historyTitles, historyView, loadSessions, sessionFromSummary, sessionMode, upsertSession } from './sessions.js';
import { createCoachUI } from './coach-ui.js';
import { canCompressVideo, compressVideo } from './video-compress.js';
import { keepFrameFitted } from './video-frame.js';
import { renderHome as renderHomeScreen } from './screens/home.js';
import { renderLogin } from './screens/login.js';
import { renderAliasPrompt, renderSignup, resetSignup } from './screens/signup.js';
import { renderNewPassword } from './screens/new-password.js';
import { signInError } from './account-rules.js';
import { el, emptyState, openSheet, pageHead, tabBar, timerBar, topBar, button as uiButton } from './ui/components.js';
import { icon } from './ui/icons.js';
import { disablePush, enablePush } from './push.js';
import { canEditWorkout, coachVideoUrl, downloadReferenceVideo, removeReferenceVideo, uploadReferenceVideo } from './coach-data.js';

// Librerie e modello sono inclusi nell'app (npm run vendor): nessun download a runtime.
const MEDIAPIPE_URL = new URL('../vendor/mediapipe/', import.meta.url).href;
const MODEL_URL = `${MEDIAPIPE_URL}pose_landmarker_heavy.task`;
const UNREADABLE_VIDEO = 'Impossibile leggere il video. I filmati HEVC dell’iPhone non si aprono su tutti i telefoni Android: registra in H.264 (iPhone: Impostazioni › Fotocamera › Formati › Più compatibile) e riprova.';

const videoInput = document.querySelector('#videoInput');
const referenceVideo = document.querySelector('#referenceVideo');
const video = document.querySelector('#video');
const videoName = document.querySelector('#videoName');
const canvas = document.querySelector('#overlay');
const attemptOverlay = createPoseOverlay(video, canvas);
const referenceOverlay = createPoseOverlay(referenceVideo, document.querySelector('#referenceOverlay'));
const emptyStage = document.querySelector('#emptyStage');
const analyzeButton = document.querySelector('#analyzeButton');
const status = document.querySelector('#status');
const feedback = document.querySelector('#feedback');
const appScroll = document.querySelector('#appScroll');
const deviceStorage = (() => { try { return window.localStorage; } catch { return null; } })();
let storage = deviceStorage;
let cloudClient;
let cloudUser;
let accessMode = null;
// Profilo dell'account (per l'iniziale nell'avatar).
let currentProfile = null;
let currentMeasurements = null;
let lastAccountMessage = '';
let benchAvailableHere = false;
let demoPreview = null;
let profileOwnerId;
let syncEnabled = false;
let syncTimer;
let syncQueue = Promise.resolve();
let uploadedIds = [];
let uploadedExerciseKeys = [];
let cloudReady = false;
let hydrating = false;
const syncMetaKey = (userId) => `buddygym:account-sync-state:${userId}`;
const dirtyKey = (userId) => `buddygym:account-pending:${userId}`;
migrateLegacyCurlLogs(storage);
let workouts = loadWorkouts(storage);
let activeWorkout = loadActiveWorkout(storage, workouts);

// Modalità: la sceglie WelcomeSplitScreen, che vede chiunque non abbia fatto l'accesso;
// chi usava già l'app resta in Palestra. La scelta fatta prima della registrazione resta
// «in attesa» e va nel profilo al primo accesso.
const MODE_PENDING_KEY = 'buddygym:mode-pending';
applyMode(readMode(deviceStorage) ?? 'gym');
// Sessione salvata dall'account (anche prima che Supabase risponda): niente lampo del benvenuto.
function hasStoredSession() {
  try {
    for (let index = 0; index < (deviceStorage?.length ?? 0); index += 1) {
      if (/^sb-.*-auth-token$/.test(deviceStorage.key(index) ?? '')) return true;
    }
  } catch { /* Senza archivio non c'è sessione. */ }
  return false;
}
const loggedOut = () => !cloudUser && !hasStoredSession();
// Schede o sequenze della modalità attiva: Palestra e Pilates non si mescolano.
const inMode = (workout) => (workout?.mode === 'pilates') === isPilates();
const modeWorkouts = () => workouts.filter(inMode);
const modeSessions = () => (storage ? loadSessions(storage) : []).filter((session) => sessionMode(session) === currentMode());

function chooseMode(mode, { pending = false } = {}) {
  saveMode(deviceStorage, mode);
  try {
    if (pending) deviceStorage.setItem(MODE_PENDING_KEY, mode);
    else deviceStorage.removeItem(MODE_PENDING_KEY);
  } catch { /* Vale per questa apertura. */ }
  historyState.filter = null;
}

async function changeMode(mode) {
  if (activeWorkout || mode === currentMode()) return;
  chooseMode(mode);
  if (cloudUser && cloudClient) {
    currentProfile = { ...(currentProfile ?? {}), mode };
    saveProfileMode(cloudClient, cloudUser.id, mode).catch((error) => {
      console.error('BUDDYGYM mode save failed', error);
      toast('Modalità non salvata sull\'account. Riprova quando hai internet.');
    });
    socialState.loaded = false;
  }
  renderRoute();
}

// Sesso, data di nascita, peso e altezza dalle prime pagine della registrazione: restano sul
// telefono finché l'account non è pronto (conferma via email o ritorno da Google), poi
// vanno nel profilo e nei dati corporei, senza sovrascrivere quelli già presenti.
const SIGNUP_PROFILE_KEY = 'buddygym:signup-profile';
function rememberSignupProfile(profile) {
  try { deviceStorage.setItem(SIGNUP_PROFILE_KEY, JSON.stringify(profile)); } catch { /* Si potranno inserire in Account. */ }
}
async function applySignupProfile(userId) {
  let pending = null;
  try { pending = JSON.parse(deviceStorage.getItem(SIGNUP_PROFILE_KEY) || 'null'); } catch { /* Niente da salvare. */ }
  if (!pending) return;
  try {
    const update = {};
    if (pending.sex && !currentProfile?.sex) update.sex = pending.sex;
    if (pending.birthDate && !currentProfile?.birth_date) update.birth_date = pending.birthDate;
    if (Object.keys(update).length) {
      await saveProfile(cloudClient, userId, update);
      currentProfile = { ...(currentProfile ?? {}), ...update };
    }
    for (const [metric, value] of [['peso', pending.weight], ['altezza', pending.height]]) {
      if (!value || currentMeasurements?.[metric]?.length) continue;
      const point = await addMeasurement(cloudClient, userId, metric, value);
      currentMeasurements?.[metric]?.push(point);
    }
    deviceStorage.removeItem(SIGNUP_PROFILE_KEY);
    resetSignup();
  } catch (error) {
    console.error('BUDDYGYM signup profile not saved', error);
  }
}

// All'accesso: la scelta fatta prima di registrarsi va nel profilo; altrimenti vale quella del profilo.
function syncModeWithProfile(profile) {
  let pending = null;
  try { pending = deviceStorage.getItem(MODE_PENDING_KEY); } catch { /* Nessuna scelta in attesa. */ }
  if (pending === 'gym' || pending === 'pilates') {
    try { deviceStorage.removeItem(MODE_PENDING_KEY); } catch { /* Già salvata. */ }
    if (profile?.mode !== pending) {
      if (profile) profile.mode = pending;
      saveProfileMode(cloudClient, cloudUser.id, pending).catch((error) => console.error('BUDDYGYM mode save failed', error));
    }
    return false;
  }
  const mode = profile?.mode;
  if ((mode !== 'gym' && mode !== 'pilates') || mode === currentMode() || activeWorkout) return false;
  chooseMode(mode);
  return true;
}
let activeExerciseKey;
let currentExercise;
let currentReference;
// 'builtin' (curl incluso), 'personal' (video dell'atleta) o 'coach'.
let currentReferenceSource = null;
let referenceUrl;
const screens = {
  welcome: document.querySelector('#welcomeScreen'),
  access: document.querySelector('#accessScreen'),
  coach: document.querySelector('#coachScreen'),
  bench: document.querySelector('#benchScreen'),
  home: document.querySelector('#homeScreen'),
  account: document.querySelector('#accountScreen'),
  workout: document.querySelector('#workoutScreen'),
  nutrition: document.querySelector('#nutritionScreen'),
  login: document.querySelector('#loginScreen'),
  signup: document.querySelector('#signupScreen'),
  newPassword: document.querySelector('#newPasswordScreen'),
  alias: document.querySelector('#aliasScreen'),
  summary: document.querySelector('#summaryScreen'),
  history: document.querySelector('#historyScreen'),
  social: document.querySelector('#socialScreen'),
  post: document.querySelector('#postScreen'),
  friend: document.querySelector('#friendScreen'),
  friends: document.querySelector('#friendsScreen'),
  leaderboard: document.querySelector('#leaderboardScreen'),
  coachingLocked: document.querySelector('#coachingLockedScreen'),
  workoutForm: document.querySelector('#workoutFormScreen'),
  exerciseForm: document.querySelector('#exerciseFormScreen'),
  exercise: document.querySelector('#exerciseScreen'),
  pilatesForm: document.querySelector('#pilatesFormScreen'),
};
const coachUI = createCoachUI(screens.coach, { onPreview: showDemoClient, prepareReference: prepareCoachReference });

function readAccessMode(userId) {
  try {
    const pending = sessionStorage.getItem('buddygym:login-mode');
    const saved = JSON.parse(sessionStorage.getItem('buddygym:access-mode') || 'null');
    const mode = pending || (saved?.userId === userId ? saved.mode : null);
    sessionStorage.removeItem('buddygym:login-mode');
    if (['client', 'coach'].includes(mode)) {
      sessionStorage.setItem('buddygym:access-mode', JSON.stringify({ userId, mode }));
      return mode;
    }
  } catch { /* La scelta resta disponibile durante questa apertura. */ }
  return null;
}

// L'area coach ora è la tab Coaching: all'accesso non si sceglie più il ruolo.
function prepareLoginMode() {
  return true;
}

function chooseAccess(mode) {
  if (!cloudUser || coachUI.isBusy()) return;
  accessMode = mode;
  try { sessionStorage.setItem('buddygym:access-mode', JSON.stringify({ userId: cloudUser.id, mode })); } catch { /* Vale per la sessione corrente. */ }
  renderAccount();
  openRoute(mode === 'coach' ? '#/coach' : '#/schede');
  updateWorkoutTimer();
}

async function showDemoClient(customer, plans) {
  if (!cloudUser || !deviceStorage || demoPreview) return;
  const userId = cloudUser.id;
  clearTimeout(syncTimer);
  await syncCloud();
  if (cloudUser?.id !== userId) return;
  demoPreview = customer;
  storage = accountStorage(deviceStorage, `${cloudUser.id}:demo:${customer.id}`);
  storage.setItem(WORKOUT_STORAGE_KEY, JSON.stringify(plans));
  workouts = plans;
  activeWorkout = loadActiveWorkout(storage, workouts);
  activeExerciseKey = undefined;
  document.querySelector('#demoPreviewLabel').textContent = `Prova cliente · ${customer.name}. I dati inseriti sono di test.`;
  document.querySelector('#demoPreviewBar').hidden = false;
  document.querySelector('#accountButton').hidden = true;
  accountMessage('Anteprima delle schede assegnate. Puoi simulare un allenamento senza modificare le prescrizioni.');
  openRoute('#/schede'); updateWorkoutTimer();
}

function exitDemoClient() {
  demoPreview = null;
  storage = cloudUser ? accountStorage(deviceStorage, cloudUser.id, scheduleCloudSync) : deviceStorage;
  workouts = loadWorkouts(storage);
  activeWorkout = loadActiveWorkout(storage, workouts);
  activeExerciseKey = undefined;
  document.querySelector('#demoPreviewBar').hidden = true;
  document.querySelector('#accountButton').hidden = false;
  openRoute('#/coaching'); updateWorkoutTimer();
}

document.querySelector('#chooseClientAccess').onclick = () => chooseAccess('client');
document.querySelector('#chooseCoachAccess').onclick = () => chooseAccess('coach');
document.querySelector('#exitDemoPreview').onclick = exitDemoClient;

function accountMessage(message) {
  lastAccountMessage = message;
  document.querySelector('#accountStatus').textContent = message;
  const status = document.querySelector('#profileStatus');
  if (status) status.textContent = message;
}

function pageCallbackParameters() {
  return authCallbackParameters(location.href);
}

function oauthCallbackMessage(parameters = pageCallbackParameters()) {
  if (!parameters.has('error')) return null;
  const description = parameters.get('error_description') ?? '';
  if (/invalid_client|unable to exchange external code/i.test(description)) {
    return 'Accesso non completato: verifica che Client ID e Client Secret del provider (Google o Apple) corrispondano a quelli salvati in Supabase.';
  }
  if (/provider is not enabled/i.test(description)) {
    return 'Accesso non completato: controlla che il provider sia attivo in Supabase.';
  }
  if (/access_denied/i.test(parameters.get('error'))) return 'Accesso annullato.';
  return 'Accesso non completato. Controlla le impostazioni del provider in Supabase e riprova.';
}

// Con PKCE il ritorno lascia ?code=… nell'indirizzo: va tolto dopo lo scambio.
function cleanAuthCallbackUrl() {
  const parameters = new URLSearchParams(location.search);
  const hadCallback = ['code', 'error', 'error_description', 'error_code'].some((key) => parameters.has(key));
  if (hadCallback || location.hash.startsWith('#error')) {
    history.replaceState(null, '', `${location.pathname}${location.hash.startsWith('#error') ? '' : location.hash}`);
  }
}

// App nativa: il browser di sistema riapre l'app con com.buddygym.app://auth/callback?code=…
async function handleNativeAuthUrl(url) {
  if (!isAuthCallback(url)) return;
  nativePlugin('Browser').close().catch(() => { /* Su Android la scheda si chiude da sola. */ });
  const parameters = authCallbackParameters(url);
  const message = oauthCallbackMessage(parameters);
  if (message) { showLoginNotice(message); return; }
  const code = parameters.get('code');
  if (!code || !cloudClient) return;
  accountMessage('Completo l’accesso…');
  const { error } = await cloudClient.auth.exchangeCodeForSession(code);
  if (error) showLoginNotice(`Accesso non riuscito: ${error.message}`);
}

function listenForNativeAuth() {
  const app = nativePlugin('App');
  app.addListener('appUrlOpen', ({ url }) => { void handleNativeAuthUrl(url); });
  // L'app può essere stata avviata proprio dal link, per esempio quello di conferma dell'email.
  app.getLaunchUrl().then((launch) => { if (launch?.url) void handleNativeAuthUrl(launch.url); }).catch(() => {});
}

function personalReferenceId(exerciseId) {
  return cloudUser ? `account:${cloudUser.id}:${exerciseId}` : exerciseId;
}

function renderAccount() {
  if (screens.account && !screens.account.hidden && cloudUser) renderProfileScreen();
}

function renderProfileScreen() {
  renderProfile(screens.account, {
    alias: currentProfile?.alias,
    email: cloudUser?.email ?? '',
    birthDate: currentProfile?.birth_date,
    measurements: currentMeasurements,
    status: lastAccountMessage,
    canRunBench: benchAvailableHere,
    version: appVersion,
    modeSection: modePicker({ mode: currentMode(), locked: !!activeWorkout, onChange: (mode) => { void changeMode(mode); } }),
    privacy: currentProfile ? { shareStats: currentProfile.share_stats !== false, shareLoads: currentProfile.share_loads !== false } : null,
    onPrivacy: async (key, value) => {
      if (!cloudUser) return false;
      const column = key === 'shareStats' ? 'share_stats' : 'share_loads';
      try {
        await savePrivacy(cloudClient, cloudUser.id, { [column]: value });
        currentProfile = { ...(currentProfile ?? {}), [column]: value };
        return true;
      } catch (error) {
        console.error('BUDDYGYM privacy save failed', error);
        toast('Impostazione non salvata. Riprova quando hai internet.');
        return false;
      }
    },
    onBack: () => openRoute('#/schede'),
    onChooseAlias: () => openRoute('#/alias'),
    onSaveMeasure: async (metric, value) => {
      if (!cloudUser || !currentMeasurements) return 'Profilo non ancora caricato. Riprova tra poco.';
      const userId = cloudUser.id;
      try {
        const point = await addMeasurement(cloudClient, userId, metric, value);
        if (cloudUser?.id === userId) currentMeasurements[metric].push(point);
        return null;
      } catch (error) {
        console.error('BUDDYGYM measurement save failed', error);
        return 'Misura non salvata. Riprova quando hai internet.';
      }
    },
    onSaveBirthDate: async (birthDate) => {
      if (!cloudUser) return 'Accedi di nuovo per salvare.';
      try {
        await saveBirthDate(cloudClient, cloudUser.id, birthDate);
        currentProfile = { ...(currentProfile ?? {}), birth_date: birthDate };
        return null;
      } catch (error) {
        console.error('BUDDYGYM birth date save failed', error);
        return 'Data non salvata. Riprova quando hai internet.';
      }
    },
    onRetrySync: retrySync,
    onExport: exportBackup,
    onImport: importBackup,
    onBench: () => openRoute('#/prova-modelli'),
    onDelete: deleteOwnAccount,
    onSignOut: signOut,
  });
}

async function loadAccountProfile(userId) {
  profileOwnerId = userId;
  try {
    const [profile, measurements] = await Promise.all([loadProfile(cloudClient, userId), loadMeasurements(cloudClient, userId)]);
    if (cloudUser?.id !== userId || profileOwnerId !== userId) return;
    currentProfile = profile;
    currentMeasurements = measurements;
    await applySignupProfile(userId);
    if (cloudUser?.id !== userId) return;
    if (syncModeWithProfile(profile)) renderRoute();
    if (!profile?.alias && !aliasPromptDismissed && !screens.home.hidden) openRoute('#/alias');
    else if (!screens.home.hidden) renderHome();
    renderAccount();
  } catch (error) {
    console.error('BUDDYGYM profile loading failed', error);
    if (cloudUser?.id !== userId || profileOwnerId !== userId) return;
    accountMessage('Non riesco a caricare il profilo. Tocca «Riprova sincronizzazione».');
  }
}

function scheduleCloudSync(key) {
  if (!cloudUser || hydrating || demoPreview) return;
  if (typeof key === 'string' && key !== WORKOUT_STORAGE_KEY && key !== SESSIONS_KEY && !key.startsWith('buddygym:history:v1:')) return;
  try { deviceStorage.setItem(dirtyKey(cloudUser.id), '1'); } catch { /* Il salvataggio locale resta la fonte temporanea. */ }
  if (!syncEnabled) return;
  clearTimeout(syncTimer);
  accountMessage('Modifiche salvate sul dispositivo. Sincronizzazione in corso…');
  syncTimer = setTimeout(() => { void syncCloud(); }, 700);
}

async function hydrateAccount(userId, userStorage) {
  hydrating = true;
  try { return await downloadAccount(cloudClient, userId, userStorage); }
  finally { hydrating = false; }
}

function syncCloud() {
  if (!cloudUser || !cloudClient || demoPreview) return Promise.resolve();
  const userId = cloudUser.id;
  const userStorage = storage;
  const client = cloudClient;
  syncQueue = syncQueue.catch(() => {}).then(async () => {
    if (cloudUser?.id !== userId) return;
    try {
      const currentWorkouts = loadWorkouts(userStorage);
      const currentIds = new Set(currentWorkouts.map((workout) => workout.id));
      const currentExerciseKeys = currentWorkouts.flatMap((workout) => workout.exercises.map((exercise) => `${workout.id}\0${exercise.id}`));
      const removed = uploadedIds.filter((id) => !currentIds.has(id));
      const removedExercises = uploadedExerciseKeys.filter((key) => !currentExerciseKeys.includes(key))
        .map((key) => { const [workoutId, exerciseId] = key.split('\0'); return { workoutId, exerciseId }; })
        .filter((item) => currentIds.has(item.workoutId));
      uploadedIds = await uploadAccount(client, userId, userStorage, removed, removedExercises);
      uploadedExerciseKeys = currentExerciseKeys;
      deviceStorage.setItem(syncMetaKey(userId), JSON.stringify({ workoutIds: uploadedIds, exerciseKeys: uploadedExerciseKeys }));
      deviceStorage.removeItem(dirtyKey(userId));
      if (cloudUser?.id === userId) accountMessage('Schede e storico sincronizzati con il tuo account.');
      return true;
    } catch (error) {
      console.error('BUDDYGYM sync failed', error);
      if (cloudUser?.id === userId) accountMessage('Sincronizzazione non riuscita. I dati restano sul dispositivo; riprova quando hai internet.');
      return false;
    }
  });
  return syncQueue;
}

async function handleAuthSession(session) {
  const user = session?.user ?? null;
  if (user?.id === cloudUser?.id && (user || cloudUser === null)) return;
  clearTimeout(syncTimer);
  syncEnabled = false;
  cloudUser = user;
  accessMode = user ? 'client' : null;
  demoPreview = null;
  coachUI.reset();
  document.querySelector('#demoPreviewBar').hidden = true;
  document.querySelector('#accountButton').hidden = false;
  profileOwnerId = user?.id;
  currentProfile = null;
  currentMeasurements = null;
  renderAccount();
  if (user) void loadAccountProfile(user.id);
  setSocialUser(user?.id ?? null);
  // Social: stato azzerato al cambio di account; pubblicati, notifiche e inviti in sospeso.
  Object.assign(socialState, { loaded: false, posts: [], friends: [], leaderboard: [], notifications: [], inviteLink: '', status: '' });
  publishedSessions.clear();
  setSocialUnread(false);
  if (user) {
    social.publishedSessionIds(cloudClient, user.id).then((ids) => { ids.forEach((id) => publishedSessions.add(id)); }).catch(() => {});
    void refreshNotifications();
    void acceptPendingInvite();
    void enablePush(cloudClient, { onOpen: (route) => openRoute(route), onReceive: () => { socialState.loaded = false; void refreshNotifications(); } });
  }
  activeExerciseKey = undefined;
  if (!user) {
    storage = deviceStorage;
    workouts = loadWorkouts(storage);
    activeWorkout = loadActiveWorkout(storage, workouts);
    uploadedIds = [];
    uploadedExerciseKeys = [];
    accountMessage('Le schede sono salvate su questo dispositivo.');
  } else {
    if (!deviceStorage) { accountMessage('Archivio locale non disponibile: non posso aprire l’account.'); return; }
    storage = accountStorage(deviceStorage, user.id, scheduleCloudSync);
    workouts = loadWorkouts(storage);
    activeWorkout = loadActiveWorkout(storage, workouts);
    renderRoute();
    accountMessage('Caricamento delle tue schede…');
    try {
      if (deviceStorage.getItem(dirtyKey(user.id)) && storage.getItem('buddygym:workouts:v2')) {
        let state = {};
        try { state = JSON.parse(deviceStorage.getItem(syncMetaKey(user.id)) || '{}'); } catch { /* Metadati recuperati dai dati locali. */ }
        uploadedIds = Array.isArray(state.workoutIds) ? state.workoutIds : [];
        uploadedExerciseKeys = Array.isArray(state.exerciseKeys) ? state.exerciseKeys : [];
        syncEnabled = true;
        accountMessage('Recupero le modifiche rimaste su questo dispositivo…');
        if (await syncCloud()) {
          const result = await hydrateAccount(user.id, storage);
          if (cloudUser?.id !== user.id) return;
          workouts = result.workouts;
          activeWorkout = loadActiveWorkout(storage, workouts);
          uploadedIds = workouts.map((workout) => workout.id);
          uploadedExerciseKeys = workouts.flatMap((workout) => workout.exercises.map((exercise) => `${workout.id}\0${exercise.id}`));
          accountMessage('Modifiche recuperate e schede sincronizzate.');
          renderRoute();
        }
        renderAccount();
        updateWorkoutTimer();
        return;
      }
      const result = await hydrateAccount(user.id, storage);
      if (cloudUser?.id !== user.id) return;
      workouts = result.workouts;
      activeWorkout = loadActiveWorkout(storage, workouts);
      uploadedIds = result.hasRemoteWorkouts ? workouts.map((workout) => workout.id) : [];
      uploadedExerciseKeys = result.hasRemoteWorkouts
        ? workouts.flatMap((workout) => workout.exercises.map((exercise) => `${workout.id}\0${exercise.id}`)) : [];
      deviceStorage.setItem(syncMetaKey(user.id), JSON.stringify({ workoutIds: uploadedIds, exerciseKeys: uploadedExerciseKeys }));
      syncEnabled = true;
      accountMessage(result.hasRemoteWorkouts
        ? 'Schede e storico caricati dal tuo account.'
        : 'Account pronto. Importa un backup se usavi già Buddy Gym su un altro indirizzo.');
      if (!result.hasRemoteWorkouts) scheduleCloudSync();
    } catch (error) {
      console.error('BUDDYGYM account loading failed', error);
      accountMessage('Non riesco a caricare i dati dell’account. Riprova quando hai internet.');
    }
  }
  renderAccount();
  updateWorkoutTimer();
  renderRoute();
}

async function initAccount() {
  try {
    cloudClient = await createCloudClient();
    cloudReady = true;
    // Un problema con i link di ritorno non deve rendere indisponibile tutto l'account.
    if (isNativeApp()) {
      try { listenForNativeAuth(); } catch (error) { console.error('BUDDYGYM deep links unavailable', error); }
    }
    cloudClient.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') return;
      // Link «Password dimenticata?»: l'utente è dentro con una sessione di recupero.
      if (event === 'PASSWORD_RECOVERY') setTimeout(() => openRoute('#/nuova-password'), 0);
      setTimeout(() => { void handleAuthSession(session); }, 0);
    });
    const { data, error } = await cloudClient.auth.getSession();
    if (error) throw error;
    await handleAuthSession(data.session);
    const callbackMessage = !data.session && oauthCallbackMessage();
    cleanAuthCallbackUrl();
    if (callbackMessage) showLoginNotice(callbackMessage);
  } catch (error) {
    console.error('BUDDYGYM cloud unavailable', error);
    accountMessage(oauthCallbackMessage() ?? 'Account non disponibile: verifica la connessione. Le schede locali continuano a funzionare.');
  }
}

document.querySelector('#accountButton').addEventListener('click', () => { if (!coachUI.isBusy()) openRoute('#/account'); });
// Messaggio da mostrare nella pagina di accesso (ritorno da Google, link scaduti…).
let loginNotice = '';
function showLoginNotice(text) {
  loginNotice = text;
  accountMessage(text);
  if (window.location.hash === '#/account') renderRoute();
  else openRoute('#/account');
}

function authUnavailable() {
  if (location.protocol === 'file:') return 'Apri Buddy Gym da http://127.0.0.1:4173 per accedere.';
  if (!cloudReady) return 'Servizio account non disponibile. Controlla la connessione e riapri l’app.';
  return null;
}

async function signInWith(provider, label) {
  const problem = authUnavailable();
  if (problem) return problem;
  try {
    const { error } = await signInWithProvider(cloudClient, provider);
    return error ? `Accesso con ${label} non riuscito: ${error.message}` : `Apro l’accesso con ${label}…`;
  } catch (error) {
    console.error('BUDDYGYM provider sign-in failed', error);
    return `Accesso con ${label} non riuscito: ${error?.message || error}`;
  }
}

const loginHandlers = {
  onBack: () => openRoute(cloudUser ? '#/schede' : '#/benvenuto'),
  onSignIn: async (email, password) => {
    const problem = authUnavailable();
    if (problem) return { message: problem };
    const { error } = await cloudClient.auth.signInWithPassword({ email, password });
    return error ? signInError(error) : { message: 'Accesso riuscito. Carico le tue schede…' };
  },
  onGoogle: () => signInWith('google', 'Google'),
  // L'App Store chiede «Accedi con Apple» quando c'è Google: solo nell'app per iPhone.
  onApple: globalThis.Capacitor?.getPlatform?.() === 'ios' ? () => signInWith('apple', 'Apple') : null,
  onForgot: async (email) => {
    const problem = authUnavailable();
    if (problem) return problem;
    const { error } = await cloudClient.auth.resetPasswordForEmail(email, { redirectTo: authRedirectUrl() });
    // Stesso messaggio che l'email esista o no: non si rivela chi è registrato.
    return error && !/rate|too many/i.test(error.message)
      ? `Invio non riuscito: ${error.message}`
      : error ? 'Troppe richieste. Riprova tra qualche minuto.' : 'Se l’email è registrata, ti abbiamo mandato il link per scegliere una nuova password.';
  },
  onSignup: () => openRoute('#/registrati'),
};

// Versione installata, in fondo ad Accesso e Profilo: nell'app nativa è data e ora della build.
let appVersion = isNativeApp() ? '' : 'Versione web';
if (isNativeApp()) {
  nativePlugin('App').getInfo().then((info) => {
    appVersion = `Versione ${info.version}`;
    for (const node of document.querySelectorAll('.bg-version')) node.textContent = appVersion;
  }).catch(() => {});
}
function appendVersion(root) {
  root.querySelector('main')?.append(el('p', { className: 'bg-note bg-note--center bg-version', text: appVersion }));
}

function renderLoginScreen() {
  const view = renderLogin(screens.login, loginHandlers);
  appendVersion(screens.login);
  if (loginNotice) { view.setStatus(loginNotice); loginNotice = ''; }
}

const checkAlias = (alias) => (cloudClient ? aliasAvailable(cloudClient, alias) : Promise.resolve(null));

function renderSignupScreen() {
  renderSignup(screens.signup, document.querySelector('#dockSlot'), {
    onBack: () => openRoute('#/benvenuto'),
    onLogin: () => openRoute('#/account'),
    onGoogle: (profile) => { rememberSignupProfile(profile); return signInWith('google', 'Google'); },
    checkAlias,
    onCreate: async ({ alias, email, birthDate, password, sex }) => {
      const problem = authUnavailable();
      if (problem) return { message: problem };
      rememberSignupProfile({ sex, birthDate });
      const { data, error } = await cloudClient.auth.signUp({
        email, password,
        options: { emailRedirectTo: authRedirectUrl(), data: { alias, birth_date: birthDate, mode: currentMode() } },
      });
      if (error) {
        if (/already|registered|exists/i.test(error.message)) return { field: 'email', message: 'Esiste già un account con questa email.' };
        // Il profilo nasce con l'account: se l'alias è stato preso nel frattempo il database rifiuta.
        if (/database error saving new user/i.test(error.message)) return { field: 'alias', message: 'Questo alias è già preso: scegline un altro.' };
        return { message: `Registrazione non riuscita: ${error.message}` };
      }
      return { message: data.session ? 'Account creato. Carico le tue schede…' : 'Controlla la tua email e conferma l’account, poi torna qui per accedere.' };
    },
  });
}

// Account senza alias (registrati con Google): lo si chiede una volta per sessione.
let aliasPromptDismissed = false;
function renderAliasScreen() {
  renderAliasPrompt(screens.alias, {
    checkAlias,
    onLater: () => { aliasPromptDismissed = true; openRoute('#/schede'); },
    onSave: async (alias) => {
      if (!cloudUser) return 'Accedi di nuovo per scegliere l’alias.';
      try {
        await saveAlias(cloudClient, cloudUser.id, alias);
      } catch (error) {
        return error?.code === '23505' ? 'Questo alias è già preso: scegline un altro.' : `Alias non salvato: ${error.message}`;
      }
      currentProfile = { ...(currentProfile ?? {}), alias };
      aliasPromptDismissed = true;
      openRoute('#/schede');
      return '';
    },
  });
}

function renderNewPasswordScreen() {
  renderNewPassword(screens.newPassword, {
    onBack: () => openRoute('#/account'),
    onSave: async (password) => {
      if (!cloudUser) return 'Il link non è più valido. Chiedi un nuovo link da «Password dimenticata?».';
      const { error } = await cloudClient.auth.updateUser({ password });
      if (error) return `Password non salvata: ${error.message}`;
      openRoute('#/account');
      accountMessage('Password aggiornata.');
      return 'Password aggiornata.';
    },
  });
}

async function signOut() {
  clearTimeout(syncTimer);
  await syncCloud();
  await disablePush(cloudClient);
  const { error } = await cloudClient.auth.signOut();
  if (!error) {
    try { sessionStorage.removeItem('buddygym:access-mode'); sessionStorage.removeItem('buddygym:login-mode'); } catch { /* Sessione già chiusa. */ }
    // Fuori dall'account si torna alla scelta Palestra / Pilates.
    openRoute('#/benvenuto');
  }
  if (error) accountMessage(`Uscita non riuscita: ${error.message}`);
}
function removeLocalAccountData(userId) {
  const prefix = `buddygym:account:${userId}:`;
  const exact = [syncMetaKey(userId), dirtyKey(userId)];
  const keys = [];
  for (let index = 0; index < deviceStorage.length; index += 1) {
    const key = deviceStorage.key(index);
    if (key && (key.startsWith(prefix) || exact.includes(key))) keys.push(key);
  }
  for (const key of keys) deviceStorage.removeItem(key);
}

// Richiesto da App Store e Google Play: l'account si elimina dall'app, non solo su richiesta.
async function deleteOwnAccount() {
  if (!cloudUser || !cloudClient || coachUI.isBusy()) return;
  if (!window.confirm('Eliminare definitivamente il tuo account? Schede, storico, profilo, area coach e video del coach verranno cancellati dal cloud e da questo dispositivo.')) return;
  if (window.prompt('Per confermare scrivi ELIMINA')?.trim().toLocaleUpperCase('it') !== 'ELIMINA') { accountMessage('Eliminazione annullata.'); return; }
  const userId = cloudUser.id;
  clearTimeout(syncTimer);
  syncEnabled = false;
  accountMessage('Eliminazione dell’account in corso…');
  try {
    // Una sincronizzazione in corso potrebbe ricreare righe dopo l'eliminazione.
    await syncQueue.catch(() => {});
    await deleteAccount(cloudClient, userId);
  } catch (error) {
    console.error('BUDDYGYM account deletion failed', error);
    syncEnabled = true;
    accountMessage(`Eliminazione non riuscita: ${error.message || 'errore sconosciuto'}. L’account non è stato eliminato: riprova quando hai internet.`);
    return;
  }
  try { removeLocalAccountData(userId); } catch { /* L'account cloud è già eliminato. */ }
  await deletePersonalReferencesWithPrefix(`account:${userId}:`).catch(() => {});
  await deleteCachedPosesWithPrefix(`local:account:${userId}:`).catch(() => {});
  await deleteCachedPosesWithPrefix(`path:${userId}/`).catch(() => {});
  try { sessionStorage.removeItem('buddygym:access-mode'); sessionStorage.removeItem('buddygym:login-mode'); } catch { /* Sessione già chiusa. */ }
  // L'utente non esiste più: basta dimenticare la sessione su questo dispositivo.
  await cloudClient.auth.signOut({ scope: 'local' }).catch(() => {});
  await handleAuthSession(null);
  showLoginNotice('Account eliminato. I tuoi dati sono stati cancellati dal cloud e da questo dispositivo.');
}

async function retrySync() {
  if (!cloudUser) return;
  if (!syncEnabled) {
    const user = cloudUser;
    cloudUser = null;
    await handleAuthSession({ user });
    return;
  }
  accountMessage('Sincronizzazione in corso…');
  await syncCloud();
  if (!currentMeasurements) await loadAccountProfile(cloudUser.id);
}
window.addEventListener('online', scheduleCloudSync);

function exportBackup() {
  try {
    const backup = createLocalBackup(storage);
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `buddygym-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    accountMessage('Backup delle schede e dello storico scaricato. I video personali sono esclusi.');
  } catch (error) { accountMessage(error.message); }
}
async function importBackup(file) {
  if (!file || !storage) return;
  try {
    const backup = JSON.parse(await file.text());
    importLocalBackup(storage, backup);
    workouts = loadWorkouts(storage);
    activeWorkout = loadActiveWorkout(storage, workouts);
    renderRoute();
    accountMessage(cloudUser ? 'Backup importato. Sincronizzazione in corso…' : 'Backup importato su questo dispositivo.');
    if (cloudUser) await syncCloud();
  } catch (error) { accountMessage(`Importazione non riuscita: ${error.message}`); }
}

let poseLandmarker;
let attemptUrl;
// Il file dell'esecuzione, solo in memoria, per decodificarlo in sequenza durante l'analisi.
let attemptFile = null;
let attemptValid = false;
let working = false;

keepFrameFitted(referenceVideo);
keepFrameFitted(video);
referenceVideo.src = CURL_EXERCISE.referenceVideo;

// TimerBar in alto su ogni schermata finché l'allenamento è in corso.
let timerBarNode = null;
let timerBarKey = '';
function updateWorkoutTimer() {
  const slot = document.querySelector('#timerSlot');
  const workout = activeWorkout && workouts.find((item) => item.id === activeWorkout.workoutId);
  const visible = !!workout && !(accessMode === 'coach' && !demoPreview);
  document.querySelector('#phoneShell').dataset.timer = visible ? 'on' : 'off';
  if (!visible) { slot.replaceChildren(); timerBarNode = null; timerBarKey = ''; syncNativeTimer(null); return; }
  const parts = window.location.hash.split('/');
  const exercise = parts[1] === 'esercizio' && parts[2] === workout.id ? workout.exercises.find((item) => item.id === parts[3]) : null;
  if (exercise) lastActiveExerciseId = exercise.id;
  const label = `${workout.title} · ${exercise ? exercise.title : 'in corso'}`;
  syncNativeTimer(workout, exercise);
  const time = formatElapsed(activeWorkout.startedAt);
  if (!timerBarNode || timerBarKey !== label) {
    timerBarKey = label;
    timerBarNode = timerBar({
      label, time,
      // Dall'esercizio si torna alla scheda; dalle altre pagine all'allenamento in corso.
      onOpen: () => openRoute(`#/scheda/${workout.id}`),
      onStop: () => { void endWorkout(); },
    });
    slot.replaceChildren(timerBarNode);
  } else timerBarNode.setTime(time);
}

// Android: notifica fissa con il cronometro (e chip nella barra di stato su Android 16).
// Si aggiorna solo quando cambiano scheda o esercizio: il tempo lo conta il sistema.
let nativeTimerKey = '';
let lastActiveExerciseId = null;
function syncNativeTimer(workout, exercise) {
  const plugin = globalThis.Capacitor?.Plugins?.WorkoutTimer;
  if (!plugin) return;
  if (!workout) {
    if (nativeTimerKey) plugin.stop().catch(() => {});
    nativeTimerKey = '';
    return;
  }
  const shown = exercise ?? workout.exercises.find((item) => item.id === lastActiveExerciseId);
  const key = `${activeWorkout.startedAt}:${workout.title}:${shown?.id ?? ''}`;
  if (key === nativeTimerKey) return;
  nativeTimerKey = key;
  plugin.start({ startedAt: activeWorkout.startedAt, title: workout.title, text: shown ? shown.title : workout.mode === 'pilates' ? 'Sessione in corso' : 'Allenamento in corso' })
    .catch((error) => console.warn('BUDDYGYM workout notification unavailable', error));
}

// Pulsanti della notifica: com.buddygym.app://workout/open oppure /end.
function handleWorkoutUrl(url) {
  if (!url?.startsWith('com.buddygym.app://workout/')) return false;
  const workout = activeWorkout && workouts.find((item) => item.id === activeWorkout.workoutId);
  if (!workout) { openRoute('#/schede'); return true; }
  const exercise = workout.exercises.find((item) => item.id === lastActiveExerciseId);
  openRoute(exercise ? `#/esercizio/${workout.id}/${exercise.id}` : `#/scheda/${workout.id}`);
  if (url.endsWith('/end')) setTimeout(() => { void endWorkout(); }, 300);
  return true;
}

// Avvia il cronometro della scheda; un allenamento già in corso viene prima salvato.
function startWorkout(workout) {
  if (activeWorkout?.workoutId === workout.id) return true;
  if (activeWorkout) {
    const previousWorkout = workouts.find((item) => item.id === activeWorkout.workoutId);
    if (previousWorkout && !window.confirm(`«${previousWorkout.title}» è ancora in corso. Terminarlo e salvarlo nello storico per iniziare «${workout.title}»?`)) return false;
    if (previousWorkout && storage && !finishWorkoutSession(storage, previousWorkout, activeWorkout)) {
      window.alert('Non riesco a salvare il precedente allenamento. Riprova prima di avviarne uno nuovo.');
      return false;
    }
  }
  for (const exercise of workout.exercises) migratePreviousLog(storage, workout.id, exercise, false);
  activeWorkout = { workoutId: workout.id, startedAt: Date.now() };
  try { storage.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify(activeWorkout)); } catch { /* Il timer continua finché la pagina rimane aperta. */ }
  updateWorkoutTimer();
  return true;
}

// Fine allenamento: conferma, salvataggio nello storico e riepilogo.
// «Termina allenamento» apre sempre la conferma (EndWorkoutSheet), da qualunque punto.
function endWorkout() {
  if (!activeWorkout || document.querySelector('#sheetSlot .bg-sheet')) return;
  const workout = workouts.find((item) => item.id === activeWorkout.workoutId);
  if (!workout) { void finishWorkout(); return; }
  const logs = workout.exercises.map((exercise) => readSetLog(storage, workout.id, exercise.id));
  openEndWorkoutSheet({
    workoutTitle: workout.title,
    duration: formatDuration(Date.now() - activeWorkout.startedAt),
    pilates: workout.mode === 'pilates',
    check: workout.mode === 'pilates' ? pilates.endSessionCheck(workout, logs) : endWorkoutCheck(workout, logs),
    onEnd: () => { void finishWorkout(); },
  });
}

async function finishWorkout() {
  if (!activeWorkout) return;
  const workout = workouts.find((item) => item.id === activeWorkout.workoutId);
  const session = activeWorkout;
  const endedAt = Date.now();
  if (workout && storage && !finishWorkoutSession(storage, workout, session, endedAt)) {
    window.alert('Non riesco a salvare lo storico su questo dispositivo. L’allenamento resta aperto: riprova.');
    return;
  }
  // La seduta entra nello Storico con il suo riepilogo, anche senza serie registrate.
  if (workout && storage) {
    const sessionId = `workout-${session.startedAt}`;
    const summary = workout.mode === 'pilates'
      ? pilatesSessionSummary(workout, sessionId, session.startedAt, endedAt)
      : { ...workoutSummary(storage, workout, sessionId, workouts), duration: endedAt - session.startedAt };
    upsertSession(storage, sessionFromSummary(workout, sessionId, session.startedAt, endedAt, summary));
  }
  activeWorkout = null;
  clearRest();
  clearPilates();
  try { storage.removeItem(ACTIVE_WORKOUT_KEY); } catch { /* Timer comunque fermato in questa pagina. */ }
  if (!storage) window.alert('Il browser non consente il salvataggio locale: questa seduta non è stata aggiunta allo storico.');
  updateWorkoutTimer();
  if (workout) {
    celebrateSession = `workout-${session.startedAt}`;
    openRoute(`#/riepilogo/${workout.id}/${session.startedAt}/${endedAt}`);
  } else openRoute('#/schede');
}
// Sedute già pubblicate sul Social (si riempie dal database quando l'account è collegato).
const publishedSessions = new Set();
// Pubblica (dal riepilogo o dallo Storico): sempre una scelta dell'utente, mai automatica.
function openPublish(workout, sessionId) {
  if (!cloudUser || !cloudClient) { showLoginNotice('Accedi per pubblicare i tuoi allenamenti sul Social.'); return; }
  const session = storage ? loadSessions(storage).find((item) => item.id === sessionId) : null;
  if (!session) { toast('Allenamento non trovato nello Storico.'); return; }
  openPublishSheet({
    session,
    suggested: social.suggestedTitle(session),
    onPublish: async (choice) => {
      try {
        await social.publishSession(cloudClient, cloudUser.id, session, choice);
      } catch (error) {
        console.error('BUDDYGYM publish failed', error);
        return /duplicate|23505/.test(`${error.code} ${error.message}`) ? 'Questo allenamento è già stato pubblicato.' : 'Pubblicazione non riuscita. Riprova quando hai internet.';
      }
      publishedSessions.add(session.id);
      socialState.loaded = false;
      toast('Pubblicato');
      renderRoute();
      return null;
    },
  });
}

// I coriandoli partono una volta sola, all'apertura del riepilogo appena finito.
let celebrateSession = null;

function renderSummaryScreen(workout, startedAt, endedAt) {
  const sessionId = `workout-${startedAt}`;
  const celebrate = celebrateSession === sessionId;
  celebrateSession = null;
  if (workout.mode === 'pilates') {
    const saved = storage ? loadSessions(storage).find((item) => item.id === sessionId) : null;
    renderPilatesSummary(screens.summary, document.querySelector('#dockSlot'), {
      workout,
      summary: saved?.summary ?? pilatesSessionSummary(workout, sessionId, startedAt, endedAt),
      name: currentProfile?.alias || currentProfile?.first_name || '',
      celebrate, confetti,
      published: publishedSessions.has(sessionId),
      onDone: () => openRoute('#/schede'),
      onPublish: () => openPublish(workout, sessionId),
    });
    if (celebrate) celebrationHaptic();
    return;
  }
  renderSummary(screens.summary, document.querySelector('#dockSlot'), {
    workout,
    summary: { ...workoutSummary(storage, workout, sessionId, workouts), ...(endedAt > startedAt ? { duration: endedAt - startedAt } : {}) },
    name: currentProfile?.alias || currentProfile?.first_name || '',
    celebrate,
    published: publishedSessions.has(sessionId),
    onDone: () => openRoute('#/schede'),
    onPublish: () => openPublish(workout, sessionId),
  });
  if (celebrate) celebrationHaptic();
}

// Riepilogo di una seduta dallo Storico: com'era quel giorno, senza coriandoli, con la data.
function renderSessionSummary(session) {
  if (sessionMode(session) === 'pilates') {
    renderPilatesSummary(screens.summary, document.querySelector('#dockSlot'), {
      workout: { id: session.workoutId, title: session.title },
      summary: { ...session.summary, duration: session.endedAt - session.startedAt, endedAt: session.endedAt },
      name: currentProfile?.alias || currentProfile?.first_name || '',
      celebrate: false, confetti,
      date: new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }).format(session.endedAt),
      published: publishedSessions.has(session.id),
      onDone: () => openRoute('#/storico'),
      onPublish: () => openPublish({ id: session.workoutId, title: session.title }, session.id),
    });
    return;
  }
  renderSummary(screens.summary, document.querySelector('#dockSlot'), {
    workout: { id: session.workoutId, title: session.title },
    summary: { ...session.summary, duration: session.endedAt - session.startedAt },
    name: currentProfile?.alias || currentProfile?.first_name || '',
    celebrate: false,
    date: new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }).format(session.endedAt),
    published: publishedSessions.has(session.id),
    onDone: () => openRoute('#/storico'),
    onPublish: () => openPublish({ id: session.workoutId, title: session.title }, session.id),
  });
}

// Leggera vibrazione «success» insieme ai coriandoli, dove il telefono la supporta.
function celebrationHaptic() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const haptics = globalThis.Capacitor?.Plugins?.Haptics;
  if (haptics?.notification) haptics.notification({ type: 'SUCCESS' }).catch(() => {});
  else navigator.vibrate?.(40);
}

updateWorkoutTimer();
setInterval(updateWorkoutTimer, 1000);

// Recupero tra le serie (ExerciseRestScreen). Il cronometro dell'allenamento continua.
let activeRest = storage ? loadRest(storage) : null;
let restView = null;
let restAudio = null;
const restPanel = document.querySelector('#restPanel');

function saveRest() {
  try {
    if (activeRest) storage.setItem(ACTIVE_REST_KEY, JSON.stringify(activeRest));
    else storage.removeItem(ACTIVE_REST_KEY);
  } catch { /* Il recupero continua finché la pagina resta aperta. */ }
}

function clearRest() {
  if (activeRest) nativeRest(null);
  activeRest = null;
  saveRest();
  hideRestPanel();
}

// App Android: il recupero lo conta anche il servizio dell'allenamento, che suona a schermo bloccato.
const nativeTimer = () => globalThis.Capacitor?.Plugins?.WorkoutTimer;
function nativeRest(rest) {
  const plugin = nativeTimer();
  if (!plugin?.startRest) return;
  const call = rest
    ? plugin.startRest({ endsAt: rest.endsAt, total: rest.total, next: rest.next, detail: rest.detail, set: rest.nextIndex + 1 })
    : plugin.cancelRest();
  call.catch((error) => console.warn('BUDDYGYM native rest unavailable', error));
}

// +15 s e Salta dalla notifica, o fine del recupero mentre l'app era in background.
function syncNativeRest(state) {
  if (!activeRest) return;
  if (state?.endsAt) {
    activeRest = { ...activeRest, endsAt: state.endsAt, total: state.total || activeRest.total };
    saveRest();
    tickRest();
  } else {
    finishRest(false, restRemaining(activeRest) === 0);
  }
}
if (nativeTimer()?.addListener) {
  nativeTimer().addListener('restChanged', syncNativeRest);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && activeRest) nativeTimer().getRest().then(syncNativeRest).catch(() => {});
  });
}

function startRest(workout, exercise, nextIndex, detail) {
  unlockRestAudio();
  activeRest = {
    ...createRest({ workoutId: workout.id, exerciseId: exercise.id, nextIndex, seconds: restSecondsOf(exercise) }),
    next: `Prossima: serie ${nextIndex + 1} di ${Math.max(plannedSets(exercise), nextIndex + 1, document.querySelectorAll('#setRows .bg-set').length)}`,
    detail,
  };
  saveRest();
  nativeRest(activeRest);
  showRestIfHere();
}

function restIsHere() {
  const parts = window.location.hash.split('/');
  return !!activeRest && !screens.exercise.hidden && parts[1] === 'esercizio'
    && parts[2] === activeRest.workoutId && parts[3] === activeRest.exerciseId;
}

// Il pannello prende il posto delle frecce solo nella pagina dell'esercizio in recupero.
function showRestIfHere() {
  if (!restIsHere()) { hideRestPanel(); return; }
  document.querySelector('#exerciseNav').hidden = true;
  restView = renderRest(restPanel, {
    remaining: restRemaining(activeRest),
    total: activeRest.total,
    next: activeRest.next,
    detail: activeRest.detail,
    onMinus: () => { activeRest = adjustRest(activeRest, -15); saveRest(); nativeRest(activeRest); tickRest(); },
    onPlus: () => { activeRest = adjustRest(activeRest, 15); saveRest(); nativeRest(activeRest); tickRest(); },
    onSkip: () => { nativeRest(null); finishRest(false); },
  });
}

function hideRestPanel() {
  if (restPanel.hidden) return;
  restPanel.hidden = true;
  restView = null;
  pauseView = null;
  if (!screens.exercise.hidden) document.querySelector('#exerciseNav').hidden = false;
}

function tickRest() {
  if (!activeRest) return;
  if (activeWorkout?.workoutId !== activeRest.workoutId) { clearRest(); return; }
  const remaining = restRemaining(activeRest);
  if (remaining === 0) { finishRest(true); return; }
  restView?.update(remaining, activeRest.total);
}

// Fine recupero: segnale, «Vai: serie N» per 2 secondi, poi il cursore sulla serie successiva.
function finishRest(signal, showGo = signal) {
  const rest = activeRest;
  if (!rest) return;
  activeRest = null;
  saveRest();
  if (signal) restSignal();
  const here = restView && restIsHereFor(rest);
  if (!here) { hideRestPanel(); return; }
  const focusNext = () => {
    hideRestPanel();
    if (!restIsHereFor(rest)) return;
    document.querySelectorAll('#setRows .bg-set')[rest.nextIndex]?.querySelector('input')?.focus({ preventScroll: false });
  };
  if (!showGo) { focusNext(); return; }
  restView.go(`Vai: serie ${rest.nextIndex + 1}`);
  setTimeout(focusNext, 2000);
}

function restIsHereFor(rest) {
  const parts = window.location.hash.split('/');
  return !screens.exercise.hidden && parts[2] === rest.workoutId && parts[3] === rest.exerciseId;
}

// Vibrazione e suono breve. Nell'app Android li gestisce il telefono, che rispetta
// il silenzioso; sul web il suono usa la sessione audio «ambient» (iPhone: tace col silenzioso).
function restSignal() {
  // Nell'app Android suona e vibra il servizio, anche a schermo bloccato: qui niente doppioni.
  if (nativeTimer()?.startRest) return;
  navigator.vibrate?.([200, 100, 200]);
  try {
    if (!restAudio) return;
    const oscillator = restAudio.createOscillator();
    const gain = restAudio.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.2, restAudio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, restAudio.currentTime + 0.25);
    oscillator.connect(gain).connect(restAudio.destination);
    oscillator.start();
    oscillator.stop(restAudio.currentTime + 0.25);
  } catch { /* Senza audio resta la vibrazione. */ }
}

// L'audio del browser si sblocca solo durante un tocco: lo prepariamo alla spunta.
function unlockRestAudio() {
  if (nativeTimer()?.startRest) return;
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'ambient';
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!restAudio && Context) restAudio = new Context();
    restAudio?.resume?.();
  } catch { /* Senza audio resta la vibrazione. */ }
}

setInterval(tickRest, 250);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tickRest(); });

// ── Pilates: timer dell'esercizio e pausa tra gli esercizi (PilatesExerciseScreen) ──
// Tutto si calcola dagli orari salvati: a schermo spento conta e vibra il servizio Android,
// al ritorno l'app ricostruisce dov'è arrivata la sequenza.
let pilatesClock = storage ? pilates.loadClock(storage) : null;
let pilatesView = null;
let pilatesViewKey = '';
let pauseView = null;

function savePilatesClock() {
  try {
    if (pilatesClock) storage.setItem(pilates.PILATES_CLOCK_KEY, JSON.stringify(pilatesClock));
    else storage.removeItem(pilates.PILATES_CLOCK_KEY);
  } catch { /* Il timer continua finché la pagina resta aperta. */ }
  syncNativePlan();
}

function clearPilates() {
  if (!pilatesClock) return;
  pilatesClock = null;
  savePilatesClock();
  hidePausePanel();
}

const clockWorkout = () => (pilatesClock ? workouts.find((item) => item.id === pilatesClock.workoutId) : null);

// Esercizi fatti nella sessione in corso: una riga { seconds, level } nel registro dell'esercizio.
function pilatesDone(workout) {
  const done = new Set();
  workout.exercises.forEach((exercise, index) => { if (readSetLog(storage, workout.id, exercise.id)[0]?.seconds > 0) done.add(index); });
  return done;
}

function markPilatesDone(workout, items) {
  for (const { index, seconds } of items) {
    const exercise = workout.exercises[index];
    try { storage.setItem(exerciseLogKey(workout.id, exercise.id), JSON.stringify([{ seconds, level: exercise.level, done: true }])); } catch { /* Resta nel timer. */ }
  }
}

// Riepilogo della sessione Pilates appena finita (salvato nello Storico con la seduta).
function pilatesSessionSummary(workout, sessionId, startedAt, endedAt) {
  const histories = workout.exercises.map((exercise) => readExerciseHistory(storage, workout.id, exercise.id).sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0)));
  const done = histories.map((history) => history.find((entry) => entry.sessionId === sessionId)?.rows[0] ?? null);
  const before = histories.map((history) => history.filter((entry) => entry.sessionId !== sessionId));
  const sessions = loadSessions(storage).filter((item) => sessionMode(item) === 'pilates' && item.id !== sessionId && item.endedAt <= endedAt);
  return pilates.pilatesSummary({ workout, done, history: before, sessions, startedAt, endedAt });
}

// Sul web vibra il telefono; nell'app Android vibra e suona il servizio (anche a schermo spento).
function pilatesSignal() {
  if (nativeTimer()?.startPlan) return;
  restSignal();
}

function syncNativePlan() {
  const plugin = nativeTimer();
  // A sessione finita il servizio si ferma da solo (stop) e cancella anche le fasi.
  if (!plugin?.startPlan || !activeWorkout) return;
  const workout = clockWorkout();
  const phases = pilatesClock?.running && workout ? pilates.upcomingPhases(pilatesClock, workout) : [];
  (phases.length ? plugin.startPlan({ phases: JSON.stringify(phases) }) : plugin.cancelPlan())
    .catch((error) => console.warn('BUDDYGYM native plan unavailable', error));
}

function pilatesRouteIndex(workout) {
  const parts = window.location.hash.split('/');
  if (parts[1] !== 'esercizio' || parts[2] !== workout.id || screens.exercise.hidden) return -1;
  return workout.exercises.findIndex((item) => item.id === parts[3]);
}

// Applica il risultato del timer: esercizi fatti, pausa, esercizio successivo o fine.
function applyPilates(result, workout, { signal = true } = {}) {
  const before = pilatesClock;
  markPilatesDone(workout, result.done);
  pilatesClock = result.clock;
  savePilatesClock();
  if (signal && (result.done.length || before?.phase !== pilatesClock?.phase)) pilatesSignal();
  const here = pilatesRouteIndex(workout);
  // Fine pausa: si passa da soli all'esercizio che parte.
  if (pilatesClock?.phase === 'exercise' && before?.phase === 'pause' && here >= 0 && here !== pilatesClock.index) {
    openRoute(`#/esercizio/${workout.id}/${workout.exercises[pilatesClock.index].id}`);
  } else if (!screens.workout.hidden) renderWorkout(workout);
  if (result.finished) setTimeout(() => { void endWorkout(); }, 400);
  drawPilates();
}

function tickPilates() {
  if (!pilatesClock) return;
  const workout = clockWorkout();
  if (!workout || activeWorkout?.workoutId !== workout.id) { clearPilates(); return; }
  const result = pilates.advanceClock(pilatesClock, workout);
  if (result.done.length || result.clock !== pilatesClock) applyPilates(result, workout);
  else drawPilates();
}

// Stato del timer per l'esercizio aperto: in corso, in pausa, fatto o da avviare.
function pilatesStateFor(workout, index) {
  const total = workout.exercises[index].seconds * 1000;
  if (pilatesClock?.workoutId === workout.id && pilatesClock.phase === 'exercise' && pilatesClock.index === index) {
    return { remaining: pilates.remainingMs(pilatesClock), total, mode: pilatesClock.running ? 'running' : 'paused' };
  }
  if (activeWorkout?.workoutId === workout.id && pilatesDone(workout).has(index)) return { remaining: 0, total, mode: 'done' };
  return { remaining: total, total, mode: 'idle' };
}

function drawPilates() {
  const workout = workouts.find((item) => item.mode === 'pilates' && pilatesRouteIndex(item) >= 0);
  if (!workout) { hidePausePanel(); return; }
  const index = pilatesRouteIndex(workout);
  pilatesView?.update(pilatesStateFor(workout, index));
  if (pilatesClock?.workoutId === workout.id && pilatesClock.phase === 'pause') showPausePanel(workout);
  else hidePausePanel();
}

function showPausePanel(workout) {
  const next = workout.exercises[pilatesClock.index];
  const remaining = Math.ceil(pilates.remainingMs(pilatesClock) / 1000);
  const total = Math.max(1, Math.round(pilatesClock.duration / 1000));
  if (pauseView?.key === `${pilatesClock.workoutId}:${pilatesClock.index}`) { pauseView.update(remaining, total); return; }
  document.querySelector('#exerciseNav').hidden = true;
  const adjust = (delta) => { pilatesClock = pilates.adjustPause(pilatesClock, delta); savePilatesClock(); pauseView?.update(Math.ceil(pilates.remainingMs(pilatesClock) / 1000), Math.max(1, Math.round(pilatesClock.duration / 1000))); };
  pauseView = renderRest(restPanel, {
    remaining, total,
    over: 'Pausa', step: 5, skipLabel: 'Inizia ora',
    next: `Prossimo: ${next.title}`,
    detail: `${pilates.clockText(next.seconds)} · ${pilates.exerciseMeta(next)}`,
    onMinus: () => adjust(-5),
    onPlus: () => adjust(5),
    onSkip: () => {
      const target = clockWorkout();
      if (!target) return;
      pilatesClock = pilates.skipPause(pilatesClock, target);
      savePilatesClock();
      hidePausePanel();
      openRoute(`#/esercizio/${target.id}/${target.exercises[pilatesClock.index].id}`);
    },
  });
  pauseView.key = `${pilatesClock.workoutId}:${pilatesClock.index}`;
}

function hidePausePanel() {
  if (!pauseView) return;
  pauseView = null;
  restPanel.hidden = true;
  if (!screens.exercise.hidden) document.querySelector('#exerciseNav').hidden = false;
}

// La pagina dell'esercizio in modalità Pilates: anello, Pausa/Fatto, dati e ultime volte.
function renderPilatesExercise(workout, exercise) {
  const index = workout.exercises.indexOf(exercise);
  const history = readExerciseHistory(storage, workout.id, exercise.id).filter((entry) => entry.rows[0]?.seconds > 0)
    .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
  pilatesView = renderPilatesBlock(document.querySelector('#pilatesBlock'), {
    exercise, history,
    state: pilatesStateFor(workout, index),
    onStart: () => {
      if (activeWorkout?.workoutId !== workout.id && !startWorkout(workout)) return;
      unlockRestAudio();
      pilatesClock = pilates.startExercise(workout, index);
      savePilatesClock();
      drawPilates();
    },
    onPause: () => { pilatesClock = pilates.pauseClock(pilatesClock); savePilatesClock(); drawPilates(); },
    onResume: () => { pilatesClock = pilates.resumeClock(pilatesClock); savePilatesClock(); drawPilates(); },
    onDone: () => {
      if (activeWorkout?.workoutId !== workout.id && !startWorkout(workout)) return;
      unlockRestAudio();
      // «Fatto» senza aver avviato il timer: l'esercizio conta per la sua durata.
      const running = pilatesClock?.workoutId === workout.id && pilatesClock.phase === 'exercise' && pilatesClock.index === index
        ? pilatesClock : { ...pilates.startExercise(workout, index), startedAt: Date.now() - exercise.seconds * 1000 };
      applyPilates(pilates.finishExercise(running, workout), workout, { signal: false });
    },
  });
  drawPilates();
}

setInterval(tickPilates, 250);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tickPilates(); });

function openRoute(route) {
  if (window.location.hash === route) renderRoute();
  else window.location.hash = route;
}

// Iniziale dell'utente nell'avatar: nome del profilo, altrimenti email.
function accountInitial() {
  const source = currentProfile?.alias || currentProfile?.first_name || cloudUser?.email || '';
  return source ? source.trim().charAt(0).toLocaleUpperCase('it') : null;
}

function renderHome() {
  renderHomeScreen(screens.home, {
    workouts: modeWorkouts(),
    storage,
    pilates: isPilates(),
    streak: isPilates() ? daysInRow(modeSessions()) : 0,
    activeWorkoutId: activeWorkout?.workoutId ?? null,
    initial: accountInitial(),
    canAdd: !demoPreview,
    onAccount: () => { if (!coachUI.isBusy()) openRoute('#/account'); },
    onAdd: () => openRoute('#/nuova-scheda'),
    onOpen: (workout) => openRoute(`#/scheda/${workout.id}`),
    onStart: (workout) => { if (startWorkout(workout)) openRoute(`#/scheda/${workout.id}`); },
  });
}

// Storico: mese mostrato e filtro restano finché l'app è aperta.
const historyState = { year: new Date().getFullYear(), month: new Date().getMonth(), filter: null };
function renderHistoryScreen() {
  if (storage) backfillSessions(storage, workouts);
  // Lo Storico mostra solo le sessioni della modalità attiva.
  const sessions = modeSessions();
  const titles = historyTitles(sessions, modeWorkouts());
  if (historyState.filter && !titles.includes(historyState.filter)) historyState.filter = null;
  renderHistoryView(screens.history, {
    view: historyView(sessions, { year: historyState.year, month: historyState.month, workoutTitle: historyState.filter }),
    year: historyState.year,
    month: historyState.month,
    titles,
    filter: historyState.filter,
    pilates: isPilates(),
    initial: accountInitial(),
    onAccount: () => openRoute('#/account'),
    onFilter: (title) => { historyState.filter = title; renderHistoryScreen(); },
    onMonth: (step) => {
      const date = new Date(historyState.year, historyState.month + step, 1);
      historyState.year = date.getFullYear();
      historyState.month = date.getMonth();
      renderHistoryScreen();
    },
    onOpen: (session) => openRoute(`#/storico/${encodeURIComponent(session.id)}`),
    onEmpty: () => openRoute('#/schede'),
  });
}

// ── Social ─────────────────────────────────────────────────────────────
const socialState = { loaded: false, posts: [], names: new Map(), leaderboard: [], notifications: [], friends: [], status: '', inviteLink: '', period: 'week' };

function toast(text) {
  const slot = document.querySelector('#toastSlot');
  const node = el('p', { className: 'bg-toast', text });
  slot.replaceChildren(node);
  setTimeout(() => { if (node.isConnected) node.remove(); }, 2500);
}

function socialLocked(root, title) {
  root.replaceChildren(
    pageHead({ title }),
    el('div', { className: 'bg-form' },
      emptyState('Accedi per vedere gli allenamenti dei tuoi amici.'),
      uiButton({ label: 'Accedi', onClick: () => openRoute('#/account') })));
}

// Notifiche nell'app: accendono il pallino sulla voce Social.
async function refreshNotifications() {
  if (!cloudUser || !cloudClient) { socialState.notifications = []; setSocialUnread(false); return; }
  try {
    const [items, friends] = await Promise.all([social.loadNotifications(cloudClient), social.loadFriendships(cloudClient, cloudUser.id)]);
    socialState.notifications = social.groupNotifications(items);
    socialState.friends = friends;
    setSocialUnread(socialState.notifications.some((group) => group.unread) || pendingRequests().length > 0);
  } catch (error) { console.warn('BUDDYGYM notifications unavailable', error); }
}
// Richieste di amicizia ricevute: restano visibili finché non si accetta o rifiuta.
const pendingRequests = () => socialState.friends.filter((item) => item.kind === 'received');
async function answerRequest(userId, accept, after) {
  try {
    if (accept) await social.acceptFriend(cloudClient, cloudUser.id, userId);
    else await social.removeFriend(cloudClient, cloudUser.id, userId);
  } catch { toast('Operazione non riuscita. Riprova.'); return; }
  socialState.friends = socialState.friends.filter((item) => item.userId !== userId || item.kind !== 'received');
  if (accept) toast('Ora siete amici');
  socialState.loaded = false;
  setSocialUnread(socialState.notifications.some((group) => group.unread) || pendingRequests().length > 0);
  after();
}
function setSocialUnread(value) {
  if (socialUnread === value) return;
  socialUnread = value;
  const screen = Object.entries(screens).find(([, element]) => !element.hidden)?.[0];
  if (screen) renderChrome(screen);
}
setInterval(() => { if (cloudUser && !document.hidden) void refreshNotifications(); }, 120_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && cloudUser) void refreshNotifications(); });

async function loadSocial() {
  const me = cloudUser.id;
  const [feed, leaderboard, friends] = await Promise.all([
    social.loadFeed(cloudClient, me),
    social.loadLeaderboard(cloudClient).catch(() => []),
    social.loadFriendships(cloudClient, me).catch(() => []),
    refreshNotifications(),
  ]);
  if (cloudUser?.id !== me) return;
  Object.assign(socialState, { loaded: true, posts: feed.posts, names: feed.names, leaderboard, friends });
}

function renderSocialScreen() {
  if (!cloudUser || !cloudClient) { socialLocked(screens.social, 'Social'); return; }
  const draw = () => {
    const unread = socialState.notifications.filter((group) => group.unread);
    renderSocialFeed(screens.social, {
      me: cloudUser.id,
      initial: accountInitial(),
      leaderboard: socialState.leaderboard,
      notifications: socialState.notifications,
      requests: pendingRequests(),
      onRequest: (userId, accept) => answerRequest(userId, accept, () => renderSocialScreen()),
      onRequester: (userId) => openRoute(`#/social/amico/${userId}`),
      posts: socialState.posts,
      names: socialState.names,
      status: socialState.loaded ? socialState.status : 'Carico gli allenamenti dei tuoi amici…',
      onAccount: () => openRoute('#/account'),
      onFindFriends: () => openRoute('#/social/amici'),
      onLeaderboard: () => openRoute('#/social/classifica'),
      onNotification: (group) => {
        void social.markNotificationsRead(cloudClient, group.items.map((item) => item.id)).catch(() => {});
        group.unread = false;
        if (group.postId) openRoute(`#/social/post/${group.postId}`);
        else if (group.kind === 'friend_request') openRoute('#/social/amici');
        else openRoute(`#/social/amico/${group.actor}`);
      },
      onPost: (post) => openRoute(`#/social/post/${post.id}`),
      onAuthor: (userId) => openRoute(userId === cloudUser.id ? '#/account' : `#/social/amico/${userId}`),
      onStrength: (post) => strengthen(post, draw),
      onMenu: (post) => postMenu(post, () => { socialState.loaded = false; renderSocialScreen(); }),
    });
    // Novità viste: il pallino si spegne (restano in lista finché non si toccano).
    if (unread.length) {
      void social.markNotificationsRead(cloudClient, unread.flatMap((group) => group.items.filter((item) => !item.read_at).map((item) => item.id))).catch(() => {});
      setSocialUnread(pendingRequests().length > 0);
    }
  };
  draw();
  if (!socialState.loaded) {
    loadSocial().then(() => { if (!screens.social.hidden) draw(); }).catch((error) => {
      console.error('BUDDYGYM social unavailable', error);
      socialState.status = 'Social non disponibile. Controlla la connessione.';
      socialState.loaded = true;
      if (!screens.social.hidden) draw();
      socialState.loaded = false;
    });
  }
}

// «Forza»: cambia subito sullo schermo, poi si salva; se non riesce torna com'era.
async function strengthen(post, redraw) {
  const before = { strength: post.strength, strengthByMe: post.strengthByMe };
  try {
    const wasOn = post.strengthByMe;
    post.strengthByMe = !wasOn;
    post.strength += wasOn ? -1 : 1;
    redraw();
    await social.toggleStrength(cloudClient, cloudUser.id, { ...post, strengthByMe: wasOn });
  } catch (error) {
    console.error('BUDDYGYM strength failed', error);
    Object.assign(post, before);
    redraw();
    toast('Non riesco a salvare. Riprova.');
  }
}

function confirmAction(label, actionText, run) {
  openActions(label, [{ text: actionText, danger: true, run }]);
}

function postMenu(post, after) {
  const name = socialState.names.get(post.userId) ?? 'questo utente';
  if (post.mine) {
    openActions('Il tuo post', [{ text: 'Elimina post', danger: true, run: () => confirmAction('Eliminare il post?', 'Elimina', async () => {
      try { await social.deletePost(cloudClient, post.id); publishedSessions.delete(post.sessionId); toast('Post eliminato'); after(); } catch { toast('Post non eliminato. Riprova.'); }
    }) }]);
    return;
  }
  openActions('Altre azioni', [
    { text: 'Segnala post', run: async () => { try { await social.report(cloudClient, cloudUser.id, 'post', post.id); toast('Segnalazione inviata. Grazie.'); } catch { toast('Segnalazione non inviata. Riprova.'); } } },
    { text: `Blocca ${name}`, danger: true, run: () => blockFlow(post.userId, name, after) },
  ]);
}

function blockFlow(userId, name, after) {
  confirmAction(`Bloccare ${name}? Non vedrete più i rispettivi post e l'amicizia viene rimossa.`, 'Blocca', async () => {
    try { await social.blockUser(cloudClient, cloudUser.id, userId); toast(`${name} è bloccato.`); socialState.loaded = false; after(); } catch { toast('Blocco non riuscito. Riprova.'); }
  });
}

async function renderPostScreen(postId) {
  if (!cloudUser || !cloudClient) { socialLocked(screens.post, 'Post'); return; }
  const dock = document.querySelector('#dockSlot');
  screens.post.replaceChildren(topBar({ title: 'Post', onBack: () => openRoute('#/social') }), emptyState('Carico il post…'));
  let data;
  try { data = await social.loadPost(cloudClient, cloudUser.id, postId); } catch { data = undefined; }
  if (!window.location.hash.includes(postId)) return;
  if (!data) { screens.post.replaceChildren(topBar({ title: 'Post', onBack: () => openRoute('#/social') }), emptyState(data === null ? 'Questo post non è più disponibile.' : 'Post non disponibile. Controlla la connessione.')); return; }
  const { post, names } = data;
  const redraw = () => renderPostDetail(screens.post, dock, {
    me: cloudUser.id, post, names,
    onBack: () => openRoute('#/social'),
    onStrength: () => strengthen(post, redraw),
    onAuthor: (userId) => openRoute(userId === cloudUser.id ? '#/account' : `#/social/amico/${userId}`),
    onMenu: () => postMenu(post, () => openRoute('#/social')),
    onSend: async (body) => {
      try { await social.addComment(cloudClient, cloudUser.id, post.id, body); } catch { toast('Commento non inviato. Riprova.'); return false; }
      socialState.loaded = false;
      void renderPostScreen(post.id);
      return true;
    },
    onCommentMenu: (comment) => commentMenu(post, comment, () => renderPostScreen(post.id), names),
  });
  redraw();
}

function commentMenu(post, comment, after, names) {
  const mine = comment.user_id === cloudUser.id;
  const actions = [];
  if (mine) {
    actions.push({ text: 'Modifica', run: () => editCommentSheet(comment, after) });
  } else {
    actions.push({ text: 'Segnala commento', run: async () => { try { await social.report(cloudClient, cloudUser.id, 'comment', comment.id); toast('Segnalazione inviata. Grazie.'); } catch { toast('Segnalazione non inviata. Riprova.'); } } });
    actions.push({ text: `Blocca ${names.get(comment.user_id) ?? 'utente'}`, danger: true, run: () => blockFlow(comment.user_id, names.get(comment.user_id) ?? 'questo utente', after) });
  }
  if (mine || post.mine) {
    actions.push({ text: 'Elimina', danger: true, run: () => confirmAction('Eliminare il commento?', 'Elimina', async () => {
      try { await social.deleteComment(cloudClient, comment.id); socialState.loaded = false; after(); } catch { toast('Commento non eliminato. Riprova.'); }
    }) });
  }
  openActions(mine ? 'Il tuo commento' : 'Commento', actions);
}

function editCommentSheet(comment, after) {
  const area = el('textarea', { className: 'bg-textarea', maxlength: 1000, 'aria-label': 'Modifica il commento' });
  area.value = comment.body;
  const save = uiButton({ label: 'Salva' });
  const view = openSheet({ label: 'Modifica commento', content: el('div', { className: 'bg-sheet__body' }, el('h2', { text: 'Modifica commento' }), area, save) });
  save.addEventListener('click', async () => {
    const body = area.value.trim();
    if (!body) return;
    save.disabled = true;
    try { await social.editComment(cloudClient, comment.id, body); view.close(); after(); } catch { save.disabled = false; toast('Modifica non salvata. Riprova.'); }
  });
  area.focus();
}

async function renderFriendScreen(userId) {
  if (!cloudUser || !cloudClient) { socialLocked(screens.friend, 'Profilo'); return; }
  const me = cloudUser.id;
  const draw = async () => {
    let friendships = socialState.friends;
    if (!socialState.loaded) friendships = await social.loadFriendships(cloudClient, me).catch(() => []);
    const relation = friendships.find((item) => item.userId === userId);
    const names = await social.loadNames(cloudClient, [userId]).catch(() => new Map());
    const friend = { userId, alias: relation?.alias ?? names.get(userId) ?? 'Utente', kind: relation?.kind ?? 'none' };
    const [stats, feed] = await Promise.all([
      social.loadFriendStats(cloudClient, userId, socialState.period).catch(() => null),
      friend.kind === 'friend' ? social.loadFeed(cloudClient, me, { userId, limit: 10 }).catch(() => ({ posts: [], names: new Map() })) : { posts: [], names: new Map() },
    ]);
    if (!window.location.hash.includes(userId)) return;
    renderFriendProfile(screens.friend, {
      friend, stats, period: socialState.period, posts: feed.posts, names: feed.names,
      onBack: () => openRoute('#/social'),
      onPeriod: (period) => { socialState.period = period; void draw(); },
      onPost: (post) => openRoute(`#/social/post/${post.id}`),
      onStrength: (post) => strengthen(post, () => draw()),
      onMenu: () => openActions('Altre azioni', [
        { text: 'Segnala utente', run: async () => { try { await social.report(cloudClient, me, 'user', userId); toast('Segnalazione inviata. Grazie.'); } catch { toast('Segnalazione non inviata. Riprova.'); } } },
        { text: `Blocca ${friend.alias}`, danger: true, run: () => blockFlow(userId, friend.alias, () => openRoute('#/social')) },
      ]),
      onFriendship: async () => {
        if (friend.kind === 'friend') {
          confirmAction(`Rimuovere ${friend.alias} dagli amici?`, 'Rimuovi amico', async () => {
            try { await social.removeFriend(cloudClient, me, userId); socialState.loaded = false; toast('Amico rimosso'); void draw(); } catch { toast('Non riesco a rimuovere l\'amico. Riprova.'); }
          });
          return;
        }
        try {
          if (friend.kind === 'received') await social.acceptFriend(cloudClient, me, userId);
          else if (friend.kind === 'sent') await social.removeFriend(cloudClient, me, userId);
          else await social.requestFriend(cloudClient, me, userId);
        } catch { toast('Operazione non riuscita. Riprova.'); return; }
        socialState.loaded = false;
        void refreshNotifications();
        void draw();
      },
    });
  };
  screens.friend.replaceChildren(topBar({ title: 'Profilo', onBack: () => openRoute('#/social') }), emptyState('Carico il profilo…'));
  await draw();
}

async function renderFriendsScreen() {
  if (!cloudUser || !cloudClient) { socialLocked(screens.friends, 'Trova amici'); return; }
  const me = cloudUser.id;
  const draw = async () => {
    socialState.friends = await social.loadFriendships(cloudClient, me).catch(() => socialState.friends);
    setSocialUnread(socialState.notifications.some((group) => group.unread) || pendingRequests().length > 0);
    if (window.location.hash !== '#/social/amici') return;
    renderFindFriends(screens.friends, {
      friends: socialState.friends,
      inviteLink: socialState.inviteLink,
      status: socialState.status,
      onBack: () => openRoute('#/social'),
      onOpen: (userId) => openRoute(`#/social/amico/${userId}`),
      onAccept: (userId) => answerRequest(userId, true, () => void draw()),
      onDecline: (userId) => answerRequest(userId, false, () => void draw()),
      onSearch: async (alias) => {
        let found;
        try { found = await social.findByAlias(cloudClient, alias); } catch { return el('p', { text: 'Ricerca non riuscita. Controlla la connessione.' }); }
        if (!found) return el('p', { text: `Nessun utente con l'alias «${alias}».` });
        const labels = { friends: 'Siete già amici', sent: 'Richiesta già inviata', received: 'Ti ha chiesto l\'amicizia' };
        const row = el('div', { className: 'bg-exrow bg-exlist' }, el('span', { className: 'bg-exrow__body' }, el('span', { className: 'bg-exrow__name', text: found.alias }), el('span', { className: 'bg-exrow__meta', text: labels[found.status] ?? '' })));
        if (found.status === 'none' || found.status === 'received') {
          row.append(uiButton({ label: found.status === 'received' ? 'Accetta' : 'Aggiungi', block: false, onClick: async () => {
            try {
              if (found.status === 'received') await social.acceptFriend(cloudClient, me, found.user_id);
              else await social.requestFriend(cloudClient, me, found.user_id);
              toast(found.status === 'received' ? 'Ora siete amici' : 'Richiesta inviata');
              socialState.loaded = false;
              void draw();
            } catch { toast('Operazione non riuscita. Riprova.'); }
          } }));
        }
        return row;
      },
      onInvite: async () => {
        try {
          if (!socialState.inviteLink) socialState.inviteLink = `${WEB_APP_URL}#/invito/${await social.createInvite(cloudClient, me)}`;
          const text = `Allenati con me su BuddyGym: ${socialState.inviteLink}`;
          if (navigator.share) await navigator.share({ title: 'BuddyGym', text }).catch(() => {});
          else await navigator.clipboard?.writeText(socialState.inviteLink);
          toast(navigator.share ? 'Link di invito pronto' : 'Link di invito copiato');
        } catch { toast('Link non creato. Riprova.'); }
        void draw();
      },
    });
  };
  screens.friends.replaceChildren(topBar({ title: 'Trova amici', onBack: () => openRoute('#/social') }), emptyState('Carico i tuoi amici…'));
  await draw();
}

async function renderLeaderboardScreen() {
  if (!cloudUser || !cloudClient) { socialLocked(screens.leaderboard, 'Classifica'); return; }
  const rows = await social.loadLeaderboard(cloudClient).catch(() => socialState.leaderboard);
  if (window.location.hash !== '#/social/classifica') return;
  renderLeaderboard(screens.leaderboard, {
    me: cloudUser.id, rows,
    onBack: () => openRoute('#/social'),
    onAuthor: (userId) => openRoute(userId === cloudUser.id ? '#/account' : `#/social/amico/${userId}`),
  });
}

// Link di invito: «…/#/invito/TOKEN». Senza account si accede prima e poi si accetta.
const WEB_APP_URL = 'https://bubushen.github.io/buddygym-web/';
// L'invito resta salvato finché non viene accettato (anche dopo registrazione e conferma email).
const INVITE_KEY = 'buddygym:pending-invite';
let pendingInvite = (() => { try { return deviceStorage?.getItem(INVITE_KEY) ?? null; } catch { return null; } })();
function rememberInvite(token) {
  pendingInvite = token;
  try { if (token) deviceStorage?.setItem(INVITE_KEY, token); else deviceStorage?.removeItem(INVITE_KEY); } catch { /* Resta in memoria. */ }
}
async function acceptPendingInvite() {
  if (!pendingInvite || !cloudUser || !cloudClient) return;
  const token = pendingInvite;
  rememberInvite(null);
  try {
    const inviter = await social.acceptInvite(cloudClient, token);
    socialState.loaded = false;
    toast('Ora siete amici');
    openRoute(`#/social/amico/${inviter}`);
  } catch (error) {
    toast(error?.message?.includes('scaduto') ? 'Invito non valido o scaduto.' : 'Invito non accettato. Riprova.');
    openRoute('#/social');
  }
}

function renderNutrition() {
  screens.nutrition.replaceChildren(
    pageHead({ title: 'Nutrizione' }),
    emptyState('La sezione Nutrizione è in arrivo.'));
}

function renderCoachingLocked() {
  screens.coachingLocked.replaceChildren(
    pageHead({ title: 'Coaching', subtitle: 'Template, esercizi e schede per i tuoi clienti.' }),
    el('div', { className: 'bg-form' },
      emptyState('Accedi per usare l’area coach.'),
      uiButton({ label: 'Accedi', onClick: () => openRoute('#/account') })));
}

const TAB_SCREENS = { home: 'schede', history: 'storico', nutrition: 'nutrizione', coachingLocked: 'coaching', coach: 'coaching', social: 'social', friends: 'social', leaderboard: 'social' };
// Pallino sulla voce Social: nuovi commenti o «Forza» non ancora visti.
let socialUnread = false;
// Schermate già passate al nuovo design: senza la vecchia intestazione.
const NEW_DESIGN_SCREENS = new Set(['welcome', 'home', 'nutrition', 'coachingLocked', 'login', 'signup', 'newPassword', 'alias', 'account', 'workout', 'exercise', 'workoutForm', 'exerciseForm', 'pilatesForm', 'summary', 'coach', 'history', 'social', 'post', 'friend', 'friends', 'leaderboard']);

function renderChrome(screen) {
  document.querySelector('#phoneShell').dataset.chrome = NEW_DESIGN_SCREENS.has(screen) ? 'new' : 'legacy';
  const slot = document.querySelector('#tabBarSlot');
  const current = demoPreview ? null : TAB_SCREENS[screen];
  slot.replaceChildren(current ? tabBar({ current, dots: { social: socialUnread }, onSelect: (tab) => openRoute(`#/${tab}`) }) : '');
}

function renderWorkout(workout) {
  const active = activeWorkout?.workoutId === workout.id;
  renderWorkoutScreen(screens.workout, document.querySelector('#dockSlot'), {
    workout, storage, active,
    pilatesProgress: workout.mode === 'pilates' ? { done: pilatesDone(workout), current: pilatesClock?.workoutId === workout.id ? pilatesClock.index : null } : null,
    editable: canEditWorkout(workout),
    onBack: () => openRoute('#/schede'),
    onOpenExercise: (exercise) => openRoute(`#/esercizio/${workout.id}/${exercise.id}`),
    onStart: () => { if (startWorkout(workout)) renderWorkout(workout); },
    onStop: () => { void endWorkout(); },
    onEdit: () => openRoute(`#/modifica-scheda/${workout.id}`),
    onAddExercise: () => openRoute(`#/nuovo-esercizio/${workout.id}`),
  });
}

function showFormError(id, message) {
  const element = document.querySelector(id);
  element.textContent = message;
  element.hidden = !message;
}

// Bozza della scheda (NewWorkoutScreen): nome ed esercizi restano in memoria finché
// non si tocca «Salva scheda»; gli esercizi si aggiungono e modificano dentro la bozza.
let workoutDraft = null;
const draftRoute = () => (workoutDraft?.id ? `#/modifica-scheda/${workoutDraft.id}` : '#/nuova-scheda');

function renderWorkoutForm(workout) {
  if (!workoutDraft || workoutDraft.id !== (workout?.id ?? null)) {
    discardDraft();
    const mode = workout ? (workout.mode === 'pilates' ? 'pilates' : 'gym') : currentMode();
    workoutDraft = { id: workout?.id ?? null, title: workout?.title ?? '', exercises: structuredClone(workout?.exercises ?? []), createdIds: [], dirty: false, mode };
  }
  renderNewWorkout(screens.workoutForm, document.querySelector('#dockSlot'), {
    draft: workoutDraft,
    editing: !!workout,
    onClose: () => {
      if (workoutDraft.dirty && !window.confirm(`Uscire senza salvare? Le modifiche alla ${workoutDraft.mode === 'pilates' ? 'sequenza' : 'scheda'} andranno perse.`)) return;
      discardDraft();
      openRoute(workout ? `#/scheda/${workout.id}` : '#/schede');
    },
    onAddExercise: () => openRoute('#/nuovo-esercizio/bozza'),
    onOpenExercise: (exercise) => openRoute(`#/modifica-esercizio/bozza/${exercise.id}`),
    onSave: saveDraft,
    onDelete: workout ? async () => { if (await deleteWorkout(workout.id)) discardDraft(); } : null,
  });
}

// Esercizi creati nella bozza e mai salvati: si liberano i loro video di riferimento.
function discardDraft() {
  if (!workoutDraft) return;
  for (const exercise of workoutDraft.exercises.filter((item) => workoutDraft.createdIds.includes(item.id))) {
    getPersonalReference(personalReferenceId(exercise.id)).catch(() => null).then((local) => {
      forgetReference(exercise, local);
      return deletePersonalReference(personalReferenceId(exercise.id));
    }).catch(() => {});
  }
  workoutDraft = null;
}

function removeExerciseData(workoutId, exercise) {
  try { storage.removeItem(exerciseHistoryKey(workoutId, exercise.id)); storage.removeItem(exerciseLogKey(workoutId, exercise.id)); } catch { /* Il cloud elimina comunque lo storico. */ }
  getPersonalReference(personalReferenceId(exercise.id)).catch(() => null).then((local) => {
    forgetReference(exercise, local);
    return deletePersonalReference(personalReferenceId(exercise.id));
  }).catch(() => {});
}

function saveDraft() {
  if (demoPreview || accessMode === 'coach') return 'Le schede non si possono modificare in questa modalità.';
  const draft = workoutDraft;
  const title = draft.title.trim();
  const next = structuredClone(workouts);
  let id = draft.id;
  let removed = [];
  if (id) {
    const workout = next.find((item) => item.id === id);
    if (!canEditWorkout(workout)) return 'Questa scheda non si può modificare.';
    removed = workout.exercises.filter((exercise) => !draft.exercises.some((item) => item.id === exercise.id));
    Object.assign(workout, { title, source: 'personal', exercises: structuredClone(draft.exercises) });
  } else {
    id = makeId();
    // La nuova scheda va in fondo alla lista, come nel programma.
    next.push({ id, title, source: 'personal', exercises: structuredClone(draft.exercises), ...(draft.mode === 'pilates' ? { mode: 'pilates' } : {}) });
  }
  if (!saveWorkouts(storage, next)) return 'Non riesco a salvare la scheda su questo dispositivo.';
  workouts = next;
  for (const exercise of removed) removeExerciseData(id, exercise);
  // Video di riferimento scelti nella bozza: ora che la scheda esiste si caricano sull'account.
  for (const exercise of draft.exercises) {
    getPersonalReference(personalReferenceId(exercise.id)).then((reference) => {
      if (reference && !reference.path) void finishReference(id, exercise.id, reference);
    }).catch(() => {});
  }
  const editing = !!draft.id;
  workoutDraft = null;
  openRoute(editing ? `#/scheda/${id}` : '#/schede');
  return '';
}

// Nuovo esercizio della modalità giusta: a tempo in Pilates, serie/ripetizioni o tempo in Palestra.
function renderAnyExerciseForm(workout, exercise, inDraft = false) {
  if (workout.mode !== 'pilates') { renderExerciseForm(workout, exercise, inDraft); return 'exerciseForm'; }
  const backRoute = inDraft ? draftRoute() : `#/scheda/${workout.id}`;
  renderPilatesExerciseForm(screens.pilatesForm, document.querySelector('#dockSlot'), {
    workoutTitle: workout.title,
    exercise,
    referenceName: exercise?.reference ? 'Video di riferimento salvato' : null,
    onBack: () => openRoute(backRoute),
    onSave: async (values, referenceFile, ui) => {
      if (demoPreview || accessMode === 'coach' || (!inDraft && !canEditWorkout(workout))) return;
      const id = exercise?.id ?? makeId();
      await storeExercise({
        exercise: { id, mode: 'pilates', ...values, ...(values.howTo ? {} : { howTo: undefined }) },
        editing: !!exercise, inDraft, workoutId: workout.id, referenceFile, ...ui,
      });
    },
  });
  return 'pilatesForm';
}

function renderExerciseForm(workout, exercise, inDraft = false) {
  document.querySelector('#exerciseFormTitle').textContent = exercise ? 'Modifica esercizio' : 'Nuovo esercizio';
  const backRoute = inDraft ? draftRoute() : `#/scheda/${workout.id}`;
  document.querySelector('#exerciseFormTop').replaceChildren(topBar({ title: workout.title.trim() || 'Nuova scheda', onBack: () => openRoute(backRoute), backLabel: 'Torna alla scheda' }));
  document.querySelector('#dockSlot').replaceChildren(el('div', { className: 'bg-dock' },
    el('button', { type: 'submit', form: 'exerciseForm', id: 'saveExerciseButton', className: 'bg-btn bg-btn--block bg-btn--primary' }, 'Salva esercizio', icon('arrowRight', { small: true }))));
  document.querySelector('#exerciseNameInput').value = exercise?.title ?? '';
  const mode = exercise?.mode ?? 'reps';
  document.querySelector(`#exerciseForm input[name="mode"][value="${mode}"]`).checked = true;
  document.querySelector('#exerciseSetsInput').value = exercise?.sets ?? 3;
  document.querySelector('#exerciseRepsInput').value = exercise?.reps ?? 8;
  document.querySelector('#exerciseMinutesInput').value = exercise?.minutes ?? 10;
  document.querySelector('#exerciseTimeSetsInput').value = exercise?.mode === 'time' ? exercise.sets ?? 1 : 1;
  document.querySelector('#exerciseRestInput').value = restSecondsOf(exercise);
  document.querySelector('#personalReferenceInput').value = '';
  document.querySelector('#personalReferenceName').textContent = exercise ? 'Verifico il riferimento salvato…' : 'Nessun video selezionato';
  if (exercise) getPersonalReference(personalReferenceId(exercise.id)).then((reference) => {
    if (!window.location.hash.endsWith(`/${exercise.id}`)) return;
    document.querySelector('#personalReferenceName').textContent = reference ? `Salvato: ${reference.name}` : 'Nessun video salvato';
  }).catch(() => { document.querySelector('#personalReferenceName').textContent = 'Riferimento non disponibile'; });
  updateModeFields();
  showFormError('#exerciseFormError', '');
  document.querySelector('#referenceProgress').hidden = true;
}

function updateModeFields() {
  const timed = document.querySelector('#exerciseForm input[name="mode"]:checked').value === 'time';
  document.querySelector('#timeFields').hidden = !timed;
  document.querySelector('#repsFields').hidden = timed;
  document.querySelector('#exerciseSetsInput').required = !timed;
  document.querySelector('#exerciseRepsInput').required = !timed;
  document.querySelector('#exerciseMinutesInput').required = timed;
  document.querySelector('#exerciseTimeSetsInput').required = timed;
}

async function deleteWorkout(id) {
  const workout = workouts.find((item) => item.id === id);
  if (!canEditWorkout(workout)) return;
  if (!workout || !window.confirm(`Eliminare la scheda “${workout.title}” e i suoi esercizi?`)) return false;
  const next = workouts.filter((item) => item.id !== id);
  if (!saveWorkouts(storage, next)) { window.alert('Impossibile salvare la modifica su questo dispositivo.'); return false; }
  workouts = next;
  for (const exercise of workout.exercises) {
    try { storage.removeItem(exerciseHistoryKey(id, exercise.id)); storage.removeItem(exerciseLogKey(id, exercise.id)); } catch { /* Il cloud elimina comunque lo storico con la scheda. */ }
  }
  await Promise.allSettled(workout.exercises.map(async (exercise) => {
    const local = await getPersonalReference(personalReferenceId(exercise.id)).catch(() => null);
    forgetReference(exercise, local);
    await deletePersonalReference(personalReferenceId(exercise.id));
  }));
  if (activeWorkout?.workoutId === id) {
    activeWorkout = null;
    try { storage.removeItem(ACTIVE_WORKOUT_KEY); } catch { /* Già fermato nella pagina. */ }
    updateWorkoutTimer();
  }
  openRoute('#/schede');
  return true;
}

async function deleteExercise(workoutId, exerciseId) {
  const workout = workouts.find((item) => item.id === workoutId);
  if (!canEditWorkout(workout)) return;
  const exercise = workout?.exercises.find((item) => item.id === exerciseId);
  if (!exercise || !window.confirm(`Eliminare “${exercise.title}” dalla scheda?`)) return;
  const next = structuredClone(workouts);
  const edited = next.find((item) => item.id === workoutId);
  edited.exercises = edited.exercises.filter((item) => item.id !== exerciseId);
  if (!saveWorkouts(storage, next)) { window.alert('Impossibile salvare la modifica su questo dispositivo.'); return; }
  workouts = next;
  try { storage.removeItem(exerciseHistoryKey(workoutId, exerciseId)); storage.removeItem(exerciseLogKey(workoutId, exerciseId)); } catch { /* Il cloud elimina comunque lo storico. */ }
  try {
    const local = await getPersonalReference(personalReferenceId(exerciseId)).catch(() => null);
    forgetReference(exercise, local);
    await deletePersonalReference(personalReferenceId(exerciseId));
  } catch { /* La scheda è già stata aggiornata. */ }
  openRoute(`#/scheda/${workoutId}`);
}

// «4.060»: in italiano Intl non separa le migliaia sotto 10.000, il design sì.
function formatThousands(value) {
  const [whole, decimals] = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1, useGrouping: false }).format(value).split(',');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${decimals ? `,${decimals}` : ''}`;
}

function formatHistoryNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(number) : '—';
}

function historyDate(entry) {
  return entry.endedAt ? new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }).format(entry.endedAt) : 'Dati precedenti';
}

function renderProgressChart(exercise, history) {
  const series = history.map((entry) => ({ entry, value: sessionMetric(exercise, entry) }))
    .filter((item) => item.value !== null).slice(-8);
  const chart = document.querySelector('#progressChart');
  chart.replaceChildren();
  const unit = exercise.mode === 'time' ? 'min' : 'kg';
  const trend = document.querySelector('#progressTrend');
  if (!series.length) {
    trend.textContent = 'Inserisci un valore per vedere l’andamento.';
    return;
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 300 112');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Andamento: ${series.map((item) => `${historyDate(item.entry)} ${formatHistoryNumber(item.value)} ${unit}`).join(', ')}`);
  const values = series.map((item) => item.value);
  const low = Math.max(0, Math.min(...values) - Math.max(1, (Math.max(...values) - Math.min(...values)) * 0.3));
  const high = Math.max(...values) + Math.max(1, (Math.max(...values) - Math.min(...values)) * 0.3);
  const point = (item, index) => ({
    x: series.length === 1 ? 159 : 37 + index * 243 / (series.length - 1),
    y: 77 - (item.value - low) / (high - low) * 59,
  });
  const svgElement = (tag, attributes, content) => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    if (content != null) element.textContent = content;
    svg.append(element);
    return element;
  };
  svgElement('line', { x1: 34, x2: 282, y1: 78, y2: 78, class: 'grid' });
  svgElement('text', { x: 0, y: 21 }, formatHistoryNumber(high));
  svgElement('text', { x: 0, y: 80 }, formatHistoryNumber(low));
  svgElement('polyline', { points: series.map((item, index) => {
    const coordinates = point(item, index);
    return `${coordinates.x},${coordinates.y}`;
  }).join(' '), class: 'line' });
  series.forEach((item, index) => {
    const coordinates = point(item, index);
    svgElement('circle', { cx: coordinates.x, cy: coordinates.y, r: 4, class: 'point' });
    if (series.length <= 4 || index === 0 || index === series.length - 1) {
      const label = item.entry.endedAt
        ? new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'numeric' }).format(item.entry.endedAt)
        : 'prima';
      svgElement('text', { x: coordinates.x, y: 103, 'text-anchor': 'middle' }, label);
    }
  });
  chart.append(svg);
  if (series.length < 2) { trend.textContent = 'Servono due sedute per confrontare i carichi.'; return; }
  const difference = series.at(-1).value - series[0].value;
  trend.textContent = difference > 0
    ? `In aumento: +${formatHistoryNumber(difference)} ${unit} rispetto alla prima seduta mostrata.`
    : difference < 0
      ? `In diminuzione: ${formatHistoryNumber(difference)} ${unit} rispetto alla prima seduta mostrata.`
      : `Stabile rispetto alla prima seduta mostrata: ${formatHistoryNumber(series.at(-1).value)} ${unit}.`;
}

function renderHistory(workout, exercise) {
  migratePreviousLog(storage, workout.id, exercise, activeWorkout?.workoutId === workout.id);
  const history = readExerciseHistory(storage, workout.id, exercise.id)
    .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
  const last = history.at(-1);
  const timed = exercise.mode === 'time';
  document.querySelector('#previousWorkoutDate').textContent = last ? (last.endedAt ? shortDate(last.endedAt) : 'dati precedenti') : '';
  const rows = document.querySelector('#previousWorkoutRows');
  if (!last) {
    rows.replaceChildren(emptyState('Nessun allenamento precedente registrato per questo esercizio.'));
  } else {
    const cell = (value, unit) => (value !== '' && value != null
      ? el('td', {}, el('b', { text: formatHistoryNumber(value) }), unit ? ` ${unit}` : '')
      : el('td', { text: '—' }));
    const volume = last.rows.reduce((sum, row) => sum + (Number(row.reps) || 0) * (Number(row.load) || 0), 0);
    const minutes = last.rows.reduce((sum, row) => sum + (Number(row.minutes) || 0), 0);
    rows.replaceChildren(el('table', { className: 'bg-table' },
      el('thead', {}, el('tr', {}, el('th', { text: 'Serie' }), ...(timed ? [el('th', { text: 'Minuti' })] : [el('th', { text: 'Rip.' }), el('th', { text: 'Carico' })]))),
      el('tbody', {}, last.rows.map((row, index) => el('tr', {},
        el('td', { text: String(row.set ?? index + 1) }),
        ...(timed ? [cell(row.minutes, 'min')] : [cell(row.reps), cell(row.load, 'kg')])))),
      el('tfoot', {}, el('tr', {}, el('td', { colspan: timed ? 2 : 3, text: timed
        ? `Tempo totale: ${formatHistoryNumber(minutes)} min`
        : `Volume totale: ${formatThousands(volume)} kg` })))));
  }
  const toggle = document.querySelector('#toggleProgressButton');
  const panel = document.querySelector('#progressPanel');
  toggle.hidden = history.length < 2;
  toggle.setAttribute('aria-expanded', 'false');
  toggle.textContent = 'Mostra andamento';
  panel.hidden = true;
  document.querySelector('#progressDescription').textContent = exercise.mode === 'time'
    ? 'Minuti massimi registrati per seduta · ultime 8 sedute.'
    : 'Carico massimo per seduta · ultime 8 sedute. Il grafico non tiene conto delle ripetizioni.';
  renderProgressChart(exercise, history);
  renderRecords(exercise);
}

// Massimale (PersonalBest): massimale attuale, record dal più recente e punto di partenza,
// contando lo stesso esercizio in tutte le schede (stesso nome).
function renderRecords(exercise) {
  const section = document.querySelector('#recordsSection');
  section.hidden = exercise.mode !== 'reps';
  if (section.hidden) return;
  const { start, events, top } = recordTimeline(exerciseEntries(storage, workouts, exercise.title));
  const lift = (load, reps) => `${formatThousands(load)} kg × ${reps}`;
  const day = (time) => new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }).format(time);
  const key = exerciseKey(exercise.title);
  const shared = workouts.filter((item) => item.mode !== 'pilates' && item.exercises.some((other) => other.mode === 'reps' && exerciseKey(other.title) === key)).length > 1;
  const title = el('div', { className: 'bg-blocktitle' }, el('h2', { text: 'Massimale' }));
  if (!start) {
    section.replaceChildren(title, el('section', { className: 'bg-pb', 'aria-label': 'Massimale' },
      el('div', { className: 'bg-pb__empty' }, icon('flag', { small: true }),
        el('span', {}, 'Non hai ancora allenamenti con questo esercizio. Il primo sarà il tuo ', el('b', { text: 'punto di partenza' }), ': i record si contano da lì.'))));
    return;
  }
  const row = (date, kind, value, delta, extra = '') => el('li', { className: `bg-pb__row${extra}` },
    el('span', { className: 'bg-pb__date', text: date }),
    el('span', { className: 'bg-pb__what' }, el('span', { text: kind }), el('b', { text: value })),
    el('span', { className: 'bg-pb__delta' }, delta));
  section.replaceChildren(title, el('section', { className: 'bg-pb', 'aria-label': 'Massimale' },
    el('div', { className: 'bg-pb__now' },
      el('span', { className: 'bg-pb__ic' }, icon('trophy')),
      el('span', {},
        el('span', { className: 'bg-pb__label', text: 'Massimale attuale' }),
        el('span', { className: 'bg-pb__val', text: lift(top.load, top.reps) }),
        el('span', { className: 'bg-pb__meta' }, day(top.at), shared ? el('span', { className: 'bg-pb__all', text: 'da tutte le schede' }) : null))),
    el('ol', { className: 'bg-pb__list' },
      [...events].reverse().map((event) => row(day(event.at), event.kind === 'load' ? 'Carico' : 'Ripetizioni', lift(event.load, event.reps),
        event.kind === 'load' ? `↑ ${formatThousands(event.gain)} kg` : `↑ ${event.gain} rip.`)),
      row(day(start.at), 'Punto di partenza', lift(start.load, start.reps), icon('flag', { small: true }), ' bg-pb__row--start'))));
}

document.querySelector('#toggleProgressButton').addEventListener('click', () => {
  const panel = document.querySelector('#progressPanel');
  panel.hidden = !panel.hidden;
  const button = document.querySelector('#toggleProgressButton');
  button.setAttribute('aria-expanded', String(!panel.hidden));
  button.textContent = panel.hidden ? 'Mostra andamento' : 'Nascondi andamento';
});

// Le tue serie: ripetizioni, carico e spunta. I campi vuoti suggeriscono i valori
// della scorsa volta; la spunta senza valori li conferma.
// RecordCelebration: spunta che rimbalza, campi accesi, 12 dischetti, «+5 kg» che sale,
// badge «Record» e avviso sotto il cronometro. Non blocca nulla: il recupero parte comunque.
const BURST = [[-67, -22, 0], [-74, -54, 47], [-67, -92, 94], [-22, -67, 141], [0, -92, 188], [35, -108, 235], [41, -57, 282], [74, -54, 329], [108, -35, 16], [70, 0, 63], [87, 28, 110], [92, 67, 157]];
let recordTimers = [];
function celebrateRecord(line, exercise, record) {
  const gain = record.kind === 'load' ? `+${formatThousands(record.gain)} kg` : `+${record.gain} rip.`;
  line.querySelectorAll('.bg-prbadge, .bg-plus, .bg-prburst').forEach((node) => node.remove());
  line.classList.remove('bg-set--pr');
  void line.offsetWidth;
  line.append(
    el('span', { className: 'bg-prbadge', 'aria-hidden': 'true' }, icon('trophy'), 'Record'),
    el('span', { className: 'bg-plus', 'aria-hidden': 'true', text: gain }),
    el('span', { className: 'bg-prburst', 'aria-hidden': 'true' }, BURST.map(([dx, dy, r], index) => el('i', {
      style: `--dx:${dx}px;--dy:${dy}px;--r:${r}deg;background:var(--confetti-${(index % 4) + 1});animation-delay:${(index % 4) * 20}ms`,
    }))));
  line.classList.add('bg-set--pr');
  // Vibrazione «success» anche con «Riduci movimento».
  const haptics = globalThis.Capacitor?.Plugins?.Haptics;
  if (haptics?.notification) haptics.notification({ type: 'SUCCESS' }).catch(() => {});
  else navigator.vibrate?.(40);
  recordTimers.forEach(clearTimeout);
  const detail = `${exercise.title} · ${formatThousands(record.load)} kg × ${record.reps} · ${record.kind === 'load' ? `${gain} sul precedente` : `${gain} a questo carico`}`;
  const slot = document.querySelector('#timerSlot');
  slot.querySelector('.bg-prtoast')?.remove();
  const toastNode = el('button', { type: 'button', className: 'bg-prtoast', role: 'status', 'aria-live': 'polite', 'aria-label': `Nuovo record. ${detail}. Tocca per chiudere` },
    el('span', { className: 'bg-prtoast__ic' }, icon('trophy')),
    el('span', {}, el('b', { text: 'Nuovo record' }), el('small', { text: detail })));
  const close = () => { toastNode.classList.remove('is-on'); setTimeout(() => toastNode.remove(), 400); };
  toastNode.addEventListener('click', close);
  slot.append(toastNode);
  recordTimers = [
    setTimeout(() => toastNode.classList.add('is-on'), 250),
    setTimeout(close, 2750),
    setTimeout(() => { line.classList.remove('bg-set--pr'); line.querySelectorAll('.bg-prbadge, .bg-plus, .bg-prburst').forEach((node) => node.remove()); }, 2700),
  ];
}

function renderSetRows(workout, exercise) {
  const key = exerciseLogKey(workout.id, exercise.id);
  const timed = exercise.mode === 'time';
  const fields = timed ? [['minutes', 'Minuti', 'decimal']] : [['reps', 'Ripetizioni', 'numeric'], ['load', 'Carico (kg)', 'decimal']];
  const empty = () => Object.fromEntries([...fields.map(([field]) => [field, '']), ['done', false]]);
  const saved = readSetLog(storage, workout.id, exercise.id);
  const values = Array.from({ length: Math.max(plannedSets(exercise), saved.length) }, (_, index) => ({ ...empty(), ...saved[index], done: rowDone(exercise, saved[index]) }));
  const previous = readExerciseHistory(storage, workout.id, exercise.id).filter((entry) => entry.rows.length)
    .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0)).at(-1)?.rows ?? [];
  // Suggerimento: la stessa serie della volta scorsa; se non c'è, l'ultima serie già scritta oggi.
  const hint = (index, field) => {
    let value = (previous[index] ?? previous.at(-1))?.[field];
    for (let earlier = index - 1; (value === '' || value == null) && earlier >= 0; earlier -= 1) value = values[earlier][field];
    return value !== '' && value != null ? formatHistoryNumber(value) : '';
  };
  const inputRows = [];
  const refreshHints = () => inputRows.forEach((inputs, index) => {
    for (const [field, input] of inputs) input.placeholder = hint(index, field);
  });
  const saveNote = document.querySelector('#saveNote');
  // «8 ripetizioni × 180 kg» per la prossima serie: valori già scritti o quelli della scorsa volta.
  function nextSetDetail(next) {
    const value = (field) => values[next][field] || hint(next, field);
    if (timed) return value('minutes') ? `${value('minutes')} min` : '';
    const reps = value('reps');
    const load = value('load');
    return [reps ? `${reps} ripetizioni` : '', load ? `${load} kg` : ''].filter(Boolean).join(' × ');
  }
  function save() {
    try {
      storage.setItem(key, JSON.stringify(values));
      if (saveNote.dataset.error) { saveNote.textContent = ''; delete saveNote.dataset.error; }
    } catch {
      saveNote.dataset.error = '1';
      saveNote.textContent = 'Impossibile salvare sul dispositivo. I dati restano visibili finché tieni aperta la pagina.';
    }
  }
  const columns = timed ? 'bg-sets--time' : '';
  const container = document.querySelector('#setRows');
  container.className = `bg-sets ${columns}`;
  container.replaceChildren(el('div', { className: 'bg-sets__head', 'aria-hidden': 'true' },
    el('span', { text: 'Serie' }), ...fields.map(([, label]) => el('span', { text: label })), el('span')));
  values.forEach((row, index) => {
    const line = el('div', { className: `bg-set${row.done ? ' bg-set--done' : ''}` }, el('span', { className: 'bg-set__num', text: String(index + 1) }));
    const inputs = fields.map(([field, label, mode]) => {
      const input = el('input', {
        className: 'bg-set__in', inputmode: mode, value: row[field] || null, placeholder: hint(index, field) || null,
        'aria-label': `Serie ${index + 1} ${label.toLocaleLowerCase('it')}`, autocomplete: 'off',
      });
      input.addEventListener('input', () => { row[field] = input.value.trim().replace(',', '.'); save(); });
      line.append(input);
      return [field, input];
    });
    inputRows.push(inputs);
    const tick = el('button', { type: 'button', className: 'bg-set__ok', 'aria-pressed': String(row.done), 'aria-label': row.done ? `Serie ${index + 1} completata` : `Segna serie ${index + 1} completata` }, icon('check'));
    tick.addEventListener('click', () => {
      if (!row.done) {
        for (const [field, input] of inputs) {
          if (!input.value && input.placeholder) { input.value = input.placeholder; row[field] = input.placeholder.replace(/\./g, '').replace(',', '.'); }
        }
        if (inputs.every(([field]) => row[field] === '')) { inputs[0][1].focus(); return; }
      }
      row.done = !row.done;
      line.classList.toggle('bg-set--done', row.done);
      tick.setAttribute('aria-pressed', String(row.done));
      tick.setAttribute('aria-label', row.done ? `Serie ${index + 1} completata` : `Segna serie ${index + 1} completata`);
      save();
      refreshHints();
      // Serie record (carico o ripetizioni, regole di PersonalBest): parte la festa.
      if (row.done && exercise.mode === 'reps' && activeWorkout?.workoutId === workout.id) {
        const record = judgeSet(exerciseEntries(storage, workouts, exercise.title), values.filter((item, other) => item.done && other !== index), row);
        if (record) celebrateRecord(line, exercise, record);
      }
      // Serie confermata: parte il recupero, tranne dopo l'ultima serie dell'esercizio.
      const next = row.done ? nextOpenSet(values, index) : null;
      if (next !== null && activeWorkout?.workoutId === workout.id) startRest(workout, exercise, next, nextSetDetail(next));
    });
    line.append(tick);
    container.append(line);
  });
  document.querySelector('#addSetSlot').replaceChildren(uiButton({
    label: 'Aggiungi serie', variant: 'outline', block: false, iconBefore: 'plus',
    onClick: () => { values.push(empty()); save(); renderSetRows(workout, exercise); document.querySelector('#setRows .bg-set:last-child input')?.focus(); },
  }));
  document.querySelector('#addSetSlot').firstChild.classList.add('bg-btn--small');
  delete saveNote.dataset.error;
  saveNote.textContent = activeWorkout?.workoutId === workout.id ? ''
    : demoPreview ? 'Dati di prova: restano soltanto su questo dispositivo.'
      : 'Avvia la scheda per registrare una nuova seduta nello storico.';
}

// Il video dell'esecuzione esiste solo in memoria mentre l'esercizio è aperto:
// non viene salvato sul dispositivo né inviato al server.
function releaseAttempt() {
  if (working) return;
  video.pause();
  if (attemptUrl) URL.revokeObjectURL(attemptUrl);
  attemptUrl = undefined;
  attemptFile = null;
  attemptValid = false;
  videoInput.value = '';
  video.removeAttribute('src');
  video.load();
  video.hidden = true;
  emptyStage.hidden = false;
  videoName.textContent = 'Nessun video selezionato';
  clearResults();
  setStatus('Carica il tuo video per iniziare.');
  refreshButton();
}

// Frecce per passare all'esercizio precedente o successivo della stessa scheda.
// Frecce negli angoli in basso: precedente e successivo; sull'ultimo esercizio «Fine».
function renderExerciseNav(workout, exercise) {
  const index = workout.exercises.findIndex((item) => item.id === exercise.id);
  const previous = workout.exercises[index - 1];
  const next = workout.exercises[index + 1];
  const nav = document.querySelector('#exerciseNav');
  const go = (target) => openRoute(`#/esercizio/${workout.id}/${target.id}`);
  nav.replaceChildren(
    previous ? el('button', { type: 'button', className: 'bg-exnav__btn', 'aria-label': `Esercizio precedente: ${previous.title}`, onClick: () => go(previous) },
      icon('back'), el('span', {}, el('small', { text: 'Precedente' }), el('span', { className: 'bg-exnav__name', text: previous.title }))) : el('span'),
    next
      ? el('button', { type: 'button', className: 'bg-exnav__btn bg-exnav__btn--next', 'aria-label': `Esercizio successivo: ${next.title}`, onClick: () => go(next) },
        el('span', { className: 'bg-exnav__text' }, el('small', { text: 'Successivo' }), el('span', { className: 'bg-exnav__name', text: next.title })), icon('chevronRight'))
      : el('button', { type: 'button', className: 'bg-exnav__btn bg-exnav__btn--next', onClick: () => {
        if (activeWorkout?.workoutId === workout.id) void endWorkout();
        else openRoute(`#/scheda/${workout.id}`);
      } }, el('span', { text: 'Fine' }), icon('check')));
  nav.hidden = false;
}

// Il riquadro dell'analisi video si apre dalla card «Carica e analizza il tuo video».
let openedAnalysisKey = null;
function setAnalysisOpen(open) {
  document.querySelector('#analysisPanel').hidden = !open;
  document.querySelector('#openAnalysisButton').setAttribute('aria-expanded', String(open));
  openedAnalysisKey = open ? activeExerciseKey : null;
}
document.querySelector('#openAnalysisButton').addEventListener('click', () => {
  const opening = document.querySelector('#analysisPanel').hidden;
  setAnalysisOpen(opening);
  if (!opening) return;
  document.querySelector('#analysisPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Con un riferimento disponibile si apre subito la scelta del video.
  if (!document.querySelector('#analysisSection').hidden && !attemptFile) videoInput.click();
});

function renderExercise(workout, exercise) {
  const assigned = !canEditWorkout(workout);
  document.querySelector('#editExerciseButton').parentElement.hidden = assigned;
  document.querySelector('#coachInstructions').hidden = !assigned || !exercise.instructions;
  document.querySelector('#coachInstructionList').replaceChildren(...(exercise.instructions ?? '').split('\n').filter((line) => line.trim()).map((line) => {
    const item = document.createElement('li'); item.textContent = line; return item;
  }));
  const exerciseKey = `${workout.id}:${exercise.id}`;
  if (activeExerciseKey !== exerciseKey) {
    releaseAttempt();
    activeExerciseKey = exerciseKey;
  }
  currentExercise = exercise;
  currentReference = null;
  const variant = curlVariant(exercise);
  const curl = variant === 'standing';
  const timed = exercise.mode === 'time';
  document.querySelector('#exerciseTitle').textContent = exercise.title;
  document.querySelector('#exerciseSubtitle').textContent = variant ? 'Bicipiti · ripresa laterale' : '';
  const position = (value) => String(value).padStart(2, '0');
  document.querySelector('#exerciseIndex').textContent = `Esercizio ${position(workout.exercises.findIndex((item) => item.id === exercise.id) + 1)} di ${position(workout.exercises.length)}`;
  // Senza allenamento in corso non c'è il cronometro in alto: serve la freccia per tornare.
  document.querySelector('#exerciseTop').replaceChildren(activeWorkout?.workoutId === workout.id ? '' : topBar({ title: workout.title, onBack: () => openRoute(`#/scheda/${workout.id}`), backLabel: 'Torna alla scheda' }));
  document.querySelector('#targetSetsBlock').hidden = timed;
  document.querySelector('#targetCross').hidden = timed;
  document.querySelector('#targetSets').textContent = timed ? '' : exercise.sets;
  document.querySelector('#targetReps').textContent = timed ? exercise.minutes : exercise.reps;
  document.querySelector('#targetUnit').textContent = timed ? 'minuti' : 'ripetizioni';
  document.querySelector('#referenceSection').hidden = true;
  document.querySelector('#curlInstructions').hidden = !curl || (assigned && !!exercise.instructions);
  document.querySelector('#analysisSection').hidden = true;
  document.querySelector('#resultSection').hidden = true;
  document.querySelector('#genericVideoNote').hidden = true;
  document.querySelector('#logHeading').textContent = timed ? 'Il tuo tempo' : 'Le tue serie';
  if (exerciseKey !== openedAnalysisKey) setAnalysisOpen(false);
  renderExerciseNav(workout, exercise);
  document.querySelector('#editExerciseButton').onclick = () => openRoute(`#/modifica-esercizio/${workout.id}/${exercise.id}`);
  document.querySelector('#deleteExerciseButton').onclick = () => deleteExercise(workout.id, exercise.id);
  // Pilates: a tempo, niente serie, ripetizioni o kg.
  const pilatesExercise = exercise.mode === 'pilates';
  for (const id of ['targetSection', 'exerciseHistorySection', 'exerciseSetsSection', 'recordsSection']) document.getElementById(id).hidden = pilatesExercise;
  document.querySelector('#pilatesBlock').hidden = !pilatesExercise;
  document.querySelector('.bg-video--placeholder').classList.toggle('bg-video--pilates', pilatesExercise);
  document.querySelector('#openAnalysisButton small').textContent = pilatesExercise ? 'Analisi della postura e tracking della posizione' : 'Analisi della tecnica e tracking della posizione';
  if (pilatesExercise) {
    document.querySelector('#curlInstructions').hidden = true;
    renderPilatesExercise(workout, exercise);
  } else {
    pilatesView = null;
    renderHistory(workout, exercise);
    renderSetRows(workout, exercise);
  }
  loadReferenceForExercise(workout, exercise, curl);
}

const BUILTIN_POSE_URL = './reference/curl-corretto.pose.json';
let referencePoseJob = 0;
const uploadingReferences = new Set();

function poseKey(reference) {
  return reference.path ? `path:${reference.path}` : `local:${reference.exerciseId}:${reference.savedAt}`;
}

// Dati del riferimento salvati nella scheda (e quindi sincronizzati): niente video né pose.
function referenceSummary(reference) {
  return { path: reference.path, name: reference.name, kind: reference.kind, profile: reference.profile, savedAt: reference.savedAt };
}

function setReferencePoseStatus(text) {
  const node = document.querySelector('#referencePoseStatus');
  node.textContent = text;
  node.hidden = !text;
}

async function computePose(blob) {
  const url = URL.createObjectURL(blob);
  const media = document.createElement('video');
  media.muted = true;
  media.playsInline = true;
  media.preload = 'auto';
  media.style.cssText = 'position:fixed;width:2px;height:2px;left:-9999px;opacity:0.01;pointer-events:none';
  document.body.append(media);
  try {
    await new Promise((resolve, reject) => {
      media.addEventListener('loadedmetadata', resolve, { once: true });
      media.addEventListener('error', () => reject(new Error(UNREADABLE_VIDEO)), { once: true });
      media.src = url;
      media.load();
    });
    return packFrames(await withLandmarker(async () => {
      await ensureModel(setReferencePoseStatus);
      return collectFrames(media, 'Preparo le linee del riferimento', { showVideo: false, report: setReferencePoseStatus, file: blob });
    }));
  } finally {
    media.pause();
    media.removeAttribute('src');
    media.load();
    media.remove();
    URL.revokeObjectURL(url);
  }
}

// Linee sul video di riferimento: pose già salvate, oppure calcolate una volta
// su questo dispositivo e conservate per le aperture successive.
async function showReferencePose({ key, packedUrl, loadVideo, profile, route }) {
  const job = ++referencePoseJob;
  referenceOverlay.set([]);
  setReferencePoseStatus('');
  let packed = null;
  try {
    if (packedUrl) packed = await fetch(packedUrl).then((response) => (response.ok ? response.json() : null));
    else packed = await getCachedPose(key).catch(() => null);
    if (!packed && loadVideo) {
      if (job === referencePoseJob) setReferencePoseStatus('Preparo le linee del riferimento…');
      packed = await computePose(await loadVideo());
      saveCachedPose(key, packed).catch(() => {});
    }
  } catch (error) {
    console.warn('BUDDYGYM reference pose unavailable', error);
  }
  if (job !== referencePoseJob || window.location.hash !== route) return;
  setReferencePoseStatus('');
  const frames = unpackFrames(packed);
  if (frames) referenceOverlay.set(frames, measuredAngles(profile));
}

function stopReferencePose() {
  referencePoseJob += 1;
  referenceOverlay.set([]);
  setReferencePoseStatus('');
}

// Un riferimento creato prima dell'accesso, o su un dispositivo senza rete,
// viene caricato sul server appena possibile.
// Dopo il salvataggio, in background: un video pesante viene ridotto (serve
// riprodurlo una volta) e, con l'account, caricato sul server. L'esercizio è già
// utilizzabile con il video originale.
async function finishReference(workoutId, exerciseId, reference) {
  if (uploadingReferences.has(reference.exerciseId)) return;
  uploadingReferences.add(reference.exerciseId);
  try {
    if (reference.video.size > PERSONAL_REFERENCE_MAX_BYTES && canCompressVideo()) {
      const video = await compressVideo(reference.video);
      const current = await getPersonalReference(reference.exerciseId).catch(() => null);
      // Il riferimento potrebbe essere stato sostituito o eliminato nel frattempo.
      if (current?.savedAt !== reference.savedAt) return;
      reference = { ...current, video };
      await savePersonalReference(reference);
    }
  } catch (error) {
    console.warn('BUDDYGYM reference compression failed', error);
  } finally {
    uploadingReferences.delete(reference.exerciseId);
  }
  if (!reference.path) await uploadExistingReference(workoutId, exerciseId, reference);
}

async function uploadExistingReference(workoutId, exerciseId, reference) {
  if (!cloudUser || !cloudClient || demoPreview || uploadingReferences.has(reference.exerciseId)) return;
  uploadingReferences.add(reference.exerciseId);
  const userId = cloudUser.id;
  try {
    const path = await uploadReferenceVideo(cloudClient, userId, `personal-${exerciseId}`, reference.video);
    const exercise = workouts.find((item) => item.id === workoutId)?.exercises.find((item) => item.id === exerciseId);
    if (cloudUser?.id !== userId || !exercise) { await removeReferenceVideo(cloudClient, path).catch(() => {}); return; }
    const updated = { ...reference, path };
    await savePersonalReference(updated);
    getCachedPose(poseKey(reference)).then((packed) => packed && saveCachedPose(poseKey(updated), packed)).catch(() => {});
    const next = structuredClone(workouts);
    next.find((item) => item.id === workoutId).exercises.find((item) => item.id === exerciseId).reference = referenceSummary(updated);
    if (saveWorkouts(storage, next)) workouts = next;
  } catch (error) {
    console.warn('BUDDYGYM reference upload failed', error);
  } finally {
    uploadingReferences.delete(reference.exerciseId);
  }
}

// Elimina dal server e dal dispositivo il video di riferimento di un esercizio.
function forgetReference(exercise, localReference) {
  const path = exercise?.reference?.path ?? localReference?.path;
  if (path && cloudClient && cloudUser) removeReferenceVideo(cloudClient, path).catch(() => {});
  if (path) deleteCachedPosesWithPrefix(`path:${path}`).catch(() => {});
  if (localReference) deleteCachedPosesWithPrefix(`local:${localReference.exerciseId}:`).catch(() => {});
}

async function loadReferenceForExercise(workout, exercise, curl) {
  const route = `#/esercizio/${workout.id}/${exercise.id}`;
  const userId = cloudUser?.id;
  stopReferencePose();
  currentReferenceSource = null;
  if (workout.source === 'coach') {
    const reference = exercise.coachReference;
    if (referenceUrl) { URL.revokeObjectURL(referenceUrl); referenceUrl = null; }
    if (reference && !reference.builtin) {
      try {
        const url = await coachVideoUrl(cloudClient, reference);
        if (window.location.hash !== route || cloudUser?.id !== userId) return;
        currentReference = reference.profile ? reference : null;
        currentReferenceSource = 'coach';
        referenceVideo.src = url;
        document.querySelector('#referenceLabel').textContent = 'Esecuzione del coach';
        document.querySelector('#referenceBadge').textContent = 'riferimento';
        document.querySelector('#resultBadge').textContent = 'Confronto';
        referenceVideo.setAttribute('aria-label', 'Video di riferimento del coach');
        document.querySelector('#referenceCaption').textContent = 'Segui il video e le indicazioni del tuo coach.';
        document.querySelector('#referenceSection').hidden = false;
        for (const id of ['analysisSection', 'resultSection']) document.getElementById(id).hidden = !reference.profile;
        document.querySelector('#genericVideoNote').textContent = 'Il video del coach è disponibile. Il confronto automatico non è stato attivato per questo esercizio.';
        document.querySelector('#genericVideoNote').hidden = !!reference.profile;
        document.querySelector('#analysisDescription').textContent = 'Carica la tua esecuzione, con la stessa inquadratura del riferimento.';
        document.querySelector('#analysisLimits').textContent = 'Confronto sperimentale con il movimento del coach. Il tuo video viene elaborato sul dispositivo e non è condiviso con il coach.';
        void showReferencePose({ key: `path:${reference.path}`, loadVideo: () => downloadReferenceVideo(cloudClient, reference.path), profile: reference.profile, route });
        return;
      } catch {
        if (window.location.hash !== route) return;
        document.querySelector('#genericVideoNote').textContent = 'Video del coach non disponibile. Controlla la connessione e riapri l’esercizio.';
        document.querySelector('#genericVideoNote').hidden = false;
        return;
      }
    }
    if (!reference?.builtin) {
      document.querySelector('#genericVideoNote').textContent = 'Il coach non ha ancora aggiunto un video di riferimento a questa scheda.';
      document.querySelector('#genericVideoNote').hidden = false;
      return;
    }
    curl = reference.builtin === 'curl';
  }
  let reference = null;
  if (workout.source !== 'coach') {
    try { reference = await getPersonalReference(personalReferenceId(exercise.id)); } catch { reference = null; }
    // Su un altro dispositivo il video è soltanto sul server: si scarica una volta e resta in locale.
    const saved = exercise.reference;
    if (!reference && saved?.path && cloudClient && cloudUser) {
      document.querySelector('#genericVideoNote').textContent = 'Scarico il tuo video di riferimento…';
      document.querySelector('#genericVideoNote').hidden = false;
      try {
        const blob = await downloadReferenceVideo(cloudClient, saved.path);
        reference = { exerciseId: personalReferenceId(exercise.id), video: blob, ...saved };
        savePersonalReference(reference).catch(() => {});
      } catch {
        if (window.location.hash !== route) return;
        document.querySelector('#genericVideoNote').textContent = 'Il tuo video di riferimento non è disponibile: controlla la connessione e riapri l’esercizio.';
        return;
      }
    }
    if (reference && !reference.path && canEditWorkout(workout)) void finishReference(workout.id, exercise.id, reference);
  }
  if (window.location.hash !== route || cloudUser?.id !== userId) return;
  currentReference = reference ?? null;
  if (referenceUrl) { URL.revokeObjectURL(referenceUrl); referenceUrl = null; }
  if (reference) {
    currentReferenceSource = 'personal';
    referenceUrl = URL.createObjectURL(reference.video);
    referenceVideo.src = referenceUrl;
    document.querySelector('#referenceLabel').textContent = 'Tuo video di riferimento';
    document.querySelector('#referenceBadge').textContent = 'personale';
    referenceVideo.setAttribute('aria-label', 'Video di riferimento personale');
    document.querySelector('#resultBadge').textContent = 'Confronto';
    document.querySelector('#referenceCaption').textContent = 'Questo video è il tuo riferimento personale. Il confronto non certifica che la tecnica mostrata sia corretta.';
    document.querySelector('#analysisDescription').textContent = 'Carica una ripresa con la stessa inquadratura per confrontarla con il tuo riferimento.';
    document.querySelector('#analysisLimits').textContent = reference.kind === 'curl'
      ? 'Confrontiamo il curl con il tuo video personale. Il sistema non ha verificato che il riferimento sia tecnicamente corretto.'
      : 'Confrontiamo l’ampiezza delle articolazioni più mobili con il tuo riferimento. Non misuriamo la durata dell’allenamento e non giudichiamo la correttezza tecnica.';
    const blob = reference.video;
    void showReferencePose({ key: poseKey(reference), loadVideo: async () => blob, profile: reference.profile, route });
  } else if (curl) {
    currentReferenceSource = 'builtin';
    referenceVideo.src = CURL_EXERCISE.referenceVideo;
    document.querySelector('#referenceLabel').textContent = 'Esecuzione corretta';
    document.querySelector('#referenceBadge').textContent = 'video fisso';
    referenceVideo.setAttribute('aria-label', 'Video del curl corretto');
    document.querySelector('#resultBadge').textContent = 'Tecnica';
    document.querySelector('#referenceCaption').textContent = 'Guarda il movimento indicato nella scheda prima di iniziare.';
    document.querySelector('#analysisDescription').textContent = 'Registra il tuo curl di lato, in verticale o in orizzontale, poi carica il video per ricevere un riscontro.';
    document.querySelector('#analysisLimits').textContent = 'Controlliamo ampiezza del curl, gomito e busto. Questo giudizio è sperimentale e non certifica la correttezza dell’esecuzione.';
    void showReferencePose({ packedUrl: BUILTIN_POSE_URL, profile: CURL_EXERCISE.referenceProfile, route });
  }
  document.querySelector('#referenceSection').hidden = !reference && !curl;
  document.querySelector('#analysisSection').hidden = !reference && !curl;
  document.querySelector('#resultSection').hidden = !reference && !curl;
  document.querySelector('#genericVideoNote').hidden = !!reference || curl;
  if (workout.source !== 'coach') document.querySelector('#genericVideoNote').textContent = 'Per confrontare questo esercizio con le tue esecuzioni, aggiungi un video personale da “Modifica esercizio”. Il confronto misura la somiglianza, non la correttezza tecnica.';
}

function renderRoute() {
  // I pulsanti fissi in basso appartengono alla schermata che li disegna.
  document.querySelector('#dockSlot').replaceChildren();
  const parts = window.location.hash.split('/').filter(Boolean);
  const workout = workouts.find((item) => item.id === parts[2]);
  const exercise = workout?.exercises.find((item) => item.id === parts[3]);
  let screen = 'home';
  // Senza accesso si parte sempre dalla scelta Palestra / Pilates.
  if (loggedOut() && !['registrati', 'account', 'nuova-password', 'invito'].includes(parts[1])) {
    screen = 'welcome';
    renderWelcome(screens.welcome, {
      onChoose: (mode) => { chooseMode(mode, { pending: true }); resetSignup(); openRoute('#/registrati'); },
      onLogin: () => { chooseMode(currentMode()); openRoute('#/account'); },
    });
  } else if (parts[1] === 'prova-modelli') {
    screen = 'bench';
    // Solo nella versione di prova: il modulo e i modelli si caricano qui.
    import('./model-bench.js').then(({ renderBench }) => renderBench(screens.bench, { onBack: () => openRoute('#/account') }));
  } else if (parts[1] === 'account' && !demoPreview && !cloudUser) {
    screen = 'login';
    renderLoginScreen();
  } else if (parts[1] === 'registrati' && !cloudUser) {
    screen = 'signup';
    renderSignupScreen();
  } else if (parts[1] === 'alias' && cloudUser) {
    screen = 'alias';
    renderAliasScreen();
  } else if (parts[1] === 'nuova-password') {
    screen = 'newPassword';
    renderNewPasswordScreen();
  } else if (parts[1] === 'account' && !demoPreview) {
    screen = 'account';
    screens.account.hidden = false;
    renderProfileScreen();
  } else if ((parts[1] === 'coaching' || parts[1] === 'coach') && !demoPreview) {
    if (cloudUser) {
      screen = 'coach';
      void coachUI.enter(cloudClient, cloudUser);
    } else {
      screen = 'coachingLocked';
      renderCoachingLocked();
    }
  } else if (parts[1] === 'storico' && parts[2]) {
    const session = storage ? loadSessions(storage).find((item) => item.id === decodeURIComponent(parts[2])) : null;
    if (session) {
      screen = 'summary';
      renderSessionSummary(session);
    } else {
      screen = 'history';
      renderHistoryScreen();
    }
  } else if (parts[1] === 'storico') {
    screen = 'history';
    renderHistoryScreen();
  } else if (parts[1] === 'social' && parts[2] === 'post' && parts[3]) {
    screen = 'post';
    void renderPostScreen(parts[3]);
  } else if (parts[1] === 'social' && parts[2] === 'amico' && parts[3]) {
    screen = 'friend';
    void renderFriendScreen(parts[3]);
  } else if (parts[1] === 'social' && parts[2] === 'amici') {
    screen = 'friends';
    void renderFriendsScreen();
  } else if (parts[1] === 'social' && parts[2] === 'classifica') {
    screen = 'leaderboard';
    void renderLeaderboardScreen();
  } else if (parts[1] === 'invito' && parts[2]) {
    rememberInvite(parts[2]);
    if (cloudUser) { screen = 'social'; renderSocialScreen(); void acceptPendingInvite(); } else { screen = 'login'; loginNotice = 'Accedi o registrati per accettare l\'invito.'; renderLoginScreen(); }
  } else if (parts[1] === 'social') {
    screen = 'social';
    renderSocialScreen();
  } else if (parts[1] === 'nutrizione') {
    screen = 'nutrition';
    renderNutrition();
  } else if (parts[1] === 'scheda' && workout) {
    screen = 'workout';
    renderWorkout(workout);
  } else if (parts[1] === 'esercizio' && workout && exercise) {
    screen = 'exercise';
    renderExercise(workout, exercise);
  } else if (parts[1] === 'riepilogo' && workout && Number.isFinite(Number(parts[3]))) {
    screen = 'summary';
    renderSummaryScreen(workout, Number(parts[3]), Number(parts[4]));
  } else if (parts[1] === 'nuovo-esercizio' && parts[2] === 'bozza' && workoutDraft) {
    screen = renderAnyExerciseForm(workoutDraft, null, true);
  } else if (parts[1] === 'modifica-esercizio' && parts[2] === 'bozza' && workoutDraft?.exercises.some((item) => item.id === parts[3])) {
    screen = renderAnyExerciseForm(workoutDraft, workoutDraft.exercises.find((item) => item.id === parts[3]), true);
  } else if (parts[1] === 'nuova-scheda' && !demoPreview) {
    screen = 'workoutForm';
    renderWorkoutForm(null);
  } else if (parts[1] === 'modifica-scheda' && canEditWorkout(workout)) {
    screen = 'workoutForm';
    renderWorkoutForm(workout);
  } else if (parts[1] === 'nuovo-esercizio' && canEditWorkout(workout)) {
    screen = renderAnyExerciseForm(workout, null);
  } else if (parts[1] === 'modifica-esercizio' && canEditWorkout(workout) && exercise) {
    screen = renderAnyExerciseForm(workout, exercise);
  } else {
    renderHome();
  }
  for (const [name, element] of Object.entries(screens)) element.hidden = name !== screen;
  accessMode = cloudUser ? (screen === 'coach' ? 'coach' : 'client') : null;
  renderChrome(screen);
  updateWorkoutTimer();
  if (screen !== 'exercise') { document.querySelector('#exerciseNav').hidden = true; hideRestPanel(); } else { showRestIfHere(); drawPilates(); }
  if (screen !== 'exercise') {
    referenceVideo.pause();
    stopReferencePose();
    if (activeExerciseKey && !working) { releaseAttempt(); activeExerciseKey = undefined; }
  }
  appScroll.scrollTop = 0;
}

renderRoute();
void initAccount();
// I pulsanti della notifica del cronometro funzionano anche senza account o senza rete.
if (isNativeApp()) {
  try {
    const app = nativePlugin('App');
    app.addListener('appUrlOpen', ({ url }) => { handleWorkoutUrl(url); });
    app.getLaunchUrl().then((launch) => { if (launch?.url) handleWorkoutUrl(launch.url); }).catch(() => {});
  } catch (error) { console.error('BUDDYGYM workout links unavailable', error); }
}
import('./model-bench.js').then(({ benchAvailable }) => benchAvailable()).then((available) => {
  benchAvailableHere = available;
  renderAccount();
}).catch(() => {});
window.addEventListener('hashchange', renderRoute);
document.querySelector('#backToHome').addEventListener('click', () => openRoute('#/schede'));
document.querySelectorAll('#exerciseForm input[name="mode"]').forEach((input) => input.addEventListener('change', updateModeFields));
// Frecce su/giù dei campi numerici: si regolano i valori senza tastiera.
document.querySelector('#exerciseForm').addEventListener('click', (event) => {
  const button = event.target.closest('[data-step]');
  if (!button) return;
  const input = document.getElementById(button.dataset.for);
  const step = Number(input.step) || 1;
  const value = (Number(input.value) || 0) + Number(button.dataset.step) * step;
  input.value = String(Math.min(Number(input.max) || Infinity, Math.max(Number(input.min) || step, value)));
});
document.querySelector('#personalReferenceInput').addEventListener('change', () => {
  document.querySelector('#personalReferenceName').textContent = document.querySelector('#personalReferenceInput').files?.[0]?.name ?? 'Nessun video selezionato';
});

document.querySelector('#exerciseForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = document.querySelector('#exerciseNameInput').value.trim();
  const mode = document.querySelector('#exerciseForm input[name="mode"]:checked').value;
  const parts = window.location.hash.split('/');
  const editing = parts[1] === 'modifica-esercizio';
  const inDraft = parts[2] === 'bozza' && !!workoutDraft;
  const workoutId = inDraft ? workoutDraft.id : parts[2];
  const workout = inDraft ? workoutDraft : workouts.find((item) => item.id === workoutId);
  if ((!inDraft && !canEditWorkout(workout)) || accessMode === 'coach' || demoPreview) return;
  if (!title) { showFormError('#exerciseFormError', 'Inserisci il nome dell’esercizio.'); return; }
  const sets = Number(document.querySelector('#exerciseSetsInput').value);
  const reps = Number(document.querySelector('#exerciseRepsInput').value);
  const minutes = Number(document.querySelector('#exerciseMinutesInput').value);
  const timeSets = Number(document.querySelector('#exerciseTimeSetsInput').value);
  const restSeconds = Number(document.querySelector('#exerciseRestInput').value);
  if (!Number.isInteger(restSeconds) || restSeconds < 15 || restSeconds > 600) {
    showFormError('#exerciseFormError', 'Il recupero va da 15 a 600 secondi.'); return;
  }
  if (mode === 'reps' && (!Number.isInteger(sets) || sets < 1 || !Number.isInteger(reps) || reps < 1)) {
    showFormError('#exerciseFormError', 'Inserisci serie e ripetizioni valide.'); return;
  }
  if (mode === 'time' && (!Number.isFinite(minutes) || minutes <= 0 || !Number.isInteger(timeSets) || timeSets < 1)) {
    showFormError('#exerciseFormError', 'Inserisci una durata in minuti e un numero di serie validi.'); return;
  }
  const id = editing ? parts[3] : makeId();
  const exercise = mode === 'time' ? { id, title, mode, minutes, sets: timeSets, restSeconds } : { id, title, mode, sets, reps, restSeconds };
  const referenceFile = document.querySelector('#personalReferenceInput').files?.[0];
  const saveButton = document.querySelector('#saveExerciseButton');
  const progress = document.querySelector('#referenceProgress');
  await storeExercise({
    exercise, editing, inDraft, workoutId, referenceFile, button: saveButton,
    report: (text) => { progress.hidden = false; progress.textContent = text; },
    fail: (message) => showFormError('#exerciseFormError', message),
    done: () => { progress.hidden = true; },
  });
});

// Salva un esercizio (Palestra o Pilates) nella scheda o nella bozza, con l'eventuale
// video di riferimento personale: analisi, salvataggio sul dispositivo e sull'account.
async function storeExercise({ exercise, editing, inDraft, workoutId, referenceFile, button: saveButton, report, fail, done }) {
  const next = inDraft ? null : structuredClone(workouts);
  const editedWorkout = inDraft ? workoutDraft : next.find((item) => item.id === workoutId);
  const { id, title, mode } = exercise;
  const previous = editing ? editedWorkout.exercises.find((item) => item.id === id) : null;
  saveButton.disabled = true;
  fail('');
  let uploadedPath = null;
  try {
    const oldReference = editing ? await getPersonalReference(personalReferenceId(id)).catch(() => null) : null;
    const savedReference = previous?.reference ?? null;
    if ((oldReference || savedReference) && !referenceFile && (previous.title !== title || previous.mode !== mode)) {
      fail('Hai cambiato l’esercizio: carica un nuovo video di riferimento per sostituire quello precedente.');
      return;
    }
    let newReference;
    if (referenceFile) newReference = await analyzePersonalReference(referenceFile, exercise, report);
    // Con l'account il video di riferimento si salva sul server: un video leggero
    // subito, uno pesante dopo essere stato ridotto in background (finishReference).
    if (newReference && cloudUser && cloudClient && !demoPreview && newReference.video.size <= PERSONAL_REFERENCE_MAX_BYTES) {
      report('Carico il video di riferimento sul tuo account…');
      uploadedPath = await uploadReferenceVideo(cloudClient, cloudUser.id, `personal-${id}`, newReference.video);
      newReference.path = uploadedPath;
    }
    const pose = newReference?.pose;
    if (newReference) {
      delete newReference.pose;
      await savePersonalReference(newReference);
      if (pose) saveCachedPose(poseKey(newReference), pose).catch(() => {});
    }
    if (newReference?.path) exercise.reference = referenceSummary(newReference);
    else if (!newReference && savedReference) exercise.reference = savedReference;
    if (previous) editedWorkout.exercises[editedWorkout.exercises.indexOf(previous)] = exercise;
    else editedWorkout.exercises.push(exercise);
    if (inDraft) {
      // Nella bozza l'esercizio si salva insieme alla scheda.
      if (!previous) workoutDraft.createdIds.push(id);
      workoutDraft.dirty = true;
      if (newReference && (oldReference || savedReference)) forgetReference({ reference: savedReference }, oldReference);
      openRoute(draftRoute());
      return;
    }
    editedWorkout.source = 'personal';
    if (!saveWorkouts(storage, next)) {
      if (newReference) {
        if (oldReference) await savePersonalReference(oldReference);
        else await deletePersonalReference(personalReferenceId(id));
      }
      if (uploadedPath) removeReferenceVideo(cloudClient, uploadedPath).catch(() => {});
      fail('Non riesco a salvare l’esercizio su questo dispositivo.');
      return;
    }
    // Il riferimento precedente è stato sostituito: si libera lo spazio sul server.
    if (newReference && (oldReference || savedReference)) forgetReference({ reference: savedReference }, oldReference);
    workouts = next;
    if (newReference && !newReference.path) void finishReference(workoutId, id, newReference);
    activeExerciseKey = undefined;
    openRoute(`#/scheda/${workoutId}`);
  } catch (error) {
    console.error('BUDDYGYM reference failed', error);
    if (uploadedPath) removeReferenceVideo(cloudClient, uploadedPath).catch(() => {});
    fail(error.message || 'Non riesco a salvare il video di riferimento.');
  } finally {
    saveButton.disabled = false;
    done();
  }
}

// Oltre questa soglia il video personale viene ridotto prima di salvarlo sul dispositivo.
const PERSONAL_REFERENCE_MAX_BYTES = 20 * 1024 * 1024;

function setStatus(message) { status.textContent = message; }

function checkFormat(media) {
  // Qualsiasi formato va bene, verticale o orizzontale: gli angoli sono misurati
  // sulle proporzioni reali del fotogramma. Serve solo che il file contenga immagini.
  if (!media.videoWidth || !media.videoHeight) return 'Il file non contiene un video leggibile.';
  if (!Number.isFinite(media.duration) || media.duration < 2 || media.duration > 60) {
    return 'Usa un video tra 2 e 60 secondi.';
  }
  return null;
}

async function prepareCoachReference(file, exercise, analyze, report) {
  if (!['video/mp4', 'video/quicktime', 'video/webm'].includes(file.type)) throw new Error('Usa un video MP4, MOV o WebM.');
  return analyzePersonalReference(file, exercise, report, analyze);
}

// Analisi del video di riferimento: schermo acceso finché non ha finito.
function analyzePersonalReference(...args) {
  return withScreenOn(() => analyzePersonalReferenceNow(...args));
}

async function analyzePersonalReferenceNow(file, exercise, reportOverride = null, analyze = true) {
  if (!file.type.startsWith('video/')) throw new Error('Seleziona un file video.');
  const progress = document.querySelector('#referenceProgress');
  const report = reportOverride ?? ((message) => { progress.hidden = false; progress.textContent = message; });
  const media = document.createElement('video');
  media.muted = true;
  media.playsInline = true;
  media.preload = 'auto';
  media.style.cssText = 'position:fixed;width:2px;height:2px;left:-9999px;opacity:0.01;pointer-events:none';
  const url = URL.createObjectURL(file);
  document.body.append(media);
  try {
    const metadata = new Promise((resolve, reject) => {
      media.addEventListener('loadedmetadata', resolve, { once: true });
      media.addEventListener('error', () => reject(new Error(UNREADABLE_VIDEO)), { once: true });
    });
    media.src = url;
    media.load();
    await metadata;
    const issue = checkFormat(media);
    if (issue) throw new Error(issue);
    if (!analyze) return null;
    const allFrames = await withLandmarker(async () => {
      await ensureModel(report);
      return collectFrames(media, 'Analizzo il riferimento', { showVideo: false, report, file });
    });
    const frames = stabilizePoseFrames(analysisGrid(allFrames));
    const curl = curlVariant(exercise) !== null;
    // Le righe per fotogramma servono solo durante l'analisi: non vanno salvate.
    const { rows: _rows, ...profile } = curl ? analyzeCurlVideo(frames) : profileMovement(frames);
    if (curl && (!profile.peaks?.length || !profile.activeRange)) throw new Error('Il riferimento non mostra un curl completo abbastanza chiaro.');
    if (!curl && !profile.ready) throw new Error(profile.message);
    report('Riferimento analizzato. Preparo il salvataggio…');
    // `pose` serve a disegnare le linee sul riferimento: si salva a parte, non nel profilo.
    return { exerciseId: personalReferenceId(exercise.id), name: file.name, video: file, kind: curl ? 'curl' : 'generic', profile, pose: packFrames(allFrames), savedAt: Date.now() };
  } finally {
    media.pause();
    media.removeAttribute('src');
    media.load();
    media.remove();
    URL.revokeObjectURL(url);
  }
}

function refreshButton() { analyzeButton.disabled = working || !attemptValid; }

function showVideo() {
  emptyStage.hidden = true;
  video.hidden = false;
}

// MediaPipe in modalità video segue un solo filmato alla volta: riferimento ed
// esecuzione usano il rilevatore uno dopo l'altro, mai insieme.
let landmarkerQueue = Promise.resolve();
function withLandmarker(task) {
  const run = landmarkerQueue.then(task, task);
  landmarkerQueue = run.catch(() => {});
  return run;
}

let visionFileset;
let landmarkerDelegate;

// Foto di prova per verificare la GPU. Se non si carica entro 5 s (per esempio con
// l'app in background) la verifica si salta: meglio che bloccare l'analisi.
let poseCheck;
async function poseCheckImage() {
  if (poseCheck) return poseCheck;
  const image = new Image();
  const loaded = new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
  image.src = new URL('../reference/pose-check.jpg', import.meta.url).href;
  try {
    await Promise.race([loaded, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))]);
  } catch {
    return null;
  }
  poseCheck = Object.assign(document.createElement('canvas'), { width: image.naturalWidth, height: image.naturalHeight });
  poseCheck.getContext('2d').drawImage(image, 0, 0);
  return poseCheck;
}

async function createLandmarker(delegate) {
  const { PoseLandmarker } = await import(`${MEDIAPIPE_URL}vision_bundle.js`);
  const landmarker = await PoseLandmarker.createFromOptions(visionFileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
  // Il primo rilevamento prepara la GPU e può bloccare la pagina per secondi:
  // farlo qui evita di perdere l'inizio del video. Si usa la foto di una persona:
  // su alcuni dispositivi Android la GPU non dà errori ma non trova mai il corpo.
  const check = await poseCheckImage();
  const found = check ? landmarker.detectForVideo(check, startDetectionStream()).landmarks?.[0] : true;
  if (!found && delegate === 'GPU') {
    landmarker.close();
    throw new Error('Il rilevatore su GPU non trova il corpo su questo dispositivo.');
  }
  return landmarker;
}

async function ensureModel(report = setStatus) {
  if (poseLandmarker) return;
  report('Carico il modello di rilevamento del corpo…');
  const { FilesetResolver } = await import(`${MEDIAPIPE_URL}vision_bundle.js`);
  visionFileset ??= await FilesetResolver.forVisionTasks(`${MEDIAPIPE_URL}wasm`);
  // La GPU rende l'analisi molto più rapida sui telefoni; alcuni browser non la offrono.
  try {
    poseLandmarker = await createLandmarker('GPU');
    landmarkerDelegate = 'GPU';
  } catch (error) {
    console.warn('BUDDYGYM GPU delegate unavailable, using CPU', error);
    poseLandmarker = await createLandmarker('CPU');
    landmarkerDelegate = 'CPU';
  }
}

async function fallBackToCpu() {
  poseLandmarker?.close();
  poseLandmarker = await createLandmarker('CPU');
  landmarkerDelegate = 'CPU';
}

// MediaPipe riduce comunque l'immagine: passare un 4K intero costa solo tempo e memoria.
const DETECTION_LONG_SIDE = 960;
const detectionCanvas = document.createElement('canvas');
const detectionContext = detectionCanvas.getContext('2d', { willReadFrequently: false });

function detectionSource(media) {
  const scale = Math.min(1, DETECTION_LONG_SIDE / Math.max(media.videoWidth, media.videoHeight));
  if (scale === 1) return media;
  const width = Math.round(media.videoWidth * scale);
  const height = Math.round(media.videoHeight * scale);
  if (detectionCanvas.width !== width || detectionCanvas.height !== height) Object.assign(detectionCanvas, { width, height });
  detectionContext.drawImage(media, 0, 0, width, height);
  return detectionCanvas;
}

function seekTo(media, time) {
  if (Math.abs(media.currentTime - time) < 0.001 && media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => done(new Error('Il video non risponde: riprova con un file MP4.')), 10_000);
    function done(error) {
      clearTimeout(timeout);
      media.removeEventListener('seeked', onSeeked);
      media.removeEventListener('error', onError);
      if (error) reject(error); else resolve();
    }
    function onSeeked() { done(); }
    function onError() { done(new Error(UNREADABLE_VIDEO)); }
    media.addEventListener('seeked', onSeeked);
    media.addEventListener('error', onError);
    media.currentTime = time;
  });
}

function seekToStart(media) { return seekTo(media, 0); }

// I video si analizzano a SAMPLE_FPS fotogrammi al secondo. Le linee usano tutti i
// fotogrammi; il confronto uno ogni 0,1 s (analysisGrid), come i profili salvati.

// MediaPipe leviga i punti nel tempo usando i timestamp: devono seguire il tempo
// del video, non l'orologio del dispositivo, e crescere sempre, anche tra un video
// e il successivo (un salto di 1 s segnala l'inizio di un nuovo filmato).
let detectionClock = 0;
function startDetectionStream() {
  detectionClock += 1000;
  return detectionClock;
}

// Alcuni driver accettano la GPU ma falliscono al primo fotogramma: in quel caso
// si passa alla CPU e si ricomincia il video.
class GpuFailure extends Error {}

function detectAt(source, streamStart, time) {
  detectionClock = streamStart + Math.round(time * 1000);
  try {
    return poseLandmarker.detectForVideo(source, detectionClock);
  } catch (error) {
    if (landmarkerDelegate === 'GPU') throw new GpuFailure(error.message);
    throw error;
  }
}

// Rete di sicurezza: se la GPU non ha trovato il corpo in nessuno dei primi 2 s,
// si ricomincia sulla CPU (un video senza persone viene così controllato due volte).
function guardGpu(frames) {
  if (landmarkerDelegate === 'GPU' && frames.length === SAMPLE_FPS * 2 && frames.every((frame) => !frame.landmarks)) {
    throw new GpuFailure('Nessun corpo trovato dalla GPU.');
  }
}

// Decodifica in sequenza (veloce, indipendente dalla visibilità del video).
async function framesByDecoding(file, aspect, description, report, duration) {
  const frames = [];
  const streamStart = startDetectionStream();
  let lastReport = -1;
  await decodeFrames(file, {
    fps: SAMPLE_FPS,
    onFrame(source, time) {
      const detection = detectAt(source, streamStart, time);
      frames.push({ time, aspect, landmarks: detection.landmarks?.[0] ?? null });
      guardGpu(frames);
      if (Math.round(time) !== lastReport) { lastReport = Math.round(time); report(`${description} · ${lastReport} / ${Math.round(duration)} s`); }
    },
  });
  if (!frames.length) throw new Error('Nessun fotogramma decodificato.');
  return frames;
}

// Ripiego: si posiziona il video su ogni istante. Più lento, ma funziona con ogni formato.
async function framesBySeeking(media, aspect, description, report) {
  // iOS non decodifica i fotogrammi di un video mai avviato: lo si avvia un istante.
  if (media.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    try { await media.play(); } catch { /* Il salto successivo carica comunque il fotogramma. */ }
    media.pause();
  }
  const frames = [];
  const streamStart = startDetectionStream();
  for (let index = 0; index / SAMPLE_FPS < media.duration - 0.02; index += 1) {
    const time = Math.round(index / SAMPLE_FPS * 1000) / 1000;
    await seekTo(media, time);
    const detection = detectAt(detectionSource(media), streamStart, time);
    frames.push({ time, aspect, landmarks: detection.landmarks?.[0] ?? null });
    guardGpu(frames);
    report(`${description} · ${Math.round(time)} / ${Math.round(media.duration)} s`);
  }
  return frames;
}

async function collectFrames(media, description, options = {}) {
  if (options.showVideo !== false) showVideo();
  media.controls = false;
  media.pause();
  const report = options.report ?? setStatus;
  const aspect = media.videoWidth / media.videoHeight;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (options.file && canDecodeSequentially()) {
        try {
          return await framesByDecoding(options.file, aspect, description, report, media.duration);
        } catch (error) {
          if (error instanceof GpuFailure) throw error;
          console.warn('BUDDYGYM sequential decoding unavailable, seeking instead', error);
        }
      }
      return await framesBySeeking(media, aspect, description, report);
    } catch (error) {
      if (!(error instanceof GpuFailure) || attempt > 0) throw error;
      await fallBackToCpu();
    }
  }
  throw new Error('Analisi non riuscita.');
}

function renderChecks(comparison) {
  feedback.replaceChildren();
  feedback.hidden = false;
  if (!comparison.ready) {
    const note = document.createElement('p');
    note.className = 'result-message';
    note.textContent = comparison.message;
    feedback.append(note);
    return;
  }
  for (const check of comparison.checks) {
    const card = document.createElement('div');
    card.className = `check-card ${check.state}`;
    const label = document.createElement('strong');
    label.textContent = check.name;
    const paragraph = document.createElement('p');
    paragraph.textContent = check.message;
    card.append(label, paragraph);
    if (check.at !== null) {
      const jump = document.createElement('button');
      jump.textContent = `Guarda il momento · ${check.at.toFixed(1)} s`;
      jump.addEventListener('click', () => {
        video.pause();
        video.currentTime = check.at;
      });
      card.append(jump);
    }
    feedback.append(card);
  }
}

function clearResults() {
  feedback.hidden = true;
  feedback.replaceChildren();
  attemptOverlay.set([]);
}

function assignFile() {
  const file = videoInput.files?.[0];
  if (!file || working) return;
  attemptFile = file;
  if (attemptUrl) URL.revokeObjectURL(attemptUrl);
  const url = URL.createObjectURL(file);
  attemptUrl = url;
  attemptValid = false;
  video.src = url;
  videoName.textContent = file.name;
  clearResults();
  showVideo();
  video.load();
  setStatus(`Controllo il formato di ${file.name}…`);
  refreshButton();
}

videoInput.addEventListener('change', assignFile);
video.addEventListener('loadedmetadata', () => {
  const issue = checkFormat(video);
  attemptValid = !issue;
  if (issue) setStatus(`Video da valutare: ${issue}`);
  else setStatus('Video pronto. Puoi avviare l’analisi.');
  refreshButton();
});
referenceVideo.addEventListener('error', () => { setStatus('Il video dimostrativo non è disponibile. L’analisi resta possibile con il profilo salvato.'); });
video.addEventListener('error', () => { attemptValid = false; setStatus(UNREADABLE_VIDEO); refreshButton(); });

analyzeButton.addEventListener('click', () => {
  if (!attemptValid || working) return;
  // Analisi della tua esecuzione: schermo acceso finché non ha finito.
  void withScreenOn(analyzeAttempt);
});

async function analyzeAttempt() {
  working = true;
  refreshButton();
  videoInput.disabled = true;
  referenceVideo.pause();
  clearResults();
  try {
    const allFrames = await withLandmarker(async () => {
      await ensureModel();
      return collectFrames(video, 'Analizzo il movimento', { file: attemptFile });
    });
    const attemptFrames = stabilizePoseFrames(analysisGrid(allFrames));
    const isGeneric = currentReference?.kind === 'generic';
    const referenceProfile = currentReference?.profile ?? CURL_EXERCISE.referenceProfile;
    // I riferimenti salvati prima della correzione delle proporzioni restano confrontabili.
    const attempt = isGeneric ? null : analyzeCurlVideo(attemptFrames, { geometry: referenceProfile.geometry ?? 1 });
    const comparison = isGeneric
      ? compareMovement(referenceProfile, attemptFrames)
      : compareCurlVideos(referenceProfile, attempt);
    renderChecks(comparison);
    showVideo();
    await seekToStart(video);
    video.controls = true;
    // Linee su tutto il corpo per ogni esercizio; l'angolo sulle articolazioni confrontate.
    attemptOverlay.set(allFrames, measuredAngles(isGeneric ? referenceProfile : attempt));
    if (isGeneric) {
      setStatus(comparison.ready
        ? currentReferenceSource === 'coach'
          ? 'Confronto completato. Le differenze riguardano il movimento rispetto al video del coach; il giudizio resta sperimentale.'
          : 'Confronto completato. Le differenze segnalate riguardano il movimento rispetto al tuo video personale, non la correttezza della tecnica.'
        : 'Non si vedono abbastanza articolazioni per confrontare questo video con il riferimento.');
    } else if (comparison.ready) {
      const range = attempt.activeRange;
      setStatus(range
        ? `Analisi completata. Ho valutato il movimento tra ${range.start.toFixed(1)} e ${range.end.toFixed(1)} s; i gesti fuori da questo intervallo non incidono sul giudizio.${attempt.ignoredBoundary ? ' Un gesto al margine del video è stato escluso perché diverso dagli altri: controlla che non fosse un curl intenzionale.' : ''} Riproduci il video per vedere leve e angoli.${currentReferenceSource === 'coach' ? ' Il confronto usa il video fornito dal coach.' : currentReferenceSource === 'personal' ? ' Il confronto usa il tuo riferimento personale, che non è stato approvato da un coach.' : ''}`
        : 'Analisi completata. Riproduci il video per vedere leve e angoli.');
    } else {
      setStatus('Il video non mostra un curl completo abbastanza chiaro per il confronto.');
    }
  } catch (error) {
    console.error('BUDDYGYM analysis failed', error);
    setStatus('Analisi interrotta. Riprova con un video MP4 breve.');
    showVideo();
  } finally {
    working = false;
    video.pause();
    video.controls = true;
    videoInput.disabled = false;
    refreshButton();
  }
}
