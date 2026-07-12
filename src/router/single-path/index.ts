import type { ConstantProductPool, LiquiditySnapshot } from '../../domain/index.ts';
import {
  replayExactInputRoute,
  type ExactInputRouteReplayReceipt,
} from '../../replay/exact-input-route/index.ts';
import {
  buildDeterministicAdjacency,
  enumerateSimplePaths,
  type DeterministicAdjacencyIndex,
  type SimplePathEnumerationError,
} from '../../search/simple-paths/index.ts';
import {
  cloneFrozenSimplePathTraversal,
  createSimplePathTraversal,
  expandSimplePathTraversal,
  freezeSimplePathTraversal,
  normalizeSimplePathTraversal,
  type FrozenSimplePathTraversalState,
  type SimplePathTraversalState,
} from '../../search/simple-paths/traversal.ts';

export interface ExactInputSinglePathRouterRequest {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly maxHops: number;
  readonly maxExpansions: number;
}

export interface ExactInputSinglePathSearchSummary {
  readonly expansions: number;
  readonly enumeratedCandidates: number;
  readonly replayedCandidates: number;
  readonly rejectedCandidates: number;
  readonly termination: 'complete' | 'work-limit';
}

export interface ExactInputSinglePathPlan {
  readonly receipt: ExactInputRouteReplayReceipt;
  readonly search: ExactInputSinglePathSearchSummary;
}

export interface ExactInputSinglePathInterruptibleSearchSummary {
  readonly establishment: ExactInputSinglePathEstablishmentSummary;
  readonly expansions: number;
  readonly enumeratedCandidates: number;
  readonly replayedCandidates: number;
  readonly rejectedCandidates: number;
  readonly termination: 'complete' | 'work-limit' | 'interrupted';
}

export interface ExactInputSinglePathEstablishmentSummary {
  readonly enumeratedCandidates: number;
  readonly replayedCandidates: number;
  readonly rejectedCandidates: number;
}

export interface ExactInputSinglePathInterruptiblePlan {
  readonly receipt: ExactInputRouteReplayReceipt;
  readonly search: ExactInputSinglePathInterruptibleSearchSummary;
}

export interface ExactInputSinglePathInterruptionCheckpoint {
  readonly establishment: ExactInputSinglePathEstablishmentSummary;
  readonly expansions: number;
  readonly enumeratedCandidates: number;
  readonly replayedCandidates: number;
  readonly rejectedCandidates: number;
  readonly incumbent: ExactInputRouteReplayReceipt | null;
}

export interface ExactInputSinglePathInterruptionControl {
  readonly shouldInterrupt: (
    checkpoint: ExactInputSinglePathInterruptionCheckpoint,
  ) => boolean;
}

export interface ExactInputSinglePathInterruptionControlError {
  readonly code: 'interruption-check-failed';
}

export interface ExactInputSinglePathResumableCheckpoint {
  readonly kind: 'routelab.in-memory-router-checkpoint.v1';
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly maxHops: number;
  readonly establishment: ExactInputSinglePathEstablishmentSummary;
  readonly expansions: number;
  readonly enumeratedCandidates: number;
  readonly replayedCandidates: number;
  readonly rejectedCandidates: number;
  readonly incumbent: ExactInputRouteReplayReceipt | null;
}

export interface ExactInputSinglePathDeadlineControl {
  readonly deadlineNanoseconds: bigint;
  readonly nowNanoseconds: () => bigint;
}

export interface ExactInputSinglePathDeadlineSearchSummary {
  readonly establishment: ExactInputSinglePathEstablishmentSummary;
  readonly expansions: number;
  readonly enumeratedCandidates: number;
  readonly replayedCandidates: number;
  readonly rejectedCandidates: number;
  readonly termination: 'complete' | 'work-limit' | 'deadline';
}

export interface ExactInputSinglePathDeadlinePlan {
  readonly receipt: ExactInputRouteReplayReceipt;
  readonly search: ExactInputSinglePathDeadlineSearchSummary;
}

export type ExactInputSinglePathDeadlineError =
  | {
      readonly code: 'invalid-deadline-nanoseconds';
      readonly field: 'deadlineNanoseconds';
    }
  | {
      readonly code: 'deadline-clock-failed';
      readonly field: 'nowNanoseconds';
    }
  | {
      readonly code: 'deadline-clock-regressed';
      readonly field: 'nowNanoseconds';
    };

export type ExactInputSinglePathInvalidResumeError =
  | {
      readonly code: 'invalid-router-checkpoint';
      readonly field: 'checkpoint';
    }
  | {
      readonly code: 'invalid-resume-max-expansions';
      readonly field: 'maxExpansions';
    };

export type ExactInputSinglePathRouterValidationErrorCode =
  | 'snapshot-identity-mismatch'
  | 'empty-identifier'
  | 'nonpositive-input'
  | 'same-asset-request'
  | 'invalid-max-hops'
  | 'invalid-max-expansions'
  | 'unknown-asset';

export type ExactInputSinglePathRouterValidationErrorField =
  | 'snapshotIdentity'
  | 'assetIn'
  | 'assetOut'
  | 'amountIn'
  | 'maxHops'
  | 'maxExpansions';

export interface ExactInputSinglePathRouterValidationError {
  readonly code: ExactInputSinglePathRouterValidationErrorCode;
  readonly field: ExactInputSinglePathRouterValidationErrorField;
  readonly message: string;
}

export type ExactInputSinglePathRouterResult =
  | {
      readonly status: 'success';
      readonly plan: ExactInputSinglePathPlan;
    }
  | {
      readonly status: 'no-route';
      readonly reason: 'no-candidate' | 'all-candidates-rejected';
      readonly search: ExactInputSinglePathSearchSummary;
    }
  | {
      readonly status: 'no-plan';
      readonly reason: 'work-limit';
      readonly search: ExactInputSinglePathSearchSummary;
    }
  | {
      readonly status: 'invalid-request';
      readonly error: ExactInputSinglePathRouterValidationError;
    };

export type ExactInputSinglePathInterruptibleResult =
  | {
      readonly status: 'success';
      readonly plan: ExactInputSinglePathInterruptiblePlan;
    }
  | {
      readonly status: 'no-route';
      readonly reason: 'no-candidate' | 'all-candidates-rejected';
      readonly search: ExactInputSinglePathInterruptibleSearchSummary;
    }
  | {
      readonly status: 'no-plan';
      readonly reason: 'work-limit' | 'interrupted';
      readonly search: ExactInputSinglePathInterruptibleSearchSummary;
    }
  | {
      readonly status: 'invalid-request';
      readonly error: ExactInputSinglePathRouterValidationError;
    }
  | {
      readonly status: 'control-error';
      readonly error: ExactInputSinglePathInterruptionControlError;
    };

export type ExactInputSinglePathResumableResult =
  | {
      readonly status: 'success';
      readonly plan: ExactInputSinglePathInterruptiblePlan;
      readonly checkpoint: ExactInputSinglePathResumableCheckpoint | null;
    }
  | {
      readonly status: 'no-route';
      readonly reason: 'no-candidate' | 'all-candidates-rejected';
      readonly search: ExactInputSinglePathInterruptibleSearchSummary;
      readonly checkpoint: null;
    }
  | {
      readonly status: 'no-plan';
      readonly reason: 'work-limit' | 'interrupted';
      readonly search: ExactInputSinglePathInterruptibleSearchSummary;
      readonly checkpoint: ExactInputSinglePathResumableCheckpoint;
    }
  | {
      readonly status: 'invalid-request';
      readonly error: ExactInputSinglePathRouterValidationError;
    }
  | {
      readonly status: 'control-error';
      readonly error: ExactInputSinglePathInterruptionControlError;
    }
  | {
      readonly status: 'invalid-resume';
      readonly error: ExactInputSinglePathInvalidResumeError;
    };

export type ExactInputSinglePathDeadlineResult =
  | {
      readonly status: 'success';
      readonly plan: ExactInputSinglePathDeadlinePlan;
      readonly checkpoint: ExactInputSinglePathResumableCheckpoint | null;
    }
  | {
      readonly status: 'no-route';
      readonly reason: 'no-candidate' | 'all-candidates-rejected';
      readonly search: ExactInputSinglePathDeadlineSearchSummary;
      readonly checkpoint: null;
    }
  | {
      readonly status: 'no-plan';
      readonly reason: 'work-limit' | 'deadline';
      readonly search: ExactInputSinglePathDeadlineSearchSummary;
      readonly checkpoint: ExactInputSinglePathResumableCheckpoint;
    }
  | {
      readonly status: 'invalid-request';
      readonly error: ExactInputSinglePathRouterValidationError;
    }
  | {
      readonly status: 'invalid-resume';
      readonly error: ExactInputSinglePathInvalidResumeError;
    }
  | {
      readonly status: 'deadline-error';
      readonly error: ExactInputSinglePathDeadlineError;
    };

type ExactInputSinglePathInvalidRequestResult = Extract<
  ExactInputSinglePathRouterResult,
  { readonly status: 'invalid-request' }
>;

function validationFailure(
  code: ExactInputSinglePathRouterValidationErrorCode,
  field: ExactInputSinglePathRouterValidationErrorField,
  message: string,
): ExactInputSinglePathInvalidRequestResult {
  const error: ExactInputSinglePathRouterValidationError = Object.freeze({
    code,
    field,
    message,
  });
  return Object.freeze({ status: 'invalid-request', error });
}

function validateRequest(
  snapshot: LiquiditySnapshot,
  request: ExactInputSinglePathRouterRequest,
  knownAssets: ReadonlySet<string>,
): ExactInputSinglePathInvalidRequestResult | undefined {
  if (
    request.snapshotId !== snapshot.snapshotId ||
    request.snapshotChecksum !== snapshot.snapshotChecksum
  ) {
    return validationFailure(
      'snapshot-identity-mismatch',
      'snapshotIdentity',
      'Request snapshotId and snapshotChecksum must match the supplied snapshot.',
    );
  }
  if (request.assetIn.length === 0) {
    return validationFailure(
      'empty-identifier',
      'assetIn',
      'request.assetIn must not be empty.',
    );
  }
  if (request.assetOut.length === 0) {
    return validationFailure(
      'empty-identifier',
      'assetOut',
      'request.assetOut must not be empty.',
    );
  }
  if (request.amountIn <= 0n) {
    return validationFailure(
      'nonpositive-input',
      'amountIn',
      'request.amountIn must be positive.',
    );
  }
  if (request.assetIn === request.assetOut) {
    return validationFailure(
      'same-asset-request',
      'assetOut',
      'request.assetIn and request.assetOut must be distinct.',
    );
  }
  if (!Number.isSafeInteger(request.maxHops) || request.maxHops <= 0) {
    return validationFailure(
      'invalid-max-hops',
      'maxHops',
      'request.maxHops must be a positive safe integer.',
    );
  }
  if (!Number.isSafeInteger(request.maxExpansions) || request.maxExpansions < 0) {
    return validationFailure(
      'invalid-max-expansions',
      'maxExpansions',
      'request.maxExpansions must be a nonnegative safe integer.',
    );
  }
  if (!knownAssets.has(request.assetIn)) {
    return validationFailure(
      'unknown-asset',
      'assetIn',
      'request.assetIn must exist in the supplied snapshot.',
    );
  }
  if (!knownAssets.has(request.assetOut)) {
    return validationFailure(
      'unknown-asset',
      'assetOut',
      'request.assetOut must exist in the supplied snapshot.',
    );
  }
  return undefined;
}

function enumerationFailure(
  error: SimplePathEnumerationError,
): ExactInputSinglePathRouterResult {
  return validationFailure(error.code, error.field, error.message);
}

function compareRawUtf16(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareReceiptRoutes(
  left: ExactInputRouteReplayReceipt,
  right: ExactInputRouteReplayReceipt,
): number {
  const sharedLength = Math.min(left.hops.length, right.hops.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const leftHop = left.hops[index];
    const rightHop = right.hops[index];
    if (leftHop === undefined || rightHop === undefined) {
      throw new Error('Receipt route comparison reached an unavailable hop.');
    }

    const comparison =
      compareRawUtf16(leftHop.assetIn, rightHop.assetIn) ||
      compareRawUtf16(leftHop.poolId, rightHop.poolId) ||
      compareRawUtf16(leftHop.assetOut, rightHop.assetOut);
    if (comparison !== 0) return comparison;
  }
  return left.hops.length - right.hops.length;
}

function isStrictlyBetter(
  candidate: ExactInputRouteReplayReceipt,
  incumbent: ExactInputRouteReplayReceipt,
): boolean {
  if (candidate.amountOut !== incumbent.amountOut) {
    return candidate.amountOut > incumbent.amountOut;
  }
  if (candidate.hops.length !== incumbent.hops.length) {
    return candidate.hops.length < incumbent.hops.length;
  }
  return compareReceiptRoutes(candidate, incumbent) < 0;
}

function frozenSearchSummary(
  expansions: number,
  enumeratedCandidates: number,
  replayedCandidates: number,
  rejectedCandidates: number,
  termination: 'complete' | 'work-limit',
): ExactInputSinglePathSearchSummary {
  return Object.freeze({
    expansions,
    enumeratedCandidates,
    replayedCandidates,
    rejectedCandidates,
    termination,
  });
}

function frozenInterruptibleSearchSummary(
  establishment: ExactInputSinglePathEstablishmentSummary,
  expansions: number,
  enumeratedCandidates: number,
  replayedCandidates: number,
  rejectedCandidates: number,
  termination: 'complete' | 'work-limit' | 'interrupted',
): ExactInputSinglePathInterruptibleSearchSummary {
  return Object.freeze({
    establishment,
    expansions,
    enumeratedCandidates,
    replayedCandidates,
    rejectedCandidates,
    termination,
  });
}

function frozenEstablishmentSummary(
  enumeratedCandidates: number,
  replayedCandidates: number,
  rejectedCandidates: number,
): ExactInputSinglePathEstablishmentSummary {
  return Object.freeze({
    enumeratedCandidates,
    replayedCandidates,
    rejectedCandidates,
  });
}

function interruptionControlFailure(): Extract<
  ExactInputSinglePathInterruptibleResult,
  { readonly status: 'control-error' }
> {
  const error: ExactInputSinglePathInterruptionControlError = Object.freeze({
    code: 'interruption-check-failed',
  });
  return Object.freeze({ status: 'control-error', error });
}

function captureInterruptiblePool(pool: ConstantProductPool): ConstantProductPool {
  return Object.freeze({
    poolId: pool.poolId,
    asset0: pool.asset0,
    reserve0: pool.reserve0,
    asset1: pool.asset1,
    reserve1: pool.reserve1,
    feeChargedNumerator: pool.feeChargedNumerator,
    feeDenominator: pool.feeDenominator,
  });
}

function captureInterruptibleSnapshot(snapshot: LiquiditySnapshot): LiquiditySnapshot {
  const snapshotId = snapshot.snapshotId;
  const snapshotChecksum = snapshot.snapshotChecksum;
  const sourcePools = snapshot.pools;
  const pools = Object.freeze(Array.from(sourcePools, captureInterruptiblePool));
  return Object.freeze({ snapshotId, snapshotChecksum, pools });
}

function captureInterruptibleRequest(
  request: ExactInputSinglePathRouterRequest,
): ExactInputSinglePathRouterRequest {
  return Object.freeze({
    snapshotId: request.snapshotId,
    snapshotChecksum: request.snapshotChecksum,
    assetIn: request.assetIn,
    assetOut: request.assetOut,
    amountIn: request.amountIn,
    maxHops: request.maxHops,
    maxExpansions: request.maxExpansions,
  });
}

interface ExactInputSinglePathResumeBinding {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly maxHops: number;
}

interface ExactInputSinglePathResumableExecutionState {
  readonly snapshot: LiquiditySnapshot;
  readonly request: ExactInputSinglePathResumeBinding;
  readonly traversal: SimplePathTraversalState;
  readonly establishment: ExactInputSinglePathEstablishmentSummary;
  incumbent: ExactInputRouteReplayReceipt | undefined;
  enumeratedCandidates: number;
  replayedCandidates: number;
  rejectedCandidates: number;
}

interface ExactInputSinglePathHiddenCheckpointState {
  readonly snapshot: LiquiditySnapshot;
  readonly request: ExactInputSinglePathResumeBinding;
  readonly traversal: FrozenSimplePathTraversalState;
  readonly establishment: ExactInputSinglePathEstablishmentSummary;
  readonly incumbent: ExactInputRouteReplayReceipt | null;
  readonly enumeratedCandidates: number;
  readonly replayedCandidates: number;
  readonly rejectedCandidates: number;
}

interface ExactInputSinglePathEstablishedIncumbent {
  readonly summary: ExactInputSinglePathEstablishmentSummary;
  readonly incumbent: ExactInputRouteReplayReceipt | undefined;
}

function establishDirectIncumbent(
  snapshot: LiquiditySnapshot,
  request: ExactInputSinglePathResumeBinding,
  adjacency: DeterministicAdjacencyIndex,
): ExactInputSinglePathEstablishedIncumbent {
  const bucket = adjacency.buckets.find(({ assetIn }) => assetIn === request.assetIn);
  const candidates =
    bucket?.edges.filter(({ assetOut }) => assetOut === request.assetOut) ?? [];
  let incumbent: ExactInputRouteReplayReceipt | undefined;
  let replayedCandidates = 0;
  let rejectedCandidates = 0;

  for (const candidate of candidates) {
    const replay = replayExactInputRoute(snapshot, {
      snapshotId: request.snapshotId,
      snapshotChecksum: request.snapshotChecksum,
      assetIn: request.assetIn,
      assetOut: request.assetOut,
      amountIn: request.amountIn,
      hops: Object.freeze([candidate]),
    });
    replayedCandidates += 1;
    if (!replay.ok) {
      rejectedCandidates += 1;
      continue;
    }
    if (incumbent === undefined || isStrictlyBetter(replay.value, incumbent)) {
      incumbent = replay.value;
    }
  }

  return Object.freeze({
    summary: frozenEstablishmentSummary(
      candidates.length,
      replayedCandidates,
      rejectedCandidates,
    ),
    incumbent,
  });
}

const resumableCheckpointStates = new WeakMap<
  ExactInputSinglePathResumableCheckpoint,
  ExactInputSinglePathHiddenCheckpointState
>();

function frozenResumeBinding(
  request: ExactInputSinglePathRouterRequest,
): ExactInputSinglePathResumeBinding {
  return Object.freeze({
    snapshotId: request.snapshotId,
    snapshotChecksum: request.snapshotChecksum,
    assetIn: request.assetIn,
    assetOut: request.assetOut,
    amountIn: request.amountIn,
    maxHops: request.maxHops,
  });
}

function invalidResume(
  error: ExactInputSinglePathInvalidResumeError,
): ExactInputSinglePathResumableResult {
  return Object.freeze({ status: 'invalid-resume', error: Object.freeze(error) });
}

function capturedInterruptionControl(
  control: ExactInputSinglePathInterruptionControl,
): ExactInputSinglePathInterruptionControl['shouldInterrupt'] | undefined {
  try {
    const shouldInterrupt = control.shouldInterrupt;
    return typeof shouldInterrupt === 'function' ? shouldInterrupt : undefined;
  } catch {
    return undefined;
  }
}

export function routeExactInputSinglePath(
  snapshot: LiquiditySnapshot,
  request: ExactInputSinglePathRouterRequest,
): ExactInputSinglePathRouterResult {
  const adjacency = buildDeterministicAdjacency(snapshot);
  const knownAssets = new Set(adjacency.buckets.map((bucket) => bucket.assetIn));
  const requestFailure = validateRequest(snapshot, request, knownAssets);
  if (requestFailure !== undefined) return requestFailure;

  const enumeration = enumerateSimplePaths(adjacency, {
    snapshotId: request.snapshotId,
    snapshotChecksum: request.snapshotChecksum,
    assetIn: request.assetIn,
    assetOut: request.assetOut,
    maxHops: request.maxHops,
    maxExpansions: request.maxExpansions,
  });
  if (!enumeration.ok) return enumerationFailure(enumeration.error);

  let incumbent: ExactInputRouteReplayReceipt | undefined;
  let replayedCandidates = 0;
  let rejectedCandidates = 0;

  for (const path of enumeration.value.paths) {
    const replay = replayExactInputRoute(snapshot, {
      snapshotId: request.snapshotId,
      snapshotChecksum: request.snapshotChecksum,
      assetIn: request.assetIn,
      assetOut: request.assetOut,
      amountIn: request.amountIn,
      hops: path,
    });
    replayedCandidates += 1;

    if (!replay.ok) {
      rejectedCandidates += 1;
      continue;
    }
    if (incumbent === undefined || isStrictlyBetter(replay.value, incumbent)) {
      incumbent = replay.value;
    }
  }

  const search = frozenSearchSummary(
    enumeration.value.expansions,
    enumeration.value.paths.length,
    replayedCandidates,
    rejectedCandidates,
    enumeration.value.termination,
  );

  if (incumbent !== undefined) {
    const plan: ExactInputSinglePathPlan = Object.freeze({ receipt: incumbent, search });
    return Object.freeze({ status: 'success', plan });
  }

  if (enumeration.value.termination === 'work-limit') {
    return Object.freeze({ status: 'no-plan', reason: 'work-limit', search });
  }

  const reason =
    enumeration.value.paths.length === 0
      ? ('no-candidate' as const)
      : ('all-candidates-rejected' as const);
  return Object.freeze({ status: 'no-route', reason, search });
}

export function routeExactInputSinglePathInterruptible(
  snapshot: LiquiditySnapshot,
  request: ExactInputSinglePathRouterRequest,
  control: ExactInputSinglePathInterruptionControl,
): ExactInputSinglePathInterruptibleResult {
  const capturedSnapshot = captureInterruptibleSnapshot(snapshot);
  const capturedRequest = captureInterruptibleRequest(request);
  const adjacency = buildDeterministicAdjacency(capturedSnapshot);
  const knownAssets = new Set(adjacency.buckets.map((bucket) => bucket.assetIn));
  const requestFailure = validateRequest(capturedSnapshot, capturedRequest, knownAssets);
  if (requestFailure !== undefined) return requestFailure;

  let shouldInterrupt: ExactInputSinglePathInterruptionControl['shouldInterrupt'];
  try {
    const capturedControl = control.shouldInterrupt;
    if (typeof capturedControl !== 'function') return interruptionControlFailure();
    shouldInterrupt = capturedControl;
  } catch {
    return interruptionControlFailure();
  }

  const traversal = createSimplePathTraversal(adjacency, {
    assetIn: capturedRequest.assetIn,
    assetOut: capturedRequest.assetOut,
    maxHops: capturedRequest.maxHops,
  });
  const establishment = establishDirectIncumbent(
    capturedSnapshot,
    capturedRequest,
    adjacency,
  );
  let incumbent = establishment.incumbent;
  let enumeratedCandidates = 0;
  let replayedCandidates = 0;
  let rejectedCandidates = 0;

  const finish = (
    termination: 'complete' | 'work-limit' | 'interrupted',
  ): ExactInputSinglePathInterruptibleResult => {
    const search = frozenInterruptibleSearchSummary(
      establishment.summary,
      traversal.expansions,
      enumeratedCandidates,
      replayedCandidates,
      rejectedCandidates,
      termination,
    );
    if (incumbent !== undefined) {
      const plan: ExactInputSinglePathInterruptiblePlan = Object.freeze({
        receipt: incumbent,
        search,
      });
      return Object.freeze({ status: 'success', plan });
    }
    if (termination !== 'complete') {
      return Object.freeze({ status: 'no-plan', reason: termination, search });
    }
    const reason =
      enumeratedCandidates === 0
        ? ('no-candidate' as const)
        : ('all-candidates-rejected' as const);
    return Object.freeze({ status: 'no-route', reason, search });
  };

  while (true) {
    if (normalizeSimplePathTraversal(traversal)) return finish('complete');
    if (traversal.expansions === capturedRequest.maxExpansions) {
      return finish('work-limit');
    }

    const checkpoint: ExactInputSinglePathInterruptionCheckpoint = Object.freeze({
      establishment: establishment.summary,
      expansions: traversal.expansions,
      enumeratedCandidates,
      replayedCandidates,
      rejectedCandidates,
      incumbent: incumbent ?? null,
    });
    try {
      if (shouldInterrupt(checkpoint)) return finish('interrupted');
    } catch {
      return interruptionControlFailure();
    }

    const completedPath = expandSimplePathTraversal(traversal);
    if (completedPath === undefined) continue;

    enumeratedCandidates += 1;
    const replay = replayExactInputRoute(capturedSnapshot, {
      snapshotId: capturedRequest.snapshotId,
      snapshotChecksum: capturedRequest.snapshotChecksum,
      assetIn: capturedRequest.assetIn,
      assetOut: capturedRequest.assetOut,
      amountIn: capturedRequest.amountIn,
      hops: completedPath,
    });
    replayedCandidates += 1;
    if (!replay.ok) {
      rejectedCandidates += 1;
      continue;
    }
    if (incumbent === undefined || isStrictlyBetter(replay.value, incumbent)) {
      incumbent = replay.value;
    }
  }
}

function createResumableCheckpoint(
  state: ExactInputSinglePathResumableExecutionState,
): ExactInputSinglePathResumableCheckpoint {
  const hiddenState: ExactInputSinglePathHiddenCheckpointState = Object.freeze({
    snapshot: state.snapshot,
    request: state.request,
    traversal: freezeSimplePathTraversal(state.traversal),
    establishment: state.establishment,
    incumbent: state.incumbent ?? null,
    enumeratedCandidates: state.enumeratedCandidates,
    replayedCandidates: state.replayedCandidates,
    rejectedCandidates: state.rejectedCandidates,
  });
  const checkpoint: ExactInputSinglePathResumableCheckpoint = Object.freeze({
    kind: 'routelab.in-memory-router-checkpoint.v1',
    snapshotId: state.request.snapshotId,
    snapshotChecksum: state.request.snapshotChecksum,
    assetIn: state.request.assetIn,
    assetOut: state.request.assetOut,
    amountIn: state.request.amountIn,
    maxHops: state.request.maxHops,
    establishment: state.establishment,
    expansions: state.traversal.expansions,
    enumeratedCandidates: state.enumeratedCandidates,
    replayedCandidates: state.replayedCandidates,
    rejectedCandidates: state.rejectedCandidates,
    incumbent: state.incumbent ?? null,
  });
  resumableCheckpointStates.set(checkpoint, hiddenState);
  return checkpoint;
}

function cloneResumableExecutionState(
  hidden: ExactInputSinglePathHiddenCheckpointState,
): ExactInputSinglePathResumableExecutionState {
  return {
    snapshot: hidden.snapshot,
    request: hidden.request,
    traversal: cloneFrozenSimplePathTraversal(hidden.traversal),
    establishment: hidden.establishment,
    incumbent: hidden.incumbent ?? undefined,
    enumeratedCandidates: hidden.enumeratedCandidates,
    replayedCandidates: hidden.replayedCandidates,
    rejectedCandidates: hidden.rejectedCandidates,
  };
}

function finishResumableExecution(
  state: ExactInputSinglePathResumableExecutionState,
  termination: 'complete' | 'work-limit' | 'interrupted',
): ExactInputSinglePathResumableResult {
  const search = frozenInterruptibleSearchSummary(
    state.establishment,
    state.traversal.expansions,
    state.enumeratedCandidates,
    state.replayedCandidates,
    state.rejectedCandidates,
    termination,
  );
  const checkpoint =
    termination === 'complete' ? null : createResumableCheckpoint(state);

  if (state.incumbent !== undefined) {
    const plan: ExactInputSinglePathInterruptiblePlan = Object.freeze({
      receipt: state.incumbent,
      search,
    });
    return Object.freeze({ status: 'success', plan, checkpoint });
  }
  if (termination !== 'complete') {
    if (checkpoint === null) {
      throw new Error('Paused resumable outcome requires a checkpoint.');
    }
    return Object.freeze({
      status: 'no-plan',
      reason: termination,
      search,
      checkpoint,
    });
  }
  const reason =
    state.enumeratedCandidates === 0
      ? ('no-candidate' as const)
      : ('all-candidates-rejected' as const);
  return Object.freeze({ status: 'no-route', reason, search, checkpoint: null });
}

function continueResumableExecution(
  state: ExactInputSinglePathResumableExecutionState,
  maxExpansions: number,
  shouldInterrupt: ExactInputSinglePathInterruptionControl['shouldInterrupt'],
): ExactInputSinglePathResumableResult {
  while (true) {
    if (normalizeSimplePathTraversal(state.traversal)) {
      return finishResumableExecution(state, 'complete');
    }
    if (state.traversal.expansions === maxExpansions) {
      return finishResumableExecution(state, 'work-limit');
    }

    const checkpoint: ExactInputSinglePathInterruptionCheckpoint = Object.freeze({
      establishment: state.establishment,
      expansions: state.traversal.expansions,
      enumeratedCandidates: state.enumeratedCandidates,
      replayedCandidates: state.replayedCandidates,
      rejectedCandidates: state.rejectedCandidates,
      incumbent: state.incumbent ?? null,
    });
    try {
      if (shouldInterrupt(checkpoint)) {
        return finishResumableExecution(state, 'interrupted');
      }
    } catch {
      return interruptionControlFailure();
    }

    const completedPath = expandSimplePathTraversal(state.traversal);
    if (completedPath === undefined) continue;

    state.enumeratedCandidates += 1;
    const replay = replayExactInputRoute(state.snapshot, {
      snapshotId: state.request.snapshotId,
      snapshotChecksum: state.request.snapshotChecksum,
      assetIn: state.request.assetIn,
      assetOut: state.request.assetOut,
      amountIn: state.request.amountIn,
      hops: completedPath,
    });
    state.replayedCandidates += 1;
    if (!replay.ok) {
      state.rejectedCandidates += 1;
      continue;
    }
    if (
      state.incumbent === undefined ||
      isStrictlyBetter(replay.value, state.incumbent)
    ) {
      state.incumbent = replay.value;
    }
  }
}

export function routeExactInputSinglePathResumable(
  snapshot: LiquiditySnapshot,
  request: ExactInputSinglePathRouterRequest,
  control: ExactInputSinglePathInterruptionControl,
): ExactInputSinglePathResumableResult {
  const capturedSnapshot = captureInterruptibleSnapshot(snapshot);
  const capturedRequest = captureInterruptibleRequest(request);
  const adjacency = buildDeterministicAdjacency(capturedSnapshot);
  const knownAssets = new Set(adjacency.buckets.map((bucket) => bucket.assetIn));
  const requestFailure = validateRequest(capturedSnapshot, capturedRequest, knownAssets);
  if (requestFailure !== undefined) return requestFailure;

  const shouldInterrupt = capturedInterruptionControl(control);
  if (shouldInterrupt === undefined) return interruptionControlFailure();

  const binding = frozenResumeBinding(capturedRequest);
  const establishment = establishDirectIncumbent(
    capturedSnapshot,
    binding,
    adjacency,
  );

  const state: ExactInputSinglePathResumableExecutionState = {
    snapshot: capturedSnapshot,
    request: binding,
    traversal: createSimplePathTraversal(adjacency, {
      assetIn: capturedRequest.assetIn,
      assetOut: capturedRequest.assetOut,
      maxHops: capturedRequest.maxHops,
    }),
    establishment: establishment.summary,
    incumbent: establishment.incumbent,
    enumeratedCandidates: 0,
    replayedCandidates: 0,
    rejectedCandidates: 0,
  };
  return continueResumableExecution(
    state,
    capturedRequest.maxExpansions,
    shouldInterrupt,
  );
}

export function resumeExactInputSinglePath(
  checkpoint: ExactInputSinglePathResumableCheckpoint,
  maxExpansions: number,
  control: ExactInputSinglePathInterruptionControl,
): ExactInputSinglePathResumableResult {
  const hiddenState = resumableCheckpointStates.get(checkpoint);
  if (hiddenState === undefined) {
    return invalidResume({
      code: 'invalid-router-checkpoint',
      field: 'checkpoint',
    });
  }
  if (!Number.isSafeInteger(maxExpansions) || maxExpansions < 0) {
    return invalidResume({
      code: 'invalid-resume-max-expansions',
      field: 'maxExpansions',
    });
  }
  if (maxExpansions < hiddenState.traversal.expansions) {
    return invalidResume({
      code: 'invalid-resume-max-expansions',
      field: 'maxExpansions',
    });
  }

  const state = cloneResumableExecutionState(hiddenState);
  if (normalizeSimplePathTraversal(state.traversal)) {
    return finishResumableExecution(state, 'complete');
  }
  if (state.traversal.expansions === maxExpansions) {
    return finishResumableExecution(state, 'work-limit');
  }

  const shouldInterrupt = capturedInterruptionControl(control);
  if (shouldInterrupt === undefined) return interruptionControlFailure();
  return continueResumableExecution(state, maxExpansions, shouldInterrupt);
}

const deadlinePredicateFailure = new Error();

function frozenDeadlineError(
  error: ExactInputSinglePathDeadlineError,
): ExactInputSinglePathDeadlineError {
  return Object.freeze(error);
}

function frozenDeadlineSearchSummary(
  search: ExactInputSinglePathInterruptibleSearchSummary,
): ExactInputSinglePathDeadlineSearchSummary {
  return Object.freeze({
    establishment: search.establishment,
    expansions: search.expansions,
    enumeratedCandidates: search.enumeratedCandidates,
    replayedCandidates: search.replayedCandidates,
    rejectedCandidates: search.rejectedCandidates,
    termination: search.termination === 'interrupted' ? 'deadline' : search.termination,
  });
}

function projectDeadlineResult(
  inner: ExactInputSinglePathResumableResult,
  deadlineError: ExactInputSinglePathDeadlineError | undefined,
): ExactInputSinglePathDeadlineResult {
  if (inner.status === 'control-error') {
    if (deadlineError === undefined) {
      throw new Error('Deadline predicate failed without a deadline error.');
    }
    return Object.freeze({ status: 'deadline-error', error: deadlineError });
  }
  if (deadlineError !== undefined) {
    throw new Error('Deadline error did not stop resumable routing.');
  }
  if (inner.status === 'invalid-request' || inner.status === 'invalid-resume') {
    return inner;
  }
  if (inner.status === 'success') {
    const plan: ExactInputSinglePathDeadlinePlan = Object.freeze({
      receipt: inner.plan.receipt,
      search: frozenDeadlineSearchSummary(inner.plan.search),
    });
    return Object.freeze({
      status: 'success',
      plan,
      checkpoint: inner.checkpoint,
    });
  }
  if (inner.status === 'no-route') {
    return Object.freeze({
      status: 'no-route',
      reason: inner.reason,
      search: frozenDeadlineSearchSummary(inner.search),
      checkpoint: null,
    });
  }
  return Object.freeze({
    status: 'no-plan',
    reason: inner.reason === 'interrupted' ? 'deadline' : inner.reason,
    search: frozenDeadlineSearchSummary(inner.search),
    checkpoint: inner.checkpoint,
  });
}

function executeWithDeadline(
  deadlineControl: ExactInputSinglePathDeadlineControl,
  execute: (
    control: ExactInputSinglePathInterruptionControl,
  ) => ExactInputSinglePathResumableResult,
): ExactInputSinglePathDeadlineResult {
  let captured:
    | {
        readonly deadlineNanoseconds: bigint;
        readonly nowNanoseconds: () => bigint;
      }
    | undefined;
  let previousSample: bigint | undefined;
  let deadlineError: ExactInputSinglePathDeadlineError | undefined;

  const fail = (error: ExactInputSinglePathDeadlineError): never => {
    deadlineError = frozenDeadlineError(error);
    throw deadlinePredicateFailure;
  };

  const shouldInterrupt = (): boolean => {
    let dependencies = captured;
    if (dependencies === undefined) {
      let deadlineNanoseconds: unknown;
      try {
        deadlineNanoseconds = deadlineControl.deadlineNanoseconds;
      } catch {
        return fail({
          code: 'invalid-deadline-nanoseconds',
          field: 'deadlineNanoseconds',
        });
      }
      if (typeof deadlineNanoseconds !== 'bigint' || deadlineNanoseconds < 0n) {
        return fail({
          code: 'invalid-deadline-nanoseconds',
          field: 'deadlineNanoseconds',
        });
      }

      let nowNanoseconds: unknown;
      try {
        nowNanoseconds = deadlineControl.nowNanoseconds;
      } catch {
        return fail({
          code: 'deadline-clock-failed',
          field: 'nowNanoseconds',
        });
      }
      if (typeof nowNanoseconds !== 'function') {
        return fail({
          code: 'deadline-clock-failed',
          field: 'nowNanoseconds',
        });
      }
      dependencies = Object.freeze({
        deadlineNanoseconds,
        nowNanoseconds: nowNanoseconds as () => bigint,
      });
      captured = dependencies;
    }

    let sample: unknown;
    try {
      const nowNanoseconds = dependencies.nowNanoseconds;
      sample = nowNanoseconds();
    } catch {
      return fail({
        code: 'deadline-clock-failed',
        field: 'nowNanoseconds',
      });
    }
    if (typeof sample !== 'bigint' || sample < 0n) {
      return fail({
        code: 'deadline-clock-failed',
        field: 'nowNanoseconds',
      });
    }
    if (previousSample !== undefined && sample < previousSample) {
      return fail({
        code: 'deadline-clock-regressed',
        field: 'nowNanoseconds',
      });
    }
    previousSample = sample;
    return sample >= dependencies.deadlineNanoseconds;
  };

  const inner = execute(Object.freeze({ shouldInterrupt }));
  return projectDeadlineResult(inner, deadlineError);
}

export function routeExactInputSinglePathWithDeadline(
  snapshot: LiquiditySnapshot,
  request: ExactInputSinglePathRouterRequest,
  deadlineControl: ExactInputSinglePathDeadlineControl,
): ExactInputSinglePathDeadlineResult {
  return executeWithDeadline(deadlineControl, (control) =>
    routeExactInputSinglePathResumable(snapshot, request, control),
  );
}

export function resumeExactInputSinglePathWithDeadline(
  checkpoint: ExactInputSinglePathResumableCheckpoint,
  maxExpansions: number,
  deadlineControl: ExactInputSinglePathDeadlineControl,
): ExactInputSinglePathDeadlineResult {
  return executeWithDeadline(deadlineControl, (control) =>
    resumeExactInputSinglePath(checkpoint, maxExpansions, control),
  );
}
