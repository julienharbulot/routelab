# Supported-regime numerical pre-acceleration profile v1

This directory retains the second Milestone 7b pre-acceleration profile of the
composed numerical runtime. Its [frozen input and measurement configuration](../../../../../../../fixtures/m7/numerical-representative-profile/README.md)
covers one accepted historical stored-reserve anchor and three deterministic
synthetic stresses that vary topology and reserve scale within the supported
router regime. It does not claim historical-demand or market
representativeness.

The final profile config is 16,462 bytes at
`sha256:b2ac31c4781471872110bbd2546e8681cee3a3301477db34b3931f06a8648734`.
It freezes four separate result-blind eligible cohorts containing 396, 174, 303,
and 396 cells. Fresh exact semantic replay precedes observation. The retained
schedule contains 13,959 runtime calls, 6,345 unprofiled call-only elapsed
samples, and 12 separately recorded CPU profiles in one Inspector session.

## Retained artifacts

| Artifact | Meaning | Bytes | SHA-256 |
|---|---|---:|---|
| `manifest.json` | Closed identities, counts, claims, recommendation, artifact bindings, and source bindings | 2,878 | `59cf81e48a3973977f7d59f110280bfa36c1d75018db37fb5a40990ae0451784` |
| `semantic-work.json` | Ordered eligible cohorts, exact result bindings, and all 20 separate work counters | 1,402,659 | `3d6b060d247c4b24dacef5a0fc150f60e3ecce26f1a0e0b02a3ccd7c87d9971e` |
| `timing-observations.json` | Raw call-only elapsed observations, invocation order, and environment | 1,709,635 | `ef567cf6bcf90ee36f2d19aa30988fc116b0765d5d87523249074caf478f8a22` |
| `cpu-profile-observations.json` | Twelve raw sampled CPU profiles with complete call-frame graphs | 1,331,763 | `dcc009ef8dede0ac05a5aea55b661abf3302ad1018fa9af0bb2de01446efca40` |
| `analysis.json` | Frozen all-sample attribution and next-experiment decision | 9,243 | `f31be79d81a61681dff70249fd7dde4f733eb03d8afd538c910949d061b5892b` |

The manifest binds the four generated companion artifacts but does not hash
itself or this README.

## Result and decision

All 1,269 eligible calls used for semantic verification match the separately
retained timing-free baseline exactly. Per-case candidate-set expansion counts
are 21,516, 672, 15,534, and 21,516; work kinds remain separate and are not
collapsed into a universal cost.

The rule frozen before observation permits a later sound candidate-set-pruning
experiment only when `candidate-set-discovery` is the positive strict unique
leader by all-recorded-sample leaf-attributed microseconds in all 12 profiles and
every case has positive candidate-set work. Candidate-set discovery is not the
leader in any retained profile and has zero attributed microseconds in two of
them. The retained recommendation is therefore
`decline-sound-pruning-selection-from-this-supported-regime-suite`.

This negative result selects no pruning, heuristic, shortcut, or acceleration
implementation. The observed leaders are raw facts only: `path-shadow-price-core`
leads the historical, compressed-reserve, and amplified-reserve profiles, while
`node-runtime-or-dependency` leads all three dual-spanning-tree profiles.

## Offline verification

```bash
node cli/verify-representative-numerical-profile.ts
```

The verifier checks exact config and input bindings, safe paths, environment and
invocation grammar, all 1,269 fresh exact results and counters, the 12 nonempty
CPU-profile graphs, every sample attribution, hashes, and the mechanically
derived decline decision. Independent raw-artifact evidence reconstructs these
bindings and the decision without importing the profile implementation.

## Limitations

This profile covers one process and environment, one accepted historical
stored-reserve anchor, and three deterministic synthetic supported-regime
stresses. Raw observations include JIT compilation, garbage collection,
scheduling, native runtime work, source mapping, and profiler effects. The cases
cannot be compared by elapsed time. The artifacts support no latency,
percentile, threshold, speedup, scaling, historical-demand, production,
global-optimality, heuristic, shortcut, or research-equivalence claim.
