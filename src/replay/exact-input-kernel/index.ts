import type { ConstantProductPool, LiquiditySnapshot } from '../../domain/index.ts';
import {
  transitionConstantProductExactInput,
  type ConstantProductExecutionErrorCode,
  type ConstantProductTransitionReceipt,
} from '../../pools/constant-product/index.ts';
import type {
  ExactInputSplitReplayError,
  ExactInputSplitReplayLegReceipt,
  ExactInputSplitReplayRequest,
  ExactInputSplitReplayReceipt,
  ExactInputSplitReplayResult,
} from '../exact-input-split/index.ts';
import type {
  DirectionalRouteHop,
  ExactInputRouteReplayErrorCode,
  ExactInputRouteReplayReceipt,
  ExactInputRouteReplayRequest,
  ExactInputRouteReplayResult,
} from '../exact-input-route/index.ts';

/** Resolver capability used only by exact replay wrappers. @internal */
export interface ExactInputReplayPoolResolver {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly preparePoolLookup: () => void;
  readonly resolvePool: (poolId: string) => ConstantProductPool | undefined;
}

/**
 * Creates a request-local resolver while preserving legacy lazy snapshot-pool
 * observation. The lookup is materialized only when route pool validation begins.
 * @internal
 */
export function createEphemeralExactInputReplayPoolResolver(
  snapshot: LiquiditySnapshot,
): ExactInputReplayPoolResolver {
  let poolLookup: ReadonlyMap<string, ConstantProductPool> | undefined;
  return Object.freeze({
    get snapshotId(): string {
      return snapshot.snapshotId;
    },
    get snapshotChecksum(): string {
      return snapshot.snapshotChecksum;
    },
    preparePoolLookup(): void {
      poolLookup ??= new Map(snapshot.pools.map((pool) => [pool.poolId, pool]));
    },
    resolvePool(poolId: string): ConstantProductPool | undefined {
      poolLookup ??= new Map(snapshot.pools.map((pool) => [pool.poolId, pool]));
      return poolLookup.get(poolId);
    },
  });
}

function routeFailure(
  code: ExactInputRouteReplayErrorCode,
  message: string,
  hopIndex: number | null = null,
  causeCode: ConstantProductExecutionErrorCode | null = null,
): ExactInputRouteReplayResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, message, hopIndex, causeCode }),
  });
}

function emptyHopIdentifier(
  hop: DirectionalRouteHop,
): 'assetIn' | 'poolId' | 'assetOut' | undefined {
  if (hop.assetIn.length === 0) return 'assetIn';
  if (hop.poolId.length === 0) return 'poolId';
  if (hop.assetOut.length === 0) return 'assetOut';
  return undefined;
}

/** Exact route validation, transition, error, and receipt authority. @internal */
export function replayExactInputRouteWithResolver(
  resolver: ExactInputReplayPoolResolver,
  request: ExactInputRouteReplayRequest,
): ExactInputRouteReplayResult {
  if (
    request.snapshotId !== resolver.snapshotId ||
    request.snapshotChecksum !== resolver.snapshotChecksum
  ) {
    return routeFailure(
      'snapshot-identity-mismatch',
      'Request snapshotId and snapshotChecksum must match the supplied snapshot.',
    );
  }
  if (request.assetIn.length === 0) {
    return routeFailure('empty-identifier', 'request.assetIn must not be empty.');
  }
  if (request.assetOut.length === 0) {
    return routeFailure('empty-identifier', 'request.assetOut must not be empty.');
  }
  if (request.amountIn <= 0n) {
    return routeFailure('nonpositive-input', 'request.amountIn must be positive.');
  }
  if (request.assetIn === request.assetOut) {
    return routeFailure(
      'same-asset-request',
      'request.assetIn and request.assetOut must be distinct.',
    );
  }
  if (request.hops.length === 0) {
    return routeFailure('empty-route', 'request.hops must contain at least one hop.');
  }

  const seenPoolIds = new Set<string>();
  const seenAssets = new Set<string>([request.assetIn]);
  let expectedAssetIn = request.assetIn;
  for (const [index, hop] of request.hops.entries()) {
    const emptyField = emptyHopIdentifier(hop);
    if (emptyField !== undefined) {
      return routeFailure(
        'empty-identifier',
        `request.hops[${index}].${emptyField} must not be empty.`,
        index,
      );
    }
    if (hop.assetIn !== expectedAssetIn) {
      if (index === 0) {
        return routeFailure(
          'route-start-mismatch',
          'The first hop assetIn must equal request.assetIn.',
          index,
        );
      }
      return routeFailure(
        'noncontiguous-route',
        `request.hops[${index}].assetIn must equal the prior hop assetOut.`,
        index,
      );
    }
    if (seenPoolIds.has(hop.poolId)) {
      return routeFailure(
        'duplicate-pool',
        `request.hops[${index}].poolId repeats an earlier pool.`,
        index,
      );
    }
    seenPoolIds.add(hop.poolId);
    if (seenAssets.has(hop.assetOut)) {
      return routeFailure(
        'duplicate-asset',
        `request.hops[${index}].assetOut repeats an earlier route asset.`,
        index,
      );
    }
    seenAssets.add(hop.assetOut);
    expectedAssetIn = hop.assetOut;
  }
  if (expectedAssetIn !== request.assetOut) {
    return routeFailure(
      'route-end-mismatch',
      'The final hop assetOut must equal request.assetOut.',
      request.hops.length - 1,
    );
  }

  resolver.preparePoolLookup();
  const validatedRoute: Array<{
    readonly hop: DirectionalRouteHop;
    readonly pool: ConstantProductPool;
  }> = [];
  for (const [index, hop] of request.hops.entries()) {
    const pool = resolver.resolvePool(hop.poolId);
    if (pool === undefined) {
      return routeFailure(
        'unknown-pool',
        `request.hops[${index}].poolId does not exist in the supplied snapshot.`,
        index,
      );
    }
    const directionMatches =
      (hop.assetIn === pool.asset0 && hop.assetOut === pool.asset1) ||
      (hop.assetIn === pool.asset1 && hop.assetOut === pool.asset0);
    if (!directionMatches) {
      return routeFailure(
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
      return routeFailure(
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

  const value: ExactInputRouteReplayReceipt = Object.freeze({
    snapshotId: request.snapshotId,
    snapshotChecksum: request.snapshotChecksum,
    assetIn: request.assetIn,
    assetOut: request.assetOut,
    amountIn: request.amountIn,
    amountOut: amountIn,
    hops: Object.freeze([...hopReceipts]),
  });
  return Object.freeze({ ok: true, value });
}

function splitFailure(
  code: ExactInputSplitReplayError['code'],
  message: string,
  legIndex: number | null = null,
  causeCode: ExactInputRouteReplayErrorCode | null = null,
): ExactInputSplitReplayResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, message, legIndex, causeCode }),
  });
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

/** Exact split validation, leg replay, error, and receipt authority. @internal */
export function replayExactInputSplitWithResolver(
  resolver: ExactInputReplayPoolResolver,
  request: ExactInputSplitReplayRequest,
): ExactInputSplitReplayResult {
  if (
    request.snapshotId !== resolver.snapshotId ||
    request.snapshotChecksum !== resolver.snapshotChecksum
  ) {
    return splitFailure(
      'snapshot-identity-mismatch',
      'Request snapshotId and snapshotChecksum must match the supplied snapshot.',
    );
  }
  if (request.assetIn.length === 0) {
    return splitFailure('empty-identifier', 'request.assetIn must not be empty.');
  }
  if (request.assetOut.length === 0) {
    return splitFailure('empty-identifier', 'request.assetOut must not be empty.');
  }
  if (typeof request.amountIn !== 'bigint' || request.amountIn <= 0n) {
    return splitFailure('nonpositive-input', 'request.amountIn must be a positive bigint.');
  }
  if (request.assetIn === request.assetOut) {
    return splitFailure(
      'same-asset-request',
      'request.assetIn and request.assetOut must be distinct.',
    );
  }
  if (request.legs.length === 0) {
    return splitFailure('empty-legs', 'request.legs must contain at least one leg.');
  }

  let allocationSum = 0n;
  for (const [index, leg] of request.legs.entries()) {
    if (typeof leg.allocation !== 'bigint' || leg.allocation <= 0n) {
      return splitFailure(
        'nonpositive-allocation',
        `request.legs[${index}].allocation must be a positive bigint.`,
        index,
      );
    }
    if (leg.route.length === 0) {
      return splitFailure(
        'empty-route',
        `request.legs[${index}].route must contain at least one hop.`,
        index,
      );
    }
    allocationSum += leg.allocation;
  }
  if (allocationSum !== request.amountIn) {
    return splitFailure(
      'allocation-sum-mismatch',
      'Leg allocations must sum exactly to request.amountIn.',
    );
  }

  for (const [index, leg] of request.legs.entries()) {
    if (index === 0) continue;
    const prior = request.legs[index - 1];
    if (prior === undefined) {
      throw new Error('Split validation reached an unavailable prior leg.');
    }
    const comparison = compareDirectionalRoutes(prior.route, leg.route);
    if (comparison === 0) {
      return splitFailure(
        'duplicate-route',
        `request.legs[${index}].route duplicates the prior canonical route.`,
        index,
      );
    }
    if (comparison > 0) {
      return splitFailure(
        'noncanonical-route-order',
        'request.legs routes must be sorted by raw UTF-16 directional route order.',
        index,
      );
    }
  }

  const priorLegPoolIds = new Set<string>();
  for (const [index, leg] of request.legs.entries()) {
    const currentLegPoolIds = new Set<string>();
    for (const { poolId } of leg.route) {
      if (priorLegPoolIds.has(poolId)) {
        return splitFailure(
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
  for (const [index, leg] of request.legs.entries()) {
    const replay = replayExactInputRouteWithResolver(resolver, {
      snapshotId: request.snapshotId,
      snapshotChecksum: request.snapshotChecksum,
      assetIn: request.assetIn,
      assetOut: request.assetOut,
      amountIn: leg.allocation,
      hops: leg.route,
    });
    if (!replay.ok) {
      return splitFailure(
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
    snapshotId: request.snapshotId,
    snapshotChecksum: request.snapshotChecksum,
    assetIn: request.assetIn,
    assetOut: request.assetOut,
    amountIn: request.amountIn,
    amountOut,
    legs: Object.freeze(receiptLegs),
  });
  return Object.freeze({ ok: true, value });
}
