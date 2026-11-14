# Completed student reports — 13 November 2026

Existing student members can now reopen a completed classroom, read final reports, and download daily-report and financial-ledger CSVs. Completion blocks new decisions and student messages. New members cannot join completed classrooms. An instructor's explicit student-access closure still revokes access, and deleted classrooms remain unavailable.

The change separates read access from admission to active classrooms in both the Firestore and SQLite stores. Completion notifications deliver the final revision instead of clearing the student workspace. An open decision draft is retired when completion arrives, and a rejected completed-session decision refreshes the final state. Already accepted request retries return their original receipt without creating a new transaction.

## Verification

- All 256 automated tests passed, including completed-member access, outsider isolation, rejected decision types, idempotent retries, live completion notifications, explicit access revocation, and CSV export preservation.
- Syntax checks, browser asset version verification, and both deployment builds passed.
- Actual Chrome student and instructor tabs used a disposable, memory-only local classroom with the release code. The instructor advanced the second day while the student had a deposit draft open. The draft closed, no deposit was created, and the final student workspace remained readable with financial decisions disabled.
- Chrome's native Save As flow downloaded both CSVs. All four daily-report rows and 80 ledger postings matched the authoritative test state exactly; the ledger balanced. Refresh retained the student's sign-in, final reports, and export controls.
- Firebase classroom functions, the clock function, Firebase Hosting, and GitHub Pages deployed successfully. The published website loaded browser release `e79d8b7a57f9`. GitHub checks passed for implementation commit `3ac4a7b`.

The Chrome functional test used a local classroom; Firestore access behavior was covered by store and HTTP integration tests. No Firebase test accounts or classrooms were created for this check. Test tabs were closed and the memory-only server stopped; private CSV evidence was retained.

This updates the completion-access behavior documented in the earlier [14-day Chrome playtest](chrome-team-play-2026-11-13.md). That report describes the behavior observed before this change.

The subsequent [live Firebase verification](live-final-student-reports-2026-11-14.md) exercised completion, refresh, CSV downloads, and rejected decisions in two actual Chrome student sessions against the deployed backend.
