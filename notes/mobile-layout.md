# Mobile layout review

Reviewed on 16 November 2026 using the local demonstration with synthetic accounts.

## Changes

- Tables become labeled records at widths up to 900 CSS pixels. Sorting remains available above the records, and row actions stay attached to their data. Desktop tables retain their columns.
- The same layout covers formatted message tables. Labels are escaped, hidden from assistive technology when redundant, and hidden visually on desktop.
- Long status badges wrap inside records. Phone dialogs have more usable space, session actions stack, and filter fields use the available width.
- Mobile navigation stays in document flow, with a scrollable menu when expanded. Session tooltips stay within the phone viewport.
- Resizable panels give their title and five controls separate rows on phones, with 44-pixel controls and clear gaps. Resize handles remain inside the panel boundary.
- Operational report records can grow naturally without spilling past a fixed table height. Daily history bars wrap instead of requiring sideways scrolling.

## Verification

- Browser layout measurements at 320, 390, 430, and 768 CSS pixels; no page-level horizontal overflow on the checked screens.
- Instructor home, setup, shared clock, overview, reports, messages, account menu, saved-test dialog, roster, and catalogue/edit dialogs.
- Student inventory, suppliers, purchase history, shipment history, logistics, replenishment, sales offers, orders/dispatch, production, finance, energy, messages, reports, and help.
- Purchase, replenishment, sales-offer, dispatch, staffing, loan, deposit, electricity-switch, investment, and budget dialogs checked at 320 CSS pixels.
- Live table sorting checked in the browser. Automated tests preserve numeric precision, ordering, action identifiers, escaped content, and inventory calculations with responsive markup.
- Integrated the current categorized reporting and resizable-panel changes from main. Opened all 51 operational reports through their category menus at 320 CSS pixels; no page-level horizontal overflow was observed.
- Full existing automated test suite, JavaScript syntax checks, browser asset-version check, and static/backend allowlist builds pass.

These were browser viewport checks, not tests on physical phones. Screenshot capture was unreliable during emulation; layout verification used rendered element dimensions and the accessibility tree.
