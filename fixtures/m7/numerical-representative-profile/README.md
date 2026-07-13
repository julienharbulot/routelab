# Representative numerical pre-acceleration inputs v1

This directory freezes the output-free inputs for the second Milestone 7b
pre-acceleration measurement. It defines a supported-regime suite rather than a
historical-demand sample: one accepted historical stored-reserve anchor, one
deterministic synthetic topology stress, and two deterministic synthetic reserve
stresses. The synthetic cases are not additional historical snapshots.

The request corpus is result-blind. Each case applies all 132 ordered distinct
asset pairs at three exact fractions of the input asset's maximum incident
reserve, for 396 requests per case before eligibility filtering. The timing-free
baseline preserves all 1,584 request/case cells and freezes separate eligible
cohorts of 396, 174, 303, and 396 cells in case order.

## Frozen configurations

| File | Meaning | Bytes | SHA-256 |
|---|---|---:|---|
| `snapshot-suite-config.v1.json` | Exact historical anchor and deterministic synthetic transformations | 8,842 | `c2391d79a230d532918339a390b9150a58789a9263a906cae1ea4192219361c1` |
| `baseline-config.v1.json` | Result-blind request derivation and timing-free exact baseline | 6,813 | `fb35f57912007bb4a72835cb1aecb49c3110049e5f097dca029960f65bcfb73a` |
| `profile-protocol-config.v1.json` | Non-authorizing measurement protocol, attribution, decision, and caps | 12,745 | `2f4836026a421620433aa12ac13b44fcce45d0c733897355a7c4f2f9ec0e5b5c` |
| `profile-config.v1.json` | Final observation-authorizing config with exact artifact/cohort bindings | 16,462 | `b2ac31c4781471872110bbd2546e8681cee3a3301477db34b3931f06a8648734` |

The final config was independently byte-reviewed before observation. It binds
the exact suite, request corpus, timing-free baseline, per-case eligible counts,
and ordered eligible-cohort hash
`sha256:48f86261df3e87a2add397e3456f049640fbdfd3e964524201051b452327b5e7`.
It fixes all-sample leaf attribution before output and allows only a strict,
positive candidate-set-discovery leader in every profile of every case to select
a later sound-pruning experiment.

## Retained inputs and verification

The generated inputs are retained under the separately versioned
`supported-regime-suite-v1` stress, request, and evaluation directories. The
baseline contains complete exact results and all separate work counters; timing
and sampled observations are not part of it.

```bash
node cli/verify-representative-numerical-baseline.ts
node cli/verify-representative-numerical-profile.ts
```

The first command reconstructs the synthetic snapshots and request derivation,
then freshly replays every timing-free baseline cell. The second verifies the
retained profile, its exact semantic parity, raw observation grammar and graph
shape, attribution, hashes, and mechanically derived decision.

## Limits

The four cases vary supported topology/work and reserve/numerical regimes, but
they do not model historical order flow, equal-value trades, market prevalence,
or production demand. Raw elapsed and sampled data support no latency,
percentile, speedup, scaling, production, global-optimality, heuristic,
shortcut, or research-equivalence claim.
