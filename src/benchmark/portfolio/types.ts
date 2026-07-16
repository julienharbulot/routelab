import type { LiquiditySnapshot } from '../../domain/index.ts';
import type { EvidenceSourceIdentity } from '../../evidence/source-identity.ts';
import type { PreparedRoutingContext } from '../../runtime/prepared-routing-context/index.ts';
import type {
  QuoteEffort,
  QuoteRequest,
  RoutingContext,
} from '../../index.ts';
import type {
  SyntheticRequestAmountBucket,
  SyntheticRequestTopology,
} from '../../verification/synthetic-request-corpus/index.ts';

export type BenchmarkProfile = QuoteEffort | 'large-budget';
export type BenchmarkStrategy =
  | 'best-single'
  | 'greedy-split'
  | 'numerical-split'
  | 'large-budget-comparison';
export type AggregateDimension = 'overall' | 'amountBucket' | 'topology';

export type BenchmarkCounter =
  | 'pathExpansions'
  | 'candidateSetExpansions'
  | 'greedyOptionReplays'
  | 'finalAuthorizationReplays'
  | 'numericalProposals'
  | 'numericalIterations'
  | 'numericalAuthorizationReplays';

export interface CounterPercentiles {
  readonly p50: number | null;
  readonly p95: number | null;
}

export interface PortfolioCase {
  readonly caseId: string;
  readonly purpose: string;
  readonly amountBucket: SyntheticRequestAmountBucket;
  readonly topology: SyntheticRequestTopology;
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
  readonly numericalProposalAttemptedCount: number;
  readonly numericalProposalConvergedCount: number;
  readonly numericalProposalFailedCount: number;
  readonly numericalIterations: number;
  readonly allProposalsConverged: boolean | null;
  readonly numericalImprovementSelected: boolean;
  readonly authorizationRejections: number;
  readonly planFingerprint: string;
}

export type ExactBenchmarkOutcome =
  | { readonly outcome: 'quote'; readonly value: ExactBenchmarkQuote }
  | { readonly outcome: 'no-route' };

export interface QualityRow {
  readonly caseId: string;
  readonly amountBucket: SyntheticRequestAmountBucket;
  readonly topology: SyntheticRequestTopology;
  readonly strategy: BenchmarkStrategy;
  readonly profile: BenchmarkProfile;
  readonly outcome: 'quote' | 'no-route';
  readonly amountIn: string;
  readonly amountOut: string | null;
  readonly largeBudgetAmountOut: string | null;
  readonly comparisonAmountOut: string | null;
  readonly exactReplayPassed: boolean;
  readonly exactLargeBudgetEquality: boolean;
  readonly regretPpm: number | null;
  readonly within1Bps: boolean;
  readonly within10Bps: boolean;
  readonly within100Bps: boolean;
  readonly improvementOverBestSinglePpm: number | null;
  readonly bestSingleImproved: boolean;
  readonly splitSelected: boolean;
  readonly splitImproved: boolean;
  readonly routeCount: number;
  readonly hopCount: number;
  readonly termination: string;
  readonly work: Readonly<Record<string, number>>;
  readonly numericalProposalAttemptedCount: number;
  readonly numericalProposalConvergedCount: number;
  readonly numericalProposalFailedCount: number;
  readonly numericalIterations: number;
  readonly allProposalsConverged: boolean | null;
  readonly numericalImprovementSelected: boolean;
  readonly authorizationRejections: number;
  readonly largeBudgetBeaten: boolean;
  readonly planFingerprint: string | null;
  readonly routes: readonly SerializedBenchmarkRoute[];
}

export interface QualityAggregate {
  readonly dimension: AggregateDimension;
  readonly group: string;
  readonly strategy: BenchmarkStrategy;
  readonly profile: BenchmarkProfile;
  readonly requestCount: number;
  readonly quoteCount: number;
  readonly noRouteCount: number;
  readonly exactReplaySuccessCount: number;
  readonly exactLargeBudgetEqualityCount: number;
  readonly regretP50Ppm: number | null;
  readonly regretP90Ppm: number | null;
  readonly regretP95Ppm: number | null;
  readonly worstRegretPpm: number | null;
  readonly withinExactRatePpm: number | null;
  readonly within1BpsRatePpm: number | null;
  readonly within10BpsRatePpm: number | null;
  readonly within100BpsRatePpm: number | null;
  readonly bestSingleImprovementRatePpm: number | null;
  readonly splitSelectedRatePpm: number | null;
  readonly splitImprovementRatePpm: number | null;
  readonly medianImprovementPpm: number | null;
  readonly maximumImprovementPpm: number | null;
  readonly counterPercentiles: Readonly<Record<BenchmarkCounter, CounterPercentiles>>;
  readonly authorizationRejectionCount: number;
  readonly numericalProposalAttemptedCount: number;
  readonly numericalProposalConvergedCount: number;
  readonly numericalProposalFailedCount: number;
  readonly numericalRequestCount: number;
  readonly allProposalsConvergedRequestCount: number;
  readonly exactNumericalImprovementSelectedCount: number;
  readonly largeBudgetBeatenCount: number;
}

export interface NumericalComparison {
  readonly dimension: AggregateDimension;
  readonly group: string;
  readonly profile: QuoteEffort;
  readonly requestCount: number;
  readonly beatsGreedy: number;
  readonly tiesGreedy: number;
  readonly losesGreedy: number;
  readonly medianPositiveImprovementPpm: number | null;
  readonly maximumPositiveImprovementPpm: number | null;
}

export interface LatencyDistribution {
  readonly samples: number;
  readonly p50Micros: number;
  readonly p95Micros: number;
  readonly p99Micros: number | null;
  readonly minMicros: number;
  readonly maxMicros: number;
}

export interface LatencyRow {
  readonly strategy: 'best-single' | 'greedy-split' | 'numerical-split';
  readonly profile: QuoteEffort;
  readonly warmups: number;
  readonly samples: number;
  readonly quoteCount: number;
  readonly noRouteCount: number;
  readonly quote: LatencyDistribution | null;
  readonly noRoute: LatencyDistribution | null;
  readonly throughputPerSecond: number;
}

export interface BenchmarkEnvironment {
  readonly observedAt: string;
  readonly node: string;
  readonly platform: string;
  readonly arch: string;
  readonly cpu: string;
  readonly commit: string;
}

export interface BenchmarkSummary {
  readonly schemaVersion: 'routelab.portfolio-benchmark-summary.v2';
  readonly evidenceSource: EvidenceSourceIdentity;
  readonly corpus: {
    readonly schemaVersion: 'routelab.synthetic-request-corpus-verification-summary.v1';
    readonly corpusId: string;
    readonly datasetId: string;
    readonly snapshotId: string;
    readonly snapshotChecksum: string;
    readonly artifactSha256: string;
    readonly requestCount: number;
    readonly amountBucketCount: number;
    readonly directRequestCount: number;
    readonly multiHopOnlyRequestCount: number;
    readonly randomness: 'none';
  };
  readonly configuration: {
    readonly maxHops: 2;
    readonly maxRoutes: 2;
    readonly warmupsPerLatencyLane: number;
    readonly samplesPerLatencyLane: number;
    readonly profiles: Readonly<Record<BenchmarkProfile, unknown>>;
    readonly qualityModes: readonly {
      readonly strategy: BenchmarkStrategy;
      readonly profile: BenchmarkProfile;
    }[];
    readonly latencyCombinations: readonly {
      readonly strategy: 'best-single' | 'greedy-split' | 'numerical-split';
      readonly profile: QuoteEffort;
    }[];
    readonly comparisonRule: 'best-observed-exact-output-across-all-fixed-modes';
  };
  readonly digests: {
    readonly requestOrderSha256: string;
    readonly qualityRowsSha256: string;
    readonly qualityAggregatesSha256: string;
    readonly numericalComparisonsSha256: string;
  };
  readonly quality: {
    readonly rowCount: number;
    readonly exactReplaySuccessCount: number;
    readonly largeBudgetBeatenCount: number;
    readonly largeBudgetBeatenRequestCount: number;
    readonly largeBudgetBeatenByMode: readonly {
      readonly strategy: BenchmarkStrategy;
      readonly profile: BenchmarkProfile;
      readonly count: number;
    }[];
    readonly aggregates: readonly QualityAggregate[];
    readonly numericalComparisons: readonly NumericalComparison[];
  };
  readonly environment: BenchmarkEnvironment;
  readonly latency: readonly LatencyRow[];
}
