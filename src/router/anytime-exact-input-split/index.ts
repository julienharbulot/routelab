import type { ExactInputSplitReplayReceipt } from '../../replay/exact-input-split/index.ts';
import {
  isPreparedRoutingContext,
  preparedRoutingContextHasAsset,
  preparedRoutingContextMatchesIdentity,
  type PreparedRoutingContext,
} from '../../runtime/prepared-routing-context/index.ts';
import {
  createExactInputSplitSession,
  exactInputSplitSessionCounters,
  exactInputSplitSessionHadCandidate,
  exactInputSplitSessionIncumbent,
  runExactInputSplitReferencePolicy,
  type ExactInputSplitReferencePolicyOutcome,
  type ExactInputSplitSessionCheckpoint,
  type ExactInputSplitSessionWorkCounters,
} from '../exact-input-split-session/index.ts';

export interface ExactInputSplitRuntimeRequest {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly maxHops: number;
  readonly maxRoutes: number;
  readonly greedyParts: number;
}

export type ExactInputSplitRuntimeValidationErrorCode =
  | 'snapshot-identity-mismatch'
  | 'empty-identifier'
  | 'nonpositive-input'
  | 'same-asset-request'
  | 'invalid-max-hops'
  | 'invalid-max-routes'
  | 'invalid-greedy-parts'
  | 'unknown-asset';

export type ExactInputSplitRuntimeValidationErrorField =
  | 'snapshotIdentity'
  | 'assetIn'
  | 'assetOut'
  | 'amountIn'
  | 'maxHops'
  | 'maxRoutes'
  | 'greedyParts';

export type ExactInputSplitRuntimeValidationError =
  | { readonly code: 'snapshot-identity-mismatch'; readonly field: 'snapshotIdentity' }
  | { readonly code: 'empty-identifier'; readonly field: 'assetIn' | 'assetOut' }
  | { readonly code: 'nonpositive-input'; readonly field: 'amountIn' }
  | { readonly code: 'same-asset-request'; readonly field: 'assetOut' }
  | { readonly code: 'invalid-max-hops'; readonly field: 'maxHops' }
  | { readonly code: 'invalid-max-routes'; readonly field: 'maxRoutes' }
  | { readonly code: 'invalid-greedy-parts'; readonly field: 'greedyParts' }
  | { readonly code: 'unknown-asset'; readonly field: 'assetIn' | 'assetOut' };

export interface ExactInputSplitWorkCaps {
  readonly maxPathExpansions: number;
  readonly maxBestSingleCandidateReplays: number;
  readonly maxCandidateSetExpansions: number;
  readonly maxEqualProposalReplays: number;
  readonly maxGreedyOptionReplays: number;
  readonly maxFinalAuthorizationReplays: number;
}

export interface ExactInputSplitWorkCounters {
  readonly directCandidates: number;
  readonly directCandidateReplays: number;
  readonly directCandidateRejections: number;
  readonly pathExpansions: number;
  readonly bestSingleCandidateReplays: number;
  readonly bestSingleCandidateRejections: number;
  readonly candidateSetExpansions: number;
  readonly equalProposalReplays: number;
  readonly equalProposalRejections: number;
  readonly greedyOptionReplays: number;
  readonly greedyOptionRejections: number;
  readonly finalAuthorizationReplays: number;
  readonly finalAuthorizationRejections: number;
}

export type ExactInputSplitRuntimeWorkKind =
  | 'path-expansion'
  | 'best-single-candidate-replay'
  | 'candidate-set-expansion'
  | 'equal-proposal-replay'
  | 'greedy-option-replay'
  | 'final-authorization-replay';

export interface ExactInputSplitRuntimeCheckpoint {
  readonly nextWorkKind: ExactInputSplitRuntimeWorkKind;
  readonly counters: ExactInputSplitWorkCounters;
  readonly incumbent: ExactInputSplitReplayReceipt | null;
}

export interface ExactInputSplitRuntimeDeadlineControl {
  readonly deadlineNanoseconds: bigint;
  readonly nowNanoseconds: () => bigint;
}

export interface ExactInputSplitRuntimeControl {
  readonly workCaps: ExactInputSplitWorkCaps;
  readonly shouldInterrupt?: (checkpoint: ExactInputSplitRuntimeCheckpoint) => boolean;
  readonly deadline?: ExactInputSplitRuntimeDeadlineControl;
}

export type ExactInputSplitRuntimeControlValidationError =
  | { readonly code: 'invalid-work-caps'; readonly field: 'workCaps' }
  | {
      readonly code: 'invalid-work-cap';
      readonly field:
        | 'workCaps.maxPathExpansions'
        | 'workCaps.maxBestSingleCandidateReplays'
        | 'workCaps.maxCandidateSetExpansions'
        | 'workCaps.maxEqualProposalReplays'
        | 'workCaps.maxGreedyOptionReplays'
        | 'workCaps.maxFinalAuthorizationReplays';
    }
  | { readonly code: 'invalid-interruption-callback'; readonly field: 'shouldInterrupt' }
  | { readonly code: 'invalid-deadline-control'; readonly field: 'deadline' }
  | { readonly code: 'invalid-deadline-nanoseconds'; readonly field: 'deadline.deadlineNanoseconds' }
  | { readonly code: 'invalid-deadline-clock'; readonly field: 'deadline.nowNanoseconds' };

export type ExactInputSplitRuntimeControlError =
  | { readonly code: 'interruption-check-failed' }
  | { readonly code: 'invalid-interruption-result' };

export type ExactInputSplitRuntimeDeadlineError =
  | { readonly code: 'deadline-clock-failed'; readonly field: 'nowNanoseconds' }
  | { readonly code: 'deadline-clock-regressed'; readonly field: 'nowNanoseconds' };

export type ExactInputSplitRuntimeTermination =
  | 'complete'
  | 'work-limit'
  | 'interrupted'
  | 'deadline'
  | 'control-error'
  | 'deadline-error';

export interface ExactInputSplitRuntimeSearchSummary {
  readonly counters: ExactInputSplitWorkCounters;
  readonly termination: ExactInputSplitRuntimeTermination;
}

export interface ExactInputSplitRuntimePlan {
  readonly receipt: ExactInputSplitReplayReceipt;
  readonly search: ExactInputSplitRuntimeSearchSummary;
}

export type ExactInputSplitRuntimeResult =
  | { readonly status: 'success'; readonly plan: ExactInputSplitRuntimePlan }
  | {
      readonly status: 'no-route';
      readonly reason: 'no-candidate' | 'all-candidates-rejected';
      readonly search: ExactInputSplitRuntimeSearchSummary;
    }
  | {
      readonly status: 'no-plan';
      readonly reason: 'work-limit' | 'interrupted' | 'deadline';
      readonly search: ExactInputSplitRuntimeSearchSummary;
    }
  | { readonly status: 'invalid-request'; readonly error: ExactInputSplitRuntimeValidationError }
  | { readonly status: 'invalid-control'; readonly error: ExactInputSplitRuntimeControlValidationError }
  | {
      readonly status: 'control-error';
      readonly error: ExactInputSplitRuntimeControlError;
      readonly incumbent: ExactInputSplitReplayReceipt | null;
      readonly search: ExactInputSplitRuntimeSearchSummary;
    }
  | {
      readonly status: 'deadline-error';
      readonly error: ExactInputSplitRuntimeDeadlineError;
      readonly incumbent: ExactInputSplitReplayReceipt | null;
      readonly search: ExactInputSplitRuntimeSearchSummary;
    };

type InvalidRequest = Extract<ExactInputSplitRuntimeResult, { readonly status: 'invalid-request' }>;
type InvalidControl = Extract<ExactInputSplitRuntimeResult, { readonly status: 'invalid-control' }>;

interface CapturedControl {
  readonly caps: ExactInputSplitWorkCaps;
  readonly shouldInterrupt: ExactInputSplitRuntimeControl['shouldInterrupt'];
  readonly deadlineNanoseconds: bigint | undefined;
  readonly nowNanoseconds: (() => bigint) | undefined;
}

const CAP_FIELDS = [
  'maxPathExpansions',
  'maxBestSingleCandidateReplays',
  'maxCandidateSetExpansions',
  'maxEqualProposalReplays',
  'maxGreedyOptionReplays',
  'maxFinalAuthorizationReplays',
] as const;

function invalidRequest(error: ExactInputSplitRuntimeValidationError): InvalidRequest {
  return Object.freeze({ status: 'invalid-request', error: Object.freeze(error) });
}

function invalidControl(error: ExactInputSplitRuntimeControlValidationError): InvalidControl {
  return Object.freeze({ status: 'invalid-control', error: Object.freeze(error) });
}

function captureRequest(source: ExactInputSplitRuntimeRequest): ExactInputSplitRuntimeRequest | InvalidRequest {
  let snapshotId: unknown;
  let snapshotChecksum: unknown;
  let assetIn: unknown;
  let assetOut: unknown;
  let amountIn: unknown;
  let maxHops: unknown;
  let maxRoutes: unknown;
  let greedyParts: unknown;
  try { snapshotId = source.snapshotId; } catch { return invalidRequest({ code: 'snapshot-identity-mismatch', field: 'snapshotIdentity' }); }
  try { snapshotChecksum = source.snapshotChecksum; } catch { return invalidRequest({ code: 'snapshot-identity-mismatch', field: 'snapshotIdentity' }); }
  try { assetIn = source.assetIn; } catch { return invalidRequest({ code: 'empty-identifier', field: 'assetIn' }); }
  try { assetOut = source.assetOut; } catch { return invalidRequest({ code: 'empty-identifier', field: 'assetOut' }); }
  try { amountIn = source.amountIn; } catch { return invalidRequest({ code: 'nonpositive-input', field: 'amountIn' }); }
  try { maxHops = source.maxHops; } catch { return invalidRequest({ code: 'invalid-max-hops', field: 'maxHops' }); }
  try { maxRoutes = source.maxRoutes; } catch { return invalidRequest({ code: 'invalid-max-routes', field: 'maxRoutes' }); }
  try { greedyParts = source.greedyParts; } catch { return invalidRequest({ code: 'invalid-greedy-parts', field: 'greedyParts' }); }
  return Object.freeze({ snapshotId, snapshotChecksum, assetIn, assetOut, amountIn, maxHops, maxRoutes, greedyParts }) as ExactInputSplitRuntimeRequest;
}

function validateRequest(context: PreparedRoutingContext, request: ExactInputSplitRuntimeRequest): InvalidRequest | undefined {
  if (!isPreparedRoutingContext(context) || typeof request.snapshotId !== 'string' || typeof request.snapshotChecksum !== 'string' || !preparedRoutingContextMatchesIdentity(context, request.snapshotId, request.snapshotChecksum)) {
    return invalidRequest({ code: 'snapshot-identity-mismatch', field: 'snapshotIdentity' });
  }
  if (typeof request.assetIn !== 'string' || request.assetIn.length === 0) return invalidRequest({ code: 'empty-identifier', field: 'assetIn' });
  if (typeof request.assetOut !== 'string' || request.assetOut.length === 0) return invalidRequest({ code: 'empty-identifier', field: 'assetOut' });
  if (typeof request.amountIn !== 'bigint' || request.amountIn <= 0n) return invalidRequest({ code: 'nonpositive-input', field: 'amountIn' });
  if (request.assetIn === request.assetOut) return invalidRequest({ code: 'same-asset-request', field: 'assetOut' });
  if (!Number.isSafeInteger(request.maxHops) || request.maxHops <= 0) return invalidRequest({ code: 'invalid-max-hops', field: 'maxHops' });
  if (!Number.isSafeInteger(request.maxRoutes) || request.maxRoutes <= 0) return invalidRequest({ code: 'invalid-max-routes', field: 'maxRoutes' });
  if (!Number.isSafeInteger(request.greedyParts) || request.greedyParts <= 0) return invalidRequest({ code: 'invalid-greedy-parts', field: 'greedyParts' });
  if (!preparedRoutingContextHasAsset(context, request.assetIn)) return invalidRequest({ code: 'unknown-asset', field: 'assetIn' });
  if (!preparedRoutingContextHasAsset(context, request.assetOut)) return invalidRequest({ code: 'unknown-asset', field: 'assetOut' });
  return undefined;
}

function captureControl(source: ExactInputSplitRuntimeControl): CapturedControl | InvalidControl {
  let workCaps: unknown;
  try { workCaps = source.workCaps; } catch { return invalidControl({ code: 'invalid-work-caps', field: 'workCaps' }); }
  if ((typeof workCaps !== 'object' && typeof workCaps !== 'function') || workCaps === null) return invalidControl({ code: 'invalid-work-caps', field: 'workCaps' });
  const values: Partial<Record<(typeof CAP_FIELDS)[number], number>> = {};
  for (const field of CAP_FIELDS) {
    let value: unknown;
    try { value = Reflect.get(workCaps, field); } catch { return invalidControl({ code: 'invalid-work-cap', field: `workCaps.${field}` }); }
    if (!Number.isSafeInteger(value) || (value as number) < 0) return invalidControl({ code: 'invalid-work-cap', field: `workCaps.${field}` });
    values[field] = value as number;
  }
  let shouldInterrupt: unknown;
  try { shouldInterrupt = source.shouldInterrupt; } catch { return invalidControl({ code: 'invalid-interruption-callback', field: 'shouldInterrupt' }); }
  if (shouldInterrupt !== undefined && typeof shouldInterrupt !== 'function') return invalidControl({ code: 'invalid-interruption-callback', field: 'shouldInterrupt' });
  let deadline: unknown;
  try { deadline = source.deadline; } catch { return invalidControl({ code: 'invalid-deadline-control', field: 'deadline' }); }
  let deadlineNanoseconds: unknown;
  let nowNanoseconds: unknown;
  if (deadline !== undefined) {
    if ((typeof deadline !== 'object' && typeof deadline !== 'function') || deadline === null) return invalidControl({ code: 'invalid-deadline-control', field: 'deadline' });
    try { deadlineNanoseconds = Reflect.get(deadline, 'deadlineNanoseconds'); } catch { return invalidControl({ code: 'invalid-deadline-nanoseconds', field: 'deadline.deadlineNanoseconds' }); }
    if (typeof deadlineNanoseconds !== 'bigint' || deadlineNanoseconds < 0n) return invalidControl({ code: 'invalid-deadline-nanoseconds', field: 'deadline.deadlineNanoseconds' });
    try { nowNanoseconds = Reflect.get(deadline, 'nowNanoseconds'); } catch { return invalidControl({ code: 'invalid-deadline-clock', field: 'deadline.nowNanoseconds' }); }
    if (typeof nowNanoseconds !== 'function') return invalidControl({ code: 'invalid-deadline-clock', field: 'deadline.nowNanoseconds' });
  }
  const caps = Object.freeze(values) as ExactInputSplitWorkCaps;
  return Object.freeze({ caps, shouldInterrupt, deadlineNanoseconds, nowNanoseconds }) as CapturedControl;
}

function frozenCounters(
  counters: ExactInputSplitSessionWorkCounters,
): ExactInputSplitWorkCounters {
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
  });
}

function search(
  counters: ExactInputSplitSessionWorkCounters,
  termination: ExactInputSplitRuntimeTermination,
): ExactInputSplitRuntimeSearchSummary {
  return Object.freeze({ counters: frozenCounters(counters), termination });
}

function finish(
  counters: ExactInputSplitSessionWorkCounters,
  termination: 'complete' | 'work-limit' | 'interrupted' | 'deadline',
  incumbent: ExactInputSplitReplayReceipt | undefined,
  hadCandidate: boolean,
): ExactInputSplitRuntimeResult {
  const summary = search(counters, termination);
  if (incumbent !== undefined) return Object.freeze({ status: 'success', plan: Object.freeze({ receipt: incumbent, search: summary }) });
  if (termination !== 'complete') return Object.freeze({ status: 'no-plan', reason: termination, search: summary });
  return Object.freeze({ status: 'no-route', reason: hadCandidate ? 'all-candidates-rejected' : 'no-candidate', search: summary });
}

function operationalResult(
  outcome: Exclude<
    ExactInputSplitReferencePolicyOutcome,
    { readonly outcome: 'complete' | 'work-limit' }
  >,
  counters: ExactInputSplitSessionWorkCounters,
  incumbent: ExactInputSplitReplayReceipt | undefined,
  hadCandidate: boolean,
): ExactInputSplitRuntimeResult {
  if (outcome.outcome === 'interrupted' || outcome.outcome === 'deadline') {
    return finish(counters, outcome.outcome, incumbent, hadCandidate);
  }
  if (outcome.outcome === 'control-error') {
    return Object.freeze({
      status: 'control-error',
      error: outcome.error,
      incumbent: incumbent ?? null,
      search: search(counters, 'control-error'),
    });
  }
  return Object.freeze({
    status: 'deadline-error',
    error: outcome.error,
    incumbent: incumbent ?? null,
    search: search(counters, 'deadline-error'),
  });
}

export function routeExactInputSplitAnytime(context: PreparedRoutingContext, sourceRequest: ExactInputSplitRuntimeRequest, sourceControl: ExactInputSplitRuntimeControl): ExactInputSplitRuntimeResult {
  const capturedRequest = captureRequest(sourceRequest);
  if ('status' in capturedRequest) return capturedRequest;
  const requestFailure = validateRequest(context, capturedRequest);
  if (requestFailure !== undefined) return requestFailure;
  const capturedControl = captureControl(sourceControl);
  if ('status' in capturedControl) return capturedControl;
  const shouldInterrupt = capturedControl.shouldInterrupt;
  const session = createExactInputSplitSession(context, capturedRequest, {
    workCaps: {
      ...capturedControl.caps,
      maxNumericalProposals: 0,
      maxNumericalIterations: 0,
      maxNumericalResidualReplays: 0,
      maxNumericalAuthorizationReplays: 0,
    },
    shouldInterrupt: shouldInterrupt === undefined
      ? undefined
      : (checkpoint: ExactInputSplitSessionCheckpoint) => shouldInterrupt(
          Object.freeze({
            nextWorkKind: checkpoint.nextWorkKind as ExactInputSplitRuntimeWorkKind,
            counters: frozenCounters(checkpoint.counters),
            incumbent: checkpoint.incumbent,
          }),
        ),
    deadlineNanoseconds: capturedControl.deadlineNanoseconds,
    nowNanoseconds: capturedControl.nowNanoseconds,
  });
  const outcome = runExactInputSplitReferencePolicy(session);
  const counters = exactInputSplitSessionCounters(session);
  const incumbent = exactInputSplitSessionIncumbent(session);
  const hadCandidate = exactInputSplitSessionHadCandidate(session);
  if (outcome.outcome !== 'complete' && outcome.outcome !== 'work-limit') {
    return operationalResult(outcome, counters, incumbent, hadCandidate);
  }
  return finish(counters, outcome.outcome, incumbent, hadCandidate);
}
