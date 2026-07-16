# RouteLab benchmark methodology

The benchmark keeps deterministic routing quality separate from observational wall-clock latency.

## Inputs

The headline lane uses all 396 synthetic exact-input requests derived from the retained Ethereum mainnet Uniswap v2 block-19,000,000 pool-reserve snapshot. The corpus contains 132 ordered distinct asset pairs, three deterministic reserve-fraction amount buckets, and result-blind ordering. It is not historical order flow, an equal-value trade set, or representative demand.

Hand-readable direct, multi-hop, split, fee, rounding, no-route, and huge-integer fixtures remain correctness tests and demo inputs. They are not aggregated into the historical-snapshot-derived headline.

Every headline request uses `maxHops=2` and `maxRoutes=2`.

## Deterministic quality

`pnpm benchmark` measures these fixed modes:

```text
best-single
greedy-split / fast, balanced, thorough
numerical-split / fast, balanced, thorough
large-budget comparison
```

The comparison uses one frozen profile larger than public thorough effort with the same route restrictions. It is bounded and is not a global optimum. Its allocation grid is not nested with the public grids, so it is not assumed to dominate them. Regret is integer parts per million against the best exact output observed across every declared fixed mode; equality with the large-budget mode remains a separate diagnostic and report-only bps are derived from ppm.

For every mode, overall and by amount bucket and topology, the report records quote/no-route and fresh replay counts, equality with the large-budget mode, regret percentiles and thresholds, best-single and split improvement frequencies, median/maximum positive improvement ppm among improved requests, authorization rejections, and large-budget-beaten counts. Unlike work kinds are never added together: path expansions, candidate-set expansions, greedy option replays, final authorization replays, numerical proposals, numerical iterations, and numerical authorization replays each retain p50/p95 values. Proposal attempts reconcile into converged and failed proposals, with all-proposals-converged requests and exactly selected numerical improvements counted separately. Numerical-versus-greedy comparisons add beats/ties/loses and positive improvement ppm.

Per-request exact rows are written only to ignored `reports/raw/portfolio-v2-rows.json`. The committed summary contains aggregates and canonical digests.

## In-process latency

Latency uses `process.hrtime.bigint()` and deterministic rotation through the complete corpus. Fast is measured for all strategies, and balanced is measured for greedy and numerical split. Each reported lane has 50 warmups and 1,000 measured invocations. Quote and expected-no-route distributions are separate; this connected diameter-two corpus has no expected no-route request, so those distributions are explicitly absent.

All three efforts remain covered by deterministic quality. Raw observations are written to ignored `reports/raw/portfolio-v2-latency.json`.

Timing is local observational evidence. It is not a semantic budget, production-capacity claim, or statistical-significance claim.

## Charts and committed outputs

`reports/quality-by-effort.svg` uses categorical effort on the x-axis and p95 regret ppm on the y-axis for greedy and numerical modes across all three effort profiles. `reports/historical-regret-distribution.svg` plots the share within exact, 1, 10, and 100 bps.

Committed benchmark outputs are:

```text
reports/portfolio-v2.md
reports/portfolio-v2-summary.json
reports/quality-by-effort.svg
reports/historical-regret-distribution.svg
```

Each remains below 250 KiB. Raw rows, latency observations, and temporary output stay ignored.

## Evidence source identity

Retained benchmark and service generation require clean named executable/configuration paths. The
`routelab.evidence-source-paths.v1` set covers tracked TypeScript under `src/`, `cli/`, and
`scripts/`; the pinned Node, pnpm, lint, and TypeScript configuration; and the retained dataset JSON
from which requests are generated. Reports, raw observations, and non-executable prose are
excluded. Each summary stores the sorted resolved path list, the full source commit, and one
canonical SHA-256 digest; verifiers resolve the same list and recompute the digest from the current
tree.

## Verification

`pnpm benchmark:verify` first checks the evidence-source identity, then re-verifies corpus identity and count, reruns deterministic quality, freshly exact-replays every success, checks exact allocation conservation, reconciles all aggregates and digests, enforces the best-observed comparison rule, validates latency sample counts, rejects tracked raw data, and byte-compares deterministic Markdown and SVG rendering. It also checks chart titles, axes, series, and a non-degenerate quality metric. `pnpm service:verify` applies the same source check to the committed service summary and its deterministic Markdown/SVG renderings.

`pnpm benchmark -- --smoke` is a bounded three-request, three-strategy check. The current [portfolio report](../reports/portfolio-v2.md) and [isolated HTTP service report](../reports/service-v2.md) are local v0.1 evidence.
