# Numerical historical comparison inputs

These canonical JSON files freeze the complete result-blind cohort and bind the
retained forced-failure evidence used by the Milestone 7a historical numerical
evaluation. The comparison config and eligibility classification were fixed
before any historical numerical output was generated. The evidence document
binds the already-retained RLT-073 failure scenarios and exact test source; it
was fixed before the accepted evaluation artifacts were generated.

| Artifact | Meaning | Bytes | SHA-256 |
|---|---|---:|---|
| `comparison-config.v1.json` | Exact input bindings, runtime request, numerical controls, profile caps, comparison rule, and decision clauses | 4,650 | `96ceb8b4441e9e81c40b5662f948e91bee661a0205469b70a5dbd4e4bbb4aff6` |
| `eligibility.v1.json` | Ordered classification of all 2,376 request/profile cells | 261,915 | `5ed542c5da28a0a03eb88bece5b04cea623877b4760cea1ccdc0b27b5b91bbdc` |
| `forced-failure-evidence.v1.json` | Ten ordered retained failure scenarios, their canonical outcomes, and the exact source identity used to derive the forced-failure decision clause | 2,721 | `e2a3ccf161ac33b938da45e1e50569fdbe6b28d34268b468b6dfd24a45d2c4e7` |

The schedule is corpus-request outer and declared-profile inner over 396
requests and six profiles. Exactly 414 cells are eligible. The other 1,962
remain retained with the first applicable reason: 111 have no authorized
baseline incumbent and 1,851 have incomplete path discovery; no cell fails the
later candidate-set or model-shape conditions.

Every eligible call uses 64 outer iterations, 64 inner iterations, and the
binary64 value `2^-40` for convergence tolerance. If a profile's frozen equal
proposal replay cap is `S`, its numerical proposal, iteration, residual replay,
and authorization caps are respectively `S`, `64*S`, `2*S`, and `S`. The
terminal vector is therefore 55, 3,520, 110, and 55. These heterogeneous work
kinds are never combined into one score.

The cohort files contain no numerical result, timing, environment, warmup,
callback, clock, deadline, or randomness observation. The evidence document
names the frozen runtime revision and binds the retained 52,464-byte oracle
source at
`sha256:4f4ca6c3c0d0dd42b4a5ce8731bbdeb9d351e1d59e719ff60ed0f14eafdcb2e2`.
Generation verifies that source and derives the clause from all ten nonempty,
ordered `baseline-preserved` outcomes. Any change requires new identities and
accepted artifacts; retained results cannot be used to tune this version.

Generate an evaluation into an explicit empty directory with
`pnpm evaluate:numerical -- <output-directory>`. Verify the canonical tracked
evaluation with `pnpm verify:numerical-evaluation`.
