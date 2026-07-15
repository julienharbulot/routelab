# RouteLab TS status

**Base:** `cdc5a83` — numerical split runtime integrated  
**Target:** `v0.1.0` portfolio release  
**Completed:** `PORT-001` cleanup; `PORT-002` facade; `PORT-003` CLI/package; `PORT-004` benchmark
**Active task:** `PORT-005 — Local quote service and load evidence`

The retained core provides exact `bigint` pool/replay semantics, bounded route and pool-disjoint split discovery, immutable prepared snapshots, exact fallback behavior, and an exactly authorized numerical allocator.

The 24-case portfolio benchmark now separates deterministic quality from 100-sample local latency observations, retains a bounded longer-budget reference, and verifies every reported success by fresh exact replay.

Next: add the bounded localhost HTTP facade and measure concurrency 1, 4, and 16. Live execution, signing, settlement, PRIME, ML, gas-aware routing, and concentrated liquidity remain out of scope.
