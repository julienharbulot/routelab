# Milestone 0 fixture manifest

This manifest assigns evidence ownership without turning the hand-readable
fixture shape into a public snapshot or replay schema. “Gate-bearing” means a
case directly demonstrates that the Milestone 0 semantic contract is coherent;
it does not mean a future production task must implement unrelated behavior.

All cases assume exact-input routing, atomic-unit unsigned decimal strings,
strictly positive snapshot reserves, `feeChargedNumerator` as the charged fee
fraction over `feeDenominator`, and exactly one final output floor. Expected
values are derived in `README.md` without production helpers.

| Case | Purpose and direction | Supports | Hand-derived result | Additional assumptions | M0 classification |
|---|---|---|---|---|---|
| `direct-pool.json` | Basic `A -> B` quote and gross-input reserve transition | RLT-011 | input `100` returns `90`; reserves become `1100/910` | charged fee `3/1000`; one pool | Gate-bearing formula and field-semantics evidence; preparatory for RLT-011 |
| `single-division-rounding.json` | Distinguish the accepted `A -> B` single-final-floor formula from pre-rounding effective input | RLT-011 | input `1` returns `1`; rejected two-stage result is `0` | charged fee `1/2`; reserves `1/3` | Gate-bearing rounding evidence; preparatory for RLT-011 |
| `high-fee-path-loses.json` | Compare two explicit `A -> B` directions with zero and high charged fees | RLT-011, later RLT-022 | zero-fee output `90`; high-fee output `9` | otherwise identical `1000/1000` pools | Gate-bearing charged-fee meaning; route selection is preparatory only |
| `two-hop-beats-direct.json` | Carry exact output through `A -> B -> C` and compare with `A -> C` | RLT-012, later RLT-022 | direct `90`; hop outputs `181`, then `165` | zero fees; distinct pools; no pool reuse | Preparatory only; not an RLT-010 or RLT-011 acceptance requirement |
| `disconnected-pair.json` | Show that `A -> D` has no contiguous route across `A/B` and `C/D` components | RLT-021, RLT-022 | typed `no-route`; no numeric quote | graph/path semantics do not yet exist | Preparatory only; not an RLT-010 or RLT-011 acceptance requirement |
| `split-beats-full-route.json` | Show a stated split across two pool-disjoint `A -> C` routes | RLT-050 through RLT-052 | either full route `50`; stated `50/50` split totals `66` | zero fees; no global-optimality claim | Preparatory only; not an RLT-010, RLT-011, or v0.1 acceptance requirement |

The disconnected case has no `directionalRoute` because its expected result is
the absence of any contiguous route. Every other comparison records explicit
`(assetIn, poolId, assetOut)` hop triples in its JSON evidence.
