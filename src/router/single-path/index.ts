import type { LiquiditySnapshot } from '../../domain/index.ts';
import {
  replayExactInputRoute,
  type ExactInputRouteReplayReceipt,
} from '../../replay/exact-input-route/index.ts';
import {
  buildDeterministicAdjacency,
  enumerateSimplePaths,
  type SimplePathEnumerationError,
} from '../../search/simple-paths/index.ts';

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

function validationFailure(
  code: ExactInputSinglePathRouterValidationErrorCode,
  field: ExactInputSinglePathRouterValidationErrorField,
  message: string,
): ExactInputSinglePathRouterResult {
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
): ExactInputSinglePathRouterResult | undefined {
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
