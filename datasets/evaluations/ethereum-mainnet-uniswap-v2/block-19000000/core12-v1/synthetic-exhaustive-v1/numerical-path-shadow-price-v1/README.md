# Numerical path-shadow-price evaluation v1

This directory retains the deterministic, timing-free Milestone 7a evaluation
of the exact baseline and additive path-level numerical allocator over the same
396-request corpus and six baseline profiles. The frozen eligibility artifact
retains all 2,376 request/profile cells and permits numerical execution only for
the 414 cells whose baseline and structural discovery are complete.

The [comparison inputs](../../../../../../../fixtures/m7/numerical-historical/README.md)
were fixed before numerical output: config 4,650 bytes at
`sha256:96ceb8b4441e9e81c40b5662f948e91bee661a0205469b70a5dbd4e4bbb4aff6`
and eligibility 261,915 bytes at
`sha256:5ed542c5da28a0a03eb88bece5b04cea623877b4760cea1ccdc0b27b5b91bbdc`.
The decision also binds the 2,721-byte retained forced-failure evidence at
`sha256:e2a3ccf161ac33b938da45e1e50569fdbe6b28d34268b468b6dfd24a45d2c4e7`
and its exact 52,464-byte test source at
`sha256:4f4ca6c3c0d0dd42b4a5ce8731bbdeb9d351e1d59e719ff60ed0f14eafdcb2e2`.
The evaluation also binds the retained Milestone 6 semantic result at
`sha256:28fafa1c27fe3c685756b25566ebcc357512b3d35acfdcf06afa01304cb9546e`.

## Retained artifacts

| Artifact | Meaning | Bytes | SHA-256 |
|---|---|---:|---|
| `manifest.json` | Closed identities, counts, decision, limitations, and artifact bindings | 2,940 | `c01afe75643973ac93a4820b6bb0c66d0bb99b4ddfed39c48c8dea7dffdf732f` |
| `semantic-results.json` | All 2,376 cells, exact baseline objectives, complete eligible numerical results, 20 counters, diagnostics, comparisons, and evidence-bound cell hashes | 21,698,448 | `96c123b72fd73aed2d6063f17d4f0e6ad90e834cd752959ec693598dec329661` |

The manifest binds the semantic artifact but does not hash itself or this
README. No timing or environment observation artifact exists.

## Exact bounded results and decision

- 414 cells were eligible and executed exactly once; 1,962 ineligible cells
  remain retained with their frozen reasons and contain no numerical result.
- Under the complete exact split objective, 318 eligible cells improved, 96
  were equal, and none regressed.
- 307 distinct requests obtained strictly greater exact output in at least one
  eligible profile. Outputs are compared only within a request/asset pair and
  are never added across assets.
- The 11,028 terminal candidate diagnostics comprise 496 improved, 7,664
  not-better, and 2,868 failed proposals. Failures are typed as 1,381
  non-convergences and 1,487 exhausted exact residual-option scans.
- All four accepted decision clauses hold, so this frozen evaluation records
  numerical mode as `primary`: no eligible exact-objective regression; retained
  forced-failure evidence preserves the baseline; every eligible model-valid
  candidate set has a terminal typed diagnostic; and at least one eligible
  request has strictly greater exact output than greedy.

The forced-failure clause is mechanically derived from the ten ordered
`baseline-preserved` outcomes in the bound evidence document. Generation and
verification first validate its exact identity, then validate the exact
retained runtime test source and required test names before any corpus replay.
Those tests cover model, convergence, reconstruction, residual replay,
authorization replay, cap, interruption, deadline, callback, and clock
failures. The historical evaluation itself does not inject failures into
market cells.

## Typed work evidence

| Work kind | Total | Per-cell maximum |
|---|---:|---:|
| Direct candidates | 342 | 1 |
| Direct candidate replays | 342 | 1 |
| Direct candidate rejections | 9 | 1 |
| Path expansions | 34,962 | 102 |
| Best-single candidate replays | 3,144 | 11 |
| Best-single candidate rejections | 195 | 3 |
| Candidate-set expansions | 22,056 | 110 |
| Equal proposal replays | 11,028 | 55 |
| Equal proposal rejections | 1,236 | 18 |
| Greedy option replays | 349,926 | 1,760 |
| Greedy option rejections | 18,390 | 246 |
| Final authorization replays | 168 | 1 |
| Final authorization rejections | 0 | 0 |
| Numerical proposals | 11,028 | 55 |
| Numerical proposal failures | 1,381 | 17 |
| Numerical iterations | 705,792 | 3,520 |
| Numerical residual replays | 18,800 | 110 |
| Numerical residual replay rejections | 3,157 | 38 |
| Numerical authorization replays | 496 | 4 |
| Numerical authorization replay rejections | 0 | 0 |

The counters describe different work units and are not interchangeable or
combined into a universal work scalar.

## Offline verification and reproduction

```bash
pnpm verify:numerical-evaluation

target="$(mktemp -d)/evaluation"
pnpm evaluate:numerical -- "$target"
cmp semantic-results.json "$target/semantic-results.json"
```

Run the `cmp` command from this directory, or supply the tracked semantic
artifact's repository-relative path. Generation and verification each validate
the source dataset and corpus once, reuse one prepared context, reproduce the
retained Milestone 6 evaluation, and freshly replay every eligible numerical
cell.

## Limitations

This is one synthetic exhaustive grid over one block, venue, 12-asset allowlist,
and bounded two-hop/two-route pool-disjoint policy. `primary` is only the result
of the four frozen Milestone 7a clauses; it does not create a default mode or a
canonical numerical run/case schema. The continuous model remains proposal-only,
and every incumbent is exactly authorized. The evidence supports no latency,
speedup, representative-demand, unrestricted or discrete global-optimality,
transaction, custody, live-execution, service, or production conclusion.
