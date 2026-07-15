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
  readonly planKind: 'single' | 'split';
  readonly termination: 'complete' | 'work-limit' | 'deadline' | 'interrupted';
  readonly work: Readonly<Record<string, number>>;
  readonly semanticFingerprint: string;
  readonly timing?: {
    readonly elapsedMicros: number;
  };
  readonly diagnostics?: {
    readonly pathExpansions: number;
    readonly candidateSetExpansions: number;
    readonly numericalIterations: number;
    readonly numericalConverged: boolean | null;
    readonly authorizationRejections: number;
  };
}

export type QuoteResult =
  | { readonly ok: true; readonly value: ValidatedQuote }
  | { readonly ok: false; readonly error: QuoteError };
```

`RoutingContext` should be nominal or otherwise opaque so callers cannot fabricate one.

`quote()` is synchronous in v0.1 because the retained core is CPU-bound and synchronous. The HTTP benchmark must measure the event-loop consequence rather than hiding it. Worker isolation is a later measured decision.

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

A caller may optionally provide `deadlineMs`. The deadline is a stop boundary; deterministic work profiles remain the basis of semantic comparison.

## Semantic versus observational fields

Semantic fields:

- snapshot ID/checksum;
- request;
- routes and allocations;
- exact output;
- strategy;
- termination;
- deterministic work counters.

Observational fields:

- elapsed time;
- host/runtime information;
- queue time;
- event-loop delay;
- memory.

The semantic fingerprint excludes observational fields.

## Service boundary

The HTTP server owns:

- loaded snapshots;
- request-body limit;
- identifier lengths;
- exact amount length;
- maximum hops/routes;
- allowed effort profiles;
- maximum deadline;
- diagnostics exposure.

The service does not accept raw internal work caps.

The server stays local/offline for v0.1. A network adapter may be added later without changing the router.

## NEAR Intents boundary

The official NEAR Intents Market Maker/Message Bus documentation was checked on 2026-07-15. The
fixture adapter accepts `defuse_asset_identifier_in`, `defuse_asset_identifier_out`,
`exact_amount_in`, and `min_deadline_ms`. An explicit fictional asset map produces a bounded
`QuoteRequest`; `min_deadline_ms` remains candidate-validity metadata and is not repurposed as a
router work deadline. The adapter returns an unsigned quote candidate and is available only as
the `routelab-ts/near-intents-fixture` package subpath.

It does not:

- manage partner authentication;
- open a Message Bus WebSocket;
- sign NEP-413 payloads;
- inspect solver balances;
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
