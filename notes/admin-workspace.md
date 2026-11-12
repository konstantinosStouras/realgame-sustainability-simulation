# Instructor workspace

Instructor sign-in now opens session management. Setup is on the left; active sessions and a collapsible past-session list are on the right. Completed sessions are past sessions; running and paused sessions remain active.

Session cards now offer Open, Copy link, Export data, Test round, Close session, and Delete, with company join codes on a separate access row. Links preserve the deployment subpath and require sign-in and membership. Test rounds rehearse the initial configuration in memory and never overwrite the saved sandbox or classroom. All sessions returns to the instructor home.

Close stops the clock at the current hour and moves the session to Past sessions; extending its duration can reopen it. Delete (including Delete all active sessions) requires typed confirmation and soft-deletes the session: stored records remain, but lists, joins, state, roster and replay access are blocked. The cloud clock catches up before a close/delete and stops atomically. Bulk deletion reports partial progress on errors. Lifecycle controls require the server sessionLifecycle capability; older servers show an explanatory dialog until their backend is deployed.

Company tools appear only for students or an explicit instructor company preview. The account dropdown offers profile/session counts, sessions, creation or joining, and logout. Session settings and the student directory are available inside an instructor session.

The theme uses one persisted preference across welcome, admin, company and dialog views. Its main button moves into the header beside the account menu. Mobile layouts stack the setup and session columns and constrain the dropdown to the viewport. Browser inspection verified a 376 CSS-pixel viewport without horizontal overflow, theme persistence across navigation and reload, and explicit company preview navigation.

Validation: 63 automated tests, JavaScript syntax checks, browser release fingerprint verification, and diff review. Only synthetic demonstration data was used for UI checks.


Button update validation: 66 tests passed, including local and cloud lifecycle authorization/access checks, replay of closure, and isolated test-round storage. Browser inspection verified the dark session card and entering/returning from a test round with classroom progress unchanged.
