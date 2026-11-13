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
