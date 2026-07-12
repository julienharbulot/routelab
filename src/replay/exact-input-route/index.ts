import type { LiquiditySnapshot } from '../../domain/index.ts';
import {
  transitionConstantProductExactInput,
  type ConstantProductExecutionErrorCode,
  type ConstantProductTransitionReceipt,
} from '../../pools/constant-product/index.ts';

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

function failure(
  code: ExactInputRouteReplayErrorCode,
  message: string,
  hopIndex: number | null = null,
  causeCode: ConstantProductExecutionErrorCode | null = null,
): ExactInputRouteReplayResult {
  const error: ExactInputRouteReplayError = Object.freeze({
    code,
    message,
    hopIndex,
    causeCode,
  });
  return Object.freeze({ ok: false, error });
}

function emptyHopIdentifier(
  hop: DirectionalRouteHop,
): 'assetIn' | 'poolId' | 'assetOut' | undefined {
  if (hop.assetIn.length === 0) return 'assetIn';
  if (hop.poolId.length === 0) return 'poolId';
  if (hop.assetOut.length === 0) return 'assetOut';
  return undefined;
}

export function replayExactInputRoute(
  snapshot: LiquiditySnapshot,
  request: ExactInputRouteReplayRequest,
): ExactInputRouteReplayResult {
  if (
    request.snapshotId !== snapshot.snapshotId ||
    request.snapshotChecksum !== snapshot.snapshotChecksum
  ) {
    return failure(
      'snapshot-identity-mismatch',
      'Request snapshotId and snapshotChecksum must match the supplied snapshot.',
    );
  }

  if (request.assetIn.length === 0) {
    return failure('empty-identifier', 'request.assetIn must not be empty.');
  }
  if (request.assetOut.length === 0) {
    return failure('empty-identifier', 'request.assetOut must not be empty.');
  }
  if (request.amountIn <= 0n) {
    return failure('nonpositive-input', 'request.amountIn must be positive.');
  }
  if (request.assetIn === request.assetOut) {
    return failure('same-asset-request', 'request.assetIn and request.assetOut must be distinct.');
  }
  if (request.hops.length === 0) {
    return failure('empty-route', 'request.hops must contain at least one hop.');
  }

  const seenPoolIds = new Set<string>();
  const seenAssets = new Set<string>([request.assetIn]);
  let expectedAssetIn = request.assetIn;

  for (const [index, hop] of request.hops.entries()) {
    const emptyField = emptyHopIdentifier(hop);
    if (emptyField !== undefined) {
      return failure(
        'empty-identifier',
        `request.hops[${index}].${emptyField} must not be empty.`,
        index,
      );
    }

    if (hop.assetIn !== expectedAssetIn) {
      if (index === 0) {
        return failure(
          'route-start-mismatch',
          'The first hop assetIn must equal request.assetIn.',
          index,
        );
      }
      return failure(
        'noncontiguous-route',
        `request.hops[${index}].assetIn must equal the prior hop assetOut.`,
        index,
      );
    }

    if (seenPoolIds.has(hop.poolId)) {
      return failure(
        'duplicate-pool',
        `request.hops[${index}].poolId repeats an earlier pool.`,
        index,
      );
    }
    seenPoolIds.add(hop.poolId);

    if (seenAssets.has(hop.assetOut)) {
      return failure(
        'duplicate-asset',
        `request.hops[${index}].assetOut repeats an earlier route asset.`,
        index,
      );
    }
    seenAssets.add(hop.assetOut);
    expectedAssetIn = hop.assetOut;
  }

  if (expectedAssetIn !== request.assetOut) {
    return failure(
      'route-end-mismatch',
      'The final hop assetOut must equal request.assetOut.',
      request.hops.length - 1,
    );
  }

  const snapshotPoolsById = new Map(snapshot.pools.map((pool) => [pool.poolId, pool]));
  const validatedRoute = [];

  for (const [index, hop] of request.hops.entries()) {
    const pool = snapshotPoolsById.get(hop.poolId);
    if (pool === undefined) {
      return failure(
        'unknown-pool',
        `request.hops[${index}].poolId does not exist in the supplied snapshot.`,
        index,
      );
    }

    const directionMatches =
      (hop.assetIn === pool.asset0 && hop.assetOut === pool.asset1) ||
      (hop.assetIn === pool.asset1 && hop.assetOut === pool.asset0);
    if (!directionMatches) {
      return failure(
        'pool-direction-mismatch',
        `request.hops[${index}] does not match either direction of pool ${pool.poolId}.`,
        index,
      );
    }

    validatedRoute.push({ hop, pool });
  }

  const localPoolState = new Map(validatedRoute.map(({ pool }) => [pool.poolId, pool]));
  const hopReceipts: ConstantProductTransitionReceipt[] = [];
  let amountIn = request.amountIn;

  for (const [index, { hop, pool: initialPool }] of validatedRoute.entries()) {
    const pool = localPoolState.get(hop.poolId) ?? initialPool;
    const transition = transitionConstantProductExactInput(pool, hop.assetIn, amountIn);
    if (!transition.ok) {
      return failure(
        'hop-transition-failed',
        `Transition failed for request.hops[${index}]: ${transition.error.message}`,
        index,
        transition.error.code,
      );
    }

    localPoolState.set(hop.poolId, transition.value.pool);
    hopReceipts.push(transition.value.receipt);
    amountIn = transition.value.receipt.amountOut;
  }

  const frozenHopReceipts = Object.freeze([...hopReceipts]);
  const value: ExactInputRouteReplayReceipt = Object.freeze({
    snapshotId: request.snapshotId,
    snapshotChecksum: request.snapshotChecksum,
    assetIn: request.assetIn,
    assetOut: request.assetOut,
    amountIn: request.amountIn,
    amountOut: amountIn,
    hops: frozenHopReceipts,
  });
  return Object.freeze({ ok: true, value });
}
