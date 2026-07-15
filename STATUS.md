# RouteLab status

**State:** PORT-008 complete; PORT-009 active

Implemented: the full 396-request historical-snapshot-derived benchmark now measures eight fixed quality modes, five latency lanes, grouped exact metrics, canonical digests, and deterministic reports.

Evidence: 3,168/3,168 returned plans freshly replayed; numerical beat/tied/lost greedy at fast effort on 19/377/0 requests; all PORT-008 acceptance commands pass.

Known limitation: the bounded reference is not dominant because allocation grids are not nested; regret uses the best observed declared fixed mode and does not claim a global optimum.

Next: isolate service/load processes, measure concurrency 1/4/16, and make the worker decision in PORT-009.

Out of scope: live data, signing, custody, settlement, PRIME, ML, gas-aware routing, and concentrated liquidity.
