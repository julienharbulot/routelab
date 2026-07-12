# RouteLab exact financial and deterministic invariants

## Status and scope

This note is the accepted semantic contract for the first exact-input, two-asset constant-product vertical slice. It drives the Milestone 0 golden fixtures and later exact-execution gates.

These are RouteLab design choices. They are not claims of byte-for-byte or economic equivalence with any deployed protocol. Later tasks may add new pool models only behind separately reviewed semantics; they may not incidentally change this model.

The repository sources already require exact `bigint` execution, immutable snapshots, exact replay before incumbent acceptance, stable deterministic behavior, and separation of work budgets from wall-clock deadlines. The formula-level choices below were previously unspecified. Each material choice therefore records the alternatives considered and the RouteLab rationale.

## 1. Exact values and amount units

An asset amount and a pool reserve are nonnegative integer counts of that asset's smallest supported unit. RouteLab does not scale by token decimals, compare raw reserves across different assets, infer prices, or pass through a human-readable decimal representation in exact execution.

Snapshot reserves are strictly positive. Exact-input request amounts are strictly positive. The pool quote primitive also accepts zero input as a defined algebraic edge case, described below.

All exact financial values and all intermediates derived from them use `bigint` in memory, including:

- input and output amounts;
- reserves;
- `feeChargedNumerator` and `feeDenominator`;
- allocation amounts;
- products, numerators, denominators, and objective comparisons.

There is no fixed-width upper bound in the RouteLab domain. Available memory is an operational limit, not a financial semantic. No exact value may be converted to `number`, passed through a JSON number, or compared using an implicit mixed numeric coercion.

At a text or JSON boundary, an exact nonnegative integer uses the canonical unsigned decimal grammar:

```text
0|[1-9][0-9]*
```

Signs, whitespace, leading zeroes, decimal points, exponent notation, separators, and empty strings are invalid. Parsing validates this grammar before constructing a `bigint`; serialization uses base-ten digits directly.

### Alternatives and rationale

- Human decimal quantities plus token precision were rejected for the first slice because they introduce a separate rounding and metadata contract. Adapters may later convert into atomic units before calling the core.
- Fixed-width integers were rejected because JavaScript `bigint` already provides exact arbitrary-precision arithmetic and the repository forbids loss through `number`.
- Permissive decimal parsing was rejected because multiple spellings of one value undermine canonical fixtures, hashing, and review.

## 2. Identifiers and asset direction

A constant-product pool contains exactly two distinct asset IDs and their corresponding reserves. The pool representation uses explicit paired fields equivalent to:

```text
(asset0, reserve0), (asset1, reserve1)
```

Asset and pool IDs are nonempty, case-sensitive, opaque strings. They are never locale-normalized or interpreted as amounts. A snapshot cannot contain duplicate pool IDs, and a pool cannot contain the same asset on both sides.

For an exact-input quote:

- `assetIn` must equal exactly one of the pool's asset IDs;
- `reserveIn` is the reserve paired with `assetIn`;
- `assetOut` and `reserveOut` are the other pair;
- an unknown `assetIn` is an invalid direction, not a zero quote;
- the rules are identical when the two directions are reversed.

An exact-input request with the same input and output asset is invalid in v0.1. RouteLab does not synthesize a zero-hop plan that returns the input unchanged.

### Alternatives and rationale

- Positional direction without asset IDs was rejected because it can produce plausible but reversed reserve arithmetic.
- A same-asset no-op plan was rejected because the first product promise is routing an input asset into a different output asset; allowing it would introduce a special objective that trivially dominates routed output.

## 3. Fee representation and exact quote formula

Each pool stores:

- `feeChargedNumerator = F`, the fraction of gross input charged as the pool fee;
- `feeDenominator = D`, the fee denominator.

Both are `bigint`. A valid fee satisfies:

```text
D > 0
0 <= F < D
```

The fee may be zero. A 100% or greater fee is invalid. Equivalent unreduced ratios are allowed and remain distinct snapshot encodings; RouteLab does not silently rewrite snapshot data.

Let:

- `a` be gross exact input;
- `x` be `reserveIn`;
- `y` be `reserveOut`;
- `M = D - F` be the input multiplier.

For `a >= 0`, the exact quoted output is:

```text
q = floor((a * M * y) / (x * D + a * M))
```

The multiplication and addition are exact `bigint` operations. There is exactly one rounding operation: nonnegative integer division at the final quotient, which rounds toward zero and therefore equals mathematical floor. RouteLab does not first construct or round an integer “net input” or integer “fee amount.”

The formula gives `q = 0` for `a = 0`. With valid positive reserves and fee, `0 <= q < y`.

### Alternatives and rationale

- The earlier ambiguous name `feeNumerator` is superseded. Interpreting a fee numerator as the retained multiplier was rejected because the stored name must state that `F` is the charged fraction. The derived name `M` makes the complement explicit.
- Rounding `floor(a * M / D)` before applying the invariant was rejected because it introduces an extra rounding point and produces systematically different tiny-input results. The combined rational formula preserves all exact information until the required output-unit floor.
- Rounding output upward or to nearest was rejected because an exact-input quote must not promise an unavailable fractional output unit.
- Requiring a reduced fee fraction was rejected as unnecessary semantic rewriting. Snapshot checksums distinguish exact encodings even where the quote function is algebraically equivalent.

## 4. Zero, tiny, and invalid input

The pool quote primitive and executable transitions have deliberately separate validity rules:

- Negative input is invalid everywhere.
- A zero-input quote succeeds with zero output.
- Applying zero input succeeds as a no-op transition: both reserves are unchanged and the receipt reports zero input and zero output.
- A positive input may mathematically quote zero because of integer rounding.
- A positive-input, zero-output quote remains mathematically defined. RouteLab v0.1 treats it as ineligible for an applied transition, route hop, candidate, or returned execution plan; the rejection leaves all state unchanged. This is a RouteLab planning policy, not a claim that such a quote is universally non-executable in every external protocol.
- A v0.1 exact-input request must have positive input, even though the quote primitive defines zero for algebraic completeness and testing.

### Alternatives and rationale

- Admitting a positive input that returns zero into RouteLab execution planning was rejected because RouteLab should not construct a donation-like plan merely because the floor formula is defined.
- Treating zero input as an invalid quote was rejected because the algebraic result is exact, useful for boundary tests, and permits an unambiguous no-op transition.
- Allowing zero-input user requests was rejected for the first public intent because it adds no routing behavior and complicates `no-route` versus no-op semantics.

## 5. Reserve transitions

For an executable positive-input quote with `q > 0`, the post-swap reserves in the selected direction are:

```text
reserveInAfter  = x + a
reserveOutAfter = y - q
```

The full gross input is credited to the input reserve. The charged fraction remains in the pool; there is no external fee transfer or separate fee ledger in this model. The output reserve stays strictly positive.

The corresponding `asset0`/`asset1` fields retain their identity. A reverse-direction transition maps the directional reserves back to the correct paired fields.

A transition is computed completely and validated before a new pool value or receipt becomes visible. The input pool and enclosing snapshot are never mutated. Failure returns a typed rejection and no partial state. During later multi-hop replay, each next hop reads the latest transition state for every previously touched pool; stale snapshot reserves cannot be reused. Untouched pools remain semantically identical.

For valid positive transitions, the post-transition reserve product does not decrease:

```text
reserveInAfter * reserveOutAfter >= x * y
```

This is checked using exact `bigint` arithmetic in tests, not by approximate comparison.

### Alternatives and rationale

- Crediting only a rounded effective input or removing the fee externally was rejected because this initial model retains the fee in the pool and is expected to have a nondecreasing reserve product.
- Mutating pool objects in place was rejected because snapshots are immutable and failed candidates must not contaminate later evaluation.
- Publishing partially updated state before receipt validation was rejected because invalid candidates must be observationally atomic.

## 6. Snapshot immutability and identity

A snapshot is an immutable collection of validated pool states and is identified by the pair:

```text
(snapshotId, snapshotChecksum)
```

Both fields are nonempty opaque strings. A plan, replay request, snapshot-derived cache, or index that refers only to `snapshotId` is insufficient. The exact pair must match the requested snapshot.

The checksum semantically binds the `routelab.snapshot.v1` schema version and canonical validated financial content, independent of input collection order. It excludes wall-clock observations, derived caches/indexes, decision traces, and the human-readable snapshot ID. Canonical verification recomputes the accepted `sha256:` checksum from that content and compares it exactly with the declared checksum; it never silently rewrites a mismatch.

Immutability is semantic, not merely a TypeScript `readonly` annotation:

- validation, quote, transition, and replay functions do not modify caller-owned objects or collections;
- derived states are new values or function-local copies;
- a failed operation exposes no partial changes;
- later runtime-freezing or defensive-copy choices may strengthen enforcement without changing results.

A prepared routing context first defensively captures caller-owned snapshot data and verifies the declared checksum against its canonical financial content. A mismatch creates no context or snapshot-derived lookup or adjacency. After verification, the context exclusively owns deep-frozen captured snapshot, pool, and adjacency values plus hidden pool and known-asset lookups that are never mutated. It exposes no caller-owned or mutable collection reference.

### Alternatives and rationale

- Snapshot ID alone was rejected because the same label could otherwise refer to different liquidity.
- Including timing, cache state, or insertion order in the checksum was rejected because those do not change the executable financial state and would break deterministic identity.
- Treating preparation as an opaque-checksum boundary was rejected because a snapshot-derived lookup or adjacency must not be created from unverified financial content.

Milestone 0 fixture files are hand-auditable semantic evidence, not yet valid serialized domain snapshots. They may use scenario IDs and ordered pool descriptions without pretending to carry a verified snapshot checksum.

## 7. Valid requests, hops, candidates, and plans

Validity is layered so that a defined arithmetic quote cannot accidentally authorize execution.

### Request validity

A v0.1 request is valid only when:

- snapshot ID and checksum select the requested immutable snapshot;
- input and output assets are known, distinct IDs;
- exact input is positive;
- structural limits such as `maxHops` and work counters are explicitly bounded nonnegative safe integers, with `maxHops` positive;
- deadline nanoseconds, when present, use `bigint` and are not an exact financial value.

### Pool and hop validity

A hop is valid only when the pool exists in the pinned snapshot or latest replay state, its reserves and fee pass validation, its input direction is known, its exact input is nonnegative, and its transition succeeds. A positive-input quote of zero is RouteLab-ineligible for the hop and causes no reserve change.

### Candidate validity

A route candidate is eligible for exact replay only when it:

- begins at the requested input asset and ends at the requested output asset;
- has contiguous asset directions;
- stays within the hop limit;
- repeats neither a pool nor an asset;
- uses only pools from the requested snapshot;
- completes every hop using the latest transitioned state.

Any failure rejects the whole candidate without changing the incumbent or snapshot.

In the composed split runtime, one request branch owns one simple-path traversal and one deeply frozen canonical path list ordered by the raw UTF-16 directional route key. Pool-disjoint candidate sets derive only from that list, without rediscovery or reordering, and split-only set enumeration starts at cardinality two. A discovered path remains a structural proposal until an applicable exact replay succeeds.

### Pool-disjoint split replay

An executable split contains one or more canonical route legs with positive exact allocations. The allocations sum exactly to the requested input, and pool IDs are pairwise disjoint across legs regardless of direction. Assets may be shared across legs because this model has pool-local reserve state and no global asset ledger.

Each leg starts from the same captured original snapshot and then observes sequential transitions along its own route. A leg never observes another leg's transitions. Only after every leg replays successfully is a split receipt exposed; its exact output is the `bigint` sum of the leg outputs. A validation or replay failure exposes no partial receipt and preserves any prior incumbent. Zero-allocation routes are omitted rather than executed.

### Returned-plan validity

A returned plan is valid only when it:

- carries the requested snapshot ID and checksum;
- consumes exactly the requested input amount;
- for a split plan, contains only positive-allocation legs in canonical route order, omits zero-allocation routes, and has allocations whose exact sum equals the requested input;
- contains exact receipts consistent with a fresh sequential replay;
- has a positive final output equal to that replay's output;
- contains no approximate value as an authorizing result;
- satisfied every hard request and route constraint.

Disconnected requests and requests for which every candidate is rejected return a typed `no-route` outcome. Invalid requests return a distinct typed validation error. Neither is an exception used as ordinary control flow.

### Alternatives and rationale

- Combining validation layers was rejected because quote arithmetic, executable state change, route feasibility, and returned-plan eligibility have different zero/tiny-input behavior.
- Allowing repeated assets or pools was rejected for the bounded simple-path baseline and exact replay contract; it avoids cycles and hidden reuse of transitioned liquidity.
- Binding plans only to a snapshot ID was rejected for the identity reasons above.

## 8. Incumbents, objective, and deterministic ties

No candidate becomes or replaces an incumbent until fresh exact replay succeeds. Invalid candidates preserve the current incumbent.

For the initial exact-input objective, plans are ordered by:

1. greater exact final output;
2. for equal output, fewer hops;
3. for equal output and hop count, the lexicographically smaller canonical directional route key.

The canonical route key is the ordered sequence of hop triples:

```text
(assetIn, poolId, assetOut)
```

Triples and sequences are compared component-by-component using raw, case-sensitive UTF-16 code-unit order. Implementations must not use locale-sensitive comparison.

An equal-output candidate replaces an incumbent only when it has fewer hops, or when hop counts are equal and its canonical directional route key is smaller. This makes the selected plan independent of discovery order. Incumbent quality is monotonic under the complete objective tuple.

For pool-disjoint split plans, the exact objective and deterministic tie order is:

1. greater exact summed final output;
2. fewer positive-allocation legs;
3. fewer total hops across those legs;
4. the lexicographically smaller sequence of canonical directional route keys;
5. for the same ordered routes, the lexicographically smaller exact allocation vector using numeric `bigint` comparison.

Split legs are ordered by the existing raw UTF-16 directional route key before this comparison. An equal plan does not replace the incumbent. The allocation-vector tie is deterministic only; it does not claim that smaller earlier allocations have financial preference. Zero-allocation routes are omitted rather than replayed because every supported positive support is itself a canonical pool-disjoint candidate subset.

A bounded greedy allocation policy may propose allocations by dividing the exact input into a configured positive safe-integer number of exact `bigint` chunks. Quotient/remainder reconstruction must sum exactly, and chunks with value zero are not processed. At each step, exact partial split replays may score which canonical route receives the next whole chunk. Those score receipts are never incumbents, even when the final score covers the full requested input. Authorization requires a distinct fresh full-input split replay after allocation completes.

The greedy policy starts from the validated no-split/equal incumbent and can only replace it under the complete split objective above. Evaluation work is bounded explicitly; a cap reached during a route-option step exposes no partial allocation or receipt. Exact scoring or final replay failure preserves the incumbent. Chunk allocation is a bounded heuristic, not a global-optimality claim; tiny exhaustive allocation evidence bounds only the named configured cases.

In the composed split runtime, equal proposal receipts are also non-authorizing. Every equal or greedy incumbent replacement requires a distinct metered fresh full-input exact authorization replay against the prepared snapshot. Only that authorization receipt may replace the incumbent under the complete split objective; failure or a cooperative stop preserves the prior incumbent.

### Alternatives and rationale

- “First discovered wins” was rejected because refactoring traversal order could silently change equal-output results.
- Pool-ID sequence alone was rejected because explicit directional hop triples are easier to audit and remain unambiguous.
- Locale comparison was rejected because environment locale is not part of deterministic configuration.
- Treating a final greedy score as the returned plan was rejected because proposal scoring and full-input authorization remain separate roles even when their exact inputs happen to match.

## 9. Deterministic execution

A deterministic run is a pure semantic function of:

- snapshot ID and checksum;
- normalized request;
- algorithm configuration;
- explicit seed, if any randomized proposal order exists;
- exact deterministic work budget.

All iteration over assets, pools, routes, errors, and serialized fields that can affect results or hashes uses an explicit canonical order. Caller insertion order, object property discovery, locale, wall-clock scheduling, thread scheduling, and uncontrolled randomness cannot affect the semantic result.

Work-budget counters and stop checkpoints must be defined by the task that introduces them. Replays and regression tests use those deterministic checkpoints. A wall-clock deadline is a service/latency behavior only: deadline-driven termination is not assigned a determinism hash unless the deterministic work budget independently fixes the same termination point. Timing fields are always excluded from determinism hashes.

The composed split runtime replays every canonical eligible direct candidate through uncapped fresh exact execution and establishes the best valid direct incumbent before its first interruption callback or clock sample. Direct candidate, replay, and rejection counters are separate from discretionary work. One request-scoped cumulative safe-integer ledger then keeps distinct non-recharged caps and counters for path expansions, best-single candidate replays, candidate-set expansions, equal proposal replays, greedy option replays, and final authorization replays, with replay rejection counters where applicable. No graph expansion is counted as an exact replay or exchanged with it through a universal work scalar.

At each discretionary unit, the runtime first determines unit availability or stage completion, then applies that work kind's cumulative cap, checks interruption, samples the absolute monotonic deadline, and finally executes the unit atomically. This boundary applies before every path expansion, best-single replay, set expansion, equal proposal replay, greedy option replay, and final authorization replay. A per-kind cap closes only its stage; interruption or deadline stops the request. No stop exposes a partial replay or plan.

An interruption callback or deadline clock failure returns a typed control or deadline error rather than throwing through the runtime, executes and accounts no pending unit, and preserves the prior fully authorized incumbent and pre-unit counters.

Discovery materializes its canonical structural path list before best-single evaluation. The best-single stage processes that list in order and charges each attempted exact replay; all discovered paths are replayed only if the stage completes without exhausting its own cap. Unreplayed paths remain structural proposals available to pool-disjoint set enumeration, whose later exact proposal and authorization replays remain mandatory.

Repeated runs with identical deterministic inputs must select the same plan, exact output, termination reason, counters, and stable trace content. Observed elapsed time may differ.

Canonical split evidence is additive under `routelab.split-router-run.v1` and `routelab.split-router-case.v1`. It canonicalizes only deterministic `complete` or `work-limit` executions fixed by typed caps, and its semantic hash includes deterministic request, configuration, caps, counters, termination, and exact result. Interruption- or deadline-driven outcomes and their termination labels remain operational and receive no split-v1 determinism hash; omitting timing, clock samples, or stop observations does not make them semantic. Existing canonical single-path v1 JSON, bytes, hashes, fixtures, and zero-expansion behavior are unchanged.

### Alternatives and rationale

- Treating a wall-clock timeout as reproducible termination was rejected because scheduling changes the completed work.
- Relying on current `Map`, object, or fixture insertion order was rejected because canonical financial behavior should survive source reordering.

## 10. Exact and approximate boundary

JavaScript `number` is permitted only in fields explicitly named and documented as structural or approximate:

- bounded structural counts such as hop limits, iteration limits, and work counters, after validation as finite nonnegative safe integers;
- observational elapsed-time reporting;
- later approximate optimization, bound, feature, or ranking code.

A `number` can propose work but cannot determine an exact quote, reserve, allocation, receipt, plan output, incumbent eligibility, or exact objective comparison. Non-finite approximate values reject that proposal and preserve the validated incumbent.

Deadline nanoseconds use `bigint`. Exact decimal parsing constructs `bigint` directly after grammar validation. Code must not call `Number(exactValue)`, use mixed numeric arithmetic, or use an approximate equality test for exact state.

### Alternatives and rationale

- Requiring `bigint` for every loop counter was rejected because bounded structural counters are not asset quantities and safe-integer `number` operations are explicit and efficient.
- Allowing approximate values to authorize a plan was rejected by the repository's exact-replay boundary.

## 11. Evidence required by implementation stage

Evidence is attached to the stage that owns the behavior. A later search or replay requirement must not prematurely block the minimal domain or pool-quote stage.

### RLT-010 — Domain and snapshot validation

- canonical decimal-string acceptance, rejection, and exact `bigint` parsing;
- nonempty IDs, distinct pool assets, unique pool IDs, and strictly positive snapshot reserves;
- `feeChargedNumerator` and `feeDenominator` bounds;
- snapshot identity containing both `snapshotId` and `snapshotChecksum`, with hashing still deferred;
- deterministic typed error ordering and preservation of caller-owned input on success and failure;
- values above `Number.MAX_SAFE_INTEGER` parsed without a `number` conversion.

### RLT-011 — Constant-product quote and transition

- both pool directions with asymmetric reserves;
- zero fee and fee-boundary vectors over already validated pools;
- zero-input quote and no-op transition;
- a positive-input quote rounding to zero and its RouteLab ineligibility;
- the smallest input rounding to one and a case distinguishing the single-final-floor formula from pre-rounded effective input;
- output strictly below the available output reserve;
- full gross-input reserve credit, exact nondecreasing product, and no mutation of the input pool.

### RLT-012 — Exact route replay

- exact hop output carried into the next hop;
- latest transitioned state used for every touched pool and no stale reserve reuse;
- untouched pools and the original snapshot preserved;
- cycles and repeated pools rejected according to the route contract;
- exact hop receipts and final output reproduced deterministically.

### RLT-013 — Property and differential evidence

- output monotonicity for fixed valid state, reserve safety, and nondecreasing product;
- very large exact intermediates never entering the approximate domain;
- independent golden, property, or differential calculations that do not reuse the production helper as their authority;
- repeated exact quote and replay cases producing identical semantic results.

### RLT-022 and RLT-023 — Plan selection and exhaustive oracle

- exact replay completed before incumbent eligibility;
- invalid candidates preserving the incumbent;
- disconnected requests producing typed `no-route`;
- equal-output selection preferring fewer hops, then the canonical directional route key;
- production path sets, outputs, rejection reasons, and tie results matching a tiny exhaustive oracle under equivalent constraints.

Golden expectations must be hand-derived or produced by a structurally independent, deliberately simple reference—not copied from the production helper.

## 12. Material decision summary

| Decision | Selected RouteLab rule | Rejected principal alternative |
|---|---|---|
| Fee field meaning | `F/D` is the charged fraction | numerator is retained multiplier |
| Fee rounding | one final floor in the combined formula | floor effective input first |
| Reserve credit | full gross input; fee stays in pool | credit net input/remove fee |
| Zero input | quote `0`; no-op transition | invalid quote |
| Positive input quoting zero | arithmetic quote is `0`; RouteLab planning treats it as ineligible | donation-like RouteLab plan |
| Same-asset request | invalid in v0.1 | zero-hop identity plan |
| Snapshot binding | ID and checksum pair | ID only |
| Decimal encoding | canonical unsigned digits | permissive numeric strings/JSON numbers |
| Equal-output tie | fewer hops, then smallest directional hop-triple sequence | first discovered or route key without hop priority |
| String order | raw UTF-16 code-unit, case-sensitive | locale-sensitive comparison |

Any change to a selected rule above is a financial or deterministic contract change. It requires an explicit task, updated independent fixtures, relevant differential/property evidence, and lead plus human review.
