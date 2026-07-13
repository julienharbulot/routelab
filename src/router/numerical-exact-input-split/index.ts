import {
  advancePathShadowPriceProposal,
  capturePathShadowPriceConfiguration,
  finalizePathShadowPriceProposal,
  preparePathShadowPriceProposal,
  type CapturedPathShadowPriceConfiguration,
  type PathShadowPriceConfigurationError,
  type PathShadowPriceCoreFailureCode,
  type PathShadowPriceIterationState,
  type PathShadowPriceReadyState,
} from '../../allocation/path-shadow-price/index.ts';
import type {
  ExactInputSplitReplayLegRequest,
  ExactInputSplitReplayReceipt,
  ExactInputSplitReplayRequest,
  ExactInputSplitReplayResult,
} from '../../replay/exact-input-split/index.ts';
import type { DirectionalRouteHop } from '../../replay/exact-input-route/index.ts';
import {
  type ExactInputSplitRuntimeControlError,
  type ExactInputSplitRuntimeControlValidationError,
  type ExactInputSplitRuntimeDeadlineControl,
  type ExactInputSplitRuntimeDeadlineError,
  type ExactInputSplitRuntimeRequest,
  type ExactInputSplitRuntimeTermination,
  type ExactInputSplitRuntimeValidationError,
  type ExactInputSplitRuntimeWorkKind,
  type ExactInputSplitWorkCaps,
  type ExactInputSplitWorkCounters,
} from '../anytime-exact-input-split/index.ts';
import {
  createPreparedSimplePathFrontier,
  expandPreparedSimplePathFrontier,
  hasPreparedSimplePathExpansion,
  isPreparedRoutingContext,
  materializePreparedSimplePaths,
  preparedDirectRoutes,
  preparedRoutingContextHasAsset,
  preparedRoutingContextMatchesIdentity,
  replayPreparedExactInputSplit,
  resolvePreparedPathShadowPriceRoutes,
  type PreparedRoutingContext,
} from '../../runtime/prepared-routing-context/index.ts';
import {
  createSharedCandidateSetFrontier,
  expandSharedCandidateSetFrontier,
  hasSharedCandidateSetExpansion,
  materializeSharedCandidateSets,
} from '../../search/shared-route-discovery/index.ts';
import { isStrictlyBetterSplitReceipt } from '../split-exact-input/objective.ts';

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

type MutableCounters = {
  -readonly [Key in keyof NumericalExactInputSplitWorkCounters]: number;
};
type MutableCandidateCounters = {
  -readonly [Key in keyof NumericalExactInputSplitCandidateCounters]: number;
};
type InvalidRequest = Extract<
  NumericalExactInputSplitRuntimeResult,
  { readonly status: 'invalid-request' }
>;
type InvalidControl = Extract<
  NumericalExactInputSplitRuntimeResult,
  { readonly status: 'invalid-control' }
>;

interface CapturedRequest extends ExactInputSplitRuntimeRequest {
  readonly numerical: CapturedPathShadowPriceConfiguration;
}

interface CapturedControl {
  readonly caps: NumericalExactInputSplitWorkCaps;
  readonly shouldInterrupt: NumericalExactInputSplitRuntimeControl['shouldInterrupt'];
  readonly deadlineNanoseconds: bigint | undefined;
  readonly nowNanoseconds: (() => bigint) | undefined;
}

interface SplitProposal {
  readonly key: string;
  readonly receipt: ExactInputSplitReplayReceipt;
  readonly legs: readonly ExactInputSplitReplayLegRequest[];
}

interface CandidateDiagnosticState {
  readonly candidateSetKey: string;
  readonly routeKeys: readonly string[];
  readonly counters: MutableCandidateCounters;
  completedOuterIterations: number;
  converged: boolean;
  residualUnits: bigint | null;
}

const BASE_CAP_FIELDS = [
  'maxPathExpansions',
  'maxBestSingleCandidateReplays',
  'maxCandidateSetExpansions',
  'maxEqualProposalReplays',
  'maxGreedyOptionReplays',
  'maxFinalAuthorizationReplays',
] as const;

const NUMERICAL_CAP_FIELDS = [
  'maxNumericalProposals',
  'maxNumericalIterations',
  'maxNumericalResidualReplays',
  'maxNumericalAuthorizationReplays',
] as const;

const KIND_CAP: Record<
  NumericalExactInputSplitRuntimeWorkKind,
  keyof NumericalExactInputSplitWorkCaps
> = {
  'path-expansion': 'maxPathExpansions',
  'best-single-candidate-replay': 'maxBestSingleCandidateReplays',
  'candidate-set-expansion': 'maxCandidateSetExpansions',
  'equal-proposal-replay': 'maxEqualProposalReplays',
  'greedy-option-replay': 'maxGreedyOptionReplays',
  'final-authorization-replay': 'maxFinalAuthorizationReplays',
  'numerical-proposal': 'maxNumericalProposals',
  'numerical-iteration': 'maxNumericalIterations',
  'numerical-residual-replay': 'maxNumericalResidualReplays',
  'numerical-authorization-replay': 'maxNumericalAuthorizationReplays',
};

const KIND_COUNTER: Record<
  NumericalExactInputSplitRuntimeWorkKind,
  keyof NumericalExactInputSplitWorkCounters
> = {
  'path-expansion': 'pathExpansions',
  'best-single-candidate-replay': 'bestSingleCandidateReplays',
  'candidate-set-expansion': 'candidateSetExpansions',
  'equal-proposal-replay': 'equalProposalReplays',
  'greedy-option-replay': 'greedyOptionReplays',
  'final-authorization-replay': 'finalAuthorizationReplays',
  'numerical-proposal': 'numericalProposals',
  'numerical-iteration': 'numericalIterations',
  'numerical-residual-replay': 'numericalResidualReplays',
  'numerical-authorization-replay': 'numericalAuthorizationReplays',
};

const REAL_PROPOSAL_DRIVER: NumericalExactInputSplitProposalDriver = Object.freeze({
  prepare: preparePathShadowPriceProposal,
  advance: advancePathShadowPriceProposal,
  finalize: finalizePathShadowPriceProposal,
});

function invalidRequest(
  error: NumericalExactInputSplitRuntimeValidationError,
): InvalidRequest {
  return Object.freeze({ status: 'invalid-request', error: Object.freeze(error) });
}

function invalidControl(
  error: NumericalExactInputSplitRuntimeControlValidationError,
): InvalidControl {
  return Object.freeze({ status: 'invalid-control', error: Object.freeze(error) });
}

function captureRequest(
  context: PreparedRoutingContext,
  source: NumericalExactInputSplitRuntimeRequest,
): CapturedRequest | InvalidRequest {
  let snapshotId: unknown;
  let snapshotChecksum: unknown;
  let assetIn: unknown;
  let assetOut: unknown;
  let amountIn: unknown;
  let maxHops: unknown;
  let maxRoutes: unknown;
  let greedyParts: unknown;
  try {
    snapshotId = source.snapshotId;
  } catch {
    return invalidRequest({ code: 'snapshot-identity-mismatch', field: 'snapshotIdentity' });
  }
  try {
    snapshotChecksum = source.snapshotChecksum;
  } catch {
    return invalidRequest({ code: 'snapshot-identity-mismatch', field: 'snapshotIdentity' });
  }
  try {
    assetIn = source.assetIn;
  } catch {
    return invalidRequest({ code: 'empty-identifier', field: 'assetIn' });
  }
  try {
    assetOut = source.assetOut;
  } catch {
    return invalidRequest({ code: 'empty-identifier', field: 'assetOut' });
  }
  try {
    amountIn = source.amountIn;
  } catch {
    return invalidRequest({ code: 'nonpositive-input', field: 'amountIn' });
  }
  try {
    maxHops = source.maxHops;
  } catch {
    return invalidRequest({ code: 'invalid-max-hops', field: 'maxHops' });
  }
  try {
    maxRoutes = source.maxRoutes;
  } catch {
    return invalidRequest({ code: 'invalid-max-routes', field: 'maxRoutes' });
  }
  try {
    greedyParts = source.greedyParts;
  } catch {
    return invalidRequest({ code: 'invalid-greedy-parts', field: 'greedyParts' });
  }

  let numerical: unknown;
  try {
    numerical = source.numerical;
  } catch {
    numerical = undefined;
  }
  let outerIterations: unknown;
  let innerIterations: unknown;
  let convergenceTolerance: unknown;
  if (typeof numerical === 'object' && numerical !== null) {
    try {
      outerIterations = Reflect.get(numerical, 'outerIterations');
    } catch {
      outerIterations = undefined;
    }
    try {
      innerIterations = Reflect.get(numerical, 'innerIterations');
    } catch {
      innerIterations = undefined;
    }
    try {
      convergenceTolerance = Reflect.get(numerical, 'convergenceTolerance');
    } catch {
      convergenceTolerance = undefined;
    }
  }

  const inherited = Object.freeze({
    snapshotId,
    snapshotChecksum,
    assetIn,
    assetOut,
    amountIn,
    maxHops,
    maxRoutes,
    greedyParts,
  }) as ExactInputSplitRuntimeRequest;
  const inheritedFailure = validateInheritedRequest(context, inherited);
  if (inheritedFailure !== undefined) return inheritedFailure;
  if (typeof numerical !== 'object' || numerical === null) {
    return invalidRequest({
      code: 'invalid-numerical-configuration',
      field: 'numerical',
    });
  }
  const configuration = capturePathShadowPriceConfiguration(
    Object.freeze({ outerIterations, innerIterations, convergenceTolerance }),
  );
  if (!configuration.ok) return invalidRequest(configuration.error);
  return Object.freeze({ ...inherited, numerical: configuration.value });
}

function validateInheritedRequest(
  context: PreparedRoutingContext,
  request: ExactInputSplitRuntimeRequest,
): InvalidRequest | undefined {
  if (
    !isPreparedRoutingContext(context) ||
    typeof request.snapshotId !== 'string' ||
    typeof request.snapshotChecksum !== 'string' ||
    !preparedRoutingContextMatchesIdentity(
      context,
      request.snapshotId,
      request.snapshotChecksum,
    )
  ) {
    return invalidRequest({ code: 'snapshot-identity-mismatch', field: 'snapshotIdentity' });
  }
  if (typeof request.assetIn !== 'string' || request.assetIn.length === 0) {
    return invalidRequest({ code: 'empty-identifier', field: 'assetIn' });
  }
  if (typeof request.assetOut !== 'string' || request.assetOut.length === 0) {
    return invalidRequest({ code: 'empty-identifier', field: 'assetOut' });
  }
  if (typeof request.amountIn !== 'bigint' || request.amountIn <= 0n) {
    return invalidRequest({ code: 'nonpositive-input', field: 'amountIn' });
  }
  if (request.assetIn === request.assetOut) {
    return invalidRequest({ code: 'same-asset-request', field: 'assetOut' });
  }
  if (!Number.isSafeInteger(request.maxHops) || request.maxHops <= 0) {
    return invalidRequest({ code: 'invalid-max-hops', field: 'maxHops' });
  }
  if (!Number.isSafeInteger(request.maxRoutes) || request.maxRoutes <= 0) {
    return invalidRequest({ code: 'invalid-max-routes', field: 'maxRoutes' });
  }
  if (!Number.isSafeInteger(request.greedyParts) || request.greedyParts <= 0) {
    return invalidRequest({ code: 'invalid-greedy-parts', field: 'greedyParts' });
  }
  if (!preparedRoutingContextHasAsset(context, request.assetIn)) {
    return invalidRequest({ code: 'unknown-asset', field: 'assetIn' });
  }
  if (!preparedRoutingContextHasAsset(context, request.assetOut)) {
    return invalidRequest({ code: 'unknown-asset', field: 'assetOut' });
  }
  return undefined;
}

function captureControl(
  source: NumericalExactInputSplitRuntimeControl,
): CapturedControl | InvalidControl {
  let workCaps: unknown;
  try {
    workCaps = source.workCaps;
  } catch {
    return invalidControl({ code: 'invalid-work-caps', field: 'workCaps' });
  }
  if (
    (typeof workCaps !== 'object' && typeof workCaps !== 'function') ||
    workCaps === null
  ) {
    return invalidControl({ code: 'invalid-work-caps', field: 'workCaps' });
  }
  const values: Partial<Record<keyof NumericalExactInputSplitWorkCaps, number>> = {};
  for (const field of [...BASE_CAP_FIELDS, ...NUMERICAL_CAP_FIELDS]) {
    let value: unknown;
    try {
      value = Reflect.get(workCaps, field);
    } catch {
      return invalidControl({ code: 'invalid-work-cap', field: `workCaps.${field}` });
    }
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
      return invalidControl({ code: 'invalid-work-cap', field: `workCaps.${field}` });
    }
    values[field] = value as number;
  }
  let shouldInterrupt: unknown;
  try {
    shouldInterrupt = source.shouldInterrupt;
  } catch {
    return invalidControl({
      code: 'invalid-interruption-callback',
      field: 'shouldInterrupt',
    });
  }
  if (shouldInterrupt !== undefined && typeof shouldInterrupt !== 'function') {
    return invalidControl({
      code: 'invalid-interruption-callback',
      field: 'shouldInterrupt',
    });
  }
  let deadline: unknown;
  try {
    deadline = source.deadline;
  } catch {
    return invalidControl({ code: 'invalid-deadline-control', field: 'deadline' });
  }
  let deadlineNanoseconds: unknown;
  let nowNanoseconds: unknown;
  if (deadline !== undefined) {
    if (
      (typeof deadline !== 'object' && typeof deadline !== 'function') ||
      deadline === null
    ) {
      return invalidControl({ code: 'invalid-deadline-control', field: 'deadline' });
    }
    try {
      deadlineNanoseconds = Reflect.get(deadline, 'deadlineNanoseconds');
    } catch {
      return invalidControl({
        code: 'invalid-deadline-nanoseconds',
        field: 'deadline.deadlineNanoseconds',
      });
    }
    if (typeof deadlineNanoseconds !== 'bigint' || deadlineNanoseconds < 0n) {
      return invalidControl({
        code: 'invalid-deadline-nanoseconds',
        field: 'deadline.deadlineNanoseconds',
      });
    }
    try {
      nowNanoseconds = Reflect.get(deadline, 'nowNanoseconds');
    } catch {
      return invalidControl({
        code: 'invalid-deadline-clock',
        field: 'deadline.nowNanoseconds',
      });
    }
    if (typeof nowNanoseconds !== 'function') {
      return invalidControl({
        code: 'invalid-deadline-clock',
        field: 'deadline.nowNanoseconds',
      });
    }
  }
  return Object.freeze({
    caps: Object.freeze(values) as NumericalExactInputSplitWorkCaps,
    shouldInterrupt: shouldInterrupt as NumericalExactInputSplitRuntimeControl['shouldInterrupt'],
    deadlineNanoseconds: deadlineNanoseconds as bigint | undefined,
    nowNanoseconds: nowNanoseconds as (() => bigint) | undefined,
  });
}

function freshCounters(): MutableCounters {
  return {
    directCandidates: 0,
    directCandidateReplays: 0,
    directCandidateRejections: 0,
    pathExpansions: 0,
    bestSingleCandidateReplays: 0,
    bestSingleCandidateRejections: 0,
    candidateSetExpansions: 0,
    equalProposalReplays: 0,
    equalProposalRejections: 0,
    greedyOptionReplays: 0,
    greedyOptionRejections: 0,
    finalAuthorizationReplays: 0,
    finalAuthorizationRejections: 0,
    numericalProposals: 0,
    numericalProposalFailures: 0,
    numericalIterations: 0,
    numericalResidualReplays: 0,
    numericalResidualReplayRejections: 0,
    numericalAuthorizationReplays: 0,
    numericalAuthorizationReplayRejections: 0,
  };
}

function freshCandidateCounters(): MutableCandidateCounters {
  return {
    numericalProposals: 0,
    numericalProposalFailures: 0,
    numericalIterations: 0,
    numericalResidualReplays: 0,
    numericalResidualReplayRejections: 0,
    numericalAuthorizationReplays: 0,
    numericalAuthorizationReplayRejections: 0,
  };
}

function frozenCounters(
  counters: MutableCounters,
): NumericalExactInputSplitWorkCounters {
  return Object.freeze({
    directCandidates: counters.directCandidates,
    directCandidateReplays: counters.directCandidateReplays,
    directCandidateRejections: counters.directCandidateRejections,
    pathExpansions: counters.pathExpansions,
    bestSingleCandidateReplays: counters.bestSingleCandidateReplays,
    bestSingleCandidateRejections: counters.bestSingleCandidateRejections,
    candidateSetExpansions: counters.candidateSetExpansions,
    equalProposalReplays: counters.equalProposalReplays,
    equalProposalRejections: counters.equalProposalRejections,
    greedyOptionReplays: counters.greedyOptionReplays,
    greedyOptionRejections: counters.greedyOptionRejections,
    finalAuthorizationReplays: counters.finalAuthorizationReplays,
    finalAuthorizationRejections: counters.finalAuthorizationRejections,
    numericalProposals: counters.numericalProposals,
    numericalProposalFailures: counters.numericalProposalFailures,
    numericalIterations: counters.numericalIterations,
    numericalResidualReplays: counters.numericalResidualReplays,
    numericalResidualReplayRejections: counters.numericalResidualReplayRejections,
    numericalAuthorizationReplays: counters.numericalAuthorizationReplays,
    numericalAuthorizationReplayRejections:
      counters.numericalAuthorizationReplayRejections,
  });
}

function frozenCandidateCounters(
  counters: MutableCandidateCounters,
): NumericalExactInputSplitCandidateCounters {
  return Object.freeze({
    numericalProposals: counters.numericalProposals,
    numericalProposalFailures: counters.numericalProposalFailures,
    numericalIterations: counters.numericalIterations,
    numericalResidualReplays: counters.numericalResidualReplays,
    numericalResidualReplayRejections: counters.numericalResidualReplayRejections,
    numericalAuthorizationReplays: counters.numericalAuthorizationReplays,
    numericalAuthorizationReplayRejections:
      counters.numericalAuthorizationReplayRejections,
  });
}

function search(
  counters: MutableCounters,
  termination: ExactInputSplitRuntimeTermination,
  diagnostics: readonly NumericalExactInputSplitDiagnostic[],
): NumericalExactInputSplitRuntimeSearchSummary {
  return Object.freeze({
    counters: frozenCounters(counters),
    termination,
    numericalDiagnostics: Object.freeze([...diagnostics]),
  });
}

function finish(
  counters: MutableCounters,
  termination: 'complete' | 'work-limit' | 'interrupted' | 'deadline',
  incumbent: ExactInputSplitReplayReceipt | undefined,
  hadCandidate: boolean,
  diagnostics: readonly NumericalExactInputSplitDiagnostic[],
): NumericalExactInputSplitRuntimeResult {
  const summary = search(counters, termination, diagnostics);
  if (incumbent !== undefined) {
    return Object.freeze({
      status: 'success',
      plan: Object.freeze({ receipt: incumbent, search: summary }),
    });
  }
  if (termination !== 'complete') {
    return Object.freeze({ status: 'no-plan', reason: termination, search: summary });
  }
  return Object.freeze({
    status: 'no-route',
    reason: hadCandidate ? 'all-candidates-rejected' : 'no-candidate',
    search: summary,
  });
}

type Boundary =
  | { readonly outcome: 'execute' }
  | { readonly outcome: 'cap' }
  | { readonly outcome: 'interrupted' }
  | { readonly outcome: 'deadline' }
  | {
      readonly outcome: 'control-error';
      readonly error: ExactInputSplitRuntimeControlError;
    }
  | {
      readonly outcome: 'deadline-error';
      readonly error: ExactInputSplitRuntimeDeadlineError;
    };

function boundary(
  kind: NumericalExactInputSplitRuntimeWorkKind,
  control: CapturedControl,
  counters: MutableCounters,
  incumbent: ExactInputSplitReplayReceipt | undefined,
  priorClock: { value: bigint | undefined },
): Boundary {
  if (counters[KIND_COUNTER[kind]] === control.caps[KIND_CAP[kind]]) {
    return { outcome: 'cap' };
  }
  if (control.shouldInterrupt !== undefined) {
    const checkpoint: NumericalExactInputSplitRuntimeCheckpoint = Object.freeze({
      nextWorkKind: kind,
      counters: frozenCounters(counters),
      incumbent: incumbent ?? null,
    });
    let interrupted: unknown;
    try {
      interrupted = control.shouldInterrupt(checkpoint);
    } catch {
      return {
        outcome: 'control-error',
        error: Object.freeze({ code: 'interruption-check-failed' }),
      };
    }
    if (typeof interrupted !== 'boolean') {
      return {
        outcome: 'control-error',
        error: Object.freeze({ code: 'invalid-interruption-result' }),
      };
    }
    if (interrupted) return { outcome: 'interrupted' };
  }
  if (control.nowNanoseconds !== undefined) {
    let sample: unknown;
    try {
      sample = control.nowNanoseconds();
    } catch {
      return {
        outcome: 'deadline-error',
        error: Object.freeze({
          code: 'deadline-clock-failed',
          field: 'nowNanoseconds',
        }),
      };
    }
    if (typeof sample !== 'bigint' || sample < 0n) {
      return {
        outcome: 'deadline-error',
        error: Object.freeze({
          code: 'deadline-clock-failed',
          field: 'nowNanoseconds',
        }),
      };
    }
    if (priorClock.value !== undefined && sample < priorClock.value) {
      return {
        outcome: 'deadline-error',
        error: Object.freeze({
          code: 'deadline-clock-regressed',
          field: 'nowNanoseconds',
        }),
      };
    }
    priorClock.value = sample;
    if (sample >= control.deadlineNanoseconds!) return { outcome: 'deadline' };
  }
  return { outcome: 'execute' };
}

function operationalResult(
  stop: Exclude<Boundary, { readonly outcome: 'execute' | 'cap' }>,
  counters: MutableCounters,
  incumbent: ExactInputSplitReplayReceipt | undefined,
  hadCandidate: boolean,
  diagnostics: readonly NumericalExactInputSplitDiagnostic[],
): NumericalExactInputSplitRuntimeResult {
  if (stop.outcome === 'interrupted' || stop.outcome === 'deadline') {
    return finish(counters, stop.outcome, incumbent, hadCandidate, diagnostics);
  }
  if (stop.outcome === 'control-error') {
    return Object.freeze({
      status: 'control-error',
      error: stop.error,
      incumbent: incumbent ?? null,
      search: search(counters, 'control-error', diagnostics),
    });
  }
  return Object.freeze({
    status: 'deadline-error',
    error: stop.error,
    incumbent: incumbent ?? null,
    search: search(counters, 'deadline-error', diagnostics),
  });
}

function partialReplayRequest(
  request: ExactInputSplitRuntimeRequest,
  legs: readonly ExactInputSplitReplayLegRequest[],
): ExactInputSplitReplayRequest {
  return Object.freeze({
    snapshotId: request.snapshotId,
    snapshotChecksum: request.snapshotChecksum,
    assetIn: request.assetIn,
    assetOut: request.assetOut,
    amountIn: legs.reduce((sum, leg) => sum + leg.allocation, 0n),
    legs: Object.freeze(legs),
  });
}

function fullReplayRequest(
  request: ExactInputSplitRuntimeRequest,
  legs: readonly ExactInputSplitReplayLegRequest[],
): ExactInputSplitReplayRequest {
  return Object.freeze({
    snapshotId: request.snapshotId,
    snapshotChecksum: request.snapshotChecksum,
    assetIn: request.assetIn,
    assetOut: request.assetOut,
    amountIn: request.amountIn,
    legs: Object.freeze(legs),
  });
}

function positiveLegs(
  routes: readonly (readonly DirectionalRouteHop[])[],
  allocations: readonly bigint[],
): readonly ExactInputSplitReplayLegRequest[] {
  return Object.freeze(
    routes.flatMap((route, index) => {
      const allocation = allocations[index];
      return allocation === undefined || allocation === 0n
        ? []
        : [Object.freeze({ allocation, route })];
    }),
  );
}

function* positiveChunks(amountIn: bigint, parts: number): Generator<bigint> {
  const divisor = BigInt(parts);
  const base = amountIn / divisor;
  const remainder = amountIn % divisor;
  if (base === 0n) {
    for (let index = 0n; index < remainder; index += 1n) yield 1n;
  } else {
    for (let index = 0; index < parts; index += 1) {
      yield base + (BigInt(index) < remainder ? 1n : 0n);
    }
  }
}

function proposalKey(legs: readonly ExactInputSplitReplayLegRequest[]): string {
  return JSON.stringify(
    legs.map((leg) => ({
      allocation: leg.allocation.toString(10),
      route: leg.route.map(({ assetIn, poolId, assetOut }) => ({
        assetIn,
        poolId,
        assetOut,
      })),
    })),
  );
}

function compareProposals(left: SplitProposal, right: SplitProposal): number {
  if (isStrictlyBetterSplitReceipt(left.receipt, right.receipt)) return -1;
  if (isStrictlyBetterSplitReceipt(right.receipt, left.receipt)) return 1;
  if (left.key < right.key) return -1;
  if (left.key > right.key) return 1;
  return 0;
}

function routeKey(route: readonly DirectionalRouteHop[]): string {
  return JSON.stringify(
    route.map(({ assetIn, poolId, assetOut }) => [assetIn, poolId, assetOut]),
  );
}

function candidateSetKey(
  routes: readonly (readonly DirectionalRouteHop[])[],
): string {
  return JSON.stringify(
    routes.map((route) =>
      route.map(({ assetIn, poolId, assetOut }) => [assetIn, poolId, assetOut]),
    ),
  );
}

function createDiagnosticState(
  routes: readonly (readonly DirectionalRouteHop[])[],
): CandidateDiagnosticState {
  return {
    candidateSetKey: candidateSetKey(routes),
    routeKeys: Object.freeze(routes.map(routeKey)),
    counters: freshCandidateCounters(),
    completedOuterIterations: 0,
    converged: false,
    residualUnits: null,
  };
}

function diagnostic(
  state: CandidateDiagnosticState,
  configuredInnerIterations: number,
  status: NumericalExactInputSplitDiagnostic['status'],
  failureCode: NumericalExactInputSplitFailureCode | null,
): NumericalExactInputSplitDiagnostic {
  return Object.freeze({
    candidateSetKey: state.candidateSetKey,
    routeKeys: Object.freeze([...state.routeKeys]),
    status,
    failureCode,
    converged: state.converged,
    completedOuterIterations: state.completedOuterIterations,
    configuredInnerIterations,
    residualUnits: state.residualUnits,
    counters: frozenCandidateCounters(state.counters),
  });
}

function transitionReceiptEquals(
  left: ExactInputSplitReplayReceipt['legs'][number]['receipt']['hops'][number],
  right: ExactInputSplitReplayReceipt['legs'][number]['receipt']['hops'][number],
): boolean {
  return (
    left.poolId === right.poolId &&
    left.assetIn === right.assetIn &&
    left.assetOut === right.assetOut &&
    left.amountIn === right.amountIn &&
    left.amountOut === right.amountOut &&
    left.reserveInBefore === right.reserveInBefore &&
    left.reserveOutBefore === right.reserveOutBefore &&
    left.reserveInAfter === right.reserveInAfter &&
    left.reserveOutAfter === right.reserveOutAfter
  );
}

function receiptSemanticallyEquals(
  left: ExactInputSplitReplayReceipt,
  right: ExactInputSplitReplayReceipt,
): boolean {
  if (
    left.snapshotId !== right.snapshotId ||
    left.snapshotChecksum !== right.snapshotChecksum ||
    left.assetIn !== right.assetIn ||
    left.assetOut !== right.assetOut ||
    left.amountIn !== right.amountIn ||
    left.amountOut !== right.amountOut ||
    left.legs.length !== right.legs.length
  ) {
    return false;
  }
  for (let legIndex = 0; legIndex < left.legs.length; legIndex += 1) {
    const leftLeg = left.legs[legIndex];
    const rightLeg = right.legs[legIndex];
    if (
      leftLeg === undefined ||
      rightLeg === undefined ||
      leftLeg.allocation !== rightLeg.allocation ||
      leftLeg.receipt.snapshotId !== rightLeg.receipt.snapshotId ||
      leftLeg.receipt.snapshotChecksum !== rightLeg.receipt.snapshotChecksum ||
      leftLeg.receipt.assetIn !== rightLeg.receipt.assetIn ||
      leftLeg.receipt.assetOut !== rightLeg.receipt.assetOut ||
      leftLeg.receipt.amountIn !== rightLeg.receipt.amountIn ||
      leftLeg.receipt.amountOut !== rightLeg.receipt.amountOut ||
      leftLeg.receipt.hops.length !== rightLeg.receipt.hops.length
    ) {
      return false;
    }
    for (let hopIndex = 0; hopIndex < leftLeg.receipt.hops.length; hopIndex += 1) {
      const leftHop = leftLeg.receipt.hops[hopIndex];
      const rightHop = rightLeg.receipt.hops[hopIndex];
      if (
        leftHop === undefined ||
        rightHop === undefined ||
        !transitionReceiptEquals(leftHop, rightHop)
      ) {
        return false;
      }
    }
  }
  return true;
}

function captureReplayReceipt(
  source: ExactInputSplitReplayReceipt,
): ExactInputSplitReplayReceipt | undefined {
  try {
    const legs = Object.freeze(
      Array.from(source.legs, (sourceLeg) => {
        const sourceReceipt = sourceLeg.receipt;
        const hops = Object.freeze(
          Array.from(sourceReceipt.hops, (hop) =>
            Object.freeze({
              poolId: hop.poolId,
              assetIn: hop.assetIn,
              assetOut: hop.assetOut,
              amountIn: hop.amountIn,
              amountOut: hop.amountOut,
              reserveInBefore: hop.reserveInBefore,
              reserveOutBefore: hop.reserveOutBefore,
              reserveInAfter: hop.reserveInAfter,
              reserveOutAfter: hop.reserveOutAfter,
            }),
          ),
        );
        const receipt = Object.freeze({
          snapshotId: sourceReceipt.snapshotId,
          snapshotChecksum: sourceReceipt.snapshotChecksum,
          assetIn: sourceReceipt.assetIn,
          assetOut: sourceReceipt.assetOut,
          amountIn: sourceReceipt.amountIn,
          amountOut: sourceReceipt.amountOut,
          hops,
        });
        return Object.freeze({ allocation: sourceLeg.allocation, receipt });
      }),
    );
    return Object.freeze({
      snapshotId: source.snapshotId,
      snapshotChecksum: source.snapshotChecksum,
      assetIn: source.assetIn,
      assetOut: source.assetOut,
      amountIn: source.amountIn,
      amountOut: source.amountOut,
      legs,
    });
  } catch {
    return undefined;
  }
}

function runNumericalRuntime(
  context: PreparedRoutingContext,
  sourceRequest: NumericalExactInputSplitRuntimeRequest,
  sourceControl: NumericalExactInputSplitRuntimeControl,
  authorizationReplay: NumericalExactInputSplitAuthorizationReplay,
  proposalDriver: NumericalExactInputSplitProposalDriver,
): NumericalExactInputSplitRuntimeResult {
  const capturedRequest = captureRequest(context, sourceRequest);
  if ('status' in capturedRequest) return capturedRequest;
  const capturedControl = captureControl(sourceControl);
  if ('status' in capturedControl) return capturedControl;

  const counters = freshCounters();
  const diagnostics: NumericalExactInputSplitDiagnostic[] = [];
  let incumbent: ExactInputSplitReplayReceipt | undefined;
  let hadCandidate = false;
  let workLimited = false;
  const priorClock: { value: bigint | undefined } = { value: undefined };
  const proposals = new Map<string, SplitProposal>();

  const directRoutes = preparedDirectRoutes(
    context,
    capturedRequest.assetIn,
    capturedRequest.assetOut,
  );
  for (const route of directRoutes) {
    hadCandidate = true;
    counters.directCandidates += 1;
    counters.directCandidateReplays += 1;
    const replay = replayPreparedExactInputSplit(
      context,
      fullReplayRequest(capturedRequest, [
        Object.freeze({ allocation: capturedRequest.amountIn, route }),
      ]),
    );
    if (!replay.ok) counters.directCandidateRejections += 1;
    else if (
      incumbent === undefined ||
      isStrictlyBetterSplitReceipt(replay.value, incumbent)
    ) {
      incumbent = replay.value;
    }
  }

  const collectProposal = (
    receipt: ExactInputSplitReplayReceipt,
    legs: readonly ExactInputSplitReplayLegRequest[],
  ): void => {
    const key = proposalKey(legs);
    if (!proposals.has(key)) {
      proposals.set(key, Object.freeze({ key, receipt, legs }));
    }
  };

  const pathFrontier = createPreparedSimplePathFrontier(context, capturedRequest);
  while (hasPreparedSimplePathExpansion(pathFrontier)) {
    const stop = boundary(
      'path-expansion',
      capturedControl,
      counters,
      incumbent,
      priorClock,
    );
    if (stop.outcome === 'cap') {
      workLimited = true;
      break;
    }
    if (stop.outcome !== 'execute') {
      return operationalResult(stop, counters, incumbent, hadCandidate, diagnostics);
    }
    expandPreparedSimplePathFrontier(pathFrontier);
    counters.pathExpansions += 1;
  }
  const paths = materializePreparedSimplePaths(pathFrontier);
  hadCandidate ||= paths.length > 0;

  for (const route of paths) {
    const stop = boundary(
      'best-single-candidate-replay',
      capturedControl,
      counters,
      incumbent,
      priorClock,
    );
    if (stop.outcome === 'cap') {
      workLimited = true;
      break;
    }
    if (stop.outcome !== 'execute') {
      return operationalResult(stop, counters, incumbent, hadCandidate, diagnostics);
    }
    counters.bestSingleCandidateReplays += 1;
    const legs = Object.freeze([
      Object.freeze({ allocation: capturedRequest.amountIn, route }),
    ]);
    const replay = replayPreparedExactInputSplit(
      context,
      fullReplayRequest(capturedRequest, legs),
    );
    if (!replay.ok) counters.bestSingleCandidateRejections += 1;
    else if (
      incumbent === undefined ||
      isStrictlyBetterSplitReceipt(replay.value, incumbent)
    ) {
      incumbent = replay.value;
    }
  }

  const setFrontier = createSharedCandidateSetFrontier(paths, capturedRequest.maxRoutes);
  while (hasSharedCandidateSetExpansion(setFrontier)) {
    const stop = boundary(
      'candidate-set-expansion',
      capturedControl,
      counters,
      incumbent,
      priorClock,
    );
    if (stop.outcome === 'cap') {
      workLimited = true;
      break;
    }
    if (stop.outcome !== 'execute') {
      return operationalResult(stop, counters, incumbent, hadCandidate, diagnostics);
    }
    expandSharedCandidateSetFrontier(setFrontier);
    counters.candidateSetExpansions += 1;
  }
  const candidateSets = materializeSharedCandidateSets(setFrontier);

  for (const { routes } of candidateSets) {
    const cardinality = BigInt(routes.length);
    const base = capturedRequest.amountIn / cardinality;
    if (base === 0n) continue;
    const remainder = capturedRequest.amountIn % cardinality;
    const legs = Object.freeze(
      routes.map((route, index) =>
        Object.freeze({
          allocation: base + (BigInt(index) < remainder ? 1n : 0n),
          route,
        }),
      ),
    );
    const stop = boundary(
      'equal-proposal-replay',
      capturedControl,
      counters,
      incumbent,
      priorClock,
    );
    if (stop.outcome === 'cap') {
      workLimited = true;
      break;
    }
    if (stop.outcome !== 'execute') {
      return operationalResult(stop, counters, incumbent, hadCandidate, diagnostics);
    }
    counters.equalProposalReplays += 1;
    const replay = replayPreparedExactInputSplit(
      context,
      fullReplayRequest(capturedRequest, legs),
    );
    if (!replay.ok) counters.equalProposalRejections += 1;
    else collectProposal(replay.value, legs);
  }

  candidateSets: for (const { routes } of candidateSets) {
    const allocations = routes.map(() => 0n);
    let allocated = 0n;
    let finalProposal: ExactInputSplitReplayReceipt | undefined;
    for (const chunk of positiveChunks(
      capturedRequest.amountIn,
      capturedRequest.greedyParts,
    )) {
      let winningIndex: number | undefined;
      let winningOutput: bigint | undefined;
      let winningReceipt: ExactInputSplitReplayReceipt | undefined;
      for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
        const stop = boundary(
          'greedy-option-replay',
          capturedControl,
          counters,
          incumbent,
          priorClock,
        );
        if (stop.outcome === 'cap') {
          workLimited = true;
          break candidateSets;
        }
        if (stop.outcome !== 'execute') {
          return operationalResult(stop, counters, incumbent, hadCandidate, diagnostics);
        }
        const optionAllocations = [...allocations];
        optionAllocations[routeIndex] = optionAllocations[routeIndex]! + chunk;
        counters.greedyOptionReplays += 1;
        const replay = replayPreparedExactInputSplit(
          context,
          partialReplayRequest(
            capturedRequest,
            positiveLegs(routes, optionAllocations),
          ),
        );
        if (!replay.ok) {
          counters.greedyOptionRejections += 1;
          continue;
        }
        if (winningOutput === undefined || replay.value.amountOut > winningOutput) {
          winningIndex = routeIndex;
          winningOutput = replay.value.amountOut;
          winningReceipt = replay.value;
        }
      }
      if (winningIndex === undefined) continue candidateSets;
      allocations[winningIndex] = allocations[winningIndex]! + chunk;
      allocated += chunk;
      finalProposal = winningReceipt;
    }
    if (allocated !== capturedRequest.amountIn || finalProposal === undefined) continue;
    const legs = positiveLegs(routes, allocations);
    collectProposal(finalProposal, legs);
  }

  const orderedProposals = [...proposals.values()].sort(compareProposals);
  for (const proposal of orderedProposals) {
    if (
      incumbent !== undefined &&
      !isStrictlyBetterSplitReceipt(proposal.receipt, incumbent)
    ) {
      continue;
    }
    const stop = boundary(
      'final-authorization-replay',
      capturedControl,
      counters,
      incumbent,
      priorClock,
    );
    if (stop.outcome === 'cap') {
      workLimited = true;
      break;
    }
    if (stop.outcome !== 'execute') {
      return operationalResult(stop, counters, incumbent, hadCandidate, diagnostics);
    }
    counters.finalAuthorizationReplays += 1;
    const replay = replayPreparedExactInputSplit(
      context,
      fullReplayRequest(capturedRequest, proposal.legs),
    );
    if (!replay.ok) counters.finalAuthorizationRejections += 1;
    else if (
      incumbent === undefined ||
      isStrictlyBetterSplitReceipt(replay.value, incumbent)
    ) {
      incumbent = replay.value;
    }
  }

  if (incumbent === undefined) {
    return finish(
      counters,
      workLimited ? 'work-limit' : 'complete',
      incumbent,
      hadCandidate,
      diagnostics,
    );
  }

  for (const { routes } of candidateSets) {
    const candidate = createDiagnosticState(routes);
    const proposalStop = boundary(
      'numerical-proposal',
      capturedControl,
      counters,
      incumbent,
      priorClock,
    );
    if (proposalStop.outcome === 'cap') {
      diagnostics.push(
        diagnostic(
          candidate,
          capturedRequest.numerical.innerIterations,
          'stopped',
          null,
        ),
      );
      return finish(counters, 'work-limit', incumbent, hadCandidate, diagnostics);
    }
    if (proposalStop.outcome !== 'execute') {
      diagnostics.push(
        diagnostic(
          candidate,
          capturedRequest.numerical.innerIterations,
          'stopped',
          null,
        ),
      );
      return operationalResult(
        proposalStop,
        counters,
        incumbent,
        hadCandidate,
        diagnostics,
      );
    }
    counters.numericalProposals += 1;
    candidate.counters.numericalProposals += 1;

    const resolution = resolvePreparedPathShadowPriceRoutes(context, routes);
    if (!resolution.ok) {
      counters.numericalProposalFailures += 1;
      candidate.counters.numericalProposalFailures += 1;
      diagnostics.push(
        diagnostic(
          candidate,
          capturedRequest.numerical.innerIterations,
          'failed',
          'invalid-route-model',
        ),
      );
      continue;
    }

    const prepared = proposalDriver.prepare(
      Object.freeze({
        amountIn: capturedRequest.amountIn,
        routes: resolution.value,
        configuration: capturedRequest.numerical,
      }),
    );
    if (!prepared.ok) {
      counters.numericalProposalFailures += 1;
      candidate.counters.numericalProposalFailures += 1;
      candidate.converged = prepared.error.converged;
      candidate.completedOuterIterations = prepared.error.completedOuterIterations;
      diagnostics.push(
        diagnostic(
          candidate,
          capturedRequest.numerical.innerIterations,
          'failed',
          prepared.error.code,
        ),
      );
      continue;
    }

    let iterationState: PathShadowPriceIterationState = prepared.value.state;
    let readyState: PathShadowPriceReadyState | undefined;
    let coreFailed = false;
    while (readyState === undefined) {
      const iterationStop = boundary(
        'numerical-iteration',
        capturedControl,
        counters,
        incumbent,
        priorClock,
      );
      if (iterationStop.outcome === 'cap') {
        diagnostics.push(
          diagnostic(
            candidate,
            capturedRequest.numerical.innerIterations,
            'stopped',
            null,
          ),
        );
        return finish(counters, 'work-limit', incumbent, hadCandidate, diagnostics);
      }
      if (iterationStop.outcome !== 'execute') {
        diagnostics.push(
          diagnostic(
            candidate,
            capturedRequest.numerical.innerIterations,
            'stopped',
            null,
          ),
        );
        return operationalResult(
          iterationStop,
          counters,
          incumbent,
          hadCandidate,
          diagnostics,
        );
      }
      counters.numericalIterations += 1;
      candidate.counters.numericalIterations += 1;
      const advanced = proposalDriver.advance(iterationState);
      if (!advanced.ok) {
        counters.numericalProposalFailures += 1;
        candidate.counters.numericalProposalFailures += 1;
        candidate.converged = advanced.error.converged;
        candidate.completedOuterIterations = advanced.error.completedOuterIterations;
        diagnostics.push(
          diagnostic(
            candidate,
            capturedRequest.numerical.innerIterations,
            'failed',
            advanced.error.code,
          ),
        );
        coreFailed = true;
        break;
      }
      candidate.completedOuterIterations = advanced.value.state.completedOuterIterations;
      if (advanced.value.status === 'ready') readyState = advanced.value.state;
      else iterationState = advanced.value.state;
    }
    if (coreFailed || readyState === undefined) continue;

    const finalized = proposalDriver.finalize(readyState);
    if (!finalized.ok) {
      counters.numericalProposalFailures += 1;
      candidate.counters.numericalProposalFailures += 1;
      candidate.converged = finalized.error.converged;
      candidate.completedOuterIterations = finalized.error.completedOuterIterations;
      diagnostics.push(
        diagnostic(
          candidate,
          capturedRequest.numerical.innerIterations,
          'failed',
          finalized.error.code,
        ),
      );
      continue;
    }
    candidate.converged = true;
    candidate.completedOuterIterations = finalized.value.completedOuterIterations;
    candidate.residualUnits = finalized.value.reconstruction.residualUnits;

    const allocations = [...finalized.value.reconstruction.baseAllocations];
    const residualUnits = finalized.value.reconstruction.residualUnits;
    let score: ExactInputSplitReplayReceipt | undefined;
    let residualFailed = false;

    if (residualUnits === 0n) {
      const residualStop = boundary(
        'numerical-residual-replay',
        capturedControl,
        counters,
        incumbent,
        priorClock,
      );
      if (residualStop.outcome === 'cap') {
        diagnostics.push(
          diagnostic(
            candidate,
            capturedRequest.numerical.innerIterations,
            'stopped',
            null,
          ),
        );
        return finish(counters, 'work-limit', incumbent, hadCandidate, diagnostics);
      }
      if (residualStop.outcome !== 'execute') {
        diagnostics.push(
          diagnostic(
            candidate,
            capturedRequest.numerical.innerIterations,
            'stopped',
            null,
          ),
        );
        return operationalResult(
          residualStop,
          counters,
          incumbent,
          hadCandidate,
          diagnostics,
        );
      }
      counters.numericalResidualReplays += 1;
      candidate.counters.numericalResidualReplays += 1;
      const replay = replayPreparedExactInputSplit(
        context,
        fullReplayRequest(capturedRequest, positiveLegs(routes, allocations)),
      );
      if (!replay.ok) {
        counters.numericalResidualReplayRejections += 1;
        candidate.counters.numericalResidualReplayRejections += 1;
        residualFailed = true;
      } else {
        score = replay.value;
      }
    } else {
      for (let unit = 0n; unit < residualUnits; unit += 1n) {
        let winningIndex: number | undefined;
        let winningReceipt: ExactInputSplitReplayReceipt | undefined;
        for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
          const residualStop = boundary(
            'numerical-residual-replay',
            capturedControl,
            counters,
            incumbent,
            priorClock,
          );
          if (residualStop.outcome === 'cap') {
            diagnostics.push(
              diagnostic(
                candidate,
                capturedRequest.numerical.innerIterations,
                'stopped',
                null,
              ),
            );
            return finish(counters, 'work-limit', incumbent, hadCandidate, diagnostics);
          }
          if (residualStop.outcome !== 'execute') {
            diagnostics.push(
              diagnostic(
                candidate,
                capturedRequest.numerical.innerIterations,
                'stopped',
                null,
              ),
            );
            return operationalResult(
              residualStop,
              counters,
              incumbent,
              hadCandidate,
              diagnostics,
            );
          }
          const optionAllocations = [...allocations];
          optionAllocations[routeIndex] = optionAllocations[routeIndex]! + 1n;
          counters.numericalResidualReplays += 1;
          candidate.counters.numericalResidualReplays += 1;
          const replay = replayPreparedExactInputSplit(
            context,
            partialReplayRequest(
              capturedRequest,
              positiveLegs(routes, optionAllocations),
            ),
          );
          if (!replay.ok) {
            counters.numericalResidualReplayRejections += 1;
            candidate.counters.numericalResidualReplayRejections += 1;
            continue;
          }
          if (
            winningReceipt === undefined ||
            isStrictlyBetterSplitReceipt(replay.value, winningReceipt)
          ) {
            winningIndex = routeIndex;
            winningReceipt = replay.value;
          }
        }
        if (winningIndex === undefined || winningReceipt === undefined) {
          residualFailed = true;
          break;
        }
        allocations[winningIndex] = allocations[winningIndex]! + 1n;
        score = winningReceipt;
      }
    }

    if (residualFailed || score === undefined) {
      diagnostics.push(
        diagnostic(
          candidate,
          capturedRequest.numerical.innerIterations,
          'failed',
          'residual-options-exhausted',
        ),
      );
      continue;
    }

    if (!isStrictlyBetterSplitReceipt(score, incumbent)) {
      diagnostics.push(
        diagnostic(
          candidate,
          capturedRequest.numerical.innerIterations,
          'not-better',
          null,
        ),
      );
      continue;
    }

    const authorizationStop = boundary(
      'numerical-authorization-replay',
      capturedControl,
      counters,
      incumbent,
      priorClock,
    );
    if (authorizationStop.outcome === 'cap') {
      diagnostics.push(
        diagnostic(
          candidate,
          capturedRequest.numerical.innerIterations,
          'stopped',
          null,
        ),
      );
      return finish(counters, 'work-limit', incumbent, hadCandidate, diagnostics);
    }
    if (authorizationStop.outcome !== 'execute') {
      diagnostics.push(
        diagnostic(
          candidate,
          capturedRequest.numerical.innerIterations,
          'stopped',
          null,
        ),
      );
      return operationalResult(
        authorizationStop,
        counters,
        incumbent,
        hadCandidate,
        diagnostics,
      );
    }
    counters.numericalAuthorizationReplays += 1;
    candidate.counters.numericalAuthorizationReplays += 1;
    const authorization = authorizationReplay(
      context,
      fullReplayRequest(capturedRequest, positiveLegs(routes, allocations)),
    );
    if (!authorization.ok) {
      counters.numericalAuthorizationReplayRejections += 1;
      candidate.counters.numericalAuthorizationReplayRejections += 1;
      diagnostics.push(
        diagnostic(
          candidate,
          capturedRequest.numerical.innerIterations,
          'failed',
          'authorization-replay-rejected',
        ),
      );
      continue;
    }
    const capturedAuthorization = captureReplayReceipt(authorization.value);
    if (
      capturedAuthorization === undefined ||
      !receiptSemanticallyEquals(capturedAuthorization, score) ||
      !isStrictlyBetterSplitReceipt(capturedAuthorization, incumbent)
    ) {
      counters.numericalAuthorizationReplayRejections += 1;
      candidate.counters.numericalAuthorizationReplayRejections += 1;
      diagnostics.push(
        diagnostic(
          candidate,
          capturedRequest.numerical.innerIterations,
          'failed',
          'authorization-result-mismatch',
        ),
      );
      continue;
    }
    incumbent = capturedAuthorization;
    diagnostics.push(
      diagnostic(
        candidate,
        capturedRequest.numerical.innerIterations,
        'improved',
        null,
      ),
    );
  }

  return finish(
    counters,
    workLimited ? 'work-limit' : 'complete',
    incumbent,
    hadCandidate,
    diagnostics,
  );
}

export function routeExactInputSplitNumericalAnytime(
  context: PreparedRoutingContext,
  request: NumericalExactInputSplitRuntimeRequest,
  control: NumericalExactInputSplitRuntimeControl,
): NumericalExactInputSplitRuntimeResult {
  return runNumericalRuntime(
    context,
    request,
    control,
    replayPreparedExactInputSplit,
    REAL_PROPOSAL_DRIVER,
  );
}

/** @internal */
export function routeExactInputSplitNumericalAnytimeWithAuthorizationReplay(
  context: PreparedRoutingContext,
  request: NumericalExactInputSplitRuntimeRequest,
  control: NumericalExactInputSplitRuntimeControl,
  authorizationReplay: NumericalExactInputSplitAuthorizationReplay,
): NumericalExactInputSplitRuntimeResult {
  return runNumericalRuntime(
    context,
    request,
    control,
    authorizationReplay,
    REAL_PROPOSAL_DRIVER,
  );
}

/** @internal */
export function routeExactInputSplitNumericalAnytimeWithProposalDriver(
  context: PreparedRoutingContext,
  request: NumericalExactInputSplitRuntimeRequest,
  control: NumericalExactInputSplitRuntimeControl,
  proposalDriver: NumericalExactInputSplitProposalDriver,
): NumericalExactInputSplitRuntimeResult {
  return runNumericalRuntime(
    context,
    request,
    control,
    replayPreparedExactInputSplit,
    proposalDriver,
  );
}
