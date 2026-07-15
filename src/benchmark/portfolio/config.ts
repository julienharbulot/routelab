import { publicEffortProfileConfiguration } from '../../public/effort-profiles.ts';
import type {
  NumericalExactInputSplitConfiguration,
  NumericalExactInputSplitWorkCaps,
} from '../../router/numerical-exact-input-split/index.ts';
import type { QuoteEffort, QuoteStrategy } from '../../index.ts';
import type { BenchmarkProfile } from './types.ts';

export const BENCHMARK_CASE_SET_ID = 'portfolio-v1' as const;
export const BENCHMARK_WARMUPS = 10;
export const BENCHMARK_SAMPLES = 100;

export const PUBLIC_EFFORTS: readonly QuoteEffort[] = Object.freeze([
  'fast',
  'balanced',
  'thorough',
]);

export const PUBLIC_STRATEGIES: readonly QuoteStrategy[] = Object.freeze([
  'best-single',
  'greedy-split',
  'numerical-split',
]);

export const LATENCY_COMBINATIONS: readonly {
  readonly strategy: QuoteStrategy;
  readonly profile: QuoteEffort;
}[] = Object.freeze(PUBLIC_STRATEGIES.map((strategy) => Object.freeze({
  strategy,
  profile: 'fast' as const,
})));

export interface ReferenceProfile {
  readonly greedyParts: number;
  readonly workCaps: NumericalExactInputSplitWorkCaps;
  readonly numerical: NumericalExactInputSplitConfiguration;
}

export const REFERENCE_PROFILE: ReferenceProfile = Object.freeze({
  greedyParts: 128,
  workCaps: Object.freeze({
    maxPathExpansions: 1_000_000,
    maxBestSingleCandidateReplays: 1_000_000,
    maxCandidateSetExpansions: 1_000_000,
    maxEqualProposalReplays: 1_000_000,
    maxGreedyOptionReplays: 2_000_000,
    maxFinalAuthorizationReplays: 1_000_000,
    maxNumericalProposals: 4_096,
    maxNumericalIterations: 1_048_576,
    maxNumericalResidualReplays: 16_384,
    maxNumericalAuthorizationReplays: 4_096,
  }),
  numerical: Object.freeze({
    outerIterations: 256,
    innerIterations: 128,
    convergenceTolerance: 2 ** -52,
  }),
});

function serializeProfile(value: {
  readonly greedyParts: number;
  readonly workCaps: NumericalExactInputSplitWorkCaps;
  readonly numerical: NumericalExactInputSplitConfiguration;
}): unknown {
  return {
    greedyParts: value.greedyParts,
    workCaps: { ...value.workCaps },
    numerical: { ...value.numerical },
  };
}

export function benchmarkProfileConfiguration(): Readonly<Record<BenchmarkProfile, unknown>> {
  const profiles = publicEffortProfileConfiguration();
  return Object.freeze({
    fast: serializeProfile(profiles.fast),
    balanced: serializeProfile(profiles.balanced),
    thorough: serializeProfile(profiles.thorough),
    reference: serializeProfile(REFERENCE_PROFILE),
  });
}
