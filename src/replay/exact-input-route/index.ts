import type { LiquiditySnapshot } from '../../domain/index.ts';
import {
  type ConstantProductExecutionErrorCode,
  type ConstantProductTransitionReceipt,
} from '../../pools/constant-product/index.ts';
import {
  createEphemeralExactInputReplayPoolResolver,
  replayExactInputRouteWithResolver,
} from '../exact-input-kernel/index.ts';

export interface DirectionalRouteHop {
  readonly assetIn: string;
  readonly poolId: string;
  readonly assetOut: string;
}

export interface ExactInputRouteReplayRequest {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly hops: readonly DirectionalRouteHop[];
}

export interface ExactInputRouteReplayReceipt {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly hops: readonly ConstantProductTransitionReceipt[];
}

export type ExactInputRouteReplayErrorCode =
  | 'snapshot-identity-mismatch'
  | 'nonpositive-input'
  | 'same-asset-request'
  | 'empty-identifier'
  | 'empty-route'
  | 'route-start-mismatch'
  | 'route-end-mismatch'
  | 'noncontiguous-route'
  | 'duplicate-pool'
  | 'duplicate-asset'
  | 'unknown-pool'
  | 'pool-direction-mismatch'
  | 'hop-transition-failed';

export interface ExactInputRouteReplayError {
  readonly code: ExactInputRouteReplayErrorCode;
  readonly message: string;
  readonly hopIndex: number | null;
  readonly causeCode: ConstantProductExecutionErrorCode | null;
}

export type ExactInputRouteReplayResult =
  | { readonly ok: true; readonly value: ExactInputRouteReplayReceipt }
  | { readonly ok: false; readonly error: ExactInputRouteReplayError };

export function replayExactInputRoute(
  snapshot: LiquiditySnapshot,
  request: ExactInputRouteReplayRequest,
): ExactInputRouteReplayResult {
  return replayExactInputRouteWithResolver(
    createEphemeralExactInputReplayPoolResolver(snapshot),
    request,
  );
}
