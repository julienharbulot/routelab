# ADR 0001: Compose split routing under one verified request runtime

- **Status:** Accepted
- **Date:** 2026-07-13
- **Scope:** Pre-Milestone 6 integration gate

## Context

RouteLab's Milestone 4 anytime single-path runtime and Milestone 5 split-routing
components are independently correct within their accepted gates. They are not yet
one product path. The current split entry points prepare snapshot-derived state and
perform discovery independently, and the greedy entry point calls the equal-split
router before repeating structural discovery. Those component APIs therefore cannot
be nested to obtain one request-scoped work ledger, one deadline, or one monotonic
exact incumbent.

Historical evaluation must measure a deliberate composed runtime rather than this
accidental call chain. This decision freezes that runtime contract before production
changes. It does not implement the runtime and does not revise the factual Milestone
0–5 completion records.

## Decision

### Public boundary and compatibility surfaces

Add these public surfaces:

- `prepareRoutingContext`, a factory that accepts a liquidity snapshot and either
  returns a verified `PreparedRoutingContext` or a typed failure;
- `PreparedRoutingContext`, a public opaque handle whose construction and state are
  internal; and
- `routeExactInputSplitAnytime`, the high-level exact-input split runtime that
  accepts a prepared context, one normalized request, and one request control.

The additive factory declaration is:

```ts
export type PrepareRoutingContextResult =
  | { readonly ok: true; readonly value: PreparedRoutingContext }
  | {
      readonly ok: false;
      readonly error: CanonicalSnapshotChecksumMismatchError;
    };

export declare function prepareRoutingContext(
  snapshot: LiquiditySnapshot,
): PrepareRoutingContextResult;
```

The input is an already validated `LiquiditySnapshot`. A canonical checksum
mismatch is the factory failure in this contract.

The existing Milestone 2–5 routers remain unchanged public component and
compatibility surfaces. The new orchestration must not call
`routeExactInputSinglePath`, `routeExactInputSplit`,
`routeExactInputSplitGreedy`, or another public router as a nested stage. It may use
shared lower-level primitives extracted in later bounded tasks. This prevents
snapshot preparation, discovery, or a work cap from being charged again by a nested
router.

### Prepared context trust and ownership

`prepareRoutingContext` establishes the checksum trust boundary. It must:

1. defensively capture the caller's snapshot and pool fields without retaining a
   caller-owned object, array, pool, map, set, or derived reference;
2. recompute the checksum from the accepted canonical financial content and compare
   it exactly with the declared `snapshotChecksum`;
3. reject a mismatch without substituting or rewriting the declared checksum and
   without constructing a context, pool lookup, known-assets set, or adjacency; and
4. only after successful verification, construct the prepared state.

The resulting opaque handle exclusively owns a deep-frozen captured snapshot, its
deep-frozen pools, and a deep-frozen deterministic adjacency value. It also owns a
hidden pool lookup and known-assets set that are never mutated after construction.
Its public operations do not expose those collections or any mutable alias. All
requests remain bound to the captured `(snapshotId, snapshotChecksum)` pair.

### Runtime request and validation

The additive request declaration is:

```ts
export interface ExactInputSplitRuntimeRequest {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly maxHops: number;
  readonly maxRoutes: number;
  readonly greedyParts: number;
}

export type ExactInputSplitRuntimeValidationErrorCode =
  | 'snapshot-identity-mismatch'
  | 'empty-identifier'
  | 'nonpositive-input'
  | 'same-asset-request'
  | 'invalid-max-hops'
  | 'invalid-max-routes'
  | 'invalid-greedy-parts'
  | 'unknown-asset';

export type ExactInputSplitRuntimeValidationErrorField =
  | 'snapshotIdentity'
  | 'assetIn'
  | 'assetOut'
  | 'amountIn'
  | 'maxHops'
  | 'maxRoutes'
  | 'greedyParts';

export type ExactInputSplitRuntimeValidationError =
  | {
      readonly code: 'snapshot-identity-mismatch';
      readonly field: 'snapshotIdentity';
    }
  | {
      readonly code: 'empty-identifier';
      readonly field: 'assetIn' | 'assetOut';
    }
  | { readonly code: 'nonpositive-input'; readonly field: 'amountIn' }
  | { readonly code: 'same-asset-request'; readonly field: 'assetOut' }
  | { readonly code: 'invalid-max-hops'; readonly field: 'maxHops' }
  | { readonly code: 'invalid-max-routes'; readonly field: 'maxRoutes' }
  | { readonly code: 'invalid-greedy-parts'; readonly field: 'greedyParts' }
  | {
      readonly code: 'unknown-asset';
      readonly field: 'assetIn' | 'assetOut';
    };
```

Validation requires the exact snapshot identity captured by the prepared context;
nonempty, distinct, known input and output assets; a positive `bigint` input; and
positive safe-integer `maxHops`, `maxRoutes`, and `greedyParts`. Invalid requests
return the exact code and narrowest applicable field named above and do not begin
direct establishment.

### One shared structural discovery result

One normalized request branch owns exactly one simple-path traversal. Discovery
materializes one deeply frozen canonical path list with this representation:

```ts
readonly (readonly DirectionalRouteHop[])[]
```

Every hop, path, and containing array is captured and frozen. Paths are sorted by
the accepted canonical directional route key using raw, case-sensitive UTF-16
code-unit order. Path validity continues to prohibit repeated assets and pools.

Pool-disjoint candidate-set enumeration is a pure combination traversal over that
same path list. It neither rediscovers nor reorders paths. Split-only enumeration
starts at cardinality two; the direct and best-single stages own singleton behavior.

Discovery completes or reaches its path-expansion cap before the best-single stage
visits the materialized path list in canonical order. Each path processed by the
best-single stage is atomically exact-replayed and charged to the best-single replay
kind. All discovered paths are replayed only when that stage completes without cap
exhaustion. If its cap closes the stage, unreplayed paths remain fully materialized
structural proposals and remain eligible for pool-disjoint set enumeration. A
structural path is never an incumbent or authorizing receipt without exact replay,
but it need not undergo a best-single full-input replay before participating in a
separately exact-replayed split proposal. A direct path rediscovered and processed
by the best-single stage is replayed and charged again; that replay is not a graph
expansion.

### Direct incumbent establishment

The runtime validates the request and the shape of its request control before
establishment. It does not invoke the interruption callback or sample the clock
during that validation.

Direct establishment then visits every eligible one-hop candidate in raw UTF-16
canonical route-key order, performs a fresh atomic exact replay, and installs the
exact best valid direct receipt under the accepted objective. Establishment is
mandatory and uncapped. Its cumulative safe-integer ledger separately records
direct candidates, direct exact replays, and direct replay rejections.

Establishment finishes before the first interruption callback or clock sample,
including when a supplied deadline has already passed. When no direct candidate is
eligible, the runtime may still have no incumbent at the first discretionary stop;
it does not manufacture a baseline.

### One typed request control and cumulative ledger

One public `ExactInputSplitRuntimeControl` instance spans every discretionary stage.
Deadline nanoseconds and clock samples are `bigint`; there is no implicit default
clock.

The public cap type is `ExactInputSplitWorkCaps` with exactly these work properties:

```ts
export interface ExactInputSplitWorkCaps {
  readonly maxPathExpansions: number;
  readonly maxBestSingleCandidateReplays: number;
  readonly maxCandidateSetExpansions: number;
  readonly maxEqualProposalReplays: number;
  readonly maxGreedyOptionReplays: number;
  readonly maxFinalAuthorizationReplays: number;
}
```

The public cumulative-ledger type is `ExactInputSplitWorkCounters`, with exactly
these ledger properties:

```ts
export interface ExactInputSplitWorkCounters {
  readonly directCandidates: number;
  readonly directCandidateReplays: number;
  readonly directCandidateRejections: number;
  readonly pathExpansions: number;
  readonly bestSingleCandidateReplays: number;
  readonly bestSingleCandidateRejections: number;
  readonly candidateSetExpansions: number;
  readonly equalProposalReplays: number;
  readonly equalProposalRejections: number;
  readonly greedyOptionReplays: number;
  readonly greedyOptionRejections: number;
  readonly finalAuthorizationReplays: number;
  readonly finalAuthorizationRejections: number;
}
```

The checkpoint, deadline, and control declarations are:

```ts
export type ExactInputSplitRuntimeWorkKind =
  | 'path-expansion'
  | 'best-single-candidate-replay'
  | 'candidate-set-expansion'
  | 'equal-proposal-replay'
  | 'greedy-option-replay'
  | 'final-authorization-replay';

export interface ExactInputSplitRuntimeCheckpoint {
  readonly nextWorkKind: ExactInputSplitRuntimeWorkKind;
  readonly counters: ExactInputSplitWorkCounters;
  readonly incumbent: ExactInputSplitReplayReceipt | null;
}

export interface ExactInputSplitRuntimeDeadlineControl {
  readonly deadlineNanoseconds: bigint;
  readonly nowNanoseconds: () => bigint;
}

export interface ExactInputSplitRuntimeControl {
  readonly workCaps: ExactInputSplitWorkCaps;
  readonly shouldInterrupt?: (
    checkpoint: ExactInputSplitRuntimeCheckpoint,
  ) => boolean;
  readonly deadline?: ExactInputSplitRuntimeDeadlineControl;
}
```

The runtime defensively captures the request, control, caps, and supplied function
references exactly once. It validates their shape before direct establishment and
does not invoke the callback or clock while doing so. An absent callback skips the
interruption check; an absent deadline skips the clock check. Every callback
checkpoint is a deeply frozen snapshot of the pre-unit state. Its counters and any
non-null incumbent receipt are also deeply frozen and expose no mutable runtime
alias.

Control-shape failures return `status: 'invalid-control'` with this exact public
error union; they never throw through the runtime:

```ts
export type ExactInputSplitRuntimeControlValidationError =
  | { readonly code: 'invalid-work-caps'; readonly field: 'workCaps' }
  | {
      readonly code: 'invalid-work-cap';
      readonly field:
        | 'workCaps.maxPathExpansions'
        | 'workCaps.maxBestSingleCandidateReplays'
        | 'workCaps.maxCandidateSetExpansions'
        | 'workCaps.maxEqualProposalReplays'
        | 'workCaps.maxGreedyOptionReplays'
        | 'workCaps.maxFinalAuthorizationReplays';
    }
  | {
      readonly code: 'invalid-interruption-callback';
      readonly field: 'shouldInterrupt';
    }
  | { readonly code: 'invalid-deadline-control'; readonly field: 'deadline' }
  | {
      readonly code: 'invalid-deadline-nanoseconds';
      readonly field: 'deadline.deadlineNanoseconds';
    }
  | {
      readonly code: 'invalid-deadline-clock';
      readonly field: 'deadline.nowNanoseconds';
    };
```

A property-capture or getter failure is classified at the narrowest available field
in this union. No direct-establishment work has run when an invalid-control result is
returned.

Every cap and counter property is readonly and validated as a nonnegative safe
integer `number`. The three direct-establishment counters have no matching cap;
establishment remains mandatory and uncapped. Non-work observation counts remain
outside this ledger unless a later explicit contract adds them. The discretionary
ledger has a distinct cap and cumulative counter for each heterogeneous work kind:

| Work kind | Counted unit |
|---|---|
| Path expansions | One executed simple-path frontier edge expansion |
| Best-single candidate replays | One attempted full-input exact replay of a discovered path |
| Candidate-set expansions | One executed pool-disjoint combination-frontier expansion |
| Equal proposal replays | One attempted exact replay of an equal-allocation proposal |
| Greedy option replays | One attempted exact replay used to score one route option |
| Final authorization replays | One attempted fresh full-input exact replay for an incumbent replacement |

Each replay kind also records its applicable rejection count. An executed replay
attempt consumes one unit even when exact replay rejects it. Counters are cumulative
for the whole request and are never reset or recharged at a stage or helper boundary.
There is no universal work scalar and no conversion between graph expansions and
exact replays without a separately accepted cost model.

Exhausting one per-kind cap closes only that work stage. Later stages may continue
only from fully materialized inputs. In particular, candidate-set enumeration uses
the full path list materialized by discovery, not only the prefix exact-replayed by
the best-single stage. If any deterministic cap closes a stage, the overall
deterministic termination records `work-limit`, even when later eligible stages
finish. Interruption or deadline termination stops the entire request.

### Cooperative stop boundaries and atomic units

The same boundary protocol applies before every:

- path expansion;
- best-single candidate replay;
- candidate-set expansion;
- equal proposal replay;
- greedy option replay; and
- final authorization replay.

At each boundary, the runtime performs these steps in exact priority order:

1. determine whether the next unit exists or the stage is complete;
2. apply the relevant cumulative per-kind cap;
3. invoke the interruption callback;
4. sample the injected monotonic clock and compare it with the absolute deadline;
5. execute the unit atomically and account for its result.

A completed stage does not invoke a stop control merely to discover that it has no
next unit. A cap stop therefore precedes user interruption and deadline observation
for that unit; interruption precedes the clock sample. A replay contains no internal
cooperative stop. On interruption, deadline, cap exhaustion, or replay rejection,
no partial replay, allocation, receipt, or plan escapes. The result contains only
the prior fully authorized exact incumbent or the applicable typed no-plan outcome.

Runtime dependency failures use these public error types:

```ts
export type ExactInputSplitRuntimeControlError =
  | { readonly code: 'interruption-check-failed' }
  | { readonly code: 'invalid-interruption-result' };

export type ExactInputSplitRuntimeDeadlineError =
  | {
      readonly code: 'deadline-clock-failed';
      readonly field: 'nowNanoseconds';
    }
  | {
      readonly code: 'deadline-clock-regressed';
      readonly field: 'nowNanoseconds';
    };
```

If the callback throws, the runtime returns `interruption-check-failed`; if it
returns a non-boolean, the runtime returns `invalid-interruption-result`. A callback
result of `false` proceeds to the deadline check. A result of `true` terminates as
`interrupted` without sampling the clock.

If the clock throws or returns a non-`bigint` or negative value, the runtime returns
`deadline-clock-failed`. If a sample is below the prior sample for the same request,
it returns `deadline-clock-regressed`. A dependency error never throws through the
runtime and does not execute or account the pending unit. It preserves the unchanged
pre-unit counters and prior fully authorized incumbent, or `null` when none exists.

### Runtime result contract

The additive result and entry-point declarations are:

```ts
export type ExactInputSplitRuntimeTermination =
  | 'complete'
  | 'work-limit'
  | 'interrupted'
  | 'deadline'
  | 'control-error'
  | 'deadline-error';

export interface ExactInputSplitRuntimeSearchSummary {
  readonly counters: ExactInputSplitWorkCounters;
  readonly termination: ExactInputSplitRuntimeTermination;
}

export interface ExactInputSplitRuntimePlan {
  readonly receipt: ExactInputSplitReplayReceipt;
  readonly search: ExactInputSplitRuntimeSearchSummary;
}

export type ExactInputSplitRuntimeResult =
  | { readonly status: 'success'; readonly plan: ExactInputSplitRuntimePlan }
  | {
      readonly status: 'no-route';
      readonly reason: 'no-candidate' | 'all-candidates-rejected';
      readonly search: ExactInputSplitRuntimeSearchSummary;
    }
  | {
      readonly status: 'no-plan';
      readonly reason: 'work-limit' | 'interrupted' | 'deadline';
      readonly search: ExactInputSplitRuntimeSearchSummary;
    }
  | {
      readonly status: 'invalid-request';
      readonly error: ExactInputSplitRuntimeValidationError;
    }
  | {
      readonly status: 'invalid-control';
      readonly error: ExactInputSplitRuntimeControlValidationError;
    }
  | {
      readonly status: 'control-error';
      readonly error: ExactInputSplitRuntimeControlError;
      readonly incumbent: ExactInputSplitReplayReceipt | null;
      readonly search: ExactInputSplitRuntimeSearchSummary;
    }
  | {
      readonly status: 'deadline-error';
      readonly error: ExactInputSplitRuntimeDeadlineError;
      readonly incumbent: ExactInputSplitReplayReceipt | null;
      readonly search: ExactInputSplitRuntimeSearchSummary;
    };

export declare function routeExactInputSplitAnytime(
  context: PreparedRoutingContext,
  request: ExactInputSplitRuntimeRequest,
  control: ExactInputSplitRuntimeControl,
): ExactInputSplitRuntimeResult;
```

`success` includes `complete`, `work-limit`, `interrupted`, or `deadline` termination
when a prior fully authorized incumbent exists. `no-route` is returned only after
`complete` work; `no-plan` is used for a work-limit, interruption, or deadline when
there is no incumbent. Control and deadline dependency failures always retain their
own status, use the matching `control-error` or `deadline-error` search termination,
and return the prior authorized incumbent separately when one exists rather than
converting the error to success. No result exposes a partial replay or proposal.

### Split proposals, authorization, and objective

The runtime preserves the complete accepted split objective: greater exact summed
output, fewer positive legs, fewer total hops, the lexicographically smaller
canonical route-key sequence, and then the numerically lexicographically smaller
exact allocation vector. Incumbent quality is monotonic under that complete tuple;
equal and greedy stages may only improve it.

Equal proposal receipts and greedy option/scoring receipts are non-authorizing.
This remains true when an equal proposal or a final greedy score happens to cover
the full requested input. Every proposed replacement requires a distinct, metered,
fresh full-input exact replay against the prepared snapshot in the final
authorization stage. Only a successful authorization receipt may replace the
incumbent, and only when it is strictly better under the complete objective. A
failed, capped, interrupted, or deadline-stopped authorization preserves the prior
incumbent.

### Additive canonical split records

Canonical split evidence uses a new additive schema family:

- `routelab.split-router-run.v1`;
- `routelab.split-router-case.v1`.

Split run/case v1 canonicalizes only deterministic executions whose `complete` or
`work-limit` termination is fixed by the typed caps. Their semantic hash includes
deterministic snapshot identity/content, request, configuration, per-kind caps,
cumulative counters, termination, and exact result. Canonical fixed evidence is
therefore cap-driven rather than wall-clock or callback-scheduling driven.

Interruption- or deadline-driven outcomes and their termination labels remain
operational. They receive no split-v1 determinism hash and are not split-v1 canonical
run/case values. Merely excluding elapsed timing, clock samples, deadline
observations, interruption observations, or other operational observations does not
make such an outcome semantic or hashable.

The existing `routelab.router-run.v1` and `routelab.router-case.v1` family remains
single-path-only. Its JSON, canonical bytes, hashes, fixtures, and zero-expansion
behavior do not change. All other existing public API behavior remains compatible.

### Resume and milestone boundary

This gate adds no process-local split checkpoint, serialized split checkpoint, or
cross-process split resume. Those capabilities require a later explicit contract if
needed.

RLT-053 produces only this contract and the narrow invariant amendments. RLT-054
must implement the verified prepared context and shared discovery, RLT-055 must
implement the composed anytime split runtime, and RLT-056 must add the split record
family, fixed replay cases, replay command, and executable demo. Milestone 6 data and
evaluation remain blocked until all three tasks integrate and a cumulative review
returns `INTEGRATION GATE COMPLETE`.

## Consequences

- The high-level runtime gains a single checksum trust boundary, one shared
  structural result, and truthful non-recharged controls.
- Work limits remain comparable only within their typed kinds. The contract makes
  no claim that an expansion and an exact replay have equal cost.
- A direct eligible incumbent survives a zero discretionary budget or an already
  reached first deadline, while requests without an eligible direct route retain
  typed no-plan behavior until an exact candidate is authorized.
- Structural paths may feed later split proposals without first becoming exact
  best-single receipts; every financial proposal still crosses its own exact replay
  and distinct authorization boundaries.
- Legacy callers and canonical single-path evidence remain stable during additive
  implementation.
- No performance, unrestricted optimality, production execution, data, numerical
  allocation, acceleration, service, protocol, or learned-ordering claim follows
  from this decision.
