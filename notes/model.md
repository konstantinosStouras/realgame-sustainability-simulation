# Sustainability Studio: original model and teaching guide

This is an independently authored business simulation, not a reconstruction of RealGame's proprietary engine. All catalogues, formulas, text, code, and interface assets here are original. Private research remains excluded from the repository and deployment.

## Start a class

Sign in with Google (including Gmail and Google Workspace) or verified email/password. An instructor creates a session, selects a seed and duration, and shares each company's join code. Students sign in, enter a code, and work in their assigned company. Instructor privileges come from verified Firebase custom claims or a server-side UID allowlist. A student cannot select a teacher role. Instructor company previews are read-only. In the local demo only, explicit synthetic accounts can be selected without passwords. The public solo sandbox is a separate single-browser rehearsal; role switching there is not multiplayer authentication.

Pause for decisions and discussion, step the simulation, then inspect outcomes. Continuous running is controlled by the authoritative server. Restarting the server preserves the state; no offline elapsed time is simulated. A configured end pauses economic activity in a completed state, preserving all obligations. The instructor can extend the duration up to 180 days. There is no 180-hour cap.

## A useful first exercise

1. Compare an offer's delivery promise to the available transport routes.
2. Ship part of an order and check the unchanged original quantity and the remaining balance.
3. Purchase the next bottleneck component, then watch its receipt and later payment.
4. Change a shift or commission an investment. Record its activation time before advancing.
5. Switch to wind power and compare future energy use and carbon with existing stock's footprint.
6. Compare profit, cash, receivables, and the committed cash forecast at the same cutoff.

The seeded demonstration contains three companies with different shift and electricity decisions, two installed automation assistants, and three completed days. These are illustrative strategies, not recommended or optimal ones.

## Time and event rules

Time is an integer number of hours after 1 January 2026 00:00 UTC. Each tick advances one hour. All due events execute first, ordered by due hour then creation sequence, including same-hour consequences; then production runs, demand is allocated every six hours, automation runs, and a midnight daily close records costs and a snapshot. A shift change effective on the boundary applies to the production calculation of that tick. Real-world message/audit timestamps are stored separately as UTC ISO dates and displayed in the viewer's local time. Simulation timestamps always use UTC.

Accepted decisions either take effect immediately or create durable pending events. Their receipts, settlements, and activation events become completed outcomes. No cancellation of committed contracts is implemented. Late supplier payments and loan repayments retry every 24 hours when funds are insufficient. They remain visible as overdue; the same interest is not charged repeatedly. Existing financial and delivery terms are stored on contracts and survive catalogue changes.

## Manufacturing and inventory

One solar module consumes **24 PV cells, one recycled frame, and one controller**. Each assembly line supports six modules/hour; each worker supports two modules/hour. Output is the integer minimum of machine capacity, worker capacity, material availability, free finished-goods space, and cash available after active-shift wages. The three daily shifts are 00–08, 08–16, and 16–24 UTC. Active-shift wages are €13.50 per worker/hour, even when a material shortage stops output. If cash cannot cover wages, the hour does not run. There is no random yield, scrap, or production waste in v1.

Production uses 3 kWh per module, reduced by 25% after the efficiency retrofit. Material weighted-average value and embodied carbon transfer into finished goods. Labour and electricity are **period expenses**, not capitalized manufacturing costs; the stock value is therefore material acquisition cost, not full absorption cost. Finished output cannot exceed storage capacity. Inbound stock can exceed normal capacity up to twice capacity including goods on order, with a €0.05/unit/day overflow charge. Purchases above this hard limit are rejected. Supplier minimums and lot sizes are enforced. Supplier stock is shared, reserved on acceptance, and replenished at daily close subject to a cap of 30 times daily replenishment plus 10,000 units.

## Competitive demand

Every six hours each active market draws total demand uniformly between 80% and 120% of its configured volume, rounded to whole units. Companies compete using this original score:

```
score = (reference price / offer price)^2
      * satisfaction * quality
      * (1 + 0.1 * sqrt(daily marketing cents / 10000))
      * exp(-green weight / 100 * module kg CO2e / 100)  [when enabled]
      * (1 + payment hours / 2400)
      / (1 + delivery hours / 480)
```

Market units are allocated in proportion to scores, rounded down, with remaining units assigned by largest fractional remainder (stable company-ID tie-break). Current weighted-average stock carbon is used, or 75 kg if stock is empty. Each company has one editable offer per market. The lowest-price/stable-ID rule is defined if a scenario contains additional offers. Quantities below the chosen offer's minimum are lost; allocations above the maximum are capped; lost units are not redistributed. Accepted prices, promises, and payment terms are immutable on each order. Prices are bounded to €50–€10,000; there is no dynamic cost-based price floor.

Daily research increases quality by `0.004 * sqrt(daily research cents / 10000)`, capped at 1.5. Satisfaction is bounded 0.3–1.3: receipt after the deadline subtracts 0.08, receipt over 24 hours early subtracts 0.02, receipt in the inclusive window adds 0.025; daily recovery adds 0.005. These effects apply per shipment, including partial shipments. The model is intentionally transparent and simplified; it does not establish real-world elasticity or causality.

## Logistics and automation

Supplier and customer routes sample on-time arrival using the declared reliability percentage. A late arrival adds an integer delay uniformly from 1 to the configured maximum. Nominal estimates remain visible separately from actual receipt. Each customer consignment pays a fixed plus per-unit freight charge and records fixed plus per-unit transport carbon at dispatch. Full and partial dispatch are supported; original quantity equals remaining quantity plus all dispatched quantities. Customer receipt and customer payment are separate events.

The dispatch assistant considers the oldest open order each hour and ships up to available stock. It selects the lowest-cost route that can meet the promise **including maximum delay**. It targets a 12-hour early buffer plus maximum delay and waits until the target dispatch hour. If no route is on time, it chooses the fastest enabled route. Its next action or blocking reason is visible. One consignment per company/hour is the deliberate v1 limit.

The replenishment assistant examines enabled policies each hour. If on-hand plus unreceived purchases is at or below the reorder point, it orders the policy quantity from the selected supplier. It does not silently substitute suppliers. It charges half the normal fixed ordering fee. Insufficient supplier stock, credit, or capacity leaves an explanation and retries next hour. Disabling purchase/dispatch permission also pauses the respective assistant; existing shipments and contracts still execute. Visibility flags change navigation only; permissions change allowed decisions; carbon demand is an independent economic effect.

## Accounting, banking, and carbon

All ledger postings are integer EUR cents, double-entry, with debits positive and credits negative. Every transaction must sum to zero. Inventory value reconciles to the inventory account. Cash cannot become negative.

| Lifecycle | Posting |
| --- | --- |
| Opening capital | Debit cash/inventory/fixed assets; credit equity |
| Purchase accepted | Debit inbound asset; credit supplier payable |
| Supplier receipt | Debit inventory; credit inbound asset |
| Supplier paid | Debit payable; credit cash |
| Customer dispatch | Debit goods in transit; credit inventory; freight expensed and paid |
| Customer receipt | Debit receivable; credit revenue; debit cost of goods sold; credit goods in transit |
| Customer paid | Debit cash; credit receivable |
| Investment ordered | Debit construction/prepaid asset; credit cash |
| Investment activated | Debit fixed assets; credit construction |
| Loan funded | Debit cash; credit debt |
| Loan interest due | Debit expense; credit interest payable |
| Loan repaid | Debit debt and interest payable; credit cash |
| Deposit placed | Debit deposits; credit cash |
| Deposit matured | Debit cash; credit deposits and interest income |

Loans fund in 24 h; aggregate outstanding principal including pending loans is capped at €150,000. Terms are 7–90 days with one bullet repayment and 9% simple annual interest. Deposits run 1–90 days at 4% simple annual interest, with no early withdrawal. Interest is rounded once: `principal cents * annual rate * term hours / 8760`. Interest is recognized at maturity, not accrued daily. These are simulated contracts, not financial advice or actual products.

Daily overhead includes €350 rent, the active energy supplier's standing fee, overflow storage, marketing and research. Unpaid overhead is recognized as a liability and retried at subsequent daily closes. Fixed assets use a simplified 20% annual **declining-balance** depreciation divided by 365 at each close. Supplier credit allows new purchase commitments up to current cash plus €80,000 less existing supplier payables.

Carbon includes newly received purchased components and their inbound transport, production electricity, and dispatched customer freight. Opening stock's embodied carbon remains in stock intensity but is excluded from new operational emissions. Material conversion transfers carbon without double-counting it. This teaching footprint is not a certified corporate GHG inventory. There is no carbon price or offset system in v1.

## Reports, roles, and durability

Live metrics and the transaction journal update after each committed command/tick. Daily chart records are immutable midnight snapshots. Cumulative measures include cash, profit, revenue, output, electricity, energy expense, stock, dispatches, receipts, and emissions; daily sales/production are differences between successive snapshots. Delivered market share is cumulative received modules divided by all received modules, zero before any receipts. CSV exports include units and simulation time. The committed cash forecast only contains already scheduled monetary events: it excludes future trading, wages and overhead, and purchase/sale settlements not yet scheduled by physical receipt. It is not a projected bank balance.

The server stores state, accounts, memberships, hashed session tokens (local demonstration only), invitations, requests and replay commands in SQLite WAL transactions. Optimistic revisions reject stale decisions. Per-user idempotency keys return the original result on retry and reject reuse with a different command. Server checks enforce ownership and permissions on every action. Firebase ID tokens are verified for the configured project with the official Admin SDK. Verified emails are required. Production can additionally enable revocation checks with application-default credentials.

Announcements are instructor-to-all. Global messages are visible to the class. Teacher conversations include that company and instructors. Team messages include only the company's students, and peer messages include only the two companies. Instructor previews do not grant access to private team or peer messages. User-supplied sender fields are ignored. Instructor configuration and company decisions are auditable. Replay exports are instructor-only and contain session communication and identities; treat them as private class records. Never commit them.

## Limits and next iterations

The full-stack server is a single process on persistent storage; run exactly one clock owner. It is suitable for local classroom trials, not a horizontally scaled deployment. State and complete history are serialized per session; high-volume/long-running classes need normalized persistence, retention, and load testing. Polling updates clients every three seconds; focused forms keep their drafts and stale submissions receive an explicit conflict. No email invitations, SSO organization management, password handling outside Firebase, chat moderation, attachments, voice, tax accounting, multi-currency, or full ESG framework is implemented. The v1 catalogue is intentionally small. Commercial metrics are shared only through defined comparative reports.

Firebase Hosting and GitHub Pages host the interface and solo sandbox. They cannot run the Node/SQLite multiplayer server. A real HTTPS server with a persistent volume is required for remote classroom play; a Docker configuration is supplied. Deployment of Firebase Authentication alone does not deploy this server.
