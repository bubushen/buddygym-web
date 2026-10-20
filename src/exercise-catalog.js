// Profilo approvato per questa versione dell'esercizio, generato una volta dal
// video corretto con la stessa procedura delle esecuzioni: Pose Landmarker Heavy,
// 30 fotogrammi al secondo decodificati in sequenza, con il tempo del video, confronto su un fotogramma ogni
// 0,1 s. Geometria 2: angoli misurati sulle proporzioni reali del fotogramma.
export const CURL_EXERCISE = Object.freeze({
  id: 'dumbbell-curl-side-v5',
  referenceVideo: './reference/curl-corretto.mp4',
  referenceProfile: Object.freeze({
    geometry: 2,
    side: 'left',
    visibility: 1,
    torsoVisibility: 1,
    elbowSpread: 9.45,
    elbowOffset: 4.08,
    torsoSpread: 2.49,
    peaks: [{ angle: 50, time: 3.2 }],
  }),
});

const NOT_A_BICEPS_CURL = /\b(leg|gamb[ae]|femoral[ei]|hamstring|nordic|pols[oi]|wrist|addominal[ei]|crunch)\b/;
// Il riferimento fisso mostra un curl in piedi o seduto con il braccio libero:
// queste varianti appoggiano il braccio e cambiano la posizione del gomito.
const SUPPORTED_ARM = /\b(concentrat[oaie]|scott|preacher|panca inclinata|inclinat[oaie]|incline|spider)\b/;

function normalizedTitle(title) {
  return String(title ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('it').replace(/[^a-z0-9]+/g, ' ').trim();
}

// 'standing': regole del curl e riferimento fisso; 'other': regole del curl
// soltanto contro un video personale o del coach; null: nessuna regola del curl.
export function curlVariant(exercise) {
  if (!exercise || (exercise.mode && exercise.mode !== 'reps')) return null;
  const title = normalizedTitle(exercise.title);
  if (!/\bcurls?\b/.test(title) || NOT_A_BICEPS_CURL.test(title)) return null;
  return SUPPORTED_ARM.test(title) ? 'other' : 'standing';
}
