# RouteLab TS status

**Base:** `cdc5a83` — numerical split runtime integrated  
**Target:** `v0.1.0` portfolio release  
**Completed:** `PORT-001` cleanup; `PORT-002` facade; `PORT-003` CLI/package; `PORT-004` benchmark; `PORT-005` service
**Active task:** `PORT-006 — Fixture-only NEAR adapter and release finish`

The retained core provides exact `bigint` pool/replay semantics, bounded route and pool-disjoint split discovery, immutable prepared snapshots, exact fallback behavior, and an exactly authorized numerical allocator.

The loopback service exposes health, prepared snapshots, and bounded exact-input quotes. Same-thread load evidence covers 120 requests each at concurrency 1, 4, and 16 with valid p99 samples.

Next: add the documented fixture-only NEAR Intents request boundary and complete release checks. Live connectivity, signing, settlement, PRIME, ML, gas-aware routing, and concentrated liquidity remain out of scope.
