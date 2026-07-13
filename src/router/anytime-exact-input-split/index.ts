import type { ExactInputSplitReplayLegRequest, ExactInputSplitReplayReceipt } from '../../replay/exact-input-split/index.ts';
import type { DirectionalRouteHop } from '../../replay/exact-input-route/index.ts';
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
  type PreparedRoutingContext,
} from '../../runtime/prepared-routing-context/index.ts';
import {
  createSharedCandidateSetFrontier,
  expandSharedCandidateSetFrontier,
  hasSharedCandidateSetExpansion,
  materializeSharedCandidateSets,
} from '../../search/shared-route-discovery/index.ts';
import { isStrictlyBetterSplitReceipt } from '../split-exact-input/objective.ts';

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

type MutableCounters = { -readonly [Key in keyof ExactInputSplitWorkCounters]: number };
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

const KIND_CAP: Record<ExactInputSplitRuntimeWorkKind, keyof ExactInputSplitWorkCaps> = {
  'path-expansion': 'maxPathExpansions',
  'best-single-candidate-replay': 'maxBestSingleCandidateReplays',
  'candidate-set-expansion': 'maxCandidateSetExpansions',
  'equal-proposal-replay': 'maxEqualProposalReplays',
  'greedy-option-replay': 'maxGreedyOptionReplays',
  'final-authorization-replay': 'maxFinalAuthorizationReplays',
};

const KIND_COUNTER: Record<ExactInputSplitRuntimeWorkKind, keyof ExactInputSplitWorkCounters> = {
  'path-expansion': 'pathExpansions',
  'best-single-candidate-replay': 'bestSingleCandidateReplays',
  'candidate-set-expansion': 'candidateSetExpansions',
  'equal-proposal-replay': 'equalProposalReplays',
  'greedy-option-replay': 'greedyOptionReplays',
  'final-authorization-replay': 'finalAuthorizationReplays',
};

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

function freshCounters(): MutableCounters {
  return {
    directCandidates: 0, directCandidateReplays: 0, directCandidateRejections: 0,
    pathExpansions: 0, bestSingleCandidateReplays: 0, bestSingleCandidateRejections: 0,
    candidateSetExpansions: 0, equalProposalReplays: 0, equalProposalRejections: 0,
    greedyOptionReplays: 0, greedyOptionRejections: 0,
    finalAuthorizationReplays: 0, finalAuthorizationRejections: 0,
  };
}

function frozenCounters(counters: MutableCounters): ExactInputSplitWorkCounters {
  return Object.freeze({ ...counters });
}

function search(counters: MutableCounters, termination: ExactInputSplitRuntimeTermination): ExactInputSplitRuntimeSearchSummary {
  return Object.freeze({ counters: frozenCounters(counters), termination });
}

function finish(counters: MutableCounters, termination: 'complete' | 'work-limit' | 'interrupted' | 'deadline', incumbent: ExactInputSplitReplayReceipt | undefined, hadCandidate: boolean): ExactInputSplitRuntimeResult {
  const summary = search(counters, termination);
  if (incumbent !== undefined) return Object.freeze({ status: 'success', plan: Object.freeze({ receipt: incumbent, search: summary }) });
  if (termination !== 'complete') return Object.freeze({ status: 'no-plan', reason: termination, search: summary });
  return Object.freeze({ status: 'no-route', reason: hadCandidate ? 'all-candidates-rejected' : 'no-candidate', search: summary });
}

type Boundary =
  | { readonly outcome: 'execute' }
  | { readonly outcome: 'cap' }
  | { readonly outcome: 'result'; readonly result: ExactInputSplitRuntimeResult };

function boundary(kind: ExactInputSplitRuntimeWorkKind, control: CapturedControl, counters: MutableCounters, incumbent: ExactInputSplitReplayReceipt | undefined, priorClock: { value: bigint | undefined }): Boundary {
  if (counters[KIND_COUNTER[kind]] === control.caps[KIND_CAP[kind]]) return { outcome: 'cap' };
  if (control.shouldInterrupt !== undefined) {
    const checkpoint: ExactInputSplitRuntimeCheckpoint = Object.freeze({ nextWorkKind: kind, counters: frozenCounters(counters), incumbent: incumbent ?? null });
    let interrupted: unknown;
    const shouldInterrupt = control.shouldInterrupt;
    try { interrupted = shouldInterrupt(checkpoint); } catch {
      return { outcome: 'result', result: Object.freeze({ status: 'control-error', error: Object.freeze({ code: 'interruption-check-failed' }), incumbent: incumbent ?? null, search: search(counters, 'control-error') }) };
    }
    if (typeof interrupted !== 'boolean') return { outcome: 'result', result: Object.freeze({ status: 'control-error', error: Object.freeze({ code: 'invalid-interruption-result' }), incumbent: incumbent ?? null, search: search(counters, 'control-error') }) };
    if (interrupted) return { outcome: 'result', result: finish(counters, 'interrupted', incumbent, false) };
  }
  if (control.nowNanoseconds !== undefined) {
    let sample: unknown;
    const nowNanoseconds = control.nowNanoseconds;
    try { sample = nowNanoseconds(); } catch {
      return { outcome: 'result', result: Object.freeze({ status: 'deadline-error', error: Object.freeze({ code: 'deadline-clock-failed', field: 'nowNanoseconds' }), incumbent: incumbent ?? null, search: search(counters, 'deadline-error') }) };
    }
    if (typeof sample !== 'bigint' || sample < 0n) return { outcome: 'result', result: Object.freeze({ status: 'deadline-error', error: Object.freeze({ code: 'deadline-clock-failed', field: 'nowNanoseconds' }), incumbent: incumbent ?? null, search: search(counters, 'deadline-error') }) };
    if (priorClock.value !== undefined && sample < priorClock.value) return { outcome: 'result', result: Object.freeze({ status: 'deadline-error', error: Object.freeze({ code: 'deadline-clock-regressed', field: 'nowNanoseconds' }), incumbent: incumbent ?? null, search: search(counters, 'deadline-error') }) };
    priorClock.value = sample;
    if (sample >= control.deadlineNanoseconds!) return { outcome: 'result', result: finish(counters, 'deadline', incumbent, false) };
  }
  return { outcome: 'execute' };
}

function replayRequest(request: ExactInputSplitRuntimeRequest, legs: readonly ExactInputSplitReplayLegRequest[]) {
  return Object.freeze({ snapshotId: request.snapshotId, snapshotChecksum: request.snapshotChecksum, assetIn: request.assetIn, assetOut: request.assetOut, amountIn: legs.reduce((sum, leg) => sum + leg.allocation, 0n), legs: Object.freeze(legs) });
}

function fullReplayRequest(request: ExactInputSplitRuntimeRequest, legs: readonly ExactInputSplitReplayLegRequest[]) {
  return Object.freeze({ snapshotId: request.snapshotId, snapshotChecksum: request.snapshotChecksum, assetIn: request.assetIn, assetOut: request.assetOut, amountIn: request.amountIn, legs: Object.freeze(legs) });
}

function* positiveChunks(amountIn: bigint, parts: number): Generator<bigint> {
  const divisor = BigInt(parts);
  const base = amountIn / divisor;
  const remainder = amountIn % divisor;
  if (base === 0n) {
    for (let index = 0n; index < remainder; index += 1n) yield 1n;
  } else {
    for (let index = 0; index < parts; index += 1) yield base + (BigInt(index) < remainder ? 1n : 0n);
  }
}

function positiveLegs(routes: readonly (readonly DirectionalRouteHop[])[], allocations: readonly bigint[]): readonly ExactInputSplitReplayLegRequest[] {
  return Object.freeze(routes.flatMap((route, index) => allocations[index] === 0n ? [] : [Object.freeze({ allocation: allocations[index]!, route })]));
}

interface SplitProposal {
  readonly key: string;
  readonly receipt: ExactInputSplitReplayReceipt;
  readonly legs: readonly ExactInputSplitReplayLegRequest[];
}

function proposalKey(legs: readonly ExactInputSplitReplayLegRequest[]): string {
  return JSON.stringify(legs.map((leg) => ({
    allocation: leg.allocation.toString(10),
    route: leg.route.map(({ assetIn, poolId, assetOut }) => ({ assetIn, poolId, assetOut })),
  })));
}

function compareProposals(left: SplitProposal, right: SplitProposal): number {
  if (isStrictlyBetterSplitReceipt(left.receipt, right.receipt)) return -1;
  if (isStrictlyBetterSplitReceipt(right.receipt, left.receipt)) return 1;
  if (left.key < right.key) return -1;
  if (left.key > right.key) return 1;
  return 0;
}

export function routeExactInputSplitAnytime(context: PreparedRoutingContext, sourceRequest: ExactInputSplitRuntimeRequest, sourceControl: ExactInputSplitRuntimeControl): ExactInputSplitRuntimeResult {
  const capturedRequest = captureRequest(sourceRequest);
  if ('status' in capturedRequest) return capturedRequest;
  const requestFailure = validateRequest(context, capturedRequest);
  if (requestFailure !== undefined) return requestFailure;
  const capturedControl = captureControl(sourceControl);
  if ('status' in capturedControl) return capturedControl;

  const counters = freshCounters();
  let incumbent: ExactInputSplitReplayReceipt | undefined;
  let hadCandidate = false;
  let workLimited = false;
  const priorClock: { value: bigint | undefined } = { value: undefined };
  const proposals = new Map<string, SplitProposal>();

  const directRoutes = preparedDirectRoutes(context, capturedRequest.assetIn, capturedRequest.assetOut);
  for (const route of directRoutes) {
    hadCandidate = true;
    counters.directCandidates += 1;
    counters.directCandidateReplays += 1;
    const replay = replayPreparedExactInputSplit(context, fullReplayRequest(capturedRequest, [Object.freeze({ allocation: capturedRequest.amountIn, route })]));
    if (!replay.ok) counters.directCandidateRejections += 1;
    else if (incumbent === undefined || isStrictlyBetterSplitReceipt(replay.value, incumbent)) incumbent = replay.value;
  }

  const collectProposal = (
    receipt: ExactInputSplitReplayReceipt,
    legs: readonly ExactInputSplitReplayLegRequest[],
  ): void => {
    const key = proposalKey(legs);
    if (!proposals.has(key)) proposals.set(key, Object.freeze({ key, receipt, legs }));
  };

  const pathFrontier = createPreparedSimplePathFrontier(context, capturedRequest);
  while (hasPreparedSimplePathExpansion(pathFrontier)) {
    const stop = boundary('path-expansion', capturedControl, counters, incumbent, priorClock);
    if (stop.outcome === 'cap') { workLimited = true; break; }
    if (stop.outcome === 'result') return stop.result;
    expandPreparedSimplePathFrontier(pathFrontier);
    counters.pathExpansions += 1;
  }
  const paths = materializePreparedSimplePaths(pathFrontier);
  hadCandidate ||= paths.length > 0;

  for (const route of paths) {
    const stop = boundary('best-single-candidate-replay', capturedControl, counters, incumbent, priorClock);
    if (stop.outcome === 'cap') { workLimited = true; break; }
    if (stop.outcome === 'result') return stop.result;
    counters.bestSingleCandidateReplays += 1;
    const legs = Object.freeze([Object.freeze({ allocation: capturedRequest.amountIn, route })]);
    const replay = replayPreparedExactInputSplit(context, fullReplayRequest(capturedRequest, legs));
    if (!replay.ok) counters.bestSingleCandidateRejections += 1;
    else if (incumbent === undefined || isStrictlyBetterSplitReceipt(replay.value, incumbent)) incumbent = replay.value;
  }

  const setFrontier = createSharedCandidateSetFrontier(paths, capturedRequest.maxRoutes);
  while (hasSharedCandidateSetExpansion(setFrontier)) {
    const stop = boundary('candidate-set-expansion', capturedControl, counters, incumbent, priorClock);
    if (stop.outcome === 'cap') { workLimited = true; break; }
    if (stop.outcome === 'result') return stop.result;
    expandSharedCandidateSetFrontier(setFrontier);
    counters.candidateSetExpansions += 1;
  }
  const candidateSets = materializeSharedCandidateSets(setFrontier);

  for (const { routes } of candidateSets) {
    const cardinality = BigInt(routes.length);
    const base = capturedRequest.amountIn / cardinality;
    if (base === 0n) continue;
    const remainder = capturedRequest.amountIn % cardinality;
    const legs = Object.freeze(routes.map((route, index) => Object.freeze({ allocation: base + (BigInt(index) < remainder ? 1n : 0n), route })));
    const stop = boundary('equal-proposal-replay', capturedControl, counters, incumbent, priorClock);
    if (stop.outcome === 'cap') { workLimited = true; break; }
    if (stop.outcome === 'result') return stop.result;
    counters.equalProposalReplays += 1;
    const replay = replayPreparedExactInputSplit(context, fullReplayRequest(capturedRequest, legs));
    if (!replay.ok) counters.equalProposalRejections += 1;
    else collectProposal(replay.value, legs);
  }

  candidateSets: for (const { routes } of candidateSets) {
    const allocations = routes.map(() => 0n);
    let allocated = 0n;
    let finalProposal: ExactInputSplitReplayReceipt | undefined;
    for (const chunk of positiveChunks(capturedRequest.amountIn, capturedRequest.greedyParts)) {
      let winningIndex: number | undefined;
      let winningOutput: bigint | undefined;
      let winningReceipt: ExactInputSplitReplayReceipt | undefined;
      for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
        const stop = boundary('greedy-option-replay', capturedControl, counters, incumbent, priorClock);
        if (stop.outcome === 'cap') { workLimited = true; break candidateSets; }
        if (stop.outcome === 'result') return stop.result;
        const optionAllocations = [...allocations];
        optionAllocations[routeIndex] = optionAllocations[routeIndex]! + chunk;
        counters.greedyOptionReplays += 1;
        const replay = replayPreparedExactInputSplit(context, replayRequest(capturedRequest, positiveLegs(routes, optionAllocations)));
        if (!replay.ok) { counters.greedyOptionRejections += 1; continue; }
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
    ) continue;
    const stop = boundary(
      'final-authorization-replay',
      capturedControl,
      counters,
      incumbent,
      priorClock,
    );
    if (stop.outcome === 'cap') { workLimited = true; break; }
    if (stop.outcome === 'result') return stop.result;
    counters.finalAuthorizationReplays += 1;
    const replay = replayPreparedExactInputSplit(
      context,
      fullReplayRequest(capturedRequest, proposal.legs),
    );
    if (!replay.ok) counters.finalAuthorizationRejections += 1;
    else if (
      incumbent === undefined ||
      isStrictlyBetterSplitReceipt(replay.value, incumbent)
    ) incumbent = replay.value;
  }

  return finish(counters, workLimited ? 'work-limit' : 'complete', incumbent, hadCandidate);
}
