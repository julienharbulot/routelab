import type { ConstantProductPool, LiquiditySnapshot } from '../../domain/index.ts';
import {
  replayExactInputRoute,
  type ExactInputRouteReplayReceipt,
} from '../../replay/exact-input-route/index.ts';
import {
  buildDeterministicAdjacency,
  enumerateSimplePaths,
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
  readonly expansions: number;
  readonly enumeratedCandidates: number;
  readonly replayedCandidates: number;
  readonly rejectedCandidates: number;
  readonly termination: 'complete' | 'work-limit' | 'interrupted';
}

export interface ExactInputSinglePathInterruptiblePlan {
  readonly receipt: ExactInputRouteReplayReceipt;
  readonly search: ExactInputSinglePathInterruptibleSearchSummary;
}

export interface ExactInputSinglePathInterruptionCheckpoint {
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
  readonly expansions: number;
  readonly enumeratedCandidates: number;
  readonly replayedCandidates: number;
  readonly rejectedCandidates: number;
  readonly incumbent: ExactInputRouteReplayReceipt | null;
}

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
  expansions: number,
  enumeratedCandidates: number,
  replayedCandidates: number,
  rejectedCandidates: number,
  termination: 'complete' | 'work-limit' | 'interrupted',
): ExactInputSinglePathInterruptibleSearchSummary {
  return Object.freeze({
    expansions,
    enumeratedCandidates,
    replayedCandidates,
    rejectedCandidates,
    termination,
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
  incumbent: ExactInputRouteReplayReceipt | undefined;
  enumeratedCandidates: number;
  replayedCandidates: number;
  rejectedCandidates: number;
}

interface ExactInputSinglePathHiddenCheckpointState {
  readonly snapshot: LiquiditySnapshot;
  readonly request: ExactInputSinglePathResumeBinding;
  readonly traversal: FrozenSimplePathTraversalState;
  readonly incumbent: ExactInputRouteReplayReceipt | null;
  readonly enumeratedCandidates: number;
  readonly replayedCandidates: number;
  readonly rejectedCandidates: number;
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
  let incumbent: ExactInputRouteReplayReceipt | undefined;
  let enumeratedCandidates = 0;
  let replayedCandidates = 0;
  let rejectedCandidates = 0;

  const finish = (
    termination: 'complete' | 'work-limit' | 'interrupted',
  ): ExactInputSinglePathInterruptibleResult => {
    const search = frozenInterruptibleSearchSummary(
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

  const state: ExactInputSinglePathResumableExecutionState = {
    snapshot: capturedSnapshot,
    request: frozenResumeBinding(capturedRequest),
    traversal: createSimplePathTraversal(adjacency, {
      assetIn: capturedRequest.assetIn,
      assetOut: capturedRequest.assetOut,
      maxHops: capturedRequest.maxHops,
    }),
    incumbent: undefined,
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
