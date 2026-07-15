declare const routingContextBrand: unique symbol;

export interface RoutingContext {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly [routingContextBrand]: typeof routingContextBrand;
}

export type QuoteStrategy = 'best-single' | 'greedy-split' | 'numerical-split';
export type QuoteEffort = 'fast' | 'balanced' | 'thorough';
export type QuoteTermination = 'complete' | 'work-limit' | 'deadline' | 'interrupted';

export interface QuoteRequest {
  readonly snapshotId: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly maxHops?: number;
  readonly maxRoutes?: number;
}

export interface QuoteOptions {
  readonly strategy?: QuoteStrategy;
  readonly effort?: QuoteEffort;
  /** Relative monotonic wall-clock stop budget from quote invocation, in whole milliseconds. */
  readonly deadlineMs?: number;
  readonly includeDiagnostics?: boolean;
}

export interface AssetDisplayMetadata {
  readonly symbol: string;
  readonly decimals: number;
}

export interface FormatQuoteOptions {
  readonly assetMetadata?: Readonly<Record<string, AssetDisplayMetadata>>;
  readonly bestSingleAmountOut?: bigint;
  readonly raw?: boolean;
}

export interface QuoteHop {
  readonly poolId: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
}

export interface QuoteRoute {
  readonly allocation: bigint;
  readonly amountOut: bigint;
  readonly hops: readonly QuoteHop[];
}

export interface QuoteDiagnostics {
  readonly work: Readonly<Record<string, number>>;
  readonly pathExpansions: number;
  readonly candidateSetExpansions: number;
  readonly numericalProposals: number;
  readonly numericalIterations: number;
  readonly numericalConverged: boolean | null;
  readonly numericalFailures: number;
  readonly numericalOutcome: 'improved' | 'not-better' | 'failed' | 'stopped' | 'not-applicable';
  readonly authorizationRejections: number;
}

export interface ValidatedQuote {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly routes: readonly QuoteRoute[];
  readonly requestedStrategy: QuoteStrategy;
  readonly effort: QuoteEffort;
  readonly planKind: 'single' | 'split';
  readonly numericalImprovementSelected?: boolean;
  readonly termination: QuoteTermination;
  readonly planFingerprint: string;
  readonly timing: {
    readonly elapsedMicros: number;
  };
  readonly diagnostics?: QuoteDiagnostics;
}

export type QuoteError =
  | {
      readonly code: 'invalid-request';
      readonly field: string;
      readonly message: string;
    }
  | { readonly code: 'snapshot-mismatch'; readonly message: string }
  | { readonly code: 'no-route'; readonly message: string }
  | { readonly code: 'deadline-before-plan'; readonly message: string }
  | { readonly code: 'dependency-failure'; readonly message: string }
  | { readonly code: 'internal-invariant-failure'; readonly message: string };

export type QuoteResult =
  | { readonly ok: true; readonly value: ValidatedQuote }
  | { readonly ok: false; readonly error: QuoteError };

export type PrepareSnapshotError =
  | {
      readonly code: 'invalid-snapshot';
      readonly issues: readonly {
        readonly code: string;
        readonly path: string;
        readonly message: string;
      }[];
    }
  | {
      readonly code: 'snapshot-mismatch';
      readonly expected: string;
      readonly actual: string;
    };

export type PrepareSnapshotResult =
  | { readonly ok: true; readonly value: RoutingContext }
  | { readonly ok: false; readonly error: PrepareSnapshotError };

export interface SerializedQuoteHop {
  readonly poolId: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: string;
  readonly amountOut: string;
}

export interface SerializedQuoteRoute {
  readonly allocation: string;
  readonly amountOut: string;
  readonly hops: readonly SerializedQuoteHop[];
}

export interface SerializedQuote {
  readonly schemaVersion: 'routelab.quote.v1';
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: string;
  readonly amountOut: string;
  readonly routes: readonly SerializedQuoteRoute[];
  readonly requestedStrategy: QuoteStrategy;
  readonly effort: QuoteEffort;
  readonly planKind: 'single' | 'split';
  readonly numericalImprovementSelected?: boolean;
  readonly termination: QuoteTermination;
  readonly planFingerprint: string;
  readonly timing: { readonly elapsedMicros: number };
  readonly diagnostics?: QuoteDiagnostics;
}
