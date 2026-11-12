# Instructor workspace

Instructor sign-in now opens session management. Setup is on the left; active sessions and a collapsible past-session list are on the right. Completed sessions are past sessions; running and paused sessions remain active.

Session cards expose the existing server capabilities: open controls, export the replay, inspect company join codes, and copy the session identifier. The session identifier is not a student join credential. Session deletion and separate test-round copies are not supported by the current server API; the Options panel provides the existing independent solo sandbox.

Company tools appear only for students or an explicit instructor company preview. The account dropdown offers profile/session counts, sessions, creation or joining, and logout. Session settings and the student directory are available inside an instructor session.

The theme uses one persisted preference across welcome, admin, company and dialog views. Its main button moves into the header beside the account menu. Mobile layouts stack the setup and session columns and constrain the dropdown to the viewport. Browser inspection verified a 376 CSS-pixel viewport without horizontal overflow, theme persistence across navigation and reload, and explicit company preview navigation.

Validation: 63 automated tests, JavaScript syntax checks, browser release fingerprint verification, and diff review. Only synthetic demonstration data was used for UI checks.

