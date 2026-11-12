# Session actions and temporary test classrooms

The instructor session cards use **Open**, **Copy link**, **Export data**, **Test**, **Close**, and **Delete**. Every action has a hover/focus description, including its effect on students. Company codes and bulk deletion also have descriptions.

## Real classroom lifecycle

- Close commits the elapsed shared clock, freezes new student decisions and messages, and moves the session to Past sessions. Results and pending obligations remain available for read-only review. Instructors can still post debrief announcements or extend the duration to reopen play.
- Delete is an archive operation: the clock stops, session lists omit it, old join codes stop working, and session views, rosters, replay exports and test templates reject access. The database records are retained; student accounts are not deleted. The confirmation explicitly describes this behaviour.
- Both commands require instructor authority and use revision checks, atomic state/audit writes and retry receipts. The browser retains a real classroom lifecycle request key across an interrupted response.
- `/api/health` advertises `sessionLifecycle` and `testClassroom`. The authenticated, instructor-only `GET /api/sessions/:id/test-template` endpoint returns a setup allowlist, without student records, messages or decision history. This endpoint does not create a test session or write test data.

## Test workflow

1. Select **Test** on an active or past session.
2. Choose 1–12 companies and their names, then 1–20 simulated students per company (60 total maximum). Every student belongs to exactly one company. A 2/3/1 allocation creates six independent student identities across three competing companies.
3. The test starts paused at hour zero with the scenario setup. Use **Open test student tabs** to open each identity separately. All tabs must use the same browser profile and website origin.
4. Play the student roles manually. Teammates share economic state; the instructor sees company results and the correct actor in the audit. Student permissions and message privacy still apply. These are simulated identities, not autonomous bots.
5. **End test round** immediately discards the state and disconnects its tabs. Closing all test tabs also releases the shared worker; there is no recovery after it is discarded. Leaving just one tab does not end the other students' work.

A module SharedWorker holds the simulation, identities, clock and retry receipts in memory. Test tabs bypass Firebase authentication, health requests and classroom API calls. They do not write test state to localStorage, sessionStorage, IndexedDB, Firestore or Firebase Authentication. Normal theme preferences are independent of test data. Test links contain temporary identifiers in their fragment; they are not real student sign-ins. An instructor can explicitly download report data using the existing export controls, but there is no automatic saving.

The browser must support module SharedWorkers. Unsupported browsers show an explanatory error. Test links are for the current browser profile, not for distribution to real students on other devices.

## Verification

86 automated tests passed after integration with the session-setup and sign-in-restoration changes. Browser checks opened independent student tabs, submitted a simulated deposit, verified the teammate's balance and instructor's actor attribution, and verified that ending the round disconnected student tabs. Firestore integration checks passed against a disposable namespace and removed that namespace afterward; no Firebase Authentication test users were created. Firebase deployed both classroom functions and Hosting successfully; live health flags and browser assets were verified.
