# Implementation verification — 12 November 2026

This record covers the original Sustainability Studio implementation, not the private reference simulation.

## Automated checks

21 tests pass on Node 22.14 using the built-in test runner. Coverage includes balanced accounting and inventory valuation, partial orders, delayed receipt and payment, numeric/stock/funds checks, supplier reservation, investment activation, financing maturity and arrears, immutable daily cutoffs, completion and extension, deterministic replay, automation with incoming stock, early/on-time/late receipt, preserved energy contract terms, durable database restart, transaction rollback, simultaneous HTTP decisions, idempotent retries, origin restrictions, private-file isolation, Firebase identity mapping, instructor restrictions, private-chat export redaction, and team/peer membership boundaries.

The frontend and server pass Node syntax checks. The installed Firebase Admin SDK 14.5.1 dependency tree reports zero known vulnerabilities in the npm audit performed for this release. GitHub Actions runs installation, checks, tests, and static packaging on pushes and pull requests.

## Live integration and browser checks

- Created the dedicated Firebase project `stouras-sustainability-2026` and registered its web app.
- Enabled Google and email/password Authentication and authorized the project hosting domains, the existing stouras.com website, and localhost/loopback development.
- Provisioned the project owner's Firebase account with an instructor custom claim. No private contact information or account credential is in the repository.
- Verified Google sign-in in the browser reaches the signed-in welcome screen.
- Created temporary synthetic Firebase identities, obtained real signed ID tokens, and verified them with the Admin SDK through the actual HTTP server. Confirmed instructor session creation, student joining, a student purchase, and a shared 24-hour advance with daily plot data. Removed those temporary Firebase test identities afterward.
- Opened independent instructor and student browser sessions on the local demonstration server. Confirmed a 10-unit partial shipment preserved the original 41-unit order with 31 units remaining, plus a distinct shipment record and freight charge.
- Confirmed student-to-teacher and teacher-to-student messages appear in both clients with authoritative sender roles and distinct real/simulation timestamps.
- Advanced the shared demonstration from hour 72 to hour 120 through the instructor interface. The separate student view received the new clock and updated daily revenue plot.
- Inspected the published solo sandbox at desktop and narrow mobile widths. It uses the original engine and explicitly labels its browser-local state.
- Published the static interface on Firebase Hosting and verified the existing GitHub Pages build completed successfully.

The [original overview screenshot](screenshots/studio-overview.jpg) contains only synthetic demonstration state. It is not a copied reference screenshot.

## Deployment boundary

Firebase Authentication and static Hosting are live. The Node/SQLite shared multiplayer server runs locally and has an explicit Docker/persistent-volume deployment configuration. It is **not hosted remotely**. A public HTTPS backend with persistent storage remains necessary before inviting a remote class. A browser may require local-network permission when a public HTTPS frontend connects to a loopback backend; opening the backend's own local URL avoids that cross-origin connection.

This is a functional first release for teaching trials. It has not undergone a large-class load test or a formal external security assessment. Model simplifications, persistence limits, and supported economic rules are documented in [model.md](model.md).

## Firebase registration follow-up

On 12 November 2026, read back the project's authentication configuration and confirmed Google sign-in, email/password registration, the website's authorized domains, and email-enumeration protection. Aligned the server password policy with the registration form's 10-character minimum. Live public sign-up API checks rejected a nine-character password and accepted a ten-character password; the temporary synthetic account was removed afterward. No test email was sent.

Billing is disabled for this dedicated project. Usage-based billing has not been enabled. Remote classroom deployment still requires both an approved hosting arrangement and persistent shared storage; enabling billing alone does not deploy or migrate the current SQLite backend.
