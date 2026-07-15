# RouteLab TS status

**Base:** `cdc5a83` — numerical split runtime integrated  
**Target:** `v0.1.0` portfolio release  
**Completed:** `PORT-001` through `PORT-006`
**Release:** `v0.1.0` portfolio scope complete

The retained core provides exact `bigint` pool/replay semantics, bounded route and pool-disjoint split discovery, immutable prepared snapshots, exact fallback behavior, and an exactly authorized numerical allocator.

The loopback service exposes health, prepared snapshots, and bounded exact-input quotes. Same-thread load evidence covers 120 requests each at concurrency 1, 4, and 16 with valid p99 samples. The fixture-only NEAR boundary returns unsigned exact-input candidates through fictional asset mappings.

Next evidence-led extension: isolate quote work in a small worker pool and remeasure c1/c4/c16 tail latency. Live connectivity, signing, settlement, PRIME, ML, gas-aware routing, and concentrated liquidity remain out of scope.
