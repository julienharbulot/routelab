import type {
  advancePathShadowPriceProposal,
  finalizePathShadowPriceProposal,
  preparePathShadowPriceProposal,
  PathShadowPriceConfigurationError,
  PathShadowPriceCoreFailureCode,
} from '../../allocation/path-shadow-price/index.ts';
import type {
  ExactInputSplitReplayRequest,
  ExactInputSplitReplayResult,
  ExactInputSplitReplayReceipt,
} from '../../replay/exact-input-split/index.ts';
import type {
  ExactInputSplitRuntimeControlError,
  ExactInputSplitRuntimeControlValidationError,
  ExactInputSplitRuntimeDeadlineControl,
  ExactInputSplitRuntimeDeadlineError,
  ExactInputSplitRuntimeRequest,
  ExactInputSplitRuntimeTermination,
  ExactInputSplitRuntimeValidationError,
  ExactInputSplitRuntimeWorkKind,
  ExactInputSplitWorkCaps,
  ExactInputSplitWorkCounters,
} from '../anytime-exact-input-split/index.ts';
import type { PreparedRoutingContext } from '../../runtime/prepared-routing-context/index.ts';

export interface NumericalExactInputSplitConfiguration {
  readonly outerIterations: number;
  readonly innerIterations: number;
  readonly convergenceTolerance: number;
}

export interface NumericalExactInputSplitRuntimeRequest
  extends ExactInputSplitRuntimeRequest {
  readonly numerical: NumericalExactInputSplitConfiguration;
}

export type NumericalExactInputSplitRuntimeValidationError =
  | ExactInputSplitRuntimeValidationError
  | PathShadowPriceConfigurationError;

export interface NumericalExactInputSplitWorkCaps extends ExactInputSplitWorkCaps {
  readonly maxNumericalProposals: number;
  readonly maxNumericalIterations: number;
  readonly maxNumericalResidualReplays: number;
  readonly maxNumericalAuthorizationReplays: number;
}

export interface NumericalExactInputSplitWorkCounters
  extends ExactInputSplitWorkCounters {
  readonly numericalProposals: number;
  readonly numericalProposalFailures: number;
  readonly numericalIterations: number;
  readonly numericalResidualReplays: number;
  readonly numericalResidualReplayRejections: number;
  readonly numericalAuthorizationReplays: number;
  readonly numericalAuthorizationReplayRejections: number;
}

export type NumericalExactInputSplitRuntimeWorkKind =
  | ExactInputSplitRuntimeWorkKind
  | 'numerical-proposal'
  | 'numerical-iteration'
  | 'numerical-residual-replay'
  | 'numerical-authorization-replay';

export interface NumericalExactInputSplitRuntimeCheckpoint {
  readonly nextWorkKind: NumericalExactInputSplitRuntimeWorkKind;
  readonly counters: NumericalExactInputSplitWorkCounters;
  readonly incumbent: ExactInputSplitReplayReceipt | null;
}

export interface NumericalExactInputSplitRuntimeControl {
  readonly workCaps: NumericalExactInputSplitWorkCaps;
  readonly shouldInterrupt?: (
    checkpoint: NumericalExactInputSplitRuntimeCheckpoint,
  ) => boolean;
  readonly deadline?: ExactInputSplitRuntimeDeadlineControl;
}

export type NumericalExactInputSplitRuntimeControlValidationError =
  | ExactInputSplitRuntimeControlValidationError
  | {
      readonly code: 'invalid-work-cap';
      readonly field:
        | 'workCaps.maxNumericalProposals'
        | 'workCaps.maxNumericalIterations'
        | 'workCaps.maxNumericalResidualReplays'
        | 'workCaps.maxNumericalAuthorizationReplays';
    };

export type NumericalExactInputSplitFailureCode =
  | PathShadowPriceCoreFailureCode
  | 'residual-options-exhausted'
  | 'authorization-replay-rejected'
  | 'authorization-result-mismatch';

export interface NumericalExactInputSplitCandidateCounters {
  readonly numericalProposals: number;
  readonly numericalProposalFailures: number;
  readonly numericalIterations: number;
  readonly numericalResidualReplays: number;
  readonly numericalResidualReplayRejections: number;
  readonly numericalAuthorizationReplays: number;
  readonly numericalAuthorizationReplayRejections: number;
}

export interface NumericalExactInputSplitDiagnostic {
  readonly candidateSetKey: string;
  readonly routeKeys: readonly string[];
  readonly status: 'improved' | 'not-better' | 'failed' | 'stopped';
  readonly failureCode: NumericalExactInputSplitFailureCode | null;
  readonly converged: boolean;
  readonly completedOuterIterations: number;
  readonly configuredInnerIterations: number;
  readonly residualUnits: bigint | null;
  readonly counters: NumericalExactInputSplitCandidateCounters;
}

export interface NumericalExactInputSplitRuntimeSearchSummary {
  readonly counters: NumericalExactInputSplitWorkCounters;
  readonly termination: ExactInputSplitRuntimeTermination;
  readonly numericalDiagnostics: readonly NumericalExactInputSplitDiagnostic[];
}

export interface NumericalExactInputSplitRuntimePlan {
  readonly receipt: ExactInputSplitReplayReceipt;
  readonly search: NumericalExactInputSplitRuntimeSearchSummary;
}

export type NumericalExactInputSplitRuntimeResult =
  | { readonly status: 'success'; readonly plan: NumericalExactInputSplitRuntimePlan }
  | {
      readonly status: 'no-route';
      readonly reason: 'no-candidate' | 'all-candidates-rejected';
      readonly search: NumericalExactInputSplitRuntimeSearchSummary;
    }
  | {
      readonly status: 'no-plan';
      readonly reason: 'work-limit' | 'interrupted' | 'deadline';
      readonly search: NumericalExactInputSplitRuntimeSearchSummary;
    }
  | {
      readonly status: 'invalid-request';
      readonly error: NumericalExactInputSplitRuntimeValidationError;
    }
  | {
      readonly status: 'invalid-control';
      readonly error: NumericalExactInputSplitRuntimeControlValidationError;
    }
  | {
      readonly status: 'control-error';
      readonly error: ExactInputSplitRuntimeControlError;
      readonly incumbent: ExactInputSplitReplayReceipt | null;
      readonly search: NumericalExactInputSplitRuntimeSearchSummary;
    }
  | {
      readonly status: 'deadline-error';
      readonly error: ExactInputSplitRuntimeDeadlineError;
      readonly incumbent: ExactInputSplitReplayReceipt | null;
      readonly search: NumericalExactInputSplitRuntimeSearchSummary;
    };

/** @internal */
export type NumericalExactInputSplitAuthorizationReplay = (
  context: PreparedRoutingContext,
  request: ExactInputSplitReplayRequest,
) => ExactInputSplitReplayResult;

/** @internal */
export interface NumericalExactInputSplitProposalDriver {
  readonly prepare: typeof preparePathShadowPriceProposal;
  readonly advance: typeof advancePathShadowPriceProposal;
  readonly finalize: typeof finalizePathShadowPriceProposal;
}
