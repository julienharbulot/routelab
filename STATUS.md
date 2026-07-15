# RouteLab TS status

**Base:** `cdc5a83` — numerical split runtime integrated  
**Target:** `v0.1.0` portfolio release  
**Active task:** `PORT-001 — Clean restart and remove obvious deadweight`

## Implemented at the restart point

- exact constant-product `bigint` math;
- immutable validated snapshots and checksum verification;
- exact route and pool-disjoint split replay;
- bounded deterministic path and candidate-set discovery;
- prepared routing context;
- anytime exact fallback behavior;
- path-shadow-price proposal and deterministic integer reconstruction;
- numerical split runtime with fresh exact authorization;
- one retained historical snapshot and offline request corpus.

## Missing from the target release

- small root library facade;
- human-readable quote CLI;
- build/export surface;
- compact benchmark and chart;
- HTTP quote service and load evidence;
- fixture-only NEAR Intents quote adapter;
- concise release documentation and license.

## Release rule

Do not add PRIME, ML, gas-aware routing, concentrated liquidity, live relay integration, signing, or settlement before v0.1.

The next task is always the next incomplete `PORT-00N` file. This status file stays short.
