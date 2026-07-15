# PORT-004 — Build the compact portfolio benchmark

## Outcome

`pnpm benchmark` generates a concise, reproducible report that explains quality, work, and latency.

## Required work

1. Create a 20–30 case portfolio set with named purposes.
2. Add deterministic profiles: fast, balanced, thorough, reference.
3. Compare best-single, greedy-split, numerical-split, and the long-budget numerical reference.
4. Add a deterministic quality runner.
5. Add a separate wall-clock latency runner.
6. Use at least 10 warmups and 100 measured observations per reported strategy/profile.
7. Generate:
   - `reports/portfolio-v1.md`
   - `reports/portfolio-v1.json` or CSV
   - `reports/quality-vs-budget.svg`
8. Put raw observations under ignored `reports/raw/`.
9. Add `benchmark:verify`.
10. Add an optional `benchmark:extended` for the retained corpus.

## Implementation note

The `reference` profile is benchmark-internal, frozen above `thorough`, and still ends in fresh
exact replay; it is not added to the public quote API. Historical portfolio requests are bounded
to two hops and two routes so all four deterministic profiles remain practical on a laptop.

## Required metrics

- exact output;
- improvement over best single;
- regret against the long-budget reference;
- route/hop counts;
- deterministic work counters;
- numerical iterations and convergence;
- exact authorization rejections;
- p50/p95/p99;
- sample count;
- environment metadata.

## Rules

- Do not use wall-clock deadlines to define deterministic comparison results.
- Do not call the reference globally optimal.
- Do not commit a result above 1 MB.
- Do not retain CPU profiles or per-call source/provenance records.
- Report negative numerical results honestly.

## Acceptance

```bash
pnpm test:benchmark
pnpm benchmark
pnpm benchmark:verify
pnpm benchmark:extended -- --smoke
git diff --check
```

A clean checkout must regenerate the committed summary from versioned inputs.

## Commit

```text
PORT-004: Add the portfolio benchmark report
```
