import type {
  ConstantProductPool,
  LiquiditySnapshot,
} from '../../domain/index.ts';
import type { DirectionalRouteHop } from '../../replay/exact-input-route/index.ts';
import {
  buildDeterministicAdjacency,
  enumerateValidatedSimplePaths,
  type AdjacencyBucket,
  type DeterministicAdjacencyIndex,
} from '../../search/simple-paths/index.ts';
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

/** @internal Shared lower-level operation; it exposes no prepared state. */
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

  const value = enumerateValidatedSimplePaths(
    state.adjacency,
    state.adjacencyLookup,
    Object.freeze({
      snapshotId: request.snapshotId,
      snapshotChecksum: request.snapshotChecksum,
      assetIn: request.assetIn,
      assetOut: request.assetOut,
      maxHops: request.maxHops,
      maxExpansions: request.maxPathExpansions,
    }),
  );
  return Object.freeze({ ok: true, value });
}
