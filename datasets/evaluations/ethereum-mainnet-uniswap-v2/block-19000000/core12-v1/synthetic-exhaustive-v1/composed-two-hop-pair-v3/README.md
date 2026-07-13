# Composed two-hop/pair evaluation v3

This directory retains one offline evaluation of the exact-input composed split runtime over the frozen 396-request synthetic corpus. Each request was evaluated under six componentwise work-cap profiles using one verified prepared context, `maxHops = 2`, `maxRoutes = 2`, and `greedyParts = 16`.

The [comparison config](../../../../../../../fixtures/m6/composed-historical/comparison-config.v3.json) was fixed before results at 2,528 bytes and `sha256:4e4d1bdfe47016d23510adbc4ed8107854b5bbf0dec99f3fb88d920d7a403473`. It contains only deterministic routing and comparison semantics. The separate [observation config](../../../../../../../fixtures/m6/composed-historical/observation-config.v2.json) was fixed at 1,060 bytes and `sha256:6e1c5e315efd532f25f8c0fa601d29889452f1324978f7ce507b4c992ddb6d84`; none of its timing or environment fields enters semantic results or cell hashes. Inputs are the reviewed [historical snapshot](../../../../../../ethereum-mainnet/uniswap-v2/block-19000000/core12-v1/README.md) and [result-blind synthetic corpus](../../../../../../requests/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/synthetic-exhaustive-v1/README.md). The evaluated runtime revision is `f98dddbd748c08594c7f0de0e9b457fe69417dd5`.

## Retained artifacts

| Artifact | Meaning | Bytes | SHA-256 |
|---|---|---:|---|
| `manifest.json` | Closed identities, counts, limitations, and artifact bindings | 2,787 | `58e0e211680cf14e2d8711bad58fba25f8fba3ece127e43cb57d27337410fda8` |
| `semantic-results.json` | All 2,376 exact request/profile results, receipts, counters, cell hashes, and deterministic summaries | 5,955,224 | `28fafa1c27fe3c685756b25566ebcc357512b3d35acfdcf06afa01304cb9546e` |
| `observations.json` | Environment/revision metadata and 11,880 raw call-only elapsed-nanosecond samples | 2,355,505 | `605b671af7b438e4222a543b35439b7f12830a5d2cf20a7f79764802725058b6` |

The manifest binds the two generated data files but does not hash itself or this README.

## Bounded deterministic results

| Profile | Success | No plan | Complete | Work limit |
|---|---:|---:|---:|---:|
| `fraction-0` | 315 | 81 | 0 | 396 |
| `fraction-1-16` | 366 | 30 | 0 | 396 |
| `fraction-1-8` | 396 | 0 | 0 | 396 |
| `fraction-1-4` | 396 | 0 | 0 | 396 |
| `fraction-1-2` | 396 | 0 | 18 | 378 |
| `structural-complete` | 396 | 0 | 396 | 0 |

Across the five adjacent profile steps, 81 request/profile transitions first gained a plan and 638 already planned transitions strictly improved under the complete exact split objective. No transition lost a plan or regressed. These counts compare each request only with itself; outputs from different assets are never added or treated as equal economic values.

The terminal profile's observed per-request maxima remained within the separately frozen typed caps: 102 path expansions, 11 best-single candidate replays, 110 candidate-set expansions, 55 equal-proposal replays, 1,760 greedy-option replays, and 1 final-authorization replay. Heterogeneous counters are not combined into one work scalar.

## Offline verification and reproduction

```bash
pnpm verify:historical-evaluation

target="$(mktemp -d)/evaluation"
pnpm evaluate:historical -- "$target" f98dddbd748c08594c7f0de0e9b457fe69417dd5
cmp semantic-results.json "$target/semantic-results.json"
```

Run the `cmp` command from this directory, or supply the tracked semantic artifact's repository-relative path. Fresh generation must reproduce semantic bytes exactly. Raw observations honestly vary with the recorded environment and execution, so their bytes are not expected to reproduce.

## Limitations

This is one synthetic exhaustive grid over one block, venue, 12-asset allowlist, and bounded two-hop/two-route pool-disjoint policy. The terminal profile is complete only for that frozen structure; it is not unrestricted route or allocation optimality. Timing values are raw observations from one recorded environment and support no threshold, speedup, percentile, tail, scaling, throughput, production, live-execution, transaction-feasibility, or historical-demand claim.
