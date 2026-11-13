# Visible Chrome team play — 13 November 2026

Six authenticated synthetic students, two per competing team, completed a 14-day simulation through visible Chrome tabs alongside an instructor. Concurrent decisions, shared supplier competition, native browser disconnect/recovery, adaptive play, deliveries, payments, investments, deposit maturities, and daily reports were checked. Two visible interface defects were corrected and verified in deployed Chrome; incorrect public entry links were also corrected.

This is a browser interaction test, separate from the earlier 120-student API capacity tests. Synthetic accounts and classroom membership were provisioned privately. Student decisions and instructor clock controls are operated through the visible application. Read-only backend snapshots independently reconcile the resulting simulation. No account identifiers, credentials, or private classroom exports are included here.

## Strategies exercised

| Team | Actual choices through hour 24 |
| --- | --- |
| Alpha: volume and material supply | Regional offer €275, quantity 1–300, 60-hour delivery and 72-hour payment; two production shifts; 400 junction boxes purchased for €9,645 payable; €1,101 one-week deposit. Two 33-unit shipments used electric road and rail, respectively, after comparing delivery buffers. |
| Beta: premium offer and lower energy use | International offer €320, quantity 1–500, 96-hour delivery and 72-hour payment; evening production; €450 wind agreement and €24,000 efficiency retrofit, both awaiting activation; €1,202 one-week deposit. 31 units dispatched by electric road and 30 by rail. |
| Gamma: conservative production and automation | One 00:00–08:00 shift; regional offer €295, quantity 1–80, 60-hour delivery and 24-hour payment; €1,303 and €1,505 one-week deposits; 28-unit electric-road shipment; €18,000 dispatch assistant ordered at hour 24 for activation at hour 72. |

Every team began with €180,000 cash, 180 finished modules, 14,400 cells, 600 frames, and 600 junction boxes. Initial profit, production, debt, and customer orders were zero. Differences below reflect deliberately different decisions, timing, and accepted contracts; they are not a controlled comparison of strategy performance.

## Audited hour 24 checkpoint

At the recovered-stale checkpoint, revision 19 contained 19 committed commands and 19 idempotency receipts. Replaying the authoritative initial state and complete command sequence reproduced every persisted simulation field. All company ledgers balanced.

| Team | Cash | Cumulative profit | Produced | Finished stock | Shipments | Locked deposits |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Alpha | €176,390.68 | −€2,541.20 |192|306|2|€1,101.00|
| Beta | €151,874.52 | −€2,956.36 |192|311|2|€1,202.00|
| Gamma | €157,736.44 | −€1,488.44 |96|248|1|€2,808.00|

Each team had eight customer orders. No dispatched units had yet arrived or been paid. Alpha had €9,645 in supplier payables; the other teams had none. Freight expenses had already reduced cash and profit, while customer revenue and receipts remained pending. The frozen daily report and the live post-dispatch position were checked separately.

## Audited hour 48 checkpoint

Revision 23 contained 23 committed commands and 23 receipts. Exact replay, balanced ledgers, and both closed daily reports passed. The figures below matched the visible Chrome reports, including integer-cent revenue and cost of goods sold.

| Team | Cash | Cumulative profit | Produced | Finished stock | Revenue | Cost of goods sold | Received units |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Alpha | €174,237.80 | −€541.48 | 300 | 414 | €9,075.00 | €4,889.54 | 33 |
| Beta | €150,348.64 | €1,081.87 | 288 | 383 | €11,685.00 | €6,074.88 | 41 |
| Gamma | €156,455.48 | €1,474.92 | 192 | 344 | €8,260.00 | €3,982.82 | 28 |

Alpha's 400 junction boxes arrived at hour 48, with the €9,645 supplier payment still scheduled for hour 168. Its first road shipment arrived at hour 46 after a four-hour carrier delay; payment was due at hour 118. Beta's wind contract and efficiency retrofit activated at hour 48. Three additional Beta shipments exercised the dialog conflict reproduction and corrected-release retry, bringing its total to five shipments and 85 dispatched units. Gamma's dispatch assistant remained pending until hour 72; its first customer payment was due at hour 66. No customer shipment had yet been paid at hour 48.

## Audited hour 72 checkpoint

Before the teams' subsequent adaptive decisions, revision 24, all 24 commands and receipts, and three closed reports passed exact replay and ledger validation. Alpha had received all 66 dispatched units; Beta all 85. Their receivables remained awaiting payment. Gamma's first shipment was paid at hour 66, and its dispatch assistant activated at hour 72 and automatically sent 47 additional units without an extra student decision.

| Team | Cash | Cumulative profit | Produced | Finished stock | Revenue | Cost of goods sold | Received units |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Alpha | €172,057.20 | €1,430.54 | 450 | 564 | €18,150.00 | €9,779.08 | 66 |
| Beta | €149,100.24 | €5,808.12 | 300 | 395 | €24,225.00 | €12,594.25 | 85 |
| Gamma | €163,199.12 | −€84.14 | 288 | 393 | €8,260.00 | €3,982.82 | 28 |

Material shortages were visible in the production results: Alpha exhausted its cells, while Beta exhausted its junction boxes after producing only 12 units that day. Gamma had 24 junction boxes remaining. Beta's cumulative electricity use was 882 kWh and emissions 451.85 kg after the wind and efficiency changes. These are observed outcomes of different play choices, not evidence that one strategy is universally superior.

## Adaptive play after hour 72

Alpha responded to its exhausted cells by pausing all shifts, effective at hour 80, to avoid further idle wages. It retained finished stock for sales and dispatched another 47 units by electric road for €235.40. The expected arrival was hour 90 against a promised hour 102, retaining room for the possible four-hour road delay. The interface warned that rail would be late. Both teammates saw zero units remaining to dispatch for that order. Both decisions were accepted without a stale retry.

Beta replenished the production bottleneck with 600 junction boxes by rail for €14,445 payable, then 4,800 cells by rail for €14,925 payable. Both purchases were estimated to arrive at hour 120, with payment due at hour 240. These purchases reduced shared supplier stock from 1,050 to 450 junction boxes and from 34,800 to 30,000 cells.

Gamma explicitly reviewed and retried its 4,800-cell rail purchase for €14,925, then bought 400 junction boxes by rail for €9,645. Its two accepted purchases left shared stock at 25,200 cells and 50 junction boxes. These liabilities were also due at hour 240.

## Audited hour 192 checkpoint

Revision 31 contained 31 committed commands and 31 receipts, with eight closed reports. Full replay and balanced ledgers passed. The first supplier payment and all four deposits had matured; the newer Beta and Gamma supplier liabilities remained pending until hour 240.

| Team | Cash | Cumulative profit | Produced | Finished stock | Revenue | Cost of goods sold | Received units | Paid shipments |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Alpha | €192,824.64 | €5,095.16 | 450 | 517 | €32,250.00 | €17,111.97 | 113 | 3 |
| Beta | €168,238.16 | −€710.50 | 600 | 695 | €24,225.00 | €12,594.25 | 85 | 5 |
| Gamma | €305,119.75 | €77,803.14 | 500 | 0 | €202,630.00 | €106,075.00 | 680 | 19 |

Alpha's paused shifts limited further expenses after material exhaustion. Beta replenished production and accumulated finished stock, while Gamma's active dispatch assistant sold its available stock across 32 total shipments. Gamma had received all 680 dispatched units, but 13 shipment payments remained pending. Deposit interest was €0.84 for Alpha, €0.92 for Beta, and €2.15 across Gamma's two deposits. The rejected offline €1,404 deposit remained absent.

## Concurrent decisions and native offline recovery

The students submitted competing decisions, including a coordinated deposit round. Stale revisions were rejected, preserving entered values for explicit review. Accepted deposits and shipments appeared in the teammate's tab; ledger and receipt checks found no duplicate effects.

The Gamma recovery sequence used Chrome DevTools' actual per-tab Offline setting:

1. Gamma One entered a €1,404 deposit and submitted while offline. The error preserved the draft.
2. Gamma Two, still online, accepted a separate €1,505 deposit.
3. Gamma One closed the dialog and saw the pending-decision notice. Reloading while offline produced Chrome's network error page.
4. Restoring No throttling and reloading restored authentication, the workspace, current cash, and the pending request.
5. Retrying the original pending request received a stale-revision rejection and cleared its notice. The request was not silently rebased or submitted as a new deposit.

The authoritative audit confirmed exactly one €1,505 deposit and no €1,404 deposit. Network settings were restored after the test.

## Confirmed defect and correction

Beta found that a dispatch dialog preserved stale read-only information after a 409 response. It had opened with 372 modules in stock. A teammate dispatched 31 modules, leaving 341. The rejected dialog retained the entered 30-unit rail shipment correctly, but still displayed 372 available modules until it was cancelled and reopened.

The correction refreshes dispatch stock, remaining order quantity, validation limits, route availability, current freight quote, and arrival context after the authoritative state refresh. It retains the existing input elements and entered values. Purchasing dialogs use the same approach for changed supplier stock, prices, fees, lead time, minimums, and lot sizes. Unavailable orders, routes, or suppliers cannot be submitted using stale validation information.

The focused regressions reproduce 372→341 while preserving 30 units and rail, changing quotes, exhausted stock, disabled routes, and revised purchasing terms. The full 250-test suite passed before deployment.

The corrected release passed a visible Chrome retest. A 10-unit road draft initially showed 22 units remaining, 304 in stock, and a quantity maximum of 22. A teammate dispatched seven units by rail. After the conflict response, the same dialog showed 15 remaining, 297 in stock, and a maximum of 15; the entered 10 units and road selection remained intact. Its unchanged €117 / 38 kg quote was appropriate because the selected route and quantity had not changed.

The purchasing correction also passed a live competing-team test. Gamma opened a 4,800-cell purchase while shared stock was 34,800. Beta then bought 4,800 cells. Gamma's stale submission refreshed the same dialog to 30,000 available, preserving its entered 4,800 units and appropriate €14,925 / 12,000 kg quote for explicit review.

Testing also found that the README and canonical/social metadata directed users to a legacy deployment path. Those links were corrected to the required `/realgame-sustainability-simulation/` location. A legacy-page reproduction was distinguished from the corrected-release retest; parent-domain configuration was not changed.

Alpha also found floating-point display tails in the exact report table, including `184.32000000000002` and `2925.7999999999997` kg. The correction displays non-currency report values with at most four decimal places while preserving two-decimal currency formatting and raw CSV data. The expanded 251-test suite passed. Actual Chrome verification of the deployed release showed 184.32, 2,925.8, and 3,069.8 without binary tails; Beta's 450.905 retained useful precision. Currency retained two decimal places and module counts remained integers.

## Completed 14-day result

The instructor advanced the paused classroom through the visible clock controls to hour 336. The authoritative session became `completed` at exactly its configured end hour. Revision 32 contained 32 committed commands and 32 idempotency receipts. Full replay reproduced the complete persisted state, including all 14 daily snapshots, and all company ledgers balanced.

All six student tabs returned to session entry when the classroom completed. This matches the documented access policy: completed sessions close student access, while the instructor retains reports. Student-visible KPI reconciliation therefore ends at hour 192. The instructor's final Chrome reports matched all three exact cash and profit values below, independently reconciled against the backend audit.

| Team | Final cash | Cumulative profit | Produced | Finished stock | Revenue | Received and paid units | Shipments |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Alpha | €190,616.64 | €2,691.04 | 450 | 517 | €32,250.00 | 113 | 3 |
| Beta | €131,392.16 | −€8,461.12 | 600 | 695 | €24,225.00 | 85 | 5 |
| Gamma | €314,237.75 | €70,156.11 | 500 | 0 | €202,630.00 | 680 | 32 |

All 40 shipments had arrived and been paid. All scheduled events were completed; supplier payables, deposit assets, and loan principal were zero for every team. The newer Beta and Gamma supplier purchases settled at hour 240. All four accepted deposits matured once, and cumulative interest stayed at €0.84, €0.92, and €2.15 respectively. The offline €1,404 draft never became a deposit.

Final cumulative electricity use was 1,350 / 1,557 / 1,500 kWh for Alpha / Beta / Gamma, and total emissions were 3,174.4 / 16,255.475 / 21,886.6 kg. These totals include the simulation's supply and shipment activity, so the lower-carbon electricity contract alone does not determine total emissions. The deliberate strategy differences, stock constraints, and manual versus automated dispatch make this a functional test rather than a fair strategy ranking.

## Scope and verification limits

The browser portion used six actual student accounts and three teams, not 120 Chrome tabs. Separate API load tests cover the larger classroom capacity. This run used synthetic identities and data, exercised one native offline tab, and sampled explicit concurrent decisions; it does not prove every possible network or student action sequence. Read-only audits reconciled opening state and hours 24, 48, 72, 192, and 336. All seven test tabs were closed after inspection. The completed synthetic classroom and seven synthetic accounts remain retained pending explicit cleanup authorization; no cleanup ran.

Relevant regression coverage: [dialog context](../tests/dialog-context-refresh.test.mjs), [decision recovery](../tests/decision-recovery.test.mjs), and [instructor pause](../tests/instructor-pause.test.mjs).
