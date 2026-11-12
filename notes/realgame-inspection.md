# RealGame inspection status

Date: 12 November 2026.

The browser entry point at <https://realgame.cloud/> was inspected. This note contains original observations suitable for a public repository. Screenshots, third-party browser assets, and account-specific working notes are excluded from Git.

## Confirmed scope

- The entry page offers username/password authentication and Azure single sign-on.
- The browser loads a student entry bundle alongside Vue, PrimeVue, a reporting component, Chart.js, date-fns, CodeMirror, and a Markdown parser. Loaded dependencies establish available implementation components; they do not establish which features or plots are used by a particular simulation.
- An authenticated administrator walkthrough created and configured an isolated test session, allocated a test participant to a company, and opened that company's view through the administrator's supported preview action.
- The walkthrough covered session creation, team allocation, settings, login monitoring, purchasing, inventory, production, logistics, sales offers and business intelligence. A small simulated purchase and a short clock run produced order feedback, changing company results and a cumulative-production chart. The session was left paused.
- Administrator company preview and student sign-in are distinct workflows. A separate student authentication test has not yet been completed.
- The available post-setup administrator menu was narrower than the complete set declared in the client. The reference notes record that access limitation; unexposed screens were not treated as verified.

## Design requirements identified

| Area | Requirement for an original implementation |
| --- | --- |
| Session administration | Separate setup, paused, running and finished states; make irreversible setup transitions clear |
| Student onboarding | Keep invitation, registration, company assignment and role permissions distinct |
| Suppliers | Compare stock, unit price, lead time, payment terms and logistics with explicit units |
| Decisions | Separate immediate request confirmation from delayed execution and realized outcomes |
| Feedback | Provide live indicators, event queues, dated reports and clearly labelled charts |
| Reporting cadence | Distinguish live metrics from daily snapshots so apparently conflicting values can be interpreted |
| Teaching resources | Index permitted local references without republishing third-party materials |
| Accessibility | Give icon controls descriptive names and offer alternatives to drag-only interactions |

## Follow-up questions

- Verify separate student sign-in and invitation delivery.
- Confirm which settings and reports each administrator role is entitled to use.
- Inspect longer-run delivery, sustainability and disruption feedback in isolated tests.
- Specify independent backend rules and validation before implementing a new simulation; frontend declarations alone do not establish those rules.

A browser asset archive is not the complete simulation source. Server-side rules, state, and application data require separate authorized access and cannot be reconstructed reliably from a login screen.
