import type { LiquiditySnapshot } from '../../domain/index.ts';
import type { PreparedRoutingContext } from '../../runtime/prepared-routing-context/index.ts';
import type {
  QuoteEffort,
  QuoteRequest,
  QuoteStrategy,
  RoutingContext,
} from '../../index.ts';

export type BenchmarkProfile = QuoteEffort | 'reference';
export type BenchmarkStrategy = QuoteStrategy | 'numerical-reference';

export interface PortfolioCase {
  readonly caseId: string;
  readonly purpose: string;
  readonly snapshot: LiquiditySnapshot;
  readonly context: RoutingContext;
  readonly prepared: PreparedRoutingContext;
  readonly request: QuoteRequest;
  readonly expectedOutcome: 'quote' | 'no-route';
}

export interface SerializedBenchmarkRoute {
  readonly allocation: string;
  readonly amountOut: string;
  readonly hops: readonly {
    readonly poolId: string;
    readonly assetIn: string;
    readonly assetOut: string;
  }[];
}

export interface ExactBenchmarkQuote {
  readonly amountOut: bigint;
  readonly routes: readonly {
    readonly allocation: bigint;
    readonly amountOut: bigint;
    readonly hops: readonly {
      readonly poolId: string;
      readonly assetIn: string;
      readonly assetOut: string;
    }[];
  }[];
  readonly termination: string;
  readonly work: Readonly<Record<string, number>>;
  readonly numericalProposals: number;
  readonly numericalIterations: number;
  readonly numericalConverged: boolean | null;
  readonly authorizationRejections: number;
  readonly semanticFingerprint: string;
}

export type ExactBenchmarkOutcome =
  | { readonly outcome: 'quote'; readonly value: ExactBenchmarkQuote }
  | { readonly outcome: 'no-route' };

export interface QualityRow {
  readonly caseId: string;
  readonly strategy: BenchmarkStrategy;
  readonly profile: BenchmarkProfile;
  readonly outcome: 'quote' | 'no-route';
  readonly amountIn: string;
  readonly amountOut: string | null;
  readonly improvementOverBestSingle: string | null;
  readonly regretBps: number | null;
  readonly routeCount: number;
  readonly hopCount: number;
  readonly termination: string;
  readonly work: Readonly<Record<string, number>>;
  readonly numericalProposals: number;
  readonly numericalIterations: number;
  readonly numericalConverged: boolean | null;
  readonly authorizationRejections: number;
  readonly semanticFingerprint: string | null;
  readonly routes: readonly SerializedBenchmarkRoute[];
}

export interface QualityAggregate {
  readonly strategy: BenchmarkStrategy;
  readonly profile: BenchmarkProfile;
  readonly quoteCount: number;
  readonly noRouteCount: number;
  readonly medianRegretBps: number | null;
  readonly worstRegretBps: number | null;
  readonly splitImprovementCount: number;
  readonly authorizationRejections: number;
  readonly authorizationRejectionRate: number;
  readonly totalWork: number;
}

export interface NumericalComparison {
  readonly profile: QuoteEffort;
  readonly beatsGreedy: number;
  readonly tiesGreedy: number;
  readonly losesGreedy: number;
}

export interface LatencyRow {
  readonly strategy: QuoteStrategy;
  readonly profile: QuoteEffort;
  readonly warmups: number;
  readonly samples: number;
  readonly successful: number;
  readonly expectedNoRoute: number;
  readonly p50Micros: number;
  readonly p95Micros: number;
  readonly p99Micros: number;
  readonly minMicros: number;
  readonly maxMicros: number;
  readonly throughputPerSecond: number;
}

export interface HttpLoadRow {
  readonly concurrency: number;
  readonly requests: number;
  readonly completed: number;
  readonly failed: number;
  readonly timedOut: number;
  readonly p50Micros: number;
  readonly p95Micros: number;
  readonly p99Micros: number | null;
  readonly throughputPerSecond: number;
  readonly deadlineCompletionRate: number;
  readonly eventLoopDelayMeanMicros: number;
  readonly eventLoopDelayMaxMicros: number;
  readonly initialRssBytes: number;
  readonly peakRssBytes: number;
  readonly rssDeltaBytes: number;
}

export interface BenchmarkEnvironment {
  readonly observedAt: string;
  readonly node: string;
  readonly platform: string;
  readonly arch: string;
  readonly cpu: string;
  readonly commit: string;
}

export interface BenchmarkReport {
  readonly schemaVersion: 'routelab.portfolio-benchmark.v1';
  readonly caseSetId: 'portfolio-v1';
  readonly configuration: {
    readonly caseCount: number;
    readonly warmups: number;
    readonly samples: number;
    readonly profiles: Readonly<Record<BenchmarkProfile, unknown>>;
    readonly latencyCombinations: readonly {
      readonly strategy: QuoteStrategy;
      readonly profile: QuoteEffort;
    }[];
  };
  readonly environment: BenchmarkEnvironment;
  readonly cases: readonly {
    readonly caseId: string;
    readonly purpose: string;
    readonly snapshotId: string;
    readonly snapshotChecksum: string;
    readonly assetIn: string;
    readonly assetOut: string;
    readonly amountIn: string;
    readonly maxHops: number;
    readonly maxRoutes: number;
    readonly expectedOutcome: 'quote' | 'no-route';
  }[];
  readonly quality: readonly QualityRow[];
  readonly aggregates: readonly QualityAggregate[];
  readonly numericalComparisons: readonly NumericalComparison[];
  readonly latency: readonly LatencyRow[];
}
