import type { ConstantProductPool, LiquiditySnapshot } from '../../domain/index.ts';
import {
  createEphemeralExactInputReplayPoolResolver,
  replayExactInputSplitWithResolver,
} from '../exact-input-kernel/index.ts';
import type {
  DirectionalRouteHop,
  ExactInputRouteReplayErrorCode,
  ExactInputRouteReplayReceipt,
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

export function replayExactInputSplit(
  snapshot: LiquiditySnapshot,
  request: ExactInputSplitReplayRequest,
): ExactInputSplitReplayResult {
  const capturedSnapshot = captureSnapshot(snapshot);
  const capturedRequest = captureRequest(request);
  return replayExactInputSplitWithResolver(
    createEphemeralExactInputReplayPoolResolver(capturedSnapshot),
    capturedRequest,
  );
}
