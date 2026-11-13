# Live Firebase capacity test — 13 November 2026

The deployed backend passed a live test with **120 verified synthetic students, 12 competing teams, and one synthetic instructor**. Across **1,654 API requests**, the final run had **zero unexpected HTTP failures, connection failures, or timeouts**. All synthetic accounts and session records were removed. This supplements the earlier [local stress tests](stress-test-2026-11-13.md); it uses real Firebase Authentication, Firebase Hosting routing, Cloud Run functions, and production Firestore transactions.

## Workload and results

Each team had ten students. The workload included simultaneous state reads, 120 competing decisions from the same reviewed revision, explicit reviewed retries, duplicate submissions, 120 open notification requests alongside 360 state reads, a one-second simulation clock, 12 competing market offers, a simulated trading day, notification fan-out and private company views. Persisted accounting invariants and replay tick uniqueness were checked.

Times below are measured at the client, including network and authentication. p95 means 95% of requests completed within that time.

| Final production phase | Requests | Result | p50 | p95 | Maximum |
| --- | ---: | --- | ---: | ---: | ---: |
| Join classroom | 120 | All succeeded | 0.414 s | 0.581 s | 0.591 s |
| Simultaneous paused state reads | 120 | All succeeded | 1.746 s | 2.738 s | 3.037 s |
| Same-revision decision burst | 120 | 1 accepted, 119 expected conflicts | 3.281 s | 3.875 s | 3.942 s |
| Explicit reviewed decision retries | 119 | All accepted | 0.361 s | 0.513 s | 0.578 s |
| Duplicate submission burst | 120 | All returned saved result | 1.359 s | 2.219 s | 2.320 s |
| Reads while 120 notifications wait | 360 | All succeeded; no throttling | 1.600 s | 4.491 s | 5.733 s |
| Running-clock state reads | 120 | All succeeded | 4.849 s | 5.713 s | 5.802 s |
| State reads after market allocation | 120 | All succeeded, correct private team | 1.970 s | 3.227 s | 3.285 s |

All 120 idle notification requests completed within **26.888 seconds**, including their intentional 25-second wait. All 120 changed-state notifications arrived within **2.619 seconds** of starting the wave, including a deliberate two-second delay before the instructor changed the state. The market generated 120 orders. Deposits were committed exactly once: 120 receipts and 120 decisions despite retries.

The 119 HTTP 409 responses in the initial decision burst are required behavior: the classroom uses a shared revision, so stale decisions require a fresh review. This test does **not** claim 120 simultaneous decisions can all be silently accepted.

## Bugs and capacity issues fixed

1. **Read requests locked shared Firestore state.** Ordinary views and subscription authorization used read-write transactions. The baseline running-clock burst produced **26 HTTP 503 responses out of 120**, with p95 **35.107 seconds**. Production logs identified Firestore `ABORTED` transaction contention. Consistent read-only snapshots now avoid write locks; clock work is combined per session and instance, with fresh authorization afterward. Final running-clock p95 fell to **5.713 seconds**, with zero failures.
2. **Idle notification requests stalled before reaching the function.** With identical URLs, only one of 120 requests returned its heartbeat; 119 exceeded 45 seconds. Function arrival timestamps showed delayed forwarding after the first heartbeat. A unique non-secret wait ID on every request removes this intermediary interference. Revision semantics and header-only authentication remain covered by tests.
3. **Request slots were exhausted by idle subscriptions.** Once all 120 waits reached the backend, the old limit of 80 requests per instance caused 20 HTTP 429 responses during the combined load. Measured CPU and memory left room. Concurrency is now **160 per instance**, with the existing **two-instance maximum**, **one CPU**, and **512 MiB per instance** retained. The same combined workload then passed without 429 responses.
4. **Browser refreshes overlapped and repeated unnecessarily.** Notification callbacks now await their refresh; background refresh bursts are combined. Healthy paused sessions skip redundant three-second full-state polling. Running clocks, reconnection, visibility recovery and unfinished decision drafts keep their required refresh behavior.
5. **Changing clock speed retained the old deadline.** Cloud commands now reschedule the next tick when speed actually changes. Regression tests cover faster, slower and unchanged speeds.
6. **Unchanged profiles could be rewritten because of field order.** Profile comparisons now compare values rather than JSON property order, avoiding unnecessary Firestore writes without caching authorization.

## Verification and limits

- **159 automated tests passed**, including new read-only transaction, 120-reader clock, authorization, speed-change, browser refresh, and 120-client unique-notification regressions.
- Both deployment builds and browser asset-version checks passed. Firebase functions and Hosting were deployed; Chrome loaded the interface without console errors.
- Final runtime: `europe-west2`, revision `classroom-00027-lar`, maximum two instances, concurrency 160, one CPU and 512 MiB each. Browser release: `2d390f77e037`.
- Cloud Monitoring observed two active instances. The highest recorded one-minute mean CPU utilization was **27.7%** and memory utilization **31.9%** for the final revision through 10:45 UTC. These are sampled minute means, not instantaneous peaks.
- The load generator runs outside Chrome using real student tokens; this was **120 independent authenticated clients**, not 120 rendered browser windows. Chrome was used for the interface smoke check. The final backend measurements therefore exclude rendering time.
- This is a bounded test of one classroom, not an unlimited-capacity or multi-classroom guarantee. Notification waits consume request slots; longer histories and additional simultaneous classes need separate measurement. Peak request bursts and intentional stale conflicts are reported rather than hidden by automatic decision retries.
- Early runs exposed the load computer's missing IPv6 route. The final run uses bounded IPv4 connections and records raw first-attempt outcomes. Single-account cleanup throttling was resolved with an explicit batch deletion, and manifests confirmed cleanup for every run.

The reusable [live test module](../scripts/live-classroom-load.mjs) accepts an explicitly supplied Admin Auth client, Firestore client, public API key, HTTPS API base, output path, and cleanup-manifest path. It is not invoked by CI. It creates a uniquely named synthetic session, keeps credentials in memory, and deletes only its own recorded resources. Do not put authentication credentials or raw account data in this public repository.

See [aggregate measurements](live-capacity-2026-11-13.json) for phase counts and percentiles.
