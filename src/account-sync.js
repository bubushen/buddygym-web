// Upload incrementale dell'account: la coda e le impronte restano intatte se il cloud fallisce.
import { uploadAccount } from './cloud-account.js';
import { clearDirty, readDirty, saveSessionFingerprints, sessionFingerprints } from './sync-queue.js';

export async function runAccountSync({
  client, userId, userStorage, deviceStorage, removed = [], removedExercises = [],
}) {
  const snapshot = readDirty(deviceStorage, userId);
  const prints = sessionFingerprints(deviceStorage, userId);
  const ids = await uploadAccount(
    client, userId, userStorage, removed, removedExercises,
    { dirty: snapshot, sessionPrints: prints },
  );
  saveSessionFingerprints(deviceStorage, userId, ids.sessionPrints);
  clearDirty(deviceStorage, userId, snapshot);
  return ids;
}
