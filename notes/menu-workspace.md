# Workspace menus and operational reports

The first four workspace tools are Operations, Investments & Funding, Reporting, and Deliver. Messages, Reports (comparative charts), and Help retain their existing roles. Operations and Funding open adjacent submenus; Reporting opens seven report categories with a second submenu. Mouse, click/touch, keyboard arrows, Escape, and outside-click dismissal are supported. Menu choices open data panels directly instead of a central chooser dialog.

## Data views

- Operations: purchases, forthcoming events, inventory, production, sales offers, logistics services, delivery, order/delivery history, and replenishment.
- Funding: scheduled cash forecast, banking, energy supplier comparison, and original investments.
- Reporting: financial statements and cash events; purchase details and daily/weekly/monthly summaries; stock values and historical quantities; production, capacity and component use; electricity/carbon; order and shipment records; customer and market indicators.
- Deliver: incoming orders, dispatch assistant and delivery notes. Business updates in Messages also show automatic operational outcomes separately from human conversations and cannot receive replies.

Report tables support numeric/date sorting, applicable period and market filters, 100-row pages, scrolling and CSV download of the entire filtered, sorted result. Money exports use EUR; internal calculations retain cents. Missing actual arrival dates remain blank rather than being replaced by an estimate. Arrival reports use actual customer receipt; dispatch reports use dispatch time; order reports use order placement time. Fixed 7/14-day windows use `(current hour − window, current hour]`.

Panels can be resized using right/bottom/corner handles or keyboard arrows. Full-width and reset-size controls are available. Dragging a title or using earlier/later controls changes panel order. Size and order are stored as tab-local navigation preferences, scoped to the account and classroom; no business records are cached there. Reordering moves existing nodes so an edited decision form retains its draft. Automatic refresh does not replace the interface during a menu interaction, resize or drag.

Simulation timestamps use 12-hour am/pm notation and remain UTC. A moon, sun or evening symbol identifies the current 8-hour shift; a separate label states whether the company has enabled that shift. This describes the schedule for the next production interval, not a guarantee of production: materials, cash and capacity still constrain output. The model does not add an overtime system.

## Data boundaries

These are original reports built from the simulation's authorized state, not copies of reference game data or formulas. Reference screenshots remain in the ignored private archive and are never included in a release.

The current engine produces one finished product and synthetic customers. Company transaction reports are private to that company and instructor preview. Shared comparison snapshots contain cumulative revenue/profit, output, stock, energy, carbon, receipts and overall delivered share, but no competitor line-item ledgers, supplier/customer records, quality budgets or per-market delivery breakdown. Reports identify these limits explicitly. Monthly market volume currently shows the catalogue baseline rather than claiming observed total sales. Overall competitor shares remain combined across markets.

Component stock history is reconstructed from the fixed session recipe, opening stock, actual receipts and daily cumulative production. Finished stock uses recorded snapshots. Production conversion-cost averages cover wages and electricity, not material absorption or overhead. Balance sheets include retained profit; cash forecasts include only committed scheduled movements and may reveal a funding gap. Live views and closed daily snapshots label their cutoffs separately.

Delivery notes distinguish an estimate made at dispatch from the actual receipt outcome. Early means more than 24 hours before the promise; late means after it. Partial consignments are evaluated separately, consistently with the engine's satisfaction rule. No fabricated customer prohibition or sales ban is applied.
