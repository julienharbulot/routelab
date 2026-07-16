# RouteLab status

**State:** REL-003 release candidate; cumulative gate pending

Implemented: public omitted `min_deadline_ms` default, strict solver event, official-example-derived fixture, packed NEAR import proof, final reports, and portfolio narrative.

Evidence source: `79642a2c88f07800344252e0990d0f433ab22c63`; digest `sha256:36e5cfb6625c9f9c4be1288c8f23595f4179b7d71db57a1dec188b5d32e00499` over 90 named paths.

Result: workers passed the frozen c16 gate at 51.12→23.04 ms p95 and 434.2→1,044.3/s, while peak RSS rose from 249.7 to 402.8 MiB.

Next: run the clean-clone/cumulative gate, read-only release review, and exact-SHA CI.

Out of scope: live data, signing, custody, settlement, PRIME, ML, gas-aware routing, and concentrated liquidity.
