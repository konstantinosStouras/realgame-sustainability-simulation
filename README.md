# Sustainability Studio

An original sustainability/business simulation with an authoritative hourly engine, instructor controls, student companies, durable messages, a double-entry ledger, and data-driven daily plots.

- Main website: https://www.stouras.com/realgame-sustainability-simulation/
- Firebase project: `stouras-sustainability-2026`
- Firebase hosted interface: https://stouras-sustainability-2026.web.app/
- [Economic rules and teaching guide](notes/model.md)

## Run locally

Use Node.js 22.13 or newer (Node 22 LTS recommended).

```sh
npm ci
npm run demo
```

Open http://127.0.0.1:3000. Choose the instructor or one of three independent student identities. All accounts share the same durable SQLite simulation. Open separate tabs to test roles. The demonstration starts after three simulated days; the clock is paused. Demo sign-in is explicitly local-only and the CLI rejects a non-loopback host.

If your npm shim is unavailable, run `node server/main.mjs --demo` after installing dependencies. The engine, UI, and tests do not require a frontend build.

## Firebase classroom sign-in

Google sign-in supports Gmail and Google Workspace accounts. Email/password registration, verification, and password reset are handled by Firebase. Students sign in first, then enter a company join code. The server verifies Firebase ID tokens against the dedicated project and requires verified email. Google sign-in and email/password are enabled; website and loopback domains are authorized. The project owner's account is provisioned with an instructor custom claim.

Firebase enforces the form's 10-character minimum for new passwords. Email-enumeration protection is enabled. The project uses the authorized Blaze plan for the shared classroom backend.

```sh
# Copy .env.example to .env, then:
node --env-file=.env server/main.mjs
```

The public Firebase web config is in `firebase-config.mjs`; it is an application identifier, not an admin credential. Never store service-account keys or login tokens in this repository. Instructor authority comes from a Firebase `instructor: true` custom claim, or `FIREBASE_INSTRUCTOR_UIDS` on the server. For another instructor, use the Admin SDK or Firebase administrative tooling to set the claim. Signing in again refreshes claims.

The cloud backend always checks revoked tokens and disabled accounts through its attached service account. For the standalone local server, `FIREBASE_CHECK_REVOKED=true` enables the same checks and requires application-default credentials. Without that local option, signed tokens are accepted until their normal expiry (approximately one hour), even if revoked. Email verification and signature/issuer/audience/expiry checks are always required. The server does not accept the client's requested role.

## Persistence and deployment

The public website automatically connects to the shared Firebase backend. Firebase Hosting routes `/api/**` to the `classroom` function in London (`europe-west2`). Firestore Standard stores the authoritative sessions, membership, join codes, command history, and idempotent decision receipts. The browser cannot read or write Firestore directly; all access goes through verified Firebase identities and the server's role and membership checks.

State snapshots use compressed chunks below Firestore's document size limit. Every decision atomically commits its snapshot, audit command and retry receipt. The persisted next-tick time and transaction lock prevent duplicate clock advances across function instances. Active browser polls reconcile due hours, and a scheduled function checks running classrooms each minute when no browser is open. A delayed clock catches up in bounded batches. Idle functions scale to zero; the API is limited to two instances and the clock worker to one. These limits are not a hard spending cap.

See [cloud deployment and operations](notes/cloud-backend.md) for the storage model, verification, limits, and deployment procedure.

The standalone local server remains available for demonstrations. It stores state under `.data/`, ignored by Git. SQLite uses WAL and transactions. Keep the database, WAL, and SHM together; for consistent live backups use SQLite's backup facility or stop the server before copying. Run **one local server process/clock owner** per SQLite database.

```sh
docker build -t sustainability-studio .
docker run --name sustainability-studio -p 3000:3000 \
  -v sustainability-data:/data \
  -e ALLOWED_ORIGIN=https://www.stouras.com \
  sustainability-studio
```

The Docker alternative needs an HTTPS reverse proxy and persistent `/data`. Set `ALLOWED_ORIGIN` to the permitted frontend origins, including the backend public origin behind a proxy. The Firebase deployment uses Firestore instead of container-local SQLite. The public site also retains a labelled solo sandbox using browser-local state.

## Checks and publication

```sh
npm test
npm run check
node scripts/build-static.mjs
npx -y firebase-tools@latest deploy --only firestore,functions:classroom,hosting --project stouras-sustainability-2026
```

Tests cover ledger and inventory conservation, partial dispatch and receipt, purchases/payments, insufficient funds, delayed activation, loan/deposit maturity, daily cutoffs, completion, seeded replay, messaging/role boundaries, durable restart, duplicate/concurrent HTTP submissions, and private-file isolation. No proprietary test data are used.

GitHub Pages serves the root of `main` at the existing subpath. Assets are relative. Do not add a CNAME or change the parent domain. Firebase Hosting uses an explicit allowlist copied into `dist/`; private research, runtime databases, and admin setup files are excluded.

## Layout

- `src/engine.mjs`: original deterministic simulation, accounting, validation, and report snapshots.
- `server/`: local SQLite server and cloud Firestore persistence, HTTP APIs, auth, and authoritative clocks.
- `app.mjs`, `styles.css`, `index.html`: accessible browser workspace.
- `src/firebase-client.mjs`: Google/email authentication.
- `src/solo.mjs`: explicitly single-browser rehearsal adapter.
- `tests/`: economic, role, persistence, and concurrency verification.
- `notes/`: public project notes and independently specified rules.
- `private/`: ignored reference materials and local working records; never publish.

This project is independent of RealGame. It uses no RealGame services, credentials, copied bundles, screenshots, or teaching materials. See the model guide for simplified rules and material v1 limits.

### Session links and student entry

Instructors choose a unique Session ID when creating a class (letters, digits and hyphens). Open and Copy session link use the website's existing path with `?session=CLASS-ID`. Existing session IDs and company assignments remain valid.

Registered students visiting the base URL see the session-ID form, never an automatically selected previous class. A session link supplies the ID; new members must additionally enter that session's company join code. Unknown IDs, mismatched codes and closed sessions reveal no simulation state. Session settings → Open session to students controls access independently of the clock. Created sessions are open by default. Completed sessions remain readable to existing members for final reports and CSV exports, but reject new decisions and new members. Closing access blocks existing members' reads and decisions server-side, and the browser returns to the entry form on its next refresh. Instructors retain access.
