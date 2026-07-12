# RouteLab code-review contract

Review RouteLab changes as financial and low-latency infrastructure, while keeping claims proportional to the project's current scope.

The reviewer is read-only. The lead owns resolution and integration.

## Review output

Lead with findings ordered by severity. For every finding include:

- severity;
- affected file and symbol or observable behavior;
- the concrete defect or risk;
- why it matters;
- a reproducer, counterexample, missing test, or evidence path when possible;
- whether it blocks integration;
- the smallest credible correction direction, without implementing it.

Then state:

- scope inspected;
- tests or commands observed or safely run;
- unverified areas;
- residual risks if no findings were identified.

Do not return only a summary or “looks good.” Do not pad the review with style preferences.

## Severity

### P0 — Must not integrate

Likely loss/corruption of exact financial meaning, invalid returned plan, security exposure, data corruption, unrecoverable API break, or a release claim known to be false.

Examples:

- exact amounts converted through `number`;
- incumbent accepted without exact replay;
- reserve transition uses stale state;
- snapshot/index mismatch can return a plan;
- allocation does not sum to exact input;
- deterministic replay depends on timing or uncontrolled randomness.

### P1 — Blocks the task or release gate

Material correctness, determinism, cancellation, fallback, or reproducibility failure with realistic impact.

Examples:

- cycle or pool reuse slips through search;
- deadline returns a partial or unvalidated structure;
- fallback is bypassed on optimizer failure;
- oracle shares the implementation under test;
- replay fixture requires a live service;
- benchmark comparison changes both data and algorithm.

### P2 — Important follow-up or maintainability risk

A bounded issue that may not invalidate the current behavior but is likely to cause a regression, misleading result, or expensive future repair.

Examples:

- missing adversarial boundary case;
- ambiguous typed error behavior;
- unbounded normal trace growth;
- optimization lacks environment metadata;
- public contract change is undocumented.

### P3 — Non-blocking observation

A small clarity, naming, or local maintainability improvement. Include only when it materially improves understanding or prevents a likely error.

## Core review questions

### Scope and sequencing

- Is this the smallest task that advances the current gate?
- Did later-milestone work enter without a present use case?
- Did the change mix algorithm, dataset, broad cleanup, package extraction, or public API work?
- Are dependencies and abstractions earned by current behavior?

### Exact financial behavior

- Do exact values remain `bigint` end to end?
- Are fee application and rounding direction explicit?
- Are zero, tiny, huge, and near-reserve values handled?
- Are input states immutable where promised?
- Are subsequent hops based on updated state?
- Can invalid state or direction produce a plausible-looking result?

### Exact-validation boundary

- Is every incumbent exactly replayed before acceptance?
- Can approximate output leak into the returned exact result?
- Do allocations sum exactly after reconstruction?
- Does failure preserve the previous incumbent?
- Is the deterministic tie-break explicit and stable?

### Search and graph behavior

- Are cycles, repeated assets, and repeated pools handled according to the task contract?
- Is iteration order stable?
- Are hard constraints separate from heuristics?
- Is a claimed sound bound actually safe, documented, and tested adversarially?
- Does the production search agree with an independent tiny exhaustive oracle where required?

### Replay and timing

- Are snapshot ID, checksum, config, seed, and work budget represented?
- Is the determinism hash free of timing fields and unstable ordering?
- Are work budgets separate from wall-clock deadlines?
- Are cancellation checkpoints frequent enough and tested deterministically?
- Is only a valid incumbent returned on interruption?

### Allocation and approximate math

- Is approximate code visibly separated from exact execution?
- Are non-finite values, non-convergence, and residual errors handled?
- Is float-to-bigint reconstruction deterministic and exact in total?
- Does a simple fallback remain available?
- Is the comparison oracle independent and small enough to trust?

### Data and benchmarks

- Are provenance, schema, ordering, and checksums explicit?
- Can the benchmark run offline after data generation?
- Are base and head using identical inputs and configuration?
- Are raw results and environment metadata retained?
- Are sample sizes and percentile claims credible?
- Are quality tradeoffs reported alongside speedups?

### Learning-augmented behavior

- Does model-disabled routing remain correct?
- Can predictions do more than order candidates without an explicit experimental mode?
- Is exact replay still the approval boundary?
- Is the split chronological rather than leakage-prone?
- Are random, reversed, stale, or corrupted predictions evaluated when claimed?
- Are claims phrased as empirical unless formally proved?

### API and adapters

- Is the boundary a thin mapping over the tested core?
- Did routing logic leak into transport or protocol code?
- Are bigint values serialized as decimal strings?
- Are errors and snapshot selection explicit?
- Does a protocol adapter avoid keys, signing, or live funds unless explicitly in scope?

### Tests

- Do tests assert behavior rather than implementation shape?
- Are golden values independently derived?
- Are property tests seeded and reproducible?
- Can a failing test be hidden by updating the fixture from production output?
- Are important failure paths covered?
- Did the relevant full gate run after integration?

## Review conclusion

Use one of these conclusions:

- **Block:** P0/P1 findings must be resolved before integration.
- **Integrate after specified fixes:** bounded corrections remain.
- **Integrate with recorded follow-up:** no gate failure, but a material P2 should become a task.
- **No blocking findings in reviewed scope:** state residual uncertainty and unverified areas.

The reviewer recommends. The lead decides and records the resolution.
