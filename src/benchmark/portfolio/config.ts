import { publicEffortProfileConfiguration } from '../../public/effort-profiles.ts';
import type {
  NumericalExactInputSplitConfiguration,
  NumericalExactInputSplitWorkCaps,
} from '../../router/numerical-exact-input-split/index.ts';
import type { QuoteEffort } from '../../index.ts';
import type { BenchmarkProfile, BenchmarkStrategy } from './types.ts';

export const BENCHMARK_WARMUPS = 50;
export const BENCHMARK_SAMPLES = 1_000;

export const PUBLIC_EFFORTS: readonly QuoteEffort[] = Object.freeze([
  'fast',
  'balanced',
  'thorough',
]);

export const QUALITY_MODES: readonly {
  readonly strategy: BenchmarkStrategy;
  readonly profile: BenchmarkProfile;
}[] = Object.freeze([
  Object.freeze({ strategy: 'best-single', profile: 'fast' }),
  ...PUBLIC_EFFORTS.map((profile) => Object.freeze({ strategy: 'greedy-split' as const, profile })),
  ...PUBLIC_EFFORTS.map((profile) => Object.freeze({ strategy: 'numerical-split' as const, profile })),
  Object.freeze({ strategy: 'bounded-reference', profile: 'reference' }),
]);

export const LATENCY_COMBINATIONS: readonly {
  readonly strategy: 'best-single' | 'greedy-split' | 'numerical-split';
  readonly profile: QuoteEffort;
}[] = Object.freeze([
  Object.freeze({ strategy: 'best-single', profile: 'fast' }),
  Object.freeze({ strategy: 'greedy-split', profile: 'fast' }),
  Object.freeze({ strategy: 'numerical-split', profile: 'fast' }),
  Object.freeze({ strategy: 'greedy-split', profile: 'balanced' }),
  Object.freeze({ strategy: 'numerical-split', profile: 'balanced' }),
]);

export interface ReferenceProfile {
  readonly greedyParts: number;
  readonly workCaps: NumericalExactInputSplitWorkCaps;
  readonly numerical: NumericalExactInputSplitConfiguration;
}

// One fixed profile, selected before observing PORT-008 results. It is deliberately
// larger than the public thorough profile but remains bounded and uses the same
// maxHops/maxRoutes restrictions as every public mode.
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
