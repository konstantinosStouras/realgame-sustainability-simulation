import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { fail } from '../src/engine.mjs';

export function firebaseVerifier(projectId, { checkRevoked = false } = {}) {
  const name = `studio-${projectId}`;
  const app = getApps().find(a => a.name === name) || initializeApp({ projectId }, name);
  return async token => {
    try {
      const decoded = await getAuth(app).verifyIdToken(token, checkRevoked);
      if (!decoded.email_verified) fail('Verify your email before joining a classroom.', 403);
      return decoded;
    } catch (error) { if (error.status) throw error; fail('Firebase sign-in expired or is invalid. Please sign in again.', 401); }
  };
}
