import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FirestoreStore } from './firestore-store.mjs';
import { createCloudHandler } from './cloud-http.mjs';
import { fail } from '../src/engine.mjs';

const projectId = 'stouras-sustainability-2026', app = initializeApp({ projectId });
const store = new FirestoreStore(getFirestore(app));
const runtime = { region: 'europe-west2', memory: '512MiB', timeoutSeconds: 120, minInstances: 0, maxInstances: 2, serviceAccount: `studio-backend@${projectId}.iam.gserviceaccount.com` };
const verifyFirebase = async token => {
  try { const claims = await getAuth(app).verifyIdToken(token, true); if (!claims.email_verified) fail('Verify your email before joining a classroom.', 403); return claims; }
  catch (error) { if (error.status) throw error; fail('Firebase sign-in expired or is invalid. Please sign in again.', 401); }
};
export const classroom = onRequest({ ...runtime, concurrency: 20, invoker: 'public' }, createCloudHandler({ store, verifyFirebase, projectId, allowedOrigins: ['https://www.stouras.com', 'https://stouras.com', `https://${projectId}.web.app`, `https://${projectId}.firebaseapp.com`] }));
export const classroomClock = onSchedule({ ...runtime, maxInstances: 1, schedule: 'every 1 minutes', timeZone: 'Europe/London', retryCount: 0 }, () => store.runDueClocks());
