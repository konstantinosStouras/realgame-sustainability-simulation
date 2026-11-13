# Full live simulation test — 13 November 2026

**Status: passed and cleaned up.** The full 60-day production rerun completed with 120 synthetic students and 12 competing teams. All 3,014 API requests had expected outcomes, none exceeded the 15-second deadline, and all 60 daily closes reconciled in an exact replay. The run crossed a deployment; the measurements below identify which revision served each view wave. [Machine-readable aggregate results](full-live-simulation-2026-11-13.json) contain no credentials or student identifiers.

The test extends the earlier [120-student capacity exercise](live-capacity-2026-11-13.md) to a growing economic history: **120 synthetic authenticated students, 12 competing teams, and 60 simulated days**. The earlier short run established useful capacity evidence, but did not establish performance after weeks of orders, shipments, ledger entries, and daily reports.

## Method

The [economic scenario](../scripts/live-economy-scenario.mjs) uses the [live load runner](../scripts/live-classroom-load.mjs) against Firebase Authentication, the public HTTPS API, deployed functions, and Firestore. The 120 students are independent authenticated clients, **not 120 rendered Chrome windows**. Backend timings include the request path from the load computer; they exclude browser rendering.

- Each team has ten students. All 120 students submit an authenticated setup decision. Students rotate through subsequent decisions so the exercise is not limited to one account per team.
- Teams use different regional and international offers, buy dispatch and replenishment automation, set component reorder policies, take bullet or annuity loans, place deposits, and change energy contracts. The run includes recurring offer changes, weekly finance decisions, and manual partial deliveries.
- Supplier capacity is scaled for the 12-team teaching setup through ordinary instructor commands. A three-day shared photo-cell shortage is introduced on day 20 and reversed on day 23. Ordinary prices, production recipes, and accepted-contract rules are retained.
- All economic decisions and clock advances use the authenticated public API. Each submitted decision follows a fresh reviewed revision. Selected exact duplicate submissions test saved receipts without creating another economic decision.
- After every daily advance, independent reads of the synthetic session's persisted state check accounting and inventory invariants and verify that earlier daily closes have not changed.
- At days 1, 15, 30, 45, and 59, all 120 students request their private views concurrently. The runner compares each view with persisted accounts and reports and requires every request in each wave to finish within the browser's **15-second request deadline**.
- At day 60, checks confirmed session completion, all 120 student identities in the audit, all 12 instructor company previews, repaid loans, matured deposits, explicitly preserved obligations beyond the end date, revoked student access, exact replay, and unique decision receipts.

The test used only synthetic classroom data. Credentials remain outside public artifacts. Cleanup removed all **121 synthetic accounts** (120 students and one instructor) and the recorded synthetic session resources. The cleanup manifest contains no remaining identities and marks session cleanup complete; the public aggregate records `cleaned: true`.

## Confirmed long-history performance issue

The initial production run reached day 15 and exposed slow view reads. All 120 requests eventually returned HTTP 200, but the wave exceeded the browser's deadline:

| Day-15 production baseline | Requests | p50 | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Concurrent private student views | 120 | 14.565 s | 22.774 s | 23.597 s |

An eventual HTTP 200 is insufficient when the browser has already abandoned the request. This baseline was therefore treated as a failed capacity check, rather than counted as a successful classroom run.

Repeated reads were decoding the same growing compressed snapshot independently. The correction combines simultaneous reads of an identical snapshot and retains a bounded decoded snapshot cache. A verified content digest and snapshot metadata identify the cached state. Membership, session access, actor identity, and company filtering are checked afresh for each request: **permissions and authorization results are not cached**. Mutating transactions and exports continue to read their own snapshots.

The completed cache is limited to four snapshots, a 32 MiB uncompressed-JSON byte budget, and a 30-second expiry. Oversized snapshots bypass the completed cache. These bounds limit retention; they are not a claim that total process memory equals the JSON byte budget.

A local benchmark using a 60-day history measured the decoding improvement:

| Local 60-day benchmark | Wave duration | p95 request duration |
| --- | ---: | ---: |
| Without shared decoded snapshots | 35.297 s | 33.670 s |
| With shared decoded snapshots | 5.923 s | 5.622 s |

These are **local benchmark results**, not production latency or a guarantee for concurrent classrooms. The production rerun measurements appear below.

The cache-only deployment remained below the deadline at day 45, but its 13.396-second maximum left limited headroom as history grew. A further correction serializes the authorized public projection directly to JSON in the HTTP path, removing a redundant `structuredClone` of the full response. Projection and serialization are synchronous. No history is trimmed, and no caller, actor, or authorization result is cached. Response-equivalence, privacy, authorization, and clock-catchup regressions cover this path. This serialization correction was deployed around day 49; the measurements below distinguish the cache-only revision from the final revision.

## Four confirmed fixes

| Defect | Correction | Evidence |
| --- | --- | --- |
| Repeated snapshot decoding and redundant response copying made long-history student views expensive | Combine identical in-flight snapshot reads, retain decoded snapshots within explicit bounds, and serialize authorized projections directly to JSON while checking authorization freshly | Day-15 production baseline; local 60-day comparison; cache and serialization regressions covering authorization, privacy, response equivalence, changed snapshots, and retention limits |
| “Last 7 days” and “Last 30 days” included 8 and 31 daily closes at midnight | Select the last 7 or 30 completed closes through one shared helper used by charts, tables, and CSV | A 60-day, 12-team fixture produces 84, 360, or 720 data rows for the 7-day, 30-day, and full-session selections |
| The “Exact daily values” table rounded euro cents to one decimal place | Keep two decimal places for EUR values and preserve non-monetary report precision | A daily EUR 100.01 value remains 100.01 in the table and export; daily differences still use the preceding close outside the selected window |
| CSV protection changed legitimate negative credits and losses into text | Keep finite numeric values numeric and escape formula-like text separately | Negative-number and text-escaping regressions; a completed instructor preview exports all 151 ledger entries and 304 balanced numeric postings, despite the journal showing only its latest 100 entries |

These corrections change reads and presentation. They do not rewrite historical economic decisions or daily accounting closes.

## Completed verification

- The latest complete automated suite passed **179/179 tests** with `--test-concurrency=2` in **37.17 seconds**. An earlier run at default parallelism encountered one local HTTP `ECONNRESET`; all six tests in that HTTP test file passed when rerun independently, followed by complete-suite passes. Coverage includes cache and long-history reporting, daily cutoffs/company rows/inventory, direct JSON response equivalence/privacy/authorization/catchup, and the existing economic, concurrency, and browser-state checks.
- The cache and reporting deployment was verified with HTTP 200 for browser release `b895a0e0eb1a`, function revision `classroom-00028-pag`. The subsequent serialization deployment completed around day 49: browser release `141ab44de424`, function revision `classroom-00029-von`.
- In Chrome, a 13-day classroom showed exactly **seven days and 84 company rows** in the selected report table, with euro cents retained and no console errors observed.
- CSV content and complete ledger export were verified by automated tests. **A completed CSV download was not independently confirmed in Chrome.**

## Final production rerun

The rerun completed all 60 simulated days and cleanup. It crossed a deployment: **days 1, 15, 30, and 45 below used the cache-only revision `classroom-00028-pag`**, without the subsequent direct JSON serialization correction. **Day 59 used the final revision `classroom-00029-von`.** These earlier waves must not be attributed to the final revision. Each wave used all 120 authenticated student clients; all measured maxima are below the browser's 15-second deadline.

| Completed production wave | Deployment | Requests | p50 | p95 | Maximum |
| --- | --- | ---: | ---: | ---: | ---: |
| Day 1 private student views | Cache-only `00028-pag` | 120 | 1.808 s | 2.606 s | 2.664 s |
| Day 15 private student views | Cache-only `00028-pag` | 120 | 3.680 s | 5.404 s | 5.509 s |
| Day 30 private student views | Cache-only `00028-pag` | 120 | 5.043 s | 9.114 s | 9.317 s |
| Day 45 private student views | Cache-only `00028-pag` | 120 | 11.073 s | 13.142 s | 13.396 s |
| Day 59 private student views | Final `00029-von` | 120 | 10.684 s | 12.105 s | 12.410 s |

All 120 requests in the final day-59 wave returned HTTP 200. All five measured waves passed the 15-second gate. Across the complete run, **3,012 requests returned HTTP 200, one returned HTTP 201, and one returned the expected HTTP 403 when a student accessed the completed session**. There were **zero unexpected failures and zero requests at or above 15 seconds**. The maximum across all 3,014 requests was 13.396 seconds, during day 45. This is a deadline check, not a claim of instantaneous responses: the final wave's median was 10.684 seconds.

Around day 45, monitoring observed one instance, a highest memory sample of **73.9%** (approximately **378 MiB** of the 512 MiB allocation), and a CPU sample of **44.6%**. These observations belong to the cache-only deployment. The final revision reached **two instances** during the day-59 wave; its highest observed minute distribution means were **53.2% CPU** and **71.4% memory**, declining after cleanup to **4.9% CPU** and **40.0% memory**. These are sampled minute means, not instantaneous peaks. Both revisions used the same configuration: one CPU and 512 MiB per instance, concurrency 160, and at most two instances. Because the final wave used two instances while day 45 used one, the production performance difference cannot be attributed entirely to the serialization change.

The day-59 log query found no `ERROR` or request-failed entries. Post-cleanup request metrics through 11:53 UTC recorded 531 HTTP 200 responses and the one expected HTTP 403 on the final revision, with zero HTTP 5xx responses. The final post-cleanup log fetch and its retry were unavailable because the monitoring API returned HTTP 429. This limits the final log inspection; it was a monitoring read quota limit, not a simulation API failure. The runner's complete 3,014-request totals above remain independently recorded.

## Economic and daily accounting results

The completed run accepted **1,090 economic decisions**. Replaying the saved initial state and production audit reproduced the entire final state exactly. The independent [economic validator](../scripts/economic-checks.mjs) also passed at **all 60 daily closes, covering 720 company report rows**. It checked the exact cutoff and company coverage at each close, immutable earlier reports, balanced integer-cent journals and account totals, inventory quantities and values, revenue/cost recognition, receivables/payables, debt and interest, deposits, investments, and outstanding cash-flow obligations. Daily report values were reconciled against the state at their own cutoff, rather than comparing every historical report with the final state.

| Completed economic activity | Result |
| --- | ---: |
| Units produced | 58,566 |
| Customer orders | 5,760 |
| Shipments dispatched | 5,606 |
| Units received by customers | 48,576 |
| Customer payments | 5,229 |
| Supplier purchases / paid | 580 / 520 |
| Freight payments | 5,419 |
| Loans / fully repaid | 12 / 12 |
| Deposits / matured / pending beyond day 60 | 60 / 48 / 12 |

Obligations scheduled beyond the simulation end remain explicitly represented; pending deposits and unpaid future obligations are not discarded to force a zero balance. The [aggregate results](full-live-simulation-2026-11-13.json) record exact replay, strict daily reconciliation, deadline checks, and completed cleanup.

This successful run validates the bounded workload on the measured deployments. It does not establish unlimited capacity, 120 simultaneous rendered browsers, or multiple busy classrooms sharing the same backend.
