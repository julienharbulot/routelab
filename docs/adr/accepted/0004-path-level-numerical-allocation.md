# ADR 0004: Freeze path-level numerical allocation semantics

- **Status:** Accepted
- **Date:** 2026-07-13
- **Scope:** Milestone 7a numerical proposal, exact reconstruction, and authorization

## Context

RouteLab already has exact no-split, equal-split, and bounded greedy
allocation, a tiny exhaustive reference, pool-disjoint route sets, one composed
request context, non-recharged typed work controls, and one exact replay kernel.
It does not have a numerical allocator.

Milestone 7a requires a path-level shadow-price proposal without weakening the
existing exact boundary. The continuous model necessarily omits integer floors
and positive-input zero-output activation. Binary64 arithmetic can therefore
suggest work, but it cannot establish an executable allocation, objective, or
incumbent.

This decision freezes the model, deterministic approximate procedure, exact
reconstruction, residual scoring, authorization, controls, diagnostics, and
evidence rule before production numerical code is written.

## Decision

### Additive supported boundary and stage order

The existing `routeExactInputSplitAnytime` entry point, its six work kinds and
result types, and canonical `routelab.split-router-run.v1` and
`routelab.split-router-case.v1` are closed compatibility surfaces. Numerical
allocation does not add fields to them or change their bytes, hashes, counters,
errors, or behavior.

A later task may add the direct source-module entry point:

```text
src/router/numerical-exact-input-split/index.ts
routeExactInputSplitNumericalAnytime(context, request, control)
```

Its request reuses every `ExactInputSplitRuntimeRequest` field and adds one
mandatory captured `numerical` configuration. Its result mirrors the existing
outcome classes with additive numerical counters and diagnostics.
Internal curve, binary-normalization, resolver, and orchestration helpers are not
supported APIs.

The additive entry point owns new additive control types rather than widening
the protected old ones. `NumericalExactInputSplitRuntimeWorkKind` is the union
of the six old kinds and the four numerical kinds. Its work caps/counters contain
all corresponding fields. `NumericalExactInputSplitRuntimeCheckpoint` contains
that 10-kind union, the additive counters, and the exact incumbent; the new
callback receives this checkpoint. Callback and deadline semantics are reused,
but `ExactInputSplitRuntimeControl`, its callback/checkpoint/work-kind/counter
types, and every old result remain untouched.

Request capture first reads all inherited request fields in their accepted order,
then reads `numerical`, `numerical.outerIterations`,
`numerical.innerIterations`, and `numerical.convergenceTolerance`, each once.
A missing, throwing, null, or non-object configuration projects
`{ code: 'invalid-numerical-configuration', field: 'numerical' }`. Missing,
throwing, or invalid fields project, in that order,
`invalid-outer-iterations` / `numerical.outerIterations`,
`invalid-inner-iterations` / `numerical.innerIterations`, and
`invalid-convergence-tolerance` / `numerical.convergenceTolerance`.

The additive control captures `workCaps`, the six old cap fields, then
`maxNumericalProposals`, `maxNumericalIterations`,
`maxNumericalResidualReplays`, and `maxNumericalAuthorizationReplays`, followed
by the callback and deadline fields in their existing order. The work-caps object
and old cap failures retain their old additive-result projections. Each missing,
throwing, or invalid numerical cap projects additive `invalid-work-cap` with its
exact `workCaps.<field>` path. Configuration/control validation returns typed
`invalid-request` or `invalid-control` before numerical model construction or any work;
it is not a numerical candidate failure diagnostic.

One call uses one prepared context, one canonical path list, one candidate-set
frontier, and one cumulative typed control. Direct establishment, best-single,
equal, and greedy stages run first. Numerical proposal work starts only after an
exact baseline incumbent has been authorized. Structural and baseline work is
never rediscovered or recharged. Without an exact baseline, no numerical work
runs. While work remains, the numerical stage attempts every materialized
candidate set at most once in the existing canonical frontier order; a model or
candidate failure does not reorder later sets.

### Exact floor-free route curve

For one directional constant-product hop, let:

- `x` be the exact input reserve;
- `y` be the exact output reserve;
- `D` be the fee denominator;
- `F` be the charged fee numerator; and
- `M = D - F`.

The advisory floor-free curve is:

```text
f(a) = (M * y * a) / (D * x + M * a)
```

A route curve has exact positive `bigint` coefficients:

```text
f(a) = A*a / (B + C*a)
```

One hop has:

```text
A = M*y
B = D*x
C = M
```

If an accumulated curve is `(A1,B1,C1)` and the next hop is
`(A2,B2,C2)`, exact composition is:

```text
A = A1*A2
B = B1*B2
C = B2*C1 + C2*A1
```

All coefficients and products are `bigint`. After constructing the one-hop
triple and after every composition, compute the positive exact
`g = gcd(A,B,C)` and replace the triple with `(A/g,B/g,C/g)`. This mandatory
primitive form is part of the deterministic model; optional, delayed, or absent
reduction is invalid because leading-bit normalization is not scale-invariant.
Reduction may not round or convert a coefficient to `number`.

For exact request input `X` and normalized input share `u`, define the exact
positive rationals:

```text
s = A/B
q = (C*X)/B
```

Before leading-bit normalization, put each rational in mandatory primitive
form: replace `(A,B)` by `(A/gcd(A,B),B/gcd(A,B))`, and compute `C*X`
exactly before replacing `(C*X,B)` by its corresponding gcd-reduced pair.
Optional or skipped rational cancellation is invalid.

The normalized continuous marginal is:

```text
m(u) = s / (1 + q*u)^2
```

The model intentionally excludes every per-hop output floor and zero-output
activation boundary. It is neither an execution simulation nor a discrete or
global optimality theorem.

### Exact-to-approximate normalization

Exact amounts, reserves, fees, coefficients, allocations, receipts, and outputs
never become JavaScript `number` values. Direct `Number(bigint)`, implicit
mixed coercion, whole-integer decimal reparsing, and JSON numbers for exact
values are forbidden.

A positive `bigint z` is converted only into a dimensionless advisory
significand/exponent pair:

1. Determine its binary bit length `L` structurally. `L - 1` must be a
   nonnegative safe integer.
2. Let `p = min(53, L)`.
3. Read the first `p` binary digits. Accumulate those digits in order through
   binary64 multiply-by-two and add-zero-or-one. The resulting prefix is an
   exactly representable integer no larger than `2^53 - 1`. The source
   `bigint` is never converted to `number`.
4. Discard every remaining low bit without rounding.
5. Divide the prefix by the exact binary64 power `2^(p-1)`. The result is a
   dimensionless significand in `[1,2)`; the structural exponent is `L-1`.

For a positive rational `n/d`, first require the mandatory gcd-reduced pair
above, normalize numerator and denominator separately, then evaluate in this
exact operation order:

```text
ratio = (significandN / significandD) * 2^(exponentN - exponentD)
```

The exponent difference must be a safe integer. The result must be finite,
strictly positive, and normal—at least `2^-1022`. Zero, subnormal underflow,
overflow, or a non-finite value is `non-finite-normalization`. No clamp,
sentinel, infinity substitution, or alternate decimal path is permitted.

The resulting `s` and `q` values are approximate from their creation. Even
when a small rational happens to be exactly representable, it has no exact or
authorizing role.

### Deterministic shadow-price proposal

The numerical configuration is explicit; there are no defaults:

```text
outerIterations
innerIterations
convergenceTolerance
```

Both iteration counts are positive safe integers no greater than 256.
`convergenceTolerance` is a finite normal `number` satisfying
`2^-1022 <= convergenceTolerance <= 1`. Negative zero and subnormal tolerances
are invalid. Existing request fields validate first in
their accepted order, followed by the configuration object, outer iterations,
inner iterations, and tolerance.

Candidate sets contain at least two canonical pool-disjoint routes. For each set,
the solver uses only basic binary64 addition, subtraction, multiplication,
division, comparison, and exact powers of two. It does not use `sqrt`,
logarithms, exponentials, randomness, locale behavior, or a clock.

Set:

```text
lambdaLower = 0
lambdaUpper = max(s_i)
```

For a finite `lambda`, a route share is computed as follows:

- if `lambda >= s`, the share is `0`;
- compute `m1 = s / ((1 + q) * (1 + q))` in the written operation order;
- if `lambda <= m1`, the share is `1`;
- otherwise start `shareLower = 0`, `shareUpper = 1`, and perform exactly
  `innerIterations` updates;
- each update uses
  `mid = (shareLower + shareUpper) / 2`,
  `denominator = 1 + q*mid`, and
  `marginal = s/(denominator*denominator)`, in that order;
- when `marginal > lambda`, set `shareLower = mid`; equality and
  `marginal < lambda` set `shareUpper = mid`;
- the returned share is exactly
  `shareMid = (shareLower + shareUpper) / 2`, with addition before division,
  using the same finite/domain checks as an inner update.

A successful proposal completes exactly `outerIterations` outer updates. A work
stop or typed proposal failure may exit earlier under the accounting below.
Each update computes
`lambdaMid = lambdaLower + ((lambdaUpper - lambdaLower) / 2)` in the written
subtraction, division, addition order, computes every route share at that value
in canonical order, and sums them in that order. If the sum is greater than one,
set `lambdaLower = lambdaMid`. Equality and a sum below one set
`lambdaUpper = lambdaMid`.

One permitted outer-update attempt is one `numerical-iteration` work unit. After
the cap/control/deadline boundary permits the attempt, increment the global and
candidate-attributable `numericalIterations` counter before any arithmetic.
Increment `completedOuterIterations` only after every route share and the lambda
interval update finish successfully. A failed atomic attempt is therefore
charged once but is not reported as completed. The fixed inner loops are atomic
proposal math within that attempt. After the final completed outer update,
compute the final sample with the identical expression
`lambdaMid = lambdaLower + ((lambdaUpper - lambdaLower) / 2)` and recompute all
shares; this final sample adds no work unit. Every intermediate lambda, product, denominator,
marginal, share, and sum must be finite and within its stated domain: lambda is
nonnegative, denominators and marginals are strictly positive, shares are in
`[0,1]`, and the sum is in `[0,route count]`. Underflow to zero, overflow, NaN,
or a domain violation is `non-finite-proposal`; values are never clamped.

The final weight sum must be finite and strictly positive. Compute
`difference = sum(weights) - 1`, then
`absoluteDifference = difference < 0 ? -difference : difference`; success
requires:

```text
absoluteDifference <= convergenceTolerance
```

Otherwise the proposal is `non-convergence`. The weights remain advisory and
are not normalized through further binary64 division before exact
reconstruction.

### Exact IEEE-754 reconstruction

Each returned weight is decoded from its exact binary64 bit pattern using an
explicit big-endian byte interpretation:

- any sign bit, including negative zero, is invalid;
- positive zero is allowed and represents integer weight zero;
- exponent bits `0` with a nonzero fraction are rejected as subnormal;
- exponent bits `2047` are rejected as infinity or NaN; and
- a positive normal value has integer significand
  `2^52 + fraction` and binary exponent
  `exponentBits - 1023 - 52`.

A rejected bit pattern is `invalid-reconstruction`. Among positive normal
weights, choose the smallest binary exponent as a common exponent. Left-shift
each exact `bigint` significand by its nonnegative exponent difference to
produce canonical nonnegative integer weights `w_i`. Positive zero produces
`w_i = 0`. The exact total `W = sum(w_i)` must be positive; otherwise the
failure is `zero-total-weight`.

For exact input `X`, base allocation is:

```text
base_i = floor((X * w_i) / W)
```

All multiplication, summation, division, and validation use `bigint`. Bases
are nonnegative and ordered by the canonical route order. Their sum must not
exceed `X`; any violated bound is `invalid-reconstruction`. With `k`
positive weights, the exact residual:

```text
residual = X - sum(base_i)
```

satisfies `0 <= residual < k <= route count`. A zero base is omitted from
replay legs, but its route remains
eligible for residual trials.

### Exact residual scoring and distinct authorization

Residual allocation uses the exact replay kernel, never an approximate marginal.

For each residual unit:

1. Let the pending partial total be the current exact allocated total plus one.
2. In canonical route order, trial-add that unit to every route in the model-valid
   candidate set, including a route with zero base/current allocation.
3. Omit zero-allocation legs and exact-replay the resulting split against the
   requested snapshot with the common pending partial total.
4. Count every completed replay and rejection. Among valid receipts, select the
   best with the accepted exact split objective and tie order.
5. If every option rejects, discard the proposal with
   `residual-options-exhausted`. Otherwise commit only the selected unit to the
   proposal allocation.

A cap, interruption, deadline, callback failure, or clock failure during an
option scan discards the pending unit and the entire numerical proposal. A
partially scanned option set never selects a route or exposes a receipt.

If residual is positive, the winning replay for the last unit, whose partial
total is `X`, is the nonauthorizing full-input proposal score. If residual is
zero, perform and charge one `numerical-residual-replay` of the reconstructed
full-input allocation to obtain that score. A rejection is
`residual-options-exhausted`.

The score may proceed only when it is strictly better than the current exact
incumbent under the complete split objective. A score that is not better records
`not-better` and performs no authorization.

A better score requires one separately metered
`numerical-authorization-replay`: freshly replay the same exact full-input
allocation against the requested prepared snapshot. Replay failure is
`authorization-replay-rejected`. A successful authorization receipt must match
the scored exact allocation/output semantics and remain strictly better than the
current incumbent; disagreement is `authorization-result-mismatch`. Only that
fresh receipt may replace the incumbent.

### Work, stops, failures, and diagnostics

The additive work kinds are exactly:

```text
numerical-proposal
numerical-iteration
numerical-residual-replay
numerical-authorization-replay
```

Their cap fields are `maxNumericalProposals`,
`maxNumericalIterations`, `maxNumericalResidualReplays`, and
`maxNumericalAuthorizationReplays`. Their counters use the corresponding
plural nouns without `max`. The additional failure and replay-rejection counters are
`numericalProposalFailures`, `numericalResidualReplayRejections`, and
`numericalAuthorizationReplayRejections`. All caps/counters are validated safe integers and
cannot be collapsed with each other or with the six baseline kinds into one
work scalar.

A proposal unit is charged before constructing one candidate-set model. A
numerical iteration is charged before one outer update. Each exact residual
option/zero-residual score and each authorization is charged before its replay.
Every boundary follows the existing order: availability/completion, cap,
interruption callback, absolute monotonic deadline, then atomic work.

A numerical cap ends the numerical stage with `work-limit`. Interruption,
deadline, callback/clock error, or regression ends the request under the existing
typed operational result. No pending work is charged or exposed. A model or
candidate failure records a diagnostic and continues to the next canonical
candidate set while work remains. Every path preserves the last fully authorized
exact incumbent and completed counters.

Once the next canonical candidate set has been materialized and selected, reaching
its `numerical-proposal` boundary creates its diagnostic identity. If that boundary
stops before charging the proposal because of a cap, interruption, deadline,
callback failure, or clock failure, emit one `stopped` diagnostic for that current
set with null failure, `converged: false`, zero attributable numerical
counters, zero completed outer iterations, and null `residualUnits`. This identity record is not a charged work
unit and exposes no partial model or replay. Candidate sets whose proposal boundary
was never reached emit no diagnostic. A stop before the numerical stage begins
likewise emits no numerical diagnostic.

The frozen numerical failure-code union is:

```text
invalid-route-model
non-finite-normalization
non-finite-proposal
non-convergence
zero-total-weight
invalid-reconstruction
residual-options-exhausted
authorization-replay-rejected
authorization-result-mismatch
```

`invalid-route-model` means that at least one of these conditions holds: exact
request input `X`, a constructed coefficient, or a rational
numerator/denominator is not a positive `bigint`; a candidate set is not the
existing canonical cardinality-two-or-more pool-disjoint form; a route is empty,
noncontiguous, or cannot be resolved directionally in the prepared snapshot; or
construction/primitive reduction fails to produce positive `A`, `B`, and `C`.
The other
codes occur only at the named normalization, proposal, reconstruction,
residual, or authorization boundary.

An unsafe structural bit length, unsafe exponent or exponent difference, or a
zero, subnormal, overflowed, or non-finite normalized rational is specifically
`non-finite-normalization`; it is not coerced into `invalid-route-model`.

Each candidate-set diagnostic is deeply frozen and appears in canonical set
order. It records:

- the candidate-set key and ordered route keys;
- status `improved`, `not-better`, `failed`, or `stopped`;
- a failure code or null;
- `converged: boolean`;
- `completedOuterIterations` and `configuredInnerIterations` as safe integers;
- `residualUnits` as `bigint | null`: null until exact reconstruction succeeds,
  then the original exact residual count (including `0n` for a genuine zero
  residual), retained even if residual scoring later fails or stops;
- proposal, residual replay/rejection, and authorization replay/rejection
  counters attributable to the candidate; and
- any exposed approximate field explicitly labeled nonauthorizing.

The diagnostic route key is exactly
`JSON.stringify(route.map(hop => [hop.assetIn,hop.poolId,hop.assetOut]))`.
The candidate-set key is exactly
`JSON.stringify(routes.map(route => route.map(hop =>
[hop.assetIn,hop.poolId,hop.assetOut])))`, with routes and hops already in their
accepted canonical order. These keys are identities, not an alternate ordering
rule.

The attributable counter field names are `numericalProposals`,
`numericalProposalFailures`, `numericalIterations`, `numericalResidualReplays`,
`numericalResidualReplayRejections`, `numericalAuthorizationReplays`, and
`numericalAuthorizationReplayRejections`. A candidate has zero or one proposal
unit; global counters are the exact safe-integer sums of charged units and
classified failures/rejections.

Counter classification is exact:

| Candidate event | Proposal failure | Residual replay rejection | Authorization replay rejection |
|---|---:|---:|---:|
| `invalid-route-model`, `non-finite-normalization`, `non-finite-proposal`, `non-convergence`, `zero-total-weight`, or `invalid-reconstruction` | increment once | no additional increment | no additional increment |
| one rejected residual option or rejected zero-residual full score | no | increment once for that completed rejected replay | no |
| `residual-options-exhausted` after all completed options reject | no additional increment beyond individual replay rejections | already counted per rejection | no |
| `authorization-replay-rejected` | no | no | increment once |
| `authorization-result-mismatch` after a successful replay | no | no | increment once because the authorization result is rejected |
| `improved` or `not-better` | no | retain only individual residual replay rejections already observed | no |
| cap, interruption, deadline, callback, or clock stop | no | retain only completed replay rejections before the stop | retain only a completed rejected/mismatched authorization; pending work adds none |

`numericalProposals`, every replay-attempt counter, and
`numericalIterations` follow their work-unit rules independently of this table.
A candidate can therefore finish `improved` or `not-better` while truthfully
retaining rejected residual options, without becoming a proposal failure.

Timing, clock samples, callback observations, mutable aliases, and prose errors
are excluded. A stopped diagnostic has null numerical failure code because the
typed runtime termination carries the operational reason.

### Independent evidence and primary-mode rule

Before RLT-072 production results, its independent oracle packet must freeze
exact fixtures and enumeration order within these limits:

- at most three canonical pool-disjoint routes;
- at most two hops per route;
- exact input no greater than 12 for exhaustive allocation comparison;
- result-blind small positive reserve and valid fee cases;
- symmetric equal allocation;
- the exact `[1,2]` allocation-vector tie;
- the retained coarse-greedy counterexample;
- positive-input zero-output activation;
- nonzero fees and bounded multi-hop composition;
- `10^80` or larger exact-sum reconstruction;
- pool/route permutations and deterministic ties.

Before RLT-073 runtime results, its independent oracle packet must additionally
freeze every numerical cap boundary, mid-residual stop, replay rejection,
authorization mismatch/rejection, callback/deadline failure, and complete
incumbent-preservation lattice over named fixtures from the same bounded set.

Expected coefficients, weights, allocations, objectives, and failures are derived
independently. The oracle does not import the production curve, normalization,
reconstruction, objective, or numerical helpers. Agreement claims remain limited
to the frozen cases.

The executable agreement criterion has two separate parts:

1. Production must exactly match the independent ADR implementation for
   primitive coefficients and reduced rational pairs, normalized binary64 bit
   patterns, solver status and weights, decoded integer weights, base/residual
   allocations, exact residual choices, failure codes, counters, diagnostics,
   and the final authorized incumbent.
2. The independent exhaustive discrete oracle separately reports its exact best
   objective and the production objective/gap for every tiny case. Equality with
   the exhaustive optimum is required only for two explicitly frozen goldens:
   (a) two identical one-hop zero-fee pools with input reserve `1`, output reserve
   `2`, and `X=2`, whose exact optimum is allocation `[1,1]` with output `2`; and
   (b) the zero-fee two-route input-three fixture whose canonical route order
   places `(x,y)=(4,9)` before `(1,9)` and whose exact objective chooses
   allocation `[1,2]` with output `7` over the tied `[2,1]`. Other
   cases—including other symmetric cases—report the exact gap
   without converting an expected floor/activation difference into a contract
   failure, provided part 1 and baseline preservation hold.

The coarse-greedy and zero-output activation counterexamples are retained. No
claim extends from named optimum-equality cases to the full bounded grid or to
unrestricted inputs.

Before generating RLT-074 numerical results, freeze the complete 396-request M6
corpus identity, baseline and numerical configurations, semantic ordering, and
heterogeneous work fields. Also freeze, before numerical output, the complete
ordered list and hash of eligible `(requestId, profileId)` cells. Eligibility is
result-blind with respect to numerical output: the frozen baseline cell must have
an exactly authorized incumbent, structurally complete path and candidate-set
discovery, and at least one canonical cardinality-two-or-more candidate set that
passes model-shape validation. Every other cell retains a typed ineligibility
reason; no cell may be removed or reclassified after numerical results.

Primary numerical mode is permitted only when:

- no request/profile exact objective regresses from its authorized baseline;
- every forced numerical failure preserves that baseline;
- every cell in that frozen eligible list ends with typed terminal
  diagnostics; and
- at least one eligible request has strictly greater exact output than greedy.

If any clause fails, retain the result and keep numerical mode experimental.
Outputs are compared only within the same request/asset pair; exact amounts are
not aggregated across assets. No latency, speedup, demand, notional, discrete
global-optimality, or production conclusion follows.

### Compatibility and publication limits

Milestone 7a creates no canonical numerical run or case schema. Any later
persisted numerical semantic record needs an additive new version. Existing split
v1 fixtures and hashes remain byte-identical.

The numerical direct module is a supported source-module surface once integrated.
A package root, `exports` map, license/publication workflow, protocol adapter,
service API, worker topology, new pool curve, transaction path, or split
checkpoint/resume is not part of this decision.

## Consequences

- RLT-072 may implement only the isolated exact-coefficient, deterministic
  proposal, IEEE decode, and bigint reconstruction core plus independent bounded
  evidence.
- RLT-073 may compose the additive runtime only after the RLT-072 gate, preserving
  the exact baseline and old v1 surfaces.
- RLT-074 must freeze identical inputs/configuration before numerical outputs and
  retain a primary or honest experimental decision.
- Every non-finite, non-convergent, invalid, rejected, capped, interrupted, or
  deadline-driven numerical path preserves the last fully authorized exact
  incumbent and therefore cannot regress below the baseline.
- The continuous model remains advisory and supports no unrestricted or discrete
  optimality claim.

## Alternatives rejected

- Extending split v1 was rejected because its schema, counters, bytes, and hashes
  are closed compatibility evidence.
- Direct bigint-to-number conversion was rejected because exact financial values
  cannot cross the approximate boundary.
- Host `sqrt`, log, exponential, or random methods were rejected because a
  fixed nested bisection has an explicit deterministic operation order.
- Rounding decimal weights was rejected because exact IEEE bit decoding and
  bigint reconstruction avoid another approximate boundary.
- Treating a full-input score as authorization was rejected because proposal and
  incumbent roles remain distinct even when their exact inputs coincide.
- Keeping numerical mode primary by design was rejected because identical-input
  evidence, including negative evidence, must earn that status.
