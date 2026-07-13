import type {
  ConstantProductPool,
  LiquiditySnapshot,
} from '../../domain/index.ts';
import {
  type ExactInputSplitReplayError,
  type ExactInputSplitReplayLegReceipt,
  type ExactInputSplitReplayLegRequest,
  type ExactInputSplitReplayRequest,
  type ExactInputSplitReplayReceipt,
  type ExactInputSplitReplayResult,
} from '../../replay/exact-input-split/index.ts';
import {
  type DirectionalRouteHop,
  type ExactInputRouteReplayErrorCode,
  type ExactInputRouteReplayReceipt,
  type ExactInputRouteReplayRequest,
  type ExactInputRouteReplayResult,
} from '../../replay/exact-input-route/index.ts';
import {
  transitionConstantProductExactInput,
  type ConstantProductExecutionErrorCode,
  type ConstantProductTransitionReceipt,
} from '../../pools/constant-product/index.ts';
import {
  buildDeterministicAdjacency,
  type AdjacencyBucket,
  type DeterministicAdjacencyIndex,
} from '../../search/simple-paths/index.ts';
import {
  expandSimplePathTraversal,
  normalizeSimplePathTraversal,
  type SimplePathTraversalState,
} from '../../search/simple-paths/traversal.ts';
import {
  verifyCanonicalSnapshotChecksum,
  type CanonicalSnapshotChecksumMismatchError,
} from '../../serialization/canonical-snapshot/index.ts';

declare const preparedRoutingContextBrand: unique symbol;

export interface PreparedRoutingContext {
  readonly [preparedRoutingContextBrand]: typeof preparedRoutingContextBrand;
}

export type PrepareRoutingContextResult =
  | { readonly ok: true; readonly value: PreparedRoutingContext }
  | {
      readonly ok: false;
      readonly error: CanonicalSnapshotChecksumMismatchError;
    };

export interface PreparedRouteDiscoveryRequest {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly maxHops: number;
  readonly maxPathExpansions: number;
  readonly maxRoutes: number;
  readonly maxCandidateSetExpansions: number;
}

export type PreparedRouteDiscoveryErrorCode =
  | 'snapshot-identity-mismatch'
  | 'empty-identifier'
  | 'same-asset-request'
  | 'invalid-max-hops'
  | 'invalid-max-path-expansions'
  | 'invalid-max-routes'
  | 'invalid-max-candidate-set-expansions'
  | 'unknown-asset';

export type PreparedRouteDiscoveryErrorField =
  | 'snapshotIdentity'
  | 'assetIn'
  | 'assetOut'
  | 'maxHops'
  | 'maxPathExpansions'
  | 'maxRoutes'
  | 'maxCandidateSetExpansions';

export interface PreparedRouteDiscoveryError {
  readonly code: PreparedRouteDiscoveryErrorCode;
  readonly field: PreparedRouteDiscoveryErrorField;
  readonly message: string;
}

export interface PreparedSimplePathDiscoveryValue {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly paths: readonly (readonly DirectionalRouteHop[])[];
  readonly expansions: number;
  readonly termination: 'complete' | 'work-limit';
}

export type PreparedSimplePathDiscoveryResult =
  | { readonly ok: true; readonly value: PreparedSimplePathDiscoveryValue }
  | { readonly ok: false; readonly error: PreparedRouteDiscoveryError };

interface PreparedRoutingContextState {
  readonly snapshot: LiquiditySnapshot;
  readonly poolLookup: ReadonlyMap<string, ConstantProductPool>;
  readonly knownAssets: ReadonlySet<string>;
  readonly adjacency: DeterministicAdjacencyIndex;
  readonly adjacencyLookup: ReadonlyMap<string, AdjacencyBucket>;
}

const preparedStates = new WeakMap<PreparedRoutingContext, PreparedRoutingContextState>();

declare const preparedSimplePathFrontierBrand: unique symbol;

/** @internal */
export interface PreparedSimplePathFrontier {
  readonly [preparedSimplePathFrontierBrand]: typeof preparedSimplePathFrontierBrand;
}

const preparedPathFrontiers = new WeakMap<
  PreparedSimplePathFrontier,
  SimplePathTraversalState
>();
const preparedPathLists = new WeakSet<readonly (readonly DirectionalRouteHop[])[]>();

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

function discoveryFailure(
  code: PreparedRouteDiscoveryErrorCode,
  field: PreparedRouteDiscoveryErrorField,
  message: string,
): PreparedSimplePathDiscoveryResult {
  const error: PreparedRouteDiscoveryError = Object.freeze({ code, field, message });
  return Object.freeze({ ok: false, error });
}

function compareRawUtf16(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareEdges(left: DirectionalRouteHop, right: DirectionalRouteHop): number {
  return (
    compareRawUtf16(left.assetIn, right.assetIn) ||
    compareRawUtf16(left.poolId, right.poolId) ||
    compareRawUtf16(left.assetOut, right.assetOut)
  );
}

function comparePaths(
  left: readonly DirectionalRouteHop[],
  right: readonly DirectionalRouteHop[],
): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const leftEdge = left[index];
    const rightEdge = right[index];
    if (leftEdge === undefined || rightEdge === undefined) {
      throw new Error('Path comparison reached an unavailable edge.');
    }
    const comparison = compareEdges(leftEdge, rightEdge);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

function validateDiscoveryRequest(
  state: PreparedRoutingContextState,
  request: PreparedRouteDiscoveryRequest,
): PreparedSimplePathDiscoveryResult | undefined {
  if (
    request.snapshotId !== state.snapshot.snapshotId ||
    request.snapshotChecksum !== state.snapshot.snapshotChecksum
  ) {
    return discoveryFailure(
      'snapshot-identity-mismatch',
      'snapshotIdentity',
      'request snapshotId and snapshotChecksum must match the prepared context identity.',
    );
  }
  if (request.assetIn.length === 0) {
    return discoveryFailure('empty-identifier', 'assetIn', 'request.assetIn must not be empty.');
  }
  if (request.assetOut.length === 0) {
    return discoveryFailure(
      'empty-identifier',
      'assetOut',
      'request.assetOut must not be empty.',
    );
  }
  if (request.assetIn === request.assetOut) {
    return discoveryFailure(
      'same-asset-request',
      'assetOut',
      'request.assetIn and request.assetOut must be distinct.',
    );
  }
  if (!Number.isSafeInteger(request.maxHops) || request.maxHops <= 0) {
    return discoveryFailure(
      'invalid-max-hops',
      'maxHops',
      'request.maxHops must be a positive safe integer.',
    );
  }
  if (
    !Number.isSafeInteger(request.maxPathExpansions) ||
    request.maxPathExpansions < 0
  ) {
    return discoveryFailure(
      'invalid-max-path-expansions',
      'maxPathExpansions',
      'request.maxPathExpansions must be a nonnegative safe integer.',
    );
  }
  if (!Number.isSafeInteger(request.maxRoutes) || request.maxRoutes <= 0) {
    return discoveryFailure(
      'invalid-max-routes',
      'maxRoutes',
      'request.maxRoutes must be a positive safe integer.',
    );
  }
  if (
    !Number.isSafeInteger(request.maxCandidateSetExpansions) ||
    request.maxCandidateSetExpansions < 0
  ) {
    return discoveryFailure(
      'invalid-max-candidate-set-expansions',
      'maxCandidateSetExpansions',
      'request.maxCandidateSetExpansions must be a nonnegative safe integer.',
    );
  }
  if (!state.knownAssets.has(request.assetIn)) {
    return discoveryFailure(
      'unknown-asset',
      'assetIn',
      'request.assetIn must exist in the prepared context.',
    );
  }
  if (!state.knownAssets.has(request.assetOut)) {
    return discoveryFailure(
      'unknown-asset',
      'assetOut',
      'request.assetOut must exist in the prepared context.',
    );
  }
  return undefined;
}

export function prepareRoutingContext(
  snapshot: LiquiditySnapshot,
): PrepareRoutingContextResult {
  const capturedSnapshot = captureSnapshot(snapshot);
  const verification = verifyCanonicalSnapshotChecksum(capturedSnapshot);
  if (!verification.ok) {
    return Object.freeze({ ok: false, error: verification.error });
  }

  const adjacency = buildDeterministicAdjacency(capturedSnapshot);
  const poolLookup = new Map(
    capturedSnapshot.pools.map((pool) => [pool.poolId, pool]),
  );
  const knownAssets = new Set<string>();
  for (const pool of capturedSnapshot.pools) {
    knownAssets.add(pool.asset0);
    knownAssets.add(pool.asset1);
  }
  const adjacencyLookup = new Map(
    adjacency.buckets.map((bucket) => [bucket.assetIn, bucket]),
  );
  const state: PreparedRoutingContextState = Object.freeze({
    snapshot: capturedSnapshot,
    poolLookup,
    knownAssets,
    adjacency,
    adjacencyLookup,
  });
  const context = Object.freeze({}) as PreparedRoutingContext;
  preparedStates.set(context, state);
  return Object.freeze({ ok: true, value: context });
}

/**
 * Capability-guarded shared lower-level operation that exposes no prepared state.
 * @internal
 */
export function discoverPreparedSimplePaths(
  context: PreparedRoutingContext,
  request: PreparedRouteDiscoveryRequest,
): PreparedSimplePathDiscoveryResult {
  const state = preparedStates.get(context);
  if (state === undefined) {
    throw new TypeError('PreparedRoutingContext was not created by prepareRoutingContext.');
  }
  const requestFailure = validateDiscoveryRequest(state, request);
  if (requestFailure !== undefined) return requestFailure;

  const initialBucket = state.adjacencyLookup.get(request.assetIn);
  if (initialBucket === undefined) {
    throw new Error('Validated prepared traversal requires a known input asset.');
  }
  const traversal: SimplePathTraversalState = {
    request: Object.freeze({
      assetIn: request.assetIn,
      assetOut: request.assetOut,
      maxHops: request.maxHops,
    }),
    bucketsByAsset: state.adjacencyLookup,
    stack: [
      {
        path: [],
        visitedAssets: new Set([request.assetIn]),
        visitedPools: new Set(),
        edges: initialBucket.edges,
        nextEdgeIndex: 0,
      },
    ],
    completePaths: [],
    expansions: 0,
  };
  let termination: 'complete' | 'work-limit' = 'complete';
  while (!normalizeSimplePathTraversal(traversal)) {
    if (traversal.expansions === request.maxPathExpansions) {
      termination = 'work-limit';
      break;
    }
    expandSimplePathTraversal(traversal);
  }
  const paths = Object.freeze([...traversal.completePaths].sort(comparePaths));
  const value: PreparedSimplePathDiscoveryValue = Object.freeze({
    snapshotId: state.snapshot.snapshotId,
    snapshotChecksum: state.snapshot.snapshotChecksum,
    assetIn: request.assetIn,
    assetOut: request.assetOut,
    paths,
    expansions: traversal.expansions,
    termination,
  });
  return Object.freeze({ ok: true, value });
}

/** Capability guard for additive runtimes. It exposes no prepared state. @internal */
export function isPreparedRoutingContext(
  context: PreparedRoutingContext,
): boolean {
  return preparedStates.has(context);
}

/** Identity check for additive runtimes. It exposes no prepared state. @internal */
export function preparedRoutingContextMatchesIdentity(
  context: PreparedRoutingContext,
  snapshotId: string,
  snapshotChecksum: string,
): boolean {
  const state = preparedStates.get(context);
  return (
    state !== undefined &&
    state.snapshot.snapshotId === snapshotId &&
    state.snapshot.snapshotChecksum === snapshotChecksum
  );
}

/** Asset-membership check for additive runtimes. It exposes no prepared state. @internal */
export function preparedRoutingContextHasAsset(
  context: PreparedRoutingContext,
  asset: string,
): boolean {
  return preparedStates.get(context)?.knownAssets.has(asset) ?? false;
}

/** Canonical eligible direct routes, captured without exposing adjacency. @internal */
export function preparedDirectRoutes(
  context: PreparedRoutingContext,
  assetIn: string,
  assetOut: string,
): readonly (readonly DirectionalRouteHop[])[] {
  const state = preparedStates.get(context);
  if (state === undefined) return Object.freeze([]);
  const bucket = state.adjacencyLookup.get(assetIn);
  if (bucket === undefined) return Object.freeze([]);
  return Object.freeze(
    bucket.edges
      .filter((edge) => edge.assetOut === assetOut)
      .map((edge) => Object.freeze([edge])),
  );
}

function capturePreparedHop(hop: DirectionalRouteHop): DirectionalRouteHop {
  return Object.freeze({
    assetIn: hop.assetIn,
    poolId: hop.poolId,
    assetOut: hop.assetOut,
  });
}

function capturePreparedSplitRequest(
  request: ExactInputSplitReplayRequest,
): ExactInputSplitReplayRequest {
  return Object.freeze({
    snapshotId: request.snapshotId,
    snapshotChecksum: request.snapshotChecksum,
    assetIn: request.assetIn,
    assetOut: request.assetOut,
    amountIn: request.amountIn,
    legs: Object.freeze(
      Array.from(request.legs, (leg): ExactInputSplitReplayLegRequest =>
        Object.freeze({
          allocation: leg.allocation,
          route: Object.freeze(Array.from(leg.route, capturePreparedHop)),
        }),
      ),
    ),
  });
}

function preparedRouteFailure(
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

function preparedSplitFailure(
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

function emptyPreparedHopIdentifier(
  hop: DirectionalRouteHop,
): 'assetIn' | 'poolId' | 'assetOut' | undefined {
  if (hop.assetIn.length === 0) return 'assetIn';
  if (hop.poolId.length === 0) return 'poolId';
  if (hop.assetOut.length === 0) return 'assetOut';
  return undefined;
}

function replayPreparedRoute(
  state: PreparedRoutingContextState,
  request: ExactInputRouteReplayRequest,
): ExactInputRouteReplayResult {
  if (
    request.snapshotId !== state.snapshot.snapshotId ||
    request.snapshotChecksum !== state.snapshot.snapshotChecksum
  ) {
    return preparedRouteFailure(
      'snapshot-identity-mismatch',
      'Request snapshotId and snapshotChecksum must match the supplied snapshot.',
    );
  }
  if (request.assetIn.length === 0) {
    return preparedRouteFailure('empty-identifier', 'request.assetIn must not be empty.');
  }
  if (request.assetOut.length === 0) {
    return preparedRouteFailure('empty-identifier', 'request.assetOut must not be empty.');
  }
  if (request.amountIn <= 0n) {
    return preparedRouteFailure('nonpositive-input', 'request.amountIn must be positive.');
  }
  if (request.assetIn === request.assetOut) {
    return preparedRouteFailure(
      'same-asset-request',
      'request.assetIn and request.assetOut must be distinct.',
    );
  }
  if (request.hops.length === 0) {
    return preparedRouteFailure('empty-route', 'request.hops must contain at least one hop.');
  }

  const seenPoolIds = new Set<string>();
  const seenAssets = new Set<string>([request.assetIn]);
  let expectedAssetIn = request.assetIn;
  for (const [index, hop] of request.hops.entries()) {
    const emptyField = emptyPreparedHopIdentifier(hop);
    if (emptyField !== undefined) {
      return preparedRouteFailure(
        'empty-identifier',
        `request.hops[${index}].${emptyField} must not be empty.`,
        index,
      );
    }
    if (hop.assetIn !== expectedAssetIn) {
      if (index === 0) {
        return preparedRouteFailure(
          'route-start-mismatch',
          'The first hop assetIn must equal request.assetIn.',
          index,
        );
      }
      return preparedRouteFailure(
        'noncontiguous-route',
        `request.hops[${index}].assetIn must equal the prior hop assetOut.`,
        index,
      );
    }
    if (seenPoolIds.has(hop.poolId)) {
      return preparedRouteFailure(
        'duplicate-pool',
        `request.hops[${index}].poolId repeats an earlier pool.`,
        index,
      );
    }
    seenPoolIds.add(hop.poolId);
    if (seenAssets.has(hop.assetOut)) {
      return preparedRouteFailure(
        'duplicate-asset',
        `request.hops[${index}].assetOut repeats an earlier route asset.`,
        index,
      );
    }
    seenAssets.add(hop.assetOut);
    expectedAssetIn = hop.assetOut;
  }
  if (expectedAssetIn !== request.assetOut) {
    return preparedRouteFailure(
      'route-end-mismatch',
      'The final hop assetOut must equal request.assetOut.',
      request.hops.length - 1,
    );
  }

  const validatedRoute: Array<{
    readonly hop: DirectionalRouteHop;
    readonly pool: ConstantProductPool;
  }> = [];
  for (const [index, hop] of request.hops.entries()) {
    const pool = state.poolLookup.get(hop.poolId);
    if (pool === undefined) {
      return preparedRouteFailure(
        'unknown-pool',
        `request.hops[${index}].poolId does not exist in the supplied snapshot.`,
        index,
      );
    }
    const directionMatches =
      (hop.assetIn === pool.asset0 && hop.assetOut === pool.asset1) ||
      (hop.assetIn === pool.asset1 && hop.assetOut === pool.asset0);
    if (!directionMatches) {
      return preparedRouteFailure(
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
      return preparedRouteFailure(
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

function comparePreparedRawUtf16(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function comparePreparedRoutes(
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
      comparePreparedRawUtf16(leftHop.assetIn, rightHop.assetIn) ||
      comparePreparedRawUtf16(leftHop.poolId, rightHop.poolId) ||
      comparePreparedRawUtf16(leftHop.assetOut, rightHop.assetOut);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

function replayPreparedSplit(
  state: PreparedRoutingContextState,
  request: ExactInputSplitReplayRequest,
): ExactInputSplitReplayResult {
  if (
    request.snapshotId !== state.snapshot.snapshotId ||
    request.snapshotChecksum !== state.snapshot.snapshotChecksum
  ) {
    return preparedSplitFailure(
      'snapshot-identity-mismatch',
      'Request snapshotId and snapshotChecksum must match the supplied snapshot.',
    );
  }
  if (request.assetIn.length === 0) {
    return preparedSplitFailure('empty-identifier', 'request.assetIn must not be empty.');
  }
  if (request.assetOut.length === 0) {
    return preparedSplitFailure('empty-identifier', 'request.assetOut must not be empty.');
  }
  if (typeof request.amountIn !== 'bigint' || request.amountIn <= 0n) {
    return preparedSplitFailure('nonpositive-input', 'request.amountIn must be a positive bigint.');
  }
  if (request.assetIn === request.assetOut) {
    return preparedSplitFailure(
      'same-asset-request',
      'request.assetIn and request.assetOut must be distinct.',
    );
  }
  if (request.legs.length === 0) {
    return preparedSplitFailure('empty-legs', 'request.legs must contain at least one leg.');
  }

  let allocationSum = 0n;
  for (const [index, leg] of request.legs.entries()) {
    if (typeof leg.allocation !== 'bigint' || leg.allocation <= 0n) {
      return preparedSplitFailure(
        'nonpositive-allocation',
        `request.legs[${index}].allocation must be a positive bigint.`,
        index,
      );
    }
    if (leg.route.length === 0) {
      return preparedSplitFailure(
        'empty-route',
        `request.legs[${index}].route must contain at least one hop.`,
        index,
      );
    }
    allocationSum += leg.allocation;
  }
  if (allocationSum !== request.amountIn) {
    return preparedSplitFailure(
      'allocation-sum-mismatch',
      'Leg allocations must sum exactly to request.amountIn.',
    );
  }
  for (const [index, leg] of request.legs.entries()) {
    if (index === 0) continue;
    const prior = request.legs[index - 1];
    if (prior === undefined) throw new Error('Split validation lost its prior leg.');
    const comparison = comparePreparedRoutes(prior.route, leg.route);
    if (comparison === 0) {
      return preparedSplitFailure(
        'duplicate-route',
        `request.legs[${index}].route duplicates the prior canonical route.`,
        index,
      );
    }
    if (comparison > 0) {
      return preparedSplitFailure(
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
        return preparedSplitFailure(
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
    const replay = replayPreparedRoute(state, {
      snapshotId: request.snapshotId,
      snapshotChecksum: request.snapshotChecksum,
      assetIn: request.assetIn,
      assetOut: request.assetOut,
      amountIn: leg.allocation,
      hops: leg.route,
    });
    if (!replay.ok) {
      return preparedSplitFailure(
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

/** Fresh exact replay against the exclusively owned prepared snapshot. @internal */
export function replayPreparedExactInputSplit(
  context: PreparedRoutingContext,
  request: ExactInputSplitReplayRequest,
): ExactInputSplitReplayResult {
  const state = preparedStates.get(context);
  if (state === undefined) {
    throw new TypeError('PreparedRoutingContext was not created by prepareRoutingContext.');
  }
  return replayPreparedSplit(state, capturePreparedSplitRequest(request));
}

/** Creates one opaque, request-local simple-path frontier. @internal */
export function createPreparedSimplePathFrontier(
  context: PreparedRoutingContext,
  request: Pick<PreparedRouteDiscoveryRequest, 'assetIn' | 'assetOut' | 'maxHops'>,
): PreparedSimplePathFrontier {
  const state = preparedStates.get(context);
  if (state === undefined) {
    throw new TypeError('PreparedRoutingContext was not created by prepareRoutingContext.');
  }
  const initialBucket = state.adjacencyLookup.get(request.assetIn);
  if (initialBucket === undefined) {
    throw new Error('Prepared frontier requires a known input asset.');
  }
  const traversal: SimplePathTraversalState = {
    request: Object.freeze({
      assetIn: request.assetIn,
      assetOut: request.assetOut,
      maxHops: request.maxHops,
    }),
    bucketsByAsset: state.adjacencyLookup,
    stack: [
      {
        path: [],
        visitedAssets: new Set([request.assetIn]),
        visitedPools: new Set(),
        edges: initialBucket.edges,
        nextEdgeIndex: 0,
      },
    ],
    completePaths: [],
    expansions: 0,
  };
  const frontier = Object.freeze({}) as PreparedSimplePathFrontier;
  preparedPathFrontiers.set(frontier, traversal);
  return frontier;
}

/** Reports whether a path-expansion unit is pending after free normalization. @internal */
export function hasPreparedSimplePathExpansion(
  frontier: PreparedSimplePathFrontier,
): boolean {
  const traversal = preparedPathFrontiers.get(frontier);
  if (traversal === undefined) throw new TypeError('Unknown prepared path frontier.');
  return !normalizeSimplePathTraversal(traversal);
}

/** Executes exactly one atomic path-expansion unit. @internal */
export function expandPreparedSimplePathFrontier(
  frontier: PreparedSimplePathFrontier,
): void {
  const traversal = preparedPathFrontiers.get(frontier);
  if (traversal === undefined) throw new TypeError('Unknown prepared path frontier.');
  expandSimplePathTraversal(traversal);
}

/** Materializes the completed prefix in accepted canonical order. @internal */
export function materializePreparedSimplePaths(
  frontier: PreparedSimplePathFrontier,
): readonly (readonly DirectionalRouteHop[])[] {
  const traversal = preparedPathFrontiers.get(frontier);
  if (traversal === undefined) throw new TypeError('Unknown prepared path frontier.');
  const paths = Object.freeze([...traversal.completePaths].sort(comparePaths));
  preparedPathLists.add(paths);
  return paths;
}

/** Capability guard for path lists minted by a prepared frontier. @internal */
export function isPreparedSimplePathList(
  paths: readonly (readonly DirectionalRouteHop[])[],
): boolean {
  return preparedPathLists.has(paths);
}
