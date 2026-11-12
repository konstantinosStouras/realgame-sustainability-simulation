# Shared classroom backend

The dedicated project is `stouras-sustainability-2026`. Its Firebase Functions API and Firestore Standard database use London (`europe-west2`). Firebase Hosting routes `/api/**` to the `classroom` function. The public web configuration selects that HTTPS backend automatically, including from the GitHub Pages subpath.

## Access and data

Google/Gmail/Workspace and verified email/password identities use the same Firebase project. The API validates ID-token signatures, issuer, audience, expiry, verified email, revocation, and disabled-user status. Only the server-verified `instructor: true` custom claim grants instructor access. An instructor creates a classroom and distributes company join codes; students cannot choose their role or company through a forged request.

All direct Firestore client access is denied, including authenticated clients. The keyless `studio-backend` runtime service account has `roles/datastore.user`, `roles/firebaseauth.viewer`, and `roles/logging.logWriter`; no service-account private key is created or stored. The Admin SDK uses that workload identity. API CORS permits the project's Firebase domains and the existing stouras.com origins.

- `studioUsers`: Firebase user IDs, display names and last verified role, without email addresses or passwords.
- `studioMembers`: user/session/company membership, indexed by user and session.
- `studioInvites`: random 96-bit company codes; hashed document keys.
- `studioSessions`: clock, revision and snapshot metadata. Subcollections contain compressed current/initial state chunks and ordered replay commands.
- `studioRequests`: per-user idempotency receipts, committed atomically with decisions.

Students can message their own team and the instructor, and can read instructor announcements. Instructor replay exports redact internal team messages and legacy class-wide and peer messages. Records may still contain participant names and permitted messages; exports are private teaching records and must not be committed to this public repository.

## Consistency and clock

The server runs the original deterministic engine. A Firestore transaction reads current membership and revision, validates a decision, applies economic/accounting invariants, then commits the state chunks, replay command and retry receipt together. Duplicate requests return the original receipt; stale decisions receive HTTP 409. HTTP 503 and interrupted requests retain the client's original key for retry.

The next due hour is persisted with the session. Browser polls process up to 24 overdue hours per transaction; `classroomClock` runs each minute and processes up to 120. Concurrent workers cannot advance the same hour twice. Pausing stops accrual. A long interruption can require multiple catch-up batches. No browser is trusted to supply the clock time, balances, computed outcomes, sender identity or instructor authority.

Snapshots are gzip-compressed, integrity-checked, and split into 500 KiB documents. A session is limited to 7 MiB compressed and 128 MiB uncompressed history. A rejected oversized write leaves the previous committed state intact. This design is for classroom trials; load testing and normalized history storage are needed for large cohorts or very long sessions.

## Deploy and operate

The project requires its approved Blaze billing plan. `firebase.json` declares the London database, deny-all client rules, indexes, Functions codebase, and Hosting rewrite. `scripts/build-functions.mjs` copies an explicit backend allowlist into ignored `.cloud-functions/`; it excludes local data, credentials, private research and test records.

```sh
npm ci --ignore-scripts
npm run check
npm test
node scripts/build-static.mjs
npx -y firebase-tools@latest deploy --only firestore,functions:classroom,hosting --project stouras-sustainability-2026
```

The runtime service account must already exist with the roles listed above. The API uses 512 MiB memory, a 120-second timeout, zero minimum instances, two maximum instances and concurrency 20. The scheduled clock has one maximum instance. These settings reduce idle compute and limit concurrency; they do not impose a monetary spending cap. Monitor usage in the Firebase/Google Cloud billing console.

The source, Firestore data and deployment artifacts are separate. Reverting code does not revert classroom state. Back up/export important completed teaching sessions before changing the model. Deleting a session document alone does not remove its Firestore subcollections or associated membership/invite/request records; use an authenticated administrative cleanup procedure scoped to the intended session.

## Verification

The cloud integration checker creates a random disposable namespace and tests two independent store clients against real Firestore: duplicate and competing decisions, denied roles, membership, assignment changes, private chat/redacted replay, daily snapshots, a new-client restart, and concurrent clock catch-up. It then removes only that test namespace. Live API verification uses temporary synthetic Firebase identities and removes its sessions and identities after checking the deployed endpoints. No student or proprietary test data are used.

The client-rule attack review covers direct reads, lists, creates, updates, deletes, role escalation, foreign ownership, invalid schema, oversized fields, and orphaned subcollections: every client path is denied. Server IAM bypasses these rules intentionally, so API authorization and validation remain essential. The rule syntax was compiled by the Firebase deploy tool; live tests verify denial with an actual student ID token.
