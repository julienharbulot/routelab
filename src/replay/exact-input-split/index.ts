import type { ConstantProductPool, LiquiditySnapshot } from '../../domain/index.ts';
import {
  replayExactInputRoute,
  type DirectionalRouteHop,
  type ExactInputRouteReplayErrorCode,
  type ExactInputRouteReplayReceipt,
} from '../exact-input-route/index.ts';

export interface ExactInputSplitReplayLegRequest {
  readonly allocation: bigint;
  readonly route: readonly DirectionalRouteHop[];
}

export interface ExactInputSplitReplayRequest {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly legs: readonly ExactInputSplitReplayLegRequest[];
}

export interface ExactInputSplitReplayLegReceipt {
  readonly allocation: bigint;
  readonly receipt: ExactInputRouteReplayReceipt;
}

export interface ExactInputSplitReplayReceipt {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly legs: readonly ExactInputSplitReplayLegReceipt[];
}

export type ExactInputSplitReplayErrorCode =
  | 'snapshot-identity-mismatch'
  | 'empty-identifier'
  | 'nonpositive-input'
  | 'same-asset-request'
  | 'empty-legs'
  | 'nonpositive-allocation'
  | 'empty-route'
  | 'allocation-sum-mismatch'
  | 'duplicate-route'
  | 'noncanonical-route-order'
  | 'shared-pool'
  | 'leg-replay-failed';

export interface ExactInputSplitReplayError {
  readonly code: ExactInputSplitReplayErrorCode;
  readonly message: string;
  readonly legIndex: number | null;
  readonly causeCode: ExactInputRouteReplayErrorCode | null;
}

export type ExactInputSplitReplayResult =
  | { readonly ok: true; readonly value: ExactInputSplitReplayReceipt }
  | { readonly ok: false; readonly error: ExactInputSplitReplayError };

function capturePool(pool: ConstantProductPool): ConstantProductPool {
  const poolId = pool.poolId;
  const asset0 = pool.asset0;
  const reserve0 = pool.reserve0;
  const asset1 = pool.asset1;
  const reserve1 = pool.reserve1;
  const feeChargedNumerator = pool.feeChargedNumerator;
  const feeDenominator = pool.feeDenominator;
  return Object.freeze({
    poolId,
    asset0,
    reserve0,
    asset1,
    reserve1,
    feeChargedNumerator,
    feeDenominator,
  });
}

function captureSnapshot(snapshot: LiquiditySnapshot): LiquiditySnapshot {
  const snapshotId = snapshot.snapshotId;
  const snapshotChecksum = snapshot.snapshotChecksum;
  const sourcePools = snapshot.pools;
  const pools = Object.freeze(Array.from(sourcePools, capturePool));
  return Object.freeze({ snapshotId, snapshotChecksum, pools });
}

function captureHop(hop: DirectionalRouteHop): DirectionalRouteHop {
  const assetIn = hop.assetIn;
  const poolId = hop.poolId;
  const assetOut = hop.assetOut;
  return Object.freeze({ assetIn, poolId, assetOut });
}

function captureRequest(
  request: ExactInputSplitReplayRequest,
): ExactInputSplitReplayRequest {
  const snapshotId = request.snapshotId;
  const snapshotChecksum = request.snapshotChecksum;
  const assetIn = request.assetIn;
  const assetOut = request.assetOut;
  const amountIn = request.amountIn;
  const sourceLegs = request.legs;
  const legs = Object.freeze(
    Array.from(sourceLegs, (leg): ExactInputSplitReplayLegRequest => {
      const allocation = leg.allocation;
      const sourceRoute = leg.route;
      const route = Object.freeze(Array.from(sourceRoute, captureHop));
      return Object.freeze({ allocation, route });
    }),
  );
  return Object.freeze({
    snapshotId,
    snapshotChecksum,
    assetIn,
    assetOut,
    amountIn,
    legs,
  });
}

function failure(
  code: ExactInputSplitReplayErrorCode,
  message: string,
  legIndex: number | null = null,
  causeCode: ExactInputRouteReplayErrorCode | null = null,
): ExactInputSplitReplayResult {
  const error: ExactInputSplitReplayError = Object.freeze({
    code,
    message,
    legIndex,
    causeCode,
  });
  return Object.freeze({ ok: false, error });
}

function compareRawUtf16(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareDirectionalRoutes(
  left: readonly DirectionalRouteHop[],
  right: readonly DirectionalRouteHop[],
): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const leftHop = left[index];
    const rightHop = right[index];
    if (leftHop === undefined || rightHop === undefined) {
      throw new Error('Route comparison reached an unavailable hop.');
    }
    const comparison =
      compareRawUtf16(leftHop.assetIn, rightHop.assetIn) ||
      compareRawUtf16(leftHop.poolId, rightHop.poolId) ||
      compareRawUtf16(leftHop.assetOut, rightHop.assetOut);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

export function replayExactInputSplit(
  snapshot: LiquiditySnapshot,
  request: ExactInputSplitReplayRequest,
): ExactInputSplitReplayResult {
  const capturedSnapshot = captureSnapshot(snapshot);
  const capturedRequest = captureRequest(request);

  if (
    capturedRequest.snapshotId !== capturedSnapshot.snapshotId ||
    capturedRequest.snapshotChecksum !== capturedSnapshot.snapshotChecksum
  ) {
    return failure(
      'snapshot-identity-mismatch',
      'Request snapshotId and snapshotChecksum must match the supplied snapshot.',
    );
  }
  if (capturedRequest.assetIn.length === 0) {
    return failure('empty-identifier', 'request.assetIn must not be empty.');
  }
  if (capturedRequest.assetOut.length === 0) {
    return failure('empty-identifier', 'request.assetOut must not be empty.');
  }
  if (typeof capturedRequest.amountIn !== 'bigint' || capturedRequest.amountIn <= 0n) {
    return failure('nonpositive-input', 'request.amountIn must be a positive bigint.');
  }
  if (capturedRequest.assetIn === capturedRequest.assetOut) {
    return failure(
      'same-asset-request',
      'request.assetIn and request.assetOut must be distinct.',
    );
  }
  if (capturedRequest.legs.length === 0) {
    return failure('empty-legs', 'request.legs must contain at least one leg.');
  }

  let allocationSum = 0n;
  for (const [index, leg] of capturedRequest.legs.entries()) {
    if (typeof leg.allocation !== 'bigint' || leg.allocation <= 0n) {
      return failure(
        'nonpositive-allocation',
        `request.legs[${index}].allocation must be a positive bigint.`,
        index,
      );
    }
    if (leg.route.length === 0) {
      return failure(
        'empty-route',
        `request.legs[${index}].route must contain at least one hop.`,
        index,
      );
    }
    allocationSum += leg.allocation;
  }
  if (allocationSum !== capturedRequest.amountIn) {
    return failure(
      'allocation-sum-mismatch',
      'Leg allocations must sum exactly to request.amountIn.',
    );
  }

  for (const [index, leg] of capturedRequest.legs.entries()) {
    if (index > 0) {
      const prior = capturedRequest.legs[index - 1];
      if (prior === undefined) {
        throw new Error('Split validation reached an unavailable prior leg.');
      }
      const comparison = compareDirectionalRoutes(prior.route, leg.route);
      if (comparison === 0) {
        return failure(
          'duplicate-route',
          `request.legs[${index}].route duplicates the prior canonical route.`,
          index,
        );
      }
      if (comparison > 0) {
        return failure(
          'noncanonical-route-order',
          'request.legs routes must be sorted by raw UTF-16 directional route order.',
          index,
        );
      }
    }
  }

  const priorLegPoolIds = new Set<string>();
  for (const [index, leg] of capturedRequest.legs.entries()) {
    const currentLegPoolIds = new Set<string>();
    for (const { poolId } of leg.route) {
      if (priorLegPoolIds.has(poolId)) {
        return failure(
          'shared-pool',
          `request.legs[${index}] reuses pool ${poolId} from another leg.`,
          index,
        );
      }
      currentLegPoolIds.add(poolId);
    }
    for (const poolId of currentLegPoolIds) priorLegPoolIds.add(poolId);
  }

  const receiptLegs: ExactInputSplitReplayLegReceipt[] = [];
  let amountOut = 0n;
  for (const [index, leg] of capturedRequest.legs.entries()) {
    const replay = replayExactInputRoute(capturedSnapshot, {
      snapshotId: capturedRequest.snapshotId,
      snapshotChecksum: capturedRequest.snapshotChecksum,
      assetIn: capturedRequest.assetIn,
      assetOut: capturedRequest.assetOut,
      amountIn: leg.allocation,
      hops: leg.route,
    });
    if (!replay.ok) {
      return failure(
        'leg-replay-failed',
        `Exact replay failed for request.legs[${index}]: ${replay.error.message}`,
        index,
        replay.error.code,
      );
    }
    receiptLegs.push(Object.freeze({ allocation: leg.allocation, receipt: replay.value }));
    amountOut += replay.value.amountOut;
  }

  const value: ExactInputSplitReplayReceipt = Object.freeze({
    snapshotId: capturedRequest.snapshotId,
    snapshotChecksum: capturedRequest.snapshotChecksum,
    assetIn: capturedRequest.assetIn,
    assetOut: capturedRequest.assetOut,
    amountIn: capturedRequest.amountIn,
    amountOut,
    legs: Object.freeze(receiptLegs),
  });
  return Object.freeze({ ok: true, value });
}
