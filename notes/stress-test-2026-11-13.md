# Classroom stress test — 13 November 2026

The tests use synthetic students and companies in an isolated checkout and local test databases. No real student records, private messages, credentials, or original RealGame materials are included.

## Workloads and observed outcomes

| Exercise | Observed result |
| --- | --- |
| Maximum-duration engine exercise | 96 synthetic student identities, 12 competing teams, and all 180 days (4,320 hours). 15,523 decisions accepted; 1,847 purchases rejected as expected for scarce supplier stock, storage or credit. Produced 17,280 orders, 3,763 shipments, and 19,126 events. |
| Daily economic checks | Every daily close passed cash, double-entry ledger, inventory valuation, order/dispatch/receipt conservation, supplier-stock and staff bounds. All 180 daily reports were present in order. Completion blocked further student purchases. |
| Role isolation | Inspected the final response for all 96 students. Each received only its own company's detailed state, events, decisions and team messages. Comparative company summaries remained limited to identifiers/names; message bodies remained redacted from audit commands. |
| Simultaneous HTTP decisions | A 120-student, 12-team burst produced one accepted revision and 119 explicit stale-revision conflicts. After reviewing fresh state, all 119 retries succeeded. Another 240 duplicate submissions left exactly 120 deposits, with no duplicate debit. |
| Further local concurrency exercise | 60 students across 12 teams sent 180 messages; the run handled 177 revision conflicts and 180 duplicate retries. A 60-way race for the last supplier lot accepted exactly one purchase. |
| Cloud transaction protocol | 120 synthetic participants against a Firestore transaction double; competing views and two clock workers produced exactly 48 elapsed hours and two daily reports. This does not emulate production SDK transaction retries or capacity. |
| Chrome instructor/student playthrough | One instructor and three active student tabs across two competing companies in a configured 12-team/60-student rehearsal; 240 simulated hours completed. A fresh corrected rehearsal verified student access closure/reopening and all twelve rendered chart colors. |

The maximum-duration engine test includes changing offers, shared component purchasing, shift changes, marketing/research budgets, private team messages, annuity loans, deposits, energy switching, and both automation assistants. It checks conservation at every daily close and checks student response isolation after completion. Engine commands in this test are sequential; simultaneous HTTP behavior is measured separately.

## Defects corrected

| Defect | Reproduction and correction | Verification |
| --- | --- | --- |
| Malformed enum values returned internal errors | Inherited object-property names such as `toString` or `constructor` passed command/investment/catalog allowlists, then produced a TypeError or misleading ledger error. Restrict allowlists to own properties, validate string enum types, and reject array catalog patches. | Regression cases now return validation status 400, add no audit/event/revision and preserve account balances. |
| Each student poll copied every company's private history | `publicView` cloned the complete classroom before filtering. With twelve mature teams, a single student poll unnecessarily copied eleven other ledgers, order histories and private records. Filter the authorized response before cloning. | Exact response comparison with the preceding implementation for instructor overview, instructor preview and student roles; mutations of nested returned data cannot alter authoritative state. Mature-classroom response comparison also passed. |
| Conservation validation repeatedly scanned all shipments per order | Each order filtered its company's whole shipment list, making repeated validation grow as orders multiplied by shipments. Sum dispatched quantities by order once, then validate orders against that map. | Existing economic tests and the 180-day stress exercise pass. Deliberately corrupted remaining/received quantities still fail conservation validation. |
| Local classroom stayed on its loading screen | The browser imported `src/session-updates.mjs`, but the local server did not serve it. Add it to the public allowlist. | Chrome opened the classroom after the fix; a recursive browser-import/worker graph test checks that every local module loads. |
| Unicode text was corrupted at network chunk boundaries | Decoding each chunk separately changed a split emoji into replacement characters. Collect bounded bytes before decoding, shared by local/cloud JSON and export body readers. | Both HTTP handlers preserve `Classroom 🌱 — Αθήνα 東京` across a split UTF-8 character; exact 16,000-byte limits remain enforced. |
| Temporary students retained access after instructor closure | The rehearsal ignored `studentAccess=false` and completed status. Apply the same student gate to views and commands, including cached receipts, while retaining instructor access. Clear stale student controls and show a recoverable closed-access screen. | Model regressions and Chrome verify blocking and automatic return to the same company after reopening. |
| Temporary clock settings retained the previous deadline | Changing speed while running did not reschedule the next tick. Reschedule only when the configured speed actually changes. | Timing regressions cover changed speed, unchanged speed, and paused/resumed clocks. |
| Twelve-team charts reused only three colors | Company color assignment used modulo three. Provide twelve stable colors for lines, points and legends in both themes. | Regression covers all twelve and filtered subsets; Chrome computed styles confirm twelve distinct rendered dark-theme colors. |

The UI also preserves the original temporary decision key after throttling, matching normal classroom retry behavior.

## Chrome playthrough

Helio and Northstar set different regional prices (EUR 245 and EUR 330), while their international offers remained EUR 300. A teammate's stale offer submission returned a conflict, kept the edited draft, and succeeded after review and retry. A private team message containing literal HTML markup was displayed as text to Helio teammates and did not appear in Northstar's team chat. Refresh retained the student's identity, company and open panels.

Helio activated all three shifts and a EUR 10,000 bullet loan. Northstar activated wind power and the efficiency investment after 48 hours. Helio bought 200 junction boxes and each company dispatched five modules from a larger order. Remaining quantities stayed open, and receipts preceded payments. At hour 240, Helio's supplier purchase had settled on 7 January at 18:00 and its loan on 9 January, including EUR 17.26 interest. Helio's receivables and debt/payables were zero. The classroom had ten completed daily closes. These outcomes are observations of different strategies, not a controlled performance comparison.

The corrected fresh rehearsal removed student decision controls when access closed and automatically restored the same company after reopening. The report screenshot below shows the corrected twelve-company palette. The 60 configured identities were not 60 simultaneously open Chrome windows; the larger participant exercises were executable model/HTTP tests.

![Corrected twelve-company report in Chrome](screenshots/stress-test-2026-11-13.jpg)

## Local performance sample

A separate repeatable fixture creates twelve companies for 180 days with both markets' volume set to 12 and the dispatch assistant installed for every company. It finishes with 16,429 orders, 5,526 shipments, 11,064 events and approximately 17.8 MB of serialized state. The preceding implementation and corrected implementation were measured against the same state in one Node.js 22.14 process, alternating five samples each.

| Operation | Before, median | After, median |
| --- | ---: | ---: |
| Whole-classroom conservation validation | 114.2 ms | 3.2 ms |
| One student's authorized view | 320.2 ms | 32.5 ms |

These are local samples, not service-level guarantees or production capacity measurements. The optimization preserves response contents; it does not eliminate the remaining costs of reading a serialized classroom or transmitting a large authorized history.

## Verification and limits

- `node --test tests/engine-stress.test.mjs`: four tests passed, including the complete 96-student/180-day exercise (approximately 23 seconds in the first run).
- Existing engine, assignment replay, session-end and shift-boundary tests: 29 passed.
- Focused malformed-input and view-isolation regressions passed again after the final input-type checks.
- Final combined suite: `npm test` — **145 passed, zero failures** (about 35 seconds locally).
- `npm run check`, browser release validation, static build, cloud-functions build, and `git diff --check` passed.
- Browser release: `43f44409cec1`. The original dirty checkout was preserved; changes were prepared in an isolated branch based on current GitHub main.
- Publication targets are GitHub Pages at the repository's existing subpath and the separately approved Firebase project `stouras-sustainability-2026`. Repository publication alone does not update the shared Firebase functions.
- Concurrency tests use the local server and/or a transaction test double. They demonstrate revision handling, idempotency and conservation under those conditions; they do not certify real Firebase production throughput or real-world multi-region latency.
- Live production saturation, production billing behavior and hundreds of independently authenticated Chrome profiles were not measured by these engine tests.
- The configured API has two maximum instances with 80 concurrent request slots each; long-lived update requests consume slots. No claim of production support for more than 160 concurrently connected browsers is made by this test.
