# Numerical path-shadow-price baseline profile v1

This directory retains the first pre-acceleration Milestone 7b profile of the
current composed numerical runtime. The measurement configuration was frozen
before observation and binds the same one-block snapshot, 396-request corpus,
and ordered 414-cell result-blind eligibility cohort as the accepted Milestone
7a evaluation.

The [profile configuration](../../../../../../../fixtures/m7/numerical-baseline-profile/profile-config.v1.json)
is 10,435 bytes at
`sha256:894aca8f1c402a5677582f18db3d24de40f199141dca284fac75aef945438349`.
It fixes one verified prepared context, fresh request-local controls, 4,554
runtime calls, 2,070 unprofiled timing observations in five alternating sweeps,
and three independent forward/reverse/forward CPU profiles at a 1,000-microsecond
sampling interval. Exact semantics are checked before observations are accepted.

## Retained artifacts

| Artifact | Meaning | Bytes | SHA-256 |
|---|---|---:|---|
| `manifest.json` | Closed identities, protocol, counts, attribution, recommendation, limitations, and artifact bindings | 11,503 | `1e77950151bbcc5b2e3cab77156d1e9ec35289c02b6afa781feecbdb78c298b2` |
| `semantic-work.json` | Ordered cohort, exact result bindings, and all 20 separate work counters | 413,657 | `da8aea57ea9c4ded88edc6d9b4a7e703a4a2c4d3d5953a37226e06d36e77396a` |
| `timing-observations.json` | Raw call-only elapsed observations, invocation order, and environment | 508,921 | `84727a7ab98e22eb83a6a55cab4384554f102a4c1ad60d6b5e364765d067346e` |
| `cpu-profile-observations.json` | Three raw sampled CPU profiles with complete call-frame graphs | 455,442 | `42397d3f425f338f7aac7042e50d48d12cc4fd32c17a41b4c49368106d95e3a9` |
| `analysis.json` | Frozen attribution analysis and next-experiment decision | 8,137 | `4c88f87cb4bdc7dee3fddd21d984d55a3424c1549f99a7f6f4205019affc0c58` |

The manifest binds the four generated companion artifacts but does not hash
itself or this README.

## Result and decision

All 414 calls used for semantic verification match the retained Milestone 7a
results exactly. The semantic artifact keeps each work kind separate, including
22,056 candidate-set expansions; unlike counters are not summed into a cost.

The frozen experiment-selection rule considers samples only when the exported
numerical runtime root is present on the sampled stack. That decision population
contains zero samples and zero sampled microseconds in all three profiles, so no
strict unique within-root leader exists. The retained recommendation is therefore
`decline-sound-pruning-selection-from-this-profile`. It selects no pruning,
shortcut, or acceleration implementation.

Across all samples, without the required runtime-root filter, the
`path-shadow-price-core` category has the largest leaf-attributed sampled time in
all three profiles: 1,432,471, 1,374,640, and 1,391,048 microseconds. This is a
raw observational fact only. It is outside the frozen decision population and
is neither a selected bottleneck nor evidence for an acceleration task.

## Offline verification

```bash
pnpm verify:numerical-baseline-profile
```

The verifier checks closed schemas, safe paths, exact file identities, the
frozen invocation grammar, semantic parity, work summaries, CPU-profile graph
integrity, signed call-frame positions, attribution, and the mechanically derived
decline decision. Independent oracle evidence reconstructs the retained results
from raw JSON without importing the profile implementation.

## Limitations

This profile covers one process and environment, one frozen block and venue, one
12-asset allowlist, and one synthetic exhaustive eligibility cohort. Raw timing
and sampled CPU data are affected by JIT compilation, garbage collection,
scheduling, native runtime work, source mapping, and instrumentation. The
artifacts support no latency, percentile, threshold, speedup, scaling,
representative-demand, production, or research-equivalence claim. They do not
satisfy Milestone 7b's broader representative-snapshot obligation; a separately
frozen measurement follow-up is required before any acceleration is selected.
