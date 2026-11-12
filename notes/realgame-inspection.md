# RealGame inspection status

Date: 12 November 2026.

The browser entry point at <https://realgame.cloud/> was inspected. This note contains original observations suitable for a public repository. Screenshots, third-party browser assets, and account-specific working notes are excluded from Git.

## Confirmed scope

- The entry page offers username/password authentication and Azure single sign-on.
- The browser loads a student entry bundle alongside Vue, PrimeVue, a reporting component, Chart.js, date-fns, CodeMirror, and a Markdown parser. Loaded dependencies establish available implementation components; they do not establish which features or plots are used by a particular simulation.
- An authenticated administrator walkthrough created and configured an isolated test session, allocated a test participant to a company, and opened that company's view through the administrator's supported preview action.
- A later isolated three-company experiment verified a separate anonymous student sign-in. Two additional agents operated competitors through administrator-supported company previews. Preview access and independent student authentication are distinct workflows; only the first company used separate student authentication.
- The experiment covered several decision rounds and seven and a half simulated days. A session runtime limit then prevented further advancement. The session was left paused. Decisions scheduled beyond that point are recorded as accepted or pending, not as completed outcomes.
- Observed workflows included purchasing, supplier comparisons, inventory, production shifts, staffing, offers, partial shipments, transport timing, loans, deposits, energy contracts and delayed automation investments.
- Teacher announcements, student-to-teacher replies, peer-company messages and global chat were tested. Team-internal chat was visible, but delivery to another student in the same company was not tested.
- The post-setup administrator menu was narrower than the available pages. Previously observed settings and additional declared reference routes rendered under the existing administrator session. Live feature changes and supplier, transport, demand and energy reference screens were inspected. A hidden menu item alone does not establish either an access restriction or a working permission boundary.

## Observed behavior and edge cases

Partial shipment required confirmation and retained the unfulfilled quantity. Early and late shipping choices produced explanatory feedback; a carrier delay could change the realized timing from the estimate. Inventory shortages, overflow, waste, changing average costs and separate labour/machine bottlenecks appeared during play. Accepted loans and automation investments had delayed effects, while a term deposit reduced available cash immediately.

Feature flags changed the decisions students could edit during the session. Some expenses continued to accrue before their editing controls were enabled. A visible sustainability metric did not by itself prove that the metric influenced customer allocation. An original implementation should specify visibility, edit permission and economic effect separately.

Students could inspect current inventory and orders, forthcoming events, cash-flow forecasts, operational messages, financial statements and comparative reports. Saved charts included profit, production, energy costs, market shares, daily sales, inventory and order/dispatch history. Live indicators and daily reports had different cutoffs. Dispatch history was distinct from completed customer arrivals, and a table's arrival column could include a future scheduled date.

Messages remained usable while the clock was paused. An announcement appeared immediately and was retained in history. The inspection also found an inconsistent displayed message date and a display-name field that did not reliably change the sent signature. These are observations to investigate, not behaviors to reproduce.

Student-facing data downloads succeeded. The private archive contains screenshots, contextual help captures, structured exports and reference materials. A chart CSV attempt did not produce a verified file. No copied assets, exports, account records or third-party teaching files are included in this repository's tracked content.

## Design requirements identified

| Area | Requirement for an original implementation |
| --- | --- |
| Session administration | Separate setup, paused, running and finished states; make irreversible setup transitions clear |
| Student onboarding | Keep invitation, registration, company assignment and role permissions distinct |
| Suppliers | Compare stock, unit price, lead time, payment terms and logistics with explicit units |
| Decisions | Separate immediate request confirmation from delayed execution and realized outcomes |
| Simulation engine | Use an authoritative clock, explicit event ordering, durable decisions and reproducible randomness |
| Order lifecycle | Keep original ordered quantity, remaining quantity, dispatch, arrival and payment as distinct records |
| Capabilities | Separate feature visibility, edit permission and economic effect; enforce permissions on the server |
| Feedback | Provide live indicators, event queues, dated reports and clearly labelled charts |
| Reporting cadence | Distinguish live metrics from daily snapshots so apparently conflicting values can be interpreted |
| Messaging | Persist scoped conversations and announcements with explicit real-world and simulation timestamps |
| Session completion | Explain runtime limits and pending obligations when further advancement is unavailable |
| Teaching resources | Index permitted local references without republishing third-party materials |
| Accessibility | Give icon controls descriptive names and offer alternatives to drag-only interactions |

## Follow-up questions

- Verify personal-email onboarding and invitation delivery separately from the anonymous student sign-in already tested.
- Confirm which settings and reports each administrator role is entitled to use.
- Test team-internal messaging with multiple independently authenticated participants.
- Complete later loan repayment, deposit maturity, replenishment and long-haul arrival experiments in a session that permits further advancement.
- Test insufficient-funds behavior, concurrent submissions, reconnect/retry handling and numeric validation without assuming how the unseen server works.
- Specify independent backend rules and validation before implementing a new simulation; frontend declarations alone do not establish those rules.

A browser asset archive is not the complete simulation source. The backend, authoritative rules, persistence and synchronization were not recovered. The experiment was broad exploratory testing with changing settings and stochastic demand; it cannot establish exact formulas, causal price elasticity or an optimal strategy. The next implementation should use original code and independently specified rules.
