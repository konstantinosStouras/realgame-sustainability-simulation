import { fail } from '../src/engine.mjs';
export function requireOpen(session) {
  if (session.status === 'deleted') fail('Session not found.', 404);
  if (session.studentAccess === false || session.status === 'completed') fail('This session is closed to students. Ask your instructor to open it.', 403);
}
