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

Firebase enforces the form's 10-character minimum for new passwords. Email-enumeration protection is enabled. These settings do not require usage-based billing; the project remains on the free plan until a paid backend is authorized.

```sh
# Copy .env.example to .env, then:
node --env-file=.env server/main.mjs
```

The public Firebase web config is in `firebase-config.mjs`; it is an application identifier, not an admin credential. Never store service-account keys or login tokens in this repository. Instructor authority comes from a Firebase `instructor: true` custom claim, or `FIREBASE_INSTRUCTOR_UIDS` on the server. For another instructor, use the Admin SDK or Firebase administrative tooling to set the claim. Signing in again refreshes claims.

`FIREBASE_CHECK_REVOKED=true` enables revocation/disabled-user checks and requires application-default credentials (for example an attached workload service account). Without this option, signed Firebase tokens are accepted until their normal expiry (approximately one hour), even if revoked. Email verification and signature/issuer/audience/expiry checks are always required. The server does not accept the client's requested role.

## Persistence and deployment

The full-stack server stores all state under `.data/`, ignored by Git. SQLite uses WAL and transactions. Keep the database, WAL, and SHM together; for consistent live backups use SQLite's backup facility or stop the server before copying. Run **one server process/clock owner** per database. There is no multi-instance clock lease or horizontal scaling in v1.

```sh
docker build -t sustainability-studio .
docker run --name sustainability-studio -p 3000:3000 \
  -v sustainability-data:/data \
  -e ALLOWED_ORIGIN=https://www.stouras.com \
  sustainability-studio
```

Use an HTTPS reverse proxy for internet classrooms and persistent storage for `/data`. Set `ALLOWED_ORIGIN` to a comma-separated list of permitted frontend origins. Include the backend public origin when it is behind an HTTPS proxy. The frontend's Server connection form selects this backend origin. Firebase Authentication and static Firebase Hosting are configured; **a remote multiplayer Node backend is not deployed by static hosting**. A backend on ephemeral/serverless local disk would lose state and is unsupported. The public site has a clearly labelled solo sandbox that uses the same engine but only browser-local state.

## Checks and publication

```sh
npm test
npm run check
node scripts/build-static.mjs
firebase deploy --only hosting --project stouras-sustainability-2026
```

Tests cover ledger and inventory conservation, partial dispatch and receipt, purchases/payments, insufficient funds, delayed activation, loan/deposit maturity, daily cutoffs, completion, seeded replay, messaging/role boundaries, durable restart, duplicate/concurrent HTTP submissions, and private-file isolation. No proprietary test data are used.

GitHub Pages serves the root of `main` at the existing subpath. Assets are relative. Do not add a CNAME or change the parent domain. Firebase Hosting uses an explicit allowlist copied into `dist/`; private research, runtime databases, and admin setup files are excluded.

## Layout

- `src/engine.mjs`: original deterministic simulation, accounting, validation, and report snapshots.
- `server/`: SQLite persistence, HTTP API, auth, authoritative clock.
- `app.mjs`, `styles.css`, `index.html`: accessible browser workspace.
- `src/firebase-client.mjs`: Google/email authentication.
- `src/solo.mjs`: explicitly single-browser rehearsal adapter.
- `tests/`: economic, role, persistence, and concurrency verification.
- `notes/`: public project notes and independently specified rules.
- `private/`: ignored reference materials and local working records; never publish.

This project is independent of RealGame. It uses no RealGame services, credentials, copied bundles, screenshots, or teaching materials. See the model guide for simplified rules and material v1 limits.
