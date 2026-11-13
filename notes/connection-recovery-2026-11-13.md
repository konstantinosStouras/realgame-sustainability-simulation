# Connection loss, refresh and competing decisions — 13 November 2026

This round used three actual Chrome student tabs across two synthetic teams, plus a separate live HTTP concurrency run against the same disposable Firebase classroom. Two students shared a team. This is distinct from the earlier [120-student, 12-team backend run](full-live-simulation-2026-11-13.md); it does not claim 120 rendered browsers. No real student classroom was used.

## Bugs found and fixed

1. **Disconnected dashboards had no warning.** The client tried to update a connection element that was never rendered, leaving cached figures labelled live. A visible, accessible warning now appears on browser disconnection or failed classroom reads. Recovery fetches authoritative state without submitting pending decisions. Status changes preserve drafts, dialogs and focus; late callbacks are scoped to their original workspace and request generation.
2. **An uncertain decision could lose its retry identity after an access failure.** If the server committed a request but its reply was lost, a later retry rejected by authentication or access checks erased the saved request key. Submitting again after access returned could duplicate the economic action. Previously uncertain requests now retain their key through retry responses 401, 403 and 404. Definitive first-attempt rejections and stale-revision conflicts still clear the request appropriately.
3. **A resolved stale retry left an obsolete banner visible.** Chrome reproduced this when a refresh already showed the latest revision before retry returned 409. The unchanged revision skipped a render, leaving a nonfunctional Retry button. Definitive resolution now removes only that notice, preserving other open work.

The network error message now explains connection recovery and safe retry without directing public-site students to local-server configuration.

## Actual Chrome observations

- Used Chrome DevTools' per-tab **Offline** setting; the computer's network configuration was not changed. The original release showed no disconnected warning. The updated release showed the warning immediately.
- An offline deposit submission retained its entered amount and showed a clear error. Closing the dialog exposed the pending-decision notice.
- Refreshing while offline produced Chrome's `ERR_INTERNET_DISCONNECTED` page. Restoring connectivity and refreshing recovered the signed-in student, workspace and saved pending decision. The site does not promise offline page loading.
- Reconnecting with a EUR 1,234 draft preserved the amount and error focus. It fetched current classroom data without placing the deposit. A read-only backend audit confirmed that neither this amount nor the earlier unsent EUR 1,000 deposit existed.
- Two Chrome tabs submitted EUR 1,100 and EUR 1,200 deposits together from the same reviewed revision. One succeeded; the other displayed the stale-state review message while retaining its amount. Explicit confirmation after review succeeded.
- The same-team view received the accepted deposit automatically. Drafts deferred background replacement until the dialog closed.
- On final release `2ab28fd34fe9`, replaying the stale saved decision after refresh displayed the review message and immediately removed the obsolete Retry banner, with no further revision change required.
- A fresh EUR 1,234 offline submission was then recovered by restoring the connection, refreshing Chrome and explicitly selecting Retry. It created one deposit. The teammate's tab received the new contract automatically; another refresh retained that contract, with no pending banner and the connection warning hidden.
- The final backend audit confirmed one EUR 1,234 cash debit, one matching locked deposit and one ledger transaction. The other team remained unchanged and all accounting invariants passed.

## Live Firebase concurrency results

Twelve simultaneous distinct requests from three synthetic student identities across two teams produced **one HTTP 200 and eleven HTTP 409 responses**. The shared revision advanced exactly once. The accepted EUR 100.08 deposit produced one deposit, ledger transaction, scheduled event, audit row and request receipt. Twenty concurrent exact retries all returned HTTP 200 with the original receipt; they created no additional economic effect. Accounting invariants and exact cash/deposit deltas passed.

Observed client durations: competing requests p50 1.448 s, p95/max 2.684 s; exact retries p50 0.561 s, p95/max 0.643 s. These are observations from this small contention burst, not a general capacity guarantee.

## Automated fault and contention coverage

The complete suite passed **218 tests**, including 24 new cases in the command-recovery, connection-status and decision-recovery suites. Coverage includes a real local HTTP socket destroyed after transaction commit, page reconstruction with saved pending state, twenty concurrent receipt retries, authentication/access loss, twelve teams competing for limited supplier stock, and twelve same-team requests constrained by a shared loan limit. The socket fault was injected in a local HTTP test with the real handler and an in-memory Firestore adapter; it was not a deliberate disruption of the production server.

Syntax, whitespace, browser asset version and both static-site and Functions build checks passed. Changes are in commits `b09d39e` and `6b65af4`; final browser release `2ab28fd34fe9`. Only browser hosting required deployment; the backend concurrency logic passed without server changes.

[GitHub checks](https://github.com/konstantinosStouras/realgame-sustainability-simulation/actions/runs/43435699879) and [Pages deployment](https://github.com/konstantinosStouras/realgame-sustainability-simulation/actions/runs/43435699692) succeeded. Firebase Hosting deployment succeeded, and both public hosting endpoints returned HTTP 200 with the final release.

Chrome was returned to **No throttling**, DevTools was closed, and the three synthetic student tabs were closed. The temporary classroom, its associated records and all four synthetic identities (including the setup instructor) were removed with cleanup checks passing. Private fixture credentials and individual run artifacts were not committed.

These results cover the exercised failures and races. They are not a proof that every possible browser, network or concurrency failure has been eliminated.
