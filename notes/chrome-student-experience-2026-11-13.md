# Live Chrome student-experience checks — 13 November 2026

This round used five actual Chrome tabs, each signed in independently: one synthetic instructor and four synthetic students across three competing companies. Two students belonged to the same company to exercise collaboration. All decisions were made through the public website UI against the live Firebase backend in a separate synthetic classroom. No real student classroom was modified.

This is rendered-browser coverage, separate from the earlier [120-student, 12-team backend simulation](full-live-simulation-2026-11-13.md). It does not claim 120 simultaneous rendered browsers.

## Reproduced problems and fixes

1. **Live updates collapsed reading controls.** Expanded report values and the finance journal closed when the instructor advanced time or another team made a decision. Keyboard focus was lost. Same-view renders now retain disclosure state, reading position, and stable control focus. Restoration is scoped to the account, session, company, page, and selected report/workspace, and never restores stale form values. Removed or ambiguous controls are not refocused.
2. **Pause could lose repeated races against students' clock reads.** At one real second per simulated hour, multiple active tabs advanced the shared revision before the instructor's pause arrived. Repeated clicks returned a stale-revision warning while time continued. An authorized, option-free instructor pause now accepts a valid older revision, accounts for elapsed time in bounded transactions, and stops the clock. Every batch rechecks authorization; economic decisions, settings changes, and pauses carrying other options retain strict revision checks. Completed or closed sessions cannot be reopened by a delayed pause.
3. **An in-flight command could display a misleading interruption notice.** A background refresh could render the pending-request marker before the command's response arrived. Background rendering now waits for the command, and the retry notice appears only after an actual interrupted outcome.

Review also caught and corrected a focus-restoration regression before release: refocusing a successfully submitted inline form would make later refreshes appear to conflict with an unfinished draft. Form-contained focus is excluded from restoration. A regression exercises the real shifts-submit handler followed by an external clock update.

## Browser observations

- Independent logins kept each student's company identity separate.
- A saved sales offer appeared in the other same-team tab without reloading. A competing team's price remained separate.
- A stale offer draft survived a competing team's update. The first submission was rejected with a refresh/review message; an explicit second submission succeeded. The application did not silently apply a stale financial decision.
- A partial dispatch sent 7 of 29 ordered modules, retained the remaining 22, and updated the teammate's shipment and finance panels. Shipment receipt occurred on 2 January at 07:00 and payment on 5 January at 07:00. Receivables subsequently returned to zero.
- Enabling a second production shift displayed the pending change and then the correct active schedule at the next eight-hour boundary. Production increased and eventually reported the material/shift constraint.
- A purchase of 10 recycled frames cost EUR 298.20. Purchase history showed receipt on 3 January at 07:00 and payment on 6 January at 07:00. Shared supplier availability changed after purchase.
- The initial ten-day session completed, blocked further student decisions, and showed no pending events. The instructor extended it to thirty days; the students could re-enter with their existing membership and workspace panels.
- The seven-day report showed exactly 21 rows for three companies, spanning 5–11 January, with negative profit values and cents preserved.
- The CSV export button was exercised, but the browser automation's download event did not return a file. Download completion is therefore not claimed from this browser run; CSV serialization and download lifecycle remain covered by automated tests.

## Validation

- All **194 automated tests passed**, including 15 new pause/interaction cases. Syntax checks, whitespace checks, browser-version validation, and both static-site and Firebase Functions builds passed.
- Fixes were published in commit `906ea23`, browser release `1d4ffbd8ac92`. [GitHub checks](https://github.com/konstantinosStouras/realgame-sustainability-simulation/actions/runs/43426322304) and [Pages deployment](https://github.com/konstantinosStouras/realgame-sustainability-simulation/actions/runs/43426321593) succeeded. Firebase Functions and Hosting deployment also succeeded. Both public hosting endpoints served the same release.
- All five Chrome tabs were reloaded onto that release. Expanded report values and the finance journal remained open after the instructor advanced time; the journal's entry count updated while keyboard focus stayed on its disclosure.
- With all five tabs connected and the fastest clock running, **one Pause click succeeded**. Every tab converged on the same paused time, 11 January at 16:00. No stale warning or misleading pending-decision notice appeared. The report retained its exact scroll offset and keyboard focus through this run.
- A new production schedule saved successfully, released form focus, and received the next instructor clock update without a manual blur or reload.
- Chart-point focus remained attached to the same company/date after another live update.
- A post-release offer change to EUR 266.45 reached the second same-team tab automatically; the competing team's EUR 255.15 offer remained unchanged. The finance journal stayed open during the update.
- Reloading a student tab recovered its signed-in company, selected workspace panels, latest offer, and shared simulation time. Final captured warning/error logs were empty in all five tabs.
- The five synthetic Chrome tabs were closed; the original user tab was left untouched. This run's temporary classroom, associated records, and all five synthetic identities were removed, with cleanup checks passing.

The browser tests demonstrate the exercised workflows and regressions, not an exhaustive proof that every possible browser/network failure has been eliminated. The separate backend load report covers the larger 120-student workload.
