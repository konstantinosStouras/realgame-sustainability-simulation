# Live final student reports — 14 November 2026

The deployed completion-access fix passed an actual Chrome test against Firebase. This follows the [implementation and local verification](completed-student-reports-2026-11-13.md). No additional application defect was found, so no code change or Firebase redeployment was necessary.

## Scope and method

Three synthetic Firebase accounts used separate Chrome tabs: one instructor and two students assigned to different teams. The deployed website loaded browser release `e79d8b7a57f9`. A dedicated one-day classroom isolated this check from real teaching sessions. Administrative setup created the fixture; the deposit, unfinished draft, simulation advance, refreshes, and exports were exercised through the actual Chrome UI.

This is a targeted completion-flow test, not a repeat of the earlier 120-student capacity test.

## Results

- Alpha placed a EUR 1,234 deposit before completion. Beta opened a EUR 5,678 deposit draft without submitting it.
- The instructor advanced the simulation to its final hour, 24. Both student tabs received the completed state. Beta's open draft closed automatically. Final reports stayed accessible and financial decision buttons became disabled.
- Refreshing both student tabs retained their separate identities and final workspace access. Alpha retained one deposit; Beta had none.
- Each student downloaded the final cash-balance report and their own financial ledger using Chrome's native Save As flow. All four files were present on disk and parsed successfully.
- Each report contained both teams' final cash balances: Alpha EUR 177,485.04 and Beta EUR 178,719.04. All four exported data rows matched the authoritative Firebase snapshot.
- Alpha's ledger contained 43 postings across 20 transactions; Beta's contained 41 postings across 19 transactions. Every exported hour, description, account, and amount matched Firebase in order. Each ledger balanced to zero.
- Independently authenticated requests attempted a new deposit, purchase, offer, and team message for each student after completion. All eight received HTTP 409. Completed-member reads and re-entry returned HTTP 200. The full authoritative state remained unchanged after the rejected commands.
- The command log contained exactly two accepted commands, at final revision 2. Replaying them from the initial state reproduced the final state exactly, and engine accounting invariants passed.
- The inspected student Chrome error log was empty.

Chrome's Save As dialog initially required native-window focus correction; this was a desktop automation issue, not an export defect. The final successful downloads above were verified from actual files, not inferred from export-button clicks.

Private CSVs, synthetic fixture credentials, full state, and audit output remain outside the public repository. The completed synthetic classroom and its three accounts were retained for inspection, with one final student report left open in Chrome. No real student data was modified.
