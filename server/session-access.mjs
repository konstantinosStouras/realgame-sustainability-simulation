import { fail } from '../src/engine.mjs';
export function requireReadable(session) {
  if (session.status === 'deleted') fail('Session not found.', 404);
  if (session.studentAccess === false) fail('This session is closed to students. Ask your instructor to open it.', 403);
}
export function requireOpen(session) {
  requireReadable(session);
  if (session.status === 'completed') fail('This session is completed. Only existing members can view final reports.', 403);
}
