# Live recovery and contention at 120 students — 13 November 2026

## Scope and method

This exercise uses 120 separate synthetic Firebase identities, ten students per team across twelve competing companies, plus one synthetic instructor. Clients call the public production HTTPS API. It is a backend test with independent authenticated clients, not 120 rendered Chrome windows. The earlier [Chrome recovery checks](connection-recovery-2026-11-13.md) cover the rendered interface.

The [economic scenario](../scripts/live-economy-scenario.mjs) runs sixty simulated days of competing offers, production, material purchasing, a shared supply shortage, deliveries, customer and supplier payments, loans, deposits and daily financial reports. All economic mutations use authenticated public API commands. Read-only inspection of this test's persisted state independently checks accounting, inventory and report invariants. Final replay reconstructs all commands and compares the entire final state.

The new [recovery scenario](../scripts/live-recovery-scenario.mjs) runs before the clock advances on days 1, 15, 30, 45 and 59. Each wave includes:

- 120 simultaneous distinct decisions at the same reviewed revision. Exactly one must succeed and 119 must return a stale-state conflict.
- 120 concurrent exact retries of the accepted request, using its original author, key and payload. These must return the same receipt without another economic effect.
- 24 rotating student clients with controlled failures. Across five waves, all 120 students experience one failure: 40 requests saved before sending, 40 accepted responses deliberately discarded by the client, and 40 actual client HTTP connections aborted after sending.
- Reconstructed pending requests, refreshed authentication and exact retries. Unsent requests whose reviewed revision became stale require an explicit review step. No uncertain request is silently rebased.
- 120 simultaneous reconnect reads checked against persisted company accounts, revision and privacy boundaries.

Fault injection is sequential within each 24-client group; the competing decisions, duplicate retries and reconnect-read waves are concurrent. An aborted connection does not prove whether the server committed, which is why the original request identity is retried and reconciled. Discarding an accepted reply is explicitly a client-side injection after observing HTTP 200, not a claim that the production server itself dropped that response.

Ordinary API calls have a 15-second deadline. Intentional faults are individually classified and cannot hide unrelated timeouts or server errors. The runner now bounds sign-in/refresh calls, shares an in-flight token refresh, and drains started identity workers before cleanup if provisioning fails. Credentials remain in private, temporary fixtures.

## Confirmed production failure and correction

The baseline used function revision `classroom-00030-fuj`, with one CPU, 512 MiB memory per instance, concurrency 160, and at most two instances. The first wave passed, but the day-15 competition against a growing history failed:

| Baseline competition wave | Accepted | Stale responses received | Ordinary 15-second timeouts | Maximum client duration |
| --- | ---: | ---: | ---: | ---: |
| Day 1 | 1 | 119 | 0 | 5.023 s |
| Day 15 | 1 | 38 | 81 | 15.017 s |

The winning day-15 response arrived after 3.967 s. Stale responses then arrived progressively through 14.960 s, while 81 clients reached their deadline. These were unexpected failures, distinct from the deliberately injected disconnects. Fourteen daily closes had reconciled before the failed wave. The baseline test resources were removed.

Every competing command previously entered a write transaction and decoded the growing history before detecting a stale revision. The fix in `1c0f2aa` adds fresh read-only authorization, receipt and metadata checks, plus one active command writer per classroom per server instance. Waiting callers recheck concurrently after the writer settles; they do not form a FIFO queue of stale write transactions. Stale paused decisions avoid loading history. The actual write transaction still repeats authorization, receipt and revision checks, preserving correctness across server instances. Running-clock catch-up and the narrow instructor-pause behavior remain intact. Admission entries are removed after success and failure; separate classrooms do not share a writer barrier.

## Validation

All **237 automated tests passed**. The new admission tests count transaction entry before the in-memory database's serialization, so that serialization cannot hide an application-level write stampede. Tests cover 120 same-version clients, exact retries, permission loss while waiting, writer failure recovery, classroom independence, clock catch-up and paused-state fast rejection. Syntax, whitespace, browser-version checks and both builds passed. [GitHub checks](https://github.com/konstantinosStouras/realgame-sustainability-simulation/actions/runs/43448151394) and [Pages publication](https://github.com/konstantinosStouras/realgame-sustainability-simulation/actions/runs/43448151162) succeeded.

## Complete 60-day recovery run

Revision `classroom-00031-yic`, containing the admission fix, completed the entire scenario. Its 5,254 API attempts comprised 4,537 HTTP 200 responses, one HTTP 201, 635 expected stale conflicts, one expected completed-session access denial, and 80 deliberately hidden/aborted responses. There were **zero unexpected client failures and zero ordinary 15-second timeouts**. The 40 saved-before-send cases did not issue an initial HTTP request.

All 120 students experienced a controlled interruption and refreshed authentication. The five waves completed 600 exact winner retries without duplicate effects. The final 1,255 accepted commands matched the persisted receipt count. An independent local audit replayed all 1,255 commands, compared the entire normalized final state, and verified all 60 daily closes and 720 company report rows. That replay independently checks state and command history; the live harness separately counted persisted receipt documents.

| Recovery day | Competing decisions p95 / max | Exact retries p95 / max | Reconnect views p95 / max |
| --- | ---: | ---: | ---: |
| 1 | 3.570 / 3.673 s | 2.076 / 2.090 s | 2.517 / 2.635 s |
| 15 | 2.898 / 2.929 s | 1.748 / 2.024 s | 3.857 / 3.881 s |
| 30 | 3.243 / 3.970 s | 1.849 / 2.018 s | 5.818 / 5.980 s |
| 45 | 3.533 / 3.539 s | 1.489 / 1.622 s | 9.175 / 9.416 s |
| 59 | 4.163 / 4.867 s | 1.994 / 2.000 s | 12.290 / 12.419 s |

Each table cell covers 120 concurrent calls. Late-session reads remained below the deadline but were slow: the 12.419-second maximum leaves limited responsiveness headroom. This is a measured workload result, not a guarantee for arbitrary histories or larger classes.

The economy produced 58,566 units, dispatched 49,558 and received 48,576. It exercised 5,760 orders, 5,606 shipments, 580 purchases, 520 supplier payments and 5,229 customer payments. All twelve loans were repaid. Of 225 deposits, 213 matured and twelve remained legitimately outstanding beyond the final close. Ending cash was €4,413,867.01, recognized revenue €13,523,292.00 and profit €4,002,709.09; receivables and payables remained represented in the ledgers. Closed reports stayed immutable throughout recovery.

## Memory failure found in server logs

Although every ordinary client request in the full run passed, Cloud Run logged a real capacity failure at 15:47:08 UTC: a 512 MiB instance reached **559 MiB**. Therefore revision `classroom-00031-yic` did **not** pass the production capacity assessment. The final state was 17,332,858 bytes uncompressed; the 120 private full-history views together were approximately 187.6 MiB before transient serialization buffers, decoded objects and SDK overhead.

Commit `573565e` increases only the classroom HTTP function to **1 GiB**. CPU remains one per instance, the maximum remains two instances and request concurrency remains 160. The clock function retains 512 MiB. Revision `classroom-00032-ced` was verified to receive 100% of HTTP traffic before the follow-up test.

The focused [mature-history scenario](../scripts/live-mature-capacity-scenario.mjs) seeds a newly owned disposable session from the saved synthetic 60-day state, treating that state as its coherent initial replay baseline. This administrative setup is explicit; subsequent reopen and decision commands use the authenticated public API. It checks three waves of 120 live-update subscriptions overlapping 120 private reads, followed by 120 competing decisions and 120 exact retries. A 31-second gap between waves expires the decoded-state cache. Ordinary calls retain the 15-second deadline. The final probe limits each long-poll request to 35 seconds and the entire notification/reconnect/updated-view sequence to 45 seconds. It checks unchanged historical reports, exact deposit effects, private accounts, four receipts and exact replay from the new baseline.

The first memory-only follow-up on revision `classroom-00032-ced` failed: 50 of 120 private views returned successfully and 70 reached the 15-second deadline. All 120 subscriptions eventually returned HTTP 200 at approximately 26–27 seconds, without a decision being submitted. No subsequent test waves ran. The fixture and all 121 identities were removed. This result demonstrates that memory headroom alone did not resolve the stronger overlapping workload.

That follow-up's server logs contained no errors, memory-limit failures or HTTP 5xx responses. Two active instances were observed. The busiest sampled minute's mean CPU utilization was 13.17% and mean memory utilization 22.82%; these are sampled distribution means, not instantaneous peaks. This evidence does not establish CPU exhaustion. The successful private responses were all uncompressed despite the client's `Accept-Encoding: gzip` header. Local harness parsing and validation also cost roughly 2.5 seconds per 120-response wave, so client timings include transfer and processing as well as server work.

The 120 authenticated clients share one load-runner host and network connection. Consequently this transfer test does not reproduce 120 independent student network links, and it cannot isolate the user's network from server/network response costs. Compression removes a measured application inefficiency regardless of which link limited the failed wave.

Commit `a5b199b` addresses the measured response costs. Student state text is shared only for the exact immutable snapshot and company, with a 24 MiB/48-entry/30-second bound. Every request still verifies authentication, membership and session access, and encodes its own caller identity. Instructor views bypass this cache. Large view responses negotiate gzip, respecting explicit gzip refusal, and retain `no-store`, privacy and origin headers. Four compression jobs per instance limit transient input copies; cancelled responses do not start queued compression work.

Local mature-history measurements reduced projection builds from 120 to twelve and serialization time from 2.204 to 0.612 seconds. Gzip reduced approximately 192 MB of response text to 26.3 MB. These are local measurements, not production latency claims. The complete suite reached **245 passing tests**, with targeted response tests repeated after the final allocation improvement. Both builds and browser-release checks passed; no browser assets changed.

## Live-update protocol correction in the probe

The first compressed run on `classroom-00033-hov` passed both initial read waves (maximum 8.811 and 8.085 seconds), competing decisions and the first retry wave. In the second wave, 118 subscriptions returned the committed revision promptly, while two returned unchanged heartbeats after 25.792 and 26.541 seconds. The probe stopped because it incorrectly required every first long-poll response to contain the change. Its fixture was cleaned.

An unchanged heartbeat is explicitly valid in the browser protocol: the browser immediately reconnects using the same revision. The probe was corrected to do this, without extending its overall 45-second convergence deadline. It now also requires each notified student to fetch the updated authorized private view, compare accounts and profit against persisted state, and preserve closed reports within that same window. Heartbeat reconnects are counted separately. A regression test forces a heartbeat for every student before each successful notification. The delayed first polls remain a responsiveness observation; they do not establish lost updates or justify calling the earlier run a complete pass.

## Final production verification

The corrected probe completed all three waves on `classroom-00033-hov`. There were **1,926 API attempts**, comprising 1,568 HTTP 200 responses, one HTTP 201 and 357 expected stale conflicts. There were **zero unexpected failures and zero ordinary request deadline overruns**. All 360 initial private reads, 360 updated private reads, 360 subscriptions and 360 exact retries passed. Each competition produced exactly one accepted deposit and 119 stale conflicts. The final state had exactly four receipts (reopen plus three deposits), unchanged historical reports and an exact replay from the mature initial baseline.

| Final wave | Initial view p95 / max | Updated view p95 / max | Competition max | Exact retry max | Full watch-to-view convergence max |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 8.661 / 9.163 s | 7.619 / 7.756 s | 5.625 s | 1.844 s | 20.149 s |
| 2 | 8.418 / 8.640 s | 8.366 / 8.843 s | 5.630 s | 1.652 s | 20.771 s |
| 3 | 8.610 / 8.806 s | 8.377 / 8.602 s | 5.945 s | 1.612 s | 20.234 s |

Convergence is measured from opening the subscription, including the deliberate initial read load and later decision submission, through receiving the update and loading the verified new private view. It is not notification latency measured from commit. No heartbeat reconnect was needed in this final run; the preceding run's two delayed heartbeats remain documented above, and the forced-heartbeat regression covers reconnect behavior.

All 720 private views used gzip: **157,996,408 transmitted bytes versus 1,152,203,106 decoded bytes**, an 86.3% reduction. The slowest ordinary request was 9.163 seconds, below the 15-second deadline but still a noticeable delay under this simultaneous mature-history load.

A final Cloud Run check at 16:21:17 UTC, after metric ingestion, matched all 1,926 client attempts by HTTP status. It found **no ERROR logs, memory-limit errors or HTTP 5xx responses** during the final run. At most two instances were observed. The highest one-minute distribution means were 18.83% CPU utilization and 37.09% memory utilization. These sampled means do not measure instantaneous peaks or guarantee capacity for larger workloads.

The full 60-day economic/recovery run was performed on revision 31. The final revision was verified with the saved mature history and repeated overlapping workloads; this was a targeted response-capacity retest, not another full 60-day economic run. Final automated validation passed **246/246 tests**. The independent full-state economic audit and the final live harness both passed. Every disposable session and all 121 synthetic identities from each run were removed; no real student identities or classrooms were modified. Only aggregate measurements are included in the [machine-readable report](live-recovery-120-2026-11-13.json).
