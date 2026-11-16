# Supply-chain experiments for Sustainability Studio

These are proposed teaching experiments, not claims about the effects of actual policies. All rates, durations and shocks below are illustrative. The implementation status distinguishes existing controls, the Poisson-demand update, and extensions that have not been built.

## Run experiments that test a prediction

Before each round, ask teams to predict the best policy, its cost and its main vulnerability. Run a baseline, introduce one change at a known simulation hour, and debrief the difference. Repeat with alternative shock durations and several demand realizations. Compare profit, service and liquidity together; include emissions when relevant. Do not treat one lucky winning team as evidence that its policy is generally best.

Teams compete for shared demand and supplier stock, so one team's choices affect its peers. For causal comparisons, repeat the whole classroom with comparable competitor policies, or create matched independent classrooms. A common seed alone does not guarantee identical external demand paths when different decisions consume the shared random generator. A future experiment runner should store external demand and disruption paths separately from company decisions.

Existing reports provide profit, cash, production, dispatches, receipts and emissions. A scenario scorecard should additionally record generated market demand, unserved demand, stockout hours, on-time quantities, average inventory, cash minimum and time to recover. Accepted orders alone do not measure all lost demand. Define recovery before play, for example restoring at least 95% of baseline daily output for three consecutive days.

## 1. Resilience, diversification and regionalisation

**Prediction:** Is the cheapest supplier still the best when availability is uncertain? Do two suppliers necessarily give two independent sources of supply?

**Instructor experiment:** Allow five simulated days for sourcing and buffer decisions. On day 6, disable the cheapest photo-cell supplier for three days, then re-enable it. Repeat with a one-day and a seven-day interruption. Ask students to compare single sourcing, dual sourcing, extra inventory and standby capacity. In a later round, disrupt both nominal suppliers to represent shared regional or upstream exposure.

**Measure:** Profit sacrificed before the event; production lost; order lateness; minimum cash; recovery time; emergency freight and emissions. Compare the insurance cost with the avoided loss across different disruption probabilities.

**Available now:** Enable/disable suppliers; change stock, replenishment, lead time, price and reliability. These edits affect new purchases. Existing accepted shipments keep their original schedules. Two suppliers and short/long lead-time options already support a basic diversification exercise.

**Extension:** Country, region and common upstream dependencies; a scheduled outage with automatic restoration; explicit treatment of goods already in transit; supplier qualification delays and backup reservation fees. Calling both suppliers domestic or foreign without such attributes would only be scenario narration.

**Context:** The [OECD Supply Chain Resilience Review](https://www.oecd.org/en/publications/2025/06/oecd-supply-chain-resilience-review_9930d256.html) finds that relocalisation can be costly and does not consistently improve resilience. The exercise should allow that result, rather than making local sourcing automatically superior.

## 2. Tariffs, trade fragmentation and policy uncertainty

**Prediction:** Should a company import early, change source, absorb the duty or raise its selling price?

**Instructor experiment:** Announce on day 3 that a 25% tariff on components from country A will begin on day 7. Give country B a higher base price, shorter lead time and limited capacity. Run three variants: no advance notice; four days' notice; and a stated chance of cancellation followed by a pre-drawn outcome. Students choose inventory, sourcing, pricing and finance policies before the outcome is revealed. Keep the announced probability and realized event consistent.

**Measure:** Landed component cost, gross profit, working capital, excess stock, delivery service and supplier concentration. Front-loading can save duties but consume cash and create stranded inventory if the policy changes.

**Available now:** A supplier-price increase approximates the cost shock for future purchases. It is not a separate tariff model and does not charge goods already ordered. Students can change sales prices, but current pricing reallocates a fixed realized market pool; it does not model aggregate demand falling when all firms raise prices.

**Extension:** Supplier country of origin, destination, tariff percentage, taxable value, announcement/effective dates, customs-entry event and duty accounting. Specify whether the teaching rule charges on order placement or border entry. Add an outside purchase option or aggregate price elasticity if testing total demand destruction or tariff incidence. Tariff pass-through should emerge from student choices and the demand model, not be predetermined.

**Context:** The [WTO's March 2026 trade outlook](https://www.wto.org/english/res_e/booksp_e/gtos0326_e.pdf) discusses front-loading, inventory management and tariff uncertainty. This is a useful mechanism to test without copying any particular real-world tariff regime.

## 3. Demand uncertainty, forecasting and the bullwhip effect

**Prediction:** Is a short sales surge a lasting change, and how much safety stock is justified?

**Instructor experiment:** Start one market at Poisson λ = 20 module arrivals/hour. Keep it steady for a baseline; then raise λ to 35 for 48 simulation hours before returning it to 20. In a separate round, make 35 permanent. Let teams choose reorder points, order sizes, capacity and delivery promises. Compare outcomes when the regime change is announced versus initially unannounced.

**Measure:** Forecast error, stockouts, inventory, excess capacity, service and cash. The λ values are global market demand, not per-team allocations.

**Poisson update:** Hourly shared arrivals; instructor edits before/during play; zero or disable pauses new demand; seeded replay. Constant-rate Poisson demand ties variance to the mean. Raising λ changes both, so it is not an experiment that changes uncertainty alone.

**Extension:** A negative-binomial or batch-arrival option to vary dispersion while keeping the mean fixed; independent scenario random streams. A true bullwhip experiment additionally needs linked retailer/distributor/manufacturer decisions, order-information delays and separate final-consumer versus upstream-order data. Competing manufacturers alone do not reproduce a multi-echelon bullwhip mechanism.

## 4. Decarbonisation under service pressure

**Prediction:** Do lower-carbon operations remain attractive when customers demand faster deliveries or inputs become scarce?

**Instructor experiment:** Start with the customer carbon preference effect off. In the next matched round enable it and increase market green weight. Then combine the same preference with a temporary supplier shortage. Teams choose electricity providers, efficiency investments and customer transport modes. For a later policy round, introduce a hypothetical carbon price, for example €100/tCO₂e, announced before it begins.

**Measure:** Profit, total emissions, emissions per module received by customers, service and cash. Compare absolute emissions with intensity so simply selling less is not confused with operational improvement.

**Available now:** Carbon-demand toggle and market green weight; existing electricity options, efficiency investment, routes and carbon accounting. These are customer-preference and operating decisions, not a carbon tax.

**Extension:** Carbon-charge accounting and boundaries, editable energy rates, emissions factors and verification. Specify which emissions are charged and avoid double-counting embodied inputs. Do not label a generic hypothetical carbon fee as a real compliance scheme.

## 5. Climate and transport chokepoints

**Prediction:** Is the fastest route always the best response to uncertainty?

**Instructor experiment:** For five days, double a selected customer route's transit time and raise its freight rate by 50%, or disable it. Use a separate round to reduce a supplier's delivery reliability and increase its inbound lead time. Teams choose buffers, slower alternatives, premium transport and delivery promises. Introduce the shock after some orders are already accepted to expose the promise-versus-execution problem.

**Measure:** Late arrivals, freight cost, service, cash, emissions and recovery time.

**Available now:** Customer-route hours, fees, reliability and enabled status; supplier lead time and reliability. New catalogue terms do not reschedule existing shipments. Customer routes are not automatically inbound supplier routes.

**Extension:** A common transport network, capacity/congestion, correlated weather events and an explicit action to delay affected in-transit consignments. Model inbound and outbound exposure separately.

**Context:** [UNCTAD's Review of Maritime Transport 2025](https://unctad.org/publication/review-maritime-transport-2025) connects chokepoint disruption with rerouting, costs and emissions, supporting a combined service/carbon exercise.

## 6. Critical inputs and circular supply

**Prediction:** Can recycling be valuable as supply insurance even when virgin materials are initially cheaper?

**Instructor experiment:** Reduce replenishment of one essential component by 60%, then introduce an alternative recovered component with a higher processing cost, uncertain yield and a recovery delay. Teams choose stockpiling, recovery investment and sourcing portfolios. Repeat with temporary and persistent scarcity.

**Measure:** Output sustained, material dependency, cost, cash, recovery yield and emissions.

**Available now:** Shared component stock and replenishment can create genuine scarcity and competition. The solar recipe makes a missing component a production bottleneck.

**Extension:** Returns, collection delays, recovery yield, substitute recipes and remanufacturing. The existing label “recycled frame” does not constitute a closed-loop supply chain. [IEA's critical minerals outlook](https://www.iea.org/reports/global-critical-minerals-outlook-2025/executive-summary) provides context on concentration and limited substitution.

## 7. Working capital and automation under stress

**Prediction:** Can a profitable growth strategy run out of cash? Does an automated reorder policy adapt to a structural shock?

**Instructor experiment:** Shorten supplier credit from 120 to 24 hours for new purchases while increasing demand. Teams choose customer payment terms, inventory, loans and promised service. Run manual and automated purchasing rounds, then introduce the same lead-time shock. Students must decide whether to override or retune the reorder policy.

**Measure:** Minimum cash, unpaid obligations, production interruptions, financing expense, profit and inventory. Count avoided stockouts as well as automation's ordering costs.

**Available now:** Supplier terms, customer offers, cash accounting, loans, deposits, and the rule-based replenishment assistant. Existing contracts retain their accepted terms. Customer payment promises are student decisions; the instructor cannot currently impose a new collection delay on accepted orders.

**Extension:** Instructor-configurable interest/credit limits, customer default and collection-delay shocks; forecast quality and delayed information. The current assistant is rule based, not an AI forecasting agent.

## Build order

Start with resilience, tariff cost shocks and demand uncertainty. Add carbon/service and liquidity rounds next. Build a reusable instructor scenario timeline before many individual shock screens: target market/supplier/route, announcement hour, effective hour, duration, parameter change and affected obligations. Add matched-run duplication, stored external shock paths and the scorecard next. Explicit tariffs, correlated dependencies and circular flows then become coherent extensions to the same experiment framework.
