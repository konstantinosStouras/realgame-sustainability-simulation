# Student workspace playtest

Two agents reviewed the existing student workspace. All 54 baseline automated tests passed. A separate simulation smoke test verified that a committed purchase showed up as incoming stock, that Inventory and Suppliers could be open together, and that closing one left the other open.

| Finding | Update |
| --- | --- |
| Inventory repeated its heading and nested a large card inside the workspace panel. | Compact green title bars and dense tables give the student panels a common layout. |
| Inventory and Logistics were grouped with decisions, and the overview shortcut used a separate orders page. | Information opens inventory, logistics, messages, and purchase and shipment history. Decisions opens buying, dispatch, sales offers, replenishment, production, finance, and energy. The overview shortcuts open the same panels. |
| Stock quantity, capacity, and incoming orders were scattered across columns. | Inventory shows finished stock first and groups stock with capacity. It also shows average cost, outstanding purchases, and embodied carbon, with filters for finished stock and components. |
| The Studio assembly recipe differed from the observed RealGame Sustainable SCM production screen. | New sessions assemble a solar panel from 32 photo cells, one recycled frame, and two junction boxes. Existing sessions and historical replays use their original recipe. |

The reference Inventory also showed waste and inventory energy. Studio models stock overflow charges and production electricity. Its inventory table displays the quantities and costs tracked by its own engine.
