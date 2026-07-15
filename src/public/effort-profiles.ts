import type { NumericalExactInputSplitConfiguration } from '../router/numerical-exact-input-split/index.ts';
import type { NumericalExactInputSplitWorkCaps } from '../router/numerical-exact-input-split/index.ts';
import type { QuoteEffort } from './types.ts';

interface EffortProfile {
  readonly greedyParts: number;
  readonly workCaps: NumericalExactInputSplitWorkCaps;
  readonly numerical: NumericalExactInputSplitConfiguration;
}

function profile(
  greedyParts: number,
  structuralCap: number,
  greedyCap: number,
  numericalCap: number,
  outerIterations: number,
  innerIterations: number,
  convergenceTolerance: number,
): EffortProfile {
  return Object.freeze({
    greedyParts,
    workCaps: Object.freeze({
      maxPathExpansions: structuralCap,
      maxBestSingleCandidateReplays: structuralCap,
      maxCandidateSetExpansions: structuralCap,
      maxEqualProposalReplays: structuralCap,
      maxGreedyOptionReplays: greedyCap,
      maxFinalAuthorizationReplays: structuralCap,
      maxNumericalProposals: numericalCap,
      maxNumericalIterations: numericalCap * outerIterations,
      maxNumericalResidualReplays: numericalCap * 4,
      maxNumericalAuthorizationReplays: numericalCap,
    }),
    numerical: Object.freeze({
      outerIterations,
      innerIterations,
      convergenceTolerance,
    }),
  });
}

const EFFORT_PROFILES: Readonly<Record<QuoteEffort, EffortProfile>> = Object.freeze({
  fast: profile(8, 2_000, 4_000, 64, 16, 16, 2 ** -32),
  balanced: profile(16, 20_000, 40_000, 256, 64, 32, 2 ** -40),
  thorough: profile(64, 200_000, 400_000, 2_048, 128, 64, 2 ** -48),
});

export function effortProfile(effort: QuoteEffort): EffortProfile {
  return EFFORT_PROFILES[effort];
}

export function publicEffortProfileConfiguration(): Readonly<Record<QuoteEffort, EffortProfile>> {
  return EFFORT_PROFILES;
}
