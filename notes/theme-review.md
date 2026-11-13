# Student theme code review

Reviewed 13 November 2026 without starting the application, opening a browser,
creating accounts or sessions, exporting files, or generating simulation data.

The student sales-offer, dispatch, purchase, staffing, loan, deposit, investment,
energy-switch, budget, and replenishment dialogs all use `modal()`. Its theme and
close controls now share an opaque sticky toolbar outside the decision form, so
scrolling content cannot show through behind the controls. Both controls retain
44-pixel touch targets. Theme switching changes appearance and stored preference;
it does not submit the form, reconstruct its inputs, or issue game commands.

Dark-mode navigation now styles the `.active` class actually emitted for open
student panels, including hover and keyboard focus. The shared header switch is
placed immediately as well as after page changes, and stays registered while
temporarily detached during a workspace render.

Validation was limited to source review, JavaScript syntax checks, asset-version
consistency, CSS delimiter checks, and Git whitespace checks. No runtime tests or
live student checks were performed for this update.

## Instructor review

The instructor dashboard, session actions, reports, company views, and account
menu were reviewed from source. All instructor dialogs share the same modal and
sticky appearance toolbar: classroom creation, test-round setup and assignment,
settings, custom steps, event history, company directory and reassignment,
catalogue editing, profile and help, password reset, and destructive-action
confirmations. Their controls inherit the theme and responsive form rules.

Report chart labels and two company series were too faint in light mode. Shared
chart tokens now keep lines, points, and legends consistent across both themes.
Against white, label contrast increases from 4.07:1 to 5.52:1; the two series
increase from 2.51:1 and 2.93:1 to 4.54:1 and 4.94:1. Dark colours are preserved.
These figures were calculated directly from the CSS colours.

This review used only source and static checks. No application, browser, game
decision, account, session, download, or generated test data was involved.
