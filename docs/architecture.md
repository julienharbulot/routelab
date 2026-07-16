# RouteLab TS v0.1 architecture

## Design goal

Keep the exact routing core, place one small facade in front of it, and add thin CLI, benchmark, HTTP, and intent-adapter boundaries.

The project is not a generalized solver platform. It is one well-factored exact-input router with observable behavior.

## Core data flow

```text
raw JSON snapshot
    |
    v
parseLiquiditySnapshot
    |
    v
checksum verification + prepare once
    |
    v
RoutingContext
    |
    +-------------------------------+
    | quote(request, options)       |
    |                               |
    |  best-single                  |
    |  greedy-split                 |
    |  numerical-split              |
    |       |                       |
    |       v                       |
    |  approximate proposal         |
    |       |                       |
    |       v                       |
    |  integer reconstruction       |
    |       |                       |
    |       v                       |
    |  fresh exact split replay     |
    +-------------------------------+
    |
    v
ValidatedQuote
    |
    +-> human formatter
    +-> decimal-string serializer
    +-> benchmark
    +-> local HTTP service
    +-> NEAR Intents fixture adapter
```

## Trust boundaries

### Raw input boundary

`prepareSnapshot(input: unknown)` performs schema/domain validation before preparation. A TypeScript cast is never treated as runtime validation.

### Numerical boundary

JavaScript `number` is allowed only inside explicitly approximate route modeling and shadow-price work. It does not appear in exact amounts, reserve transitions, allocations, or published exact output.

### Authorization boundary

Only a fresh exact replay can create a `ValidatedQuote`. The proposal and authorization phases remain distinct even when they are implemented in the same high-level call.

### Wire boundary

JSON amounts are canonical unsigned decimal strings. The public service rejects JSON numeric values for exact amounts.

## Public API shape

```ts
export interface RoutingContext {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  // Opaque implementation state.
}

export interface QuoteRequest {
  readonly snapshotId: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly maxHops?: number;
  readonly maxRoutes?: number;
}

export type QuoteStrategy =
  | 'best-single'
  | 'greedy-split'
  | 'numerical-split';

export type QuoteEffort = 'fast' | 'balanced' | 'thorough';

export interface QuoteOptions {
  readonly strategy?: QuoteStrategy;
  readonly effort?: QuoteEffort;
  // Relative monotonic wall-clock stop budget, not CPU time.
  readonly deadlineMs?: number;
  readonly includeDiagnostics?: boolean;
}

export interface ValidatedQuote {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly routes: readonly {
    readonly allocation: bigint;
    readonly hops: readonly {
      readonly poolId: string;
      readonly assetIn: string;
      readonly assetOut: string;
    }[];
  }[];
  readonly requestedStrategy: QuoteStrategy;
  readonly effort: QuoteEffort;
  readonly planKind: 'single' | 'split';
  readonly numericalImprovementSelected?: boolean;
  readonly termination: 'complete' | 'work-limit' | 'deadline' | 'interrupted';
  readonly planFingerprint: string;
  readonly timing: {
    readonly elapsedMicros: number;
  };
  readonly diagnostics?: {
    readonly work: Readonly<Record<string, number>>;
    readonly pathExpansions: number;
    readonly candidateSetExpansions: number;
    readonly numericalProposals: number;
    readonly numericalConvergedProposals: number;
    readonly numericalFailedProposals: number;
    readonly numericalIterations: number;
    readonly allProposalsConverged: boolean | null;
    readonly numericalOutcome: 'improved' | 'not-better' | 'failed' | 'stopped' | 'not-applicable';
    readonly authorizationRejections: number;
  };
}

export type QuoteResult =
  | { readonly ok: true; readonly value: ValidatedQuote }
  | { readonly ok: false; readonly error: QuoteError };
```

`RoutingContext` should be nominal or otherwise opaque so callers cannot fabricate one.

`quote()` remains synchronous and CPU-bound. The HTTP boundary can use a fixed worker pool: each worker prepares immutable snapshots once, messages carry canonical decimal strings, worker results pass a bounded required-field parser and request/snapshot match, and the main server retains bounded admission and queue/deadline policy. The retained service report records the predeclared same-run retention decision and its memory tradeoff.

The default is `greedy-split` with `balanced` effort. Numerical routing is explicit and benchmarked.

## Strategy mapping

### `best-single`

Use the composed anytime runtime with candidate-set and split work disabled after best-single discovery. Do not retain a second public single-path router solely for this mode.

### `greedy-split`

Use the composed anytime split runtime. It must maintain the exact best-single fallback.

### `numerical-split`

Use the numerical anytime runtime. It already includes the exact baseline and numerical authorization boundary. Numerical failure is diagnostic, not request failure, when a valid incumbent exists.

## Effort profiles

The public API exposes three named profiles rather than ten internal caps.

Each profile maps to one frozen internal configuration:

```text
fast       small path/candidate/allocation budget
balanced   default portfolio/service budget
thorough   larger offline or explicit user budget
```

The benchmark records the exact underlying caps. Do not tune a profile to individual benchmark cases.

A caller may optionally provide `deadlineMs`. It is measured from quote invocation using a monotonic clock and includes elapsed wall-clock time; it is not a CPU-time allowance. The deadline is a stop boundary, while deterministic work profiles remain the basis of semantic comparison.

## Plan identity versus execution metadata

`planFingerprint` hashes only:

- snapshot ID/checksum;
- request;
- routes and allocations;
- exact hop and final outputs.

The same exact executable plan has the same fingerprint even when it is found by a different strategy or effort profile. Strategy, effort, termination, numerical selection, and timing remain useful execution metadata but are not plan identity.

Raw deterministic work counters and detailed numerical outcome are opt-in diagnostics. This keeps internal counter names out of the always-present result contract.

Observational fields:

- elapsed time;
- host/runtime information;
- queue time;
- event-loop delay;
- memory.

Neither observational fields nor diagnostics affect the plan fingerprint.

## Service boundary

The HTTP server owns:

- loaded snapshots;
- request-body limit;
- identifier lengths;
- exact amount length;
- maximum hops/routes;
- allowed effort profiles;
- maximum deadline;
- maximum active and queued work;
- typed overload behavior;
- diagnostics exposure.

The service does not accept raw internal work caps.

The default CLI service uses four fixed workers and same-thread mode remains available for measurement. The retained comparison runs both modes sequentially in one invocation without reading a previous report; workers passed the frozen gate with their peak-RSS and event-loop costs reported. The server stays local/offline for v0.1; a network adapter may be added later without changing the router.

## NEAR Intents boundary

The official NEAR Intents Message Bus overview, JSON-RPC API, WebSocket reference, and example
solver were checked on 2026-07-16. The fixture keeps the public RPC parameter object distinct from
the solver event object: both use `defuse_asset_identifier_in`,
`defuse_asset_identifier_out`, `exact_amount_in`, and `min_deadline_ms`, while only the solver
event carries `quote_id`. Exact output is rejected with a typed unsupported error.

The explicit fictional asset map is bound to snapshot ID and checksum. Preparation rejects
duplicate external or internal IDs and mappings to assets absent from the parsed snapshot. Routing
still crosses only the public `quote()` facade. `min_deadline_ms` remains draft-validity metadata
and is not repurposed as a router work deadline.

The solver path returns `routelab.near-solver-quote-draft.v1`, an internal unsigned object that
preserves `quote_id`, proposed `amount_out`, a descriptive intended token difference, and the exact
plan fingerprint. It is not an official `quote_response`, which requires `signed_data`.

It does not:

- manage partner authentication;
- open a Message Bus WebSocket;
- sign NEP-413 payloads;
- inspect solver balances;
- create a nonce, quote hash, signature, or public key;
- submit intents;
- settle trades.

See the [fixture adapter boundary](../src/adapters/near-intents/README.md) for the checked official
documentation and exact exclusions.

This keeps the adapter useful as an integration seam and honest about its limits.

## Refactoring rule

First make behavior reachable through the facade. Then delete legacy entry points and split oversized files mechanically under parity tests.

Do not combine:

- public API design;
- numerical algorithm changes;
- performance tuning;
- worker-thread introduction;

in one commit.
