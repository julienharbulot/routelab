import {
  parseLiquiditySnapshot,
  type LiquiditySnapshot,
  type SnapshotValidationErrorCode,
} from '../../domain/index.ts';
import type { DirectionalRouteHop } from '../../replay/exact-input-route/index.ts';
import {
  prepareRoutingContext,
  type PreparedRoutingContext,
} from '../prepared-routing-context/index.ts';
import { serializeCanonicalSnapshotContent } from '../../serialization/canonical-snapshot/index.ts';
import {
  decodeBoundedSnapshotJson,
  type BoundedSnapshotJsonErrorCode,
} from './bounded-snapshot-json.ts';

const SERVICE_ROUTING_POLICY_BRAND: unique symbol = Symbol(
  'RouteLabServiceRoutingPolicy',
);

export const SERVICE_ROUTING_POLICY_V1_ID = 'service-policy-v1' as const;

export interface ServiceRoutingPolicy {
  readonly [SERVICE_ROUTING_POLICY_BRAND]: true;
  readonly policyId: typeof SERVICE_ROUTING_POLICY_V1_ID;
  readonly maxRawPublicationBytes: number;
  readonly maxCanonicalSnapshotBytes: number;
  readonly snapshotRootMembers: number;
  readonly poolMembers: number;
  readonly maxContainerDepth: number;
  readonly maxPublishedSnapshots: number;
  readonly maxPools: number;
  readonly maxDistinctAssets: number;
  readonly maxDirectionalEdges: number;
  readonly maxOutboundDegree: number;
  readonly maxDirectRoutesPerPair: number;
  readonly maxIdentifierCodeUnits: number;
  readonly maxIdentifierUtf8Bytes: number;
  readonly maxExactDecimalDigits: number;
  readonly maxExactValueBits: number;
  readonly maxRawRequestBytes: number;
  readonly maxRawRequestMembers: number;
  readonly maxRawRequestDepth: number;
  readonly maxRequestAmountDecimalDigits: number;
  readonly maxRequestAmountBits: number;
  readonly maxHops: number;
  readonly maxRoutes: number;
  readonly maxReplayLegs: number;
  readonly maxTotalReplayHops: number;
  readonly initialDirectTranche: number;
  readonly maxDirectInspections: number;
  readonly maxDirectReplays: number;
  readonly maxPathExpansions: number;
  readonly maxRetainedCompletePaths: number;
  readonly maxBestSingleCandidateReplays: number;
  readonly maxCandidateSetSteps: number;
  readonly maxRetainedCandidateSets: number;
  readonly maxEqualProposalReplays: number;
  readonly maxRetainedProposalRecords: number;
  readonly greedyParts: number;
  readonly maxGreedyOptionReplays: number;
  readonly maxBaselineAuthorizationReplays: number;
  readonly maxNumericalProposals: number;
  readonly maxNumericalModelRouteSteps: number;
  readonly numericalOuterUpdates: number;
  readonly numericalInnerShareUpdates: number;
  readonly numericalConvergenceTolerance: number;
  readonly maxNumericalShareMicrosteps: number;
  readonly maxNumericalReconstructionSteps: number;
  readonly maxNumericalResidualOptionReplays: number;
  readonly maxNumericalAuthorizationReplays: number;
  readonly maxActivationProbeReplays: number;
  readonly maxRepairNeighborReplays: number;
  readonly maxNumericalDiagnostics: number;
  readonly maxOptionalKeyBytes: number;
  readonly maxDebugProjectionBytes: number;
  readonly maxEncodedResponseBytes: number;
  readonly maxAggregateTransitions: number;
}

export const SERVICE_ROUTING_POLICY_V1: ServiceRoutingPolicy = Object.freeze({
  [SERVICE_ROUTING_POLICY_BRAND]: true as const,
  policyId: SERVICE_ROUTING_POLICY_V1_ID,
  maxRawPublicationBytes: 1_048_576,
  maxCanonicalSnapshotBytes: 1_048_576,
  snapshotRootMembers: 3,
  poolMembers: 7,
  maxContainerDepth: 3,
  maxPublishedSnapshots: 16,
  maxPools: 512,
  maxDistinctAssets: 128,
  maxDirectionalEdges: 1_024,
  maxOutboundDegree: 512,
  maxDirectRoutesPerPair: 256,
  maxIdentifierCodeUnits: 128,
  maxIdentifierUtf8Bytes: 256,
  maxExactDecimalDigits: 78,
  maxExactValueBits: 256,
  maxRawRequestBytes: 2_048,
  maxRawRequestMembers: 6,
  maxRawRequestDepth: 1,
  maxRequestAmountDecimalDigits: 78,
  maxRequestAmountBits: 256,
  maxHops: 4,
  maxRoutes: 4,
  maxReplayLegs: 4,
  maxTotalReplayHops: 16,
  initialDirectTranche: 8,
  maxDirectInspections: 256,
  maxDirectReplays: 256,
  maxPathExpansions: 8_192,
  maxRetainedCompletePaths: 256,
  maxBestSingleCandidateReplays: 256,
  maxCandidateSetSteps: 8_192,
  maxRetainedCandidateSets: 128,
  maxEqualProposalReplays: 128,
  maxRetainedProposalRecords: 128,
  greedyParts: 16,
  maxGreedyOptionReplays: 2_048,
  maxBaselineAuthorizationReplays: 128,
  maxNumericalProposals: 4,
  maxNumericalModelRouteSteps: 16,
  numericalOuterUpdates: 64,
  numericalInnerShareUpdates: 64,
  numericalConvergenceTolerance: 2 ** -40,
  maxNumericalShareMicrosteps: 68_640,
  maxNumericalReconstructionSteps: 48,
  maxNumericalResidualOptionReplays: 64,
  maxNumericalAuthorizationReplays: 4,
  maxActivationProbeReplays: 32,
  maxRepairNeighborReplays: 32,
  maxNumericalDiagnostics: 4,
  maxOptionalKeyBytes: 16_384,
  maxDebugProjectionBytes: 65_536,
  maxEncodedResponseBytes: 65_536,
  maxAggregateTransitions: 100_000,
});

export type ServicePublicationErrorCode =
  | BoundedSnapshotJsonErrorCode
  | 'snapshot-validation-failed'
  | 'snapshot-checksum-mismatch'
  | 'canonical-snapshot-byte-limit'
  | 'exact-value-bit-limit'
  | 'distinct-asset-limit'
  | 'directional-edge-limit'
  | 'outbound-degree-limit'
  | 'direct-route-limit';

export interface ServicePublicationError {
  readonly code: ServicePublicationErrorCode;
  readonly path: string;
  readonly message: string;
  readonly limit?: string;
  readonly cause?: SnapshotValidationErrorCode;
}

export interface ServiceSetupError {
  readonly code: 'invalid-service-policy' | 'invalid-clock-dependency';
  readonly field: 'policy' | 'nowNanoseconds';
  readonly message: string;
}

declare const preparedServiceRoutingContextBrand: unique symbol;

export interface PreparedServiceRoutingContext {
  readonly [preparedServiceRoutingContextBrand]: typeof preparedServiceRoutingContextBrand;
}

export type PrepareServiceRoutingContextResult =
  | { readonly ok: true; readonly value: PreparedServiceRoutingContext }
  | {
      readonly ok: false;
      readonly status: 'invalid-policy' | 'invalid-dependency';
      readonly error: ServiceSetupError;
    }
  | {
      readonly ok: false;
      readonly status: 'invalid-publication';
      readonly error: ServicePublicationError;
    };

export interface PreparedServiceRoutingIdentity {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly policyId: typeof SERVICE_ROUTING_POLICY_V1_ID;
}

declare const preparedServiceDirectRouteCursorBrand: unique symbol;

/** @internal */
export interface PreparedServiceDirectRouteCursor {
  readonly [preparedServiceDirectRouteCursorBrand]:
    typeof preparedServiceDirectRouteCursorBrand;
}

interface PreparedServiceRoutingState {
  readonly policy: ServiceRoutingPolicy;
  readonly prepared: PreparedRoutingContext;
  readonly identity: PreparedServiceRoutingIdentity;
  readonly knownAssets: ReadonlySet<string>;
  readonly directPairIndex: ReadonlyMap<
    string,
    ReadonlyMap<string, readonly (readonly DirectionalRouteHop[])[]>
  >;
  readonly nowNanoseconds: () => unknown;
}

interface PreparedServiceDirectRouteCursorState {
  readonly context: PreparedServiceRoutingContext;
  readonly routes: readonly (readonly DirectionalRouteHop[])[];
  index: number;
}

const preparedServiceStates = new WeakMap<
  PreparedServiceRoutingContext,
  PreparedServiceRoutingState
>();
const preparedServiceDirectCursors = new WeakMap<
  PreparedServiceDirectRouteCursor,
  PreparedServiceDirectRouteCursorState
>();
const EMPTY_DIRECT_ROUTES = Object.freeze([]) as readonly (
  readonly DirectionalRouteHop[]
)[];

function setupFailure(
  status: 'invalid-policy' | 'invalid-dependency',
  code: ServiceSetupError['code'],
  field: ServiceSetupError['field'],
  message: string,
): PrepareServiceRoutingContextResult {
  const error = Object.freeze({ code, field, message });
  return Object.freeze({ ok: false, status, error });
}

function publicationError(
  code: ServicePublicationErrorCode,
  path: string,
  message: string,
  options?: { readonly limit?: string; readonly cause?: SnapshotValidationErrorCode },
): ServicePublicationError {
  return Object.freeze({
    code,
    path,
    message,
    ...(options?.limit === undefined ? {} : { limit: options.limit }),
    ...(options?.cause === undefined ? {} : { cause: options.cause }),
  });
}

function publicationFailure(error: ServicePublicationError): PrepareServiceRoutingContextResult {
  return Object.freeze({ ok: false, status: 'invalid-publication', error });
}

function compareRawUtf16(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareRoutes(
  left: readonly DirectionalRouteHop[],
  right: readonly DirectionalRouteHop[],
): number {
  const leftHop = left[0];
  const rightHop = right[0];
  if (leftHop === undefined || rightHop === undefined) {
    throw new Error('Prepared service direct route must contain exactly one hop.');
  }
  return (
    compareRawUtf16(leftHop.assetIn, rightHop.assetIn) ||
    compareRawUtf16(leftHop.poolId, rightHop.poolId) ||
    compareRawUtf16(leftHop.assetOut, rightHop.assetOut)
  );
}

function bitLength(value: bigint): number {
  return value === 0n ? 0 : value.toString(2).length;
}

function exactValuesFitPolicy(snapshot: LiquiditySnapshot, policy: ServiceRoutingPolicy): boolean {
  for (const pool of snapshot.pools) {
    if (
      bitLength(pool.reserve0) > policy.maxExactValueBits ||
      bitLength(pool.reserve1) > policy.maxExactValueBits ||
      bitLength(pool.feeChargedNumerator) > policy.maxExactValueBits ||
      bitLength(pool.feeDenominator) > policy.maxExactValueBits
    ) {
      return false;
    }
  }
  return true;
}

function frozenHop(
  assetIn: string,
  poolId: string,
  assetOut: string,
): DirectionalRouteHop {
  return Object.freeze({ assetIn, poolId, assetOut });
}

interface PublicationIndexes {
  readonly knownAssets: ReadonlySet<string>;
  readonly directPairIndex: PreparedServiceRoutingState['directPairIndex'];
}

function buildPublicationIndexes(
  snapshot: LiquiditySnapshot,
  policy: ServiceRoutingPolicy,
): PublicationIndexes | ServicePublicationError {
  const knownAssets = new Set<string>();
  const outboundCounts = new Map<string, number>();
  const mutablePairs = new Map<
    string,
    Map<string, Array<readonly DirectionalRouteHop[]>>
  >();
  let directionalEdges = 0;

  const addEdge = (assetIn: string, poolId: string, assetOut: string): void => {
    knownAssets.add(assetIn);
    knownAssets.add(assetOut);
    directionalEdges += 1;
    outboundCounts.set(assetIn, (outboundCounts.get(assetIn) ?? 0) + 1);
    let byOutput = mutablePairs.get(assetIn);
    if (byOutput === undefined) {
      byOutput = new Map();
      mutablePairs.set(assetIn, byOutput);
    }
    let routes = byOutput.get(assetOut);
    if (routes === undefined) {
      routes = [];
      byOutput.set(assetOut, routes);
    }
    routes.push(Object.freeze([frozenHop(assetIn, poolId, assetOut)]));
  };

  for (const pool of snapshot.pools) {
    addEdge(pool.asset0, pool.poolId, pool.asset1);
    addEdge(pool.asset1, pool.poolId, pool.asset0);
  }
  if (knownAssets.size > policy.maxDistinctAssets) {
    return publicationError(
      'distinct-asset-limit',
      '$.pools',
      `Distinct asset count exceeds ${policy.maxDistinctAssets}.`,
      { limit: 'maxDistinctAssets' },
    );
  }
  if (directionalEdges > policy.maxDirectionalEdges) {
    return publicationError(
      'directional-edge-limit',
      '$.pools',
      `Directional edge count exceeds ${policy.maxDirectionalEdges}.`,
      { limit: 'maxDirectionalEdges' },
    );
  }
  for (const [asset, count] of outboundCounts) {
    if (count > policy.maxOutboundDegree) {
      return publicationError(
        'outbound-degree-limit',
        '$.pools',
        `Outbound degree for ${JSON.stringify(asset)} exceeds ${policy.maxOutboundDegree}.`,
        { limit: 'maxOutboundDegree' },
      );
    }
  }

  const directPairIndex = new Map<
    string,
    ReadonlyMap<string, readonly (readonly DirectionalRouteHop[])[]>
  >();
  for (const [assetIn, mutableByOutput] of mutablePairs) {
    const byOutput = new Map<string, readonly (readonly DirectionalRouteHop[])[]>();
    for (const [assetOut, mutableRoutes] of mutableByOutput) {
      if (mutableRoutes.length > policy.maxDirectRoutesPerPair) {
        return publicationError(
          'direct-route-limit',
          '$.pools',
          `Direct routes for (${JSON.stringify(assetIn)}, ${JSON.stringify(assetOut)}) exceed ${policy.maxDirectRoutesPerPair}.`,
          { limit: 'maxDirectRoutesPerPair' },
        );
      }
      mutableRoutes.sort(compareRoutes);
      byOutput.set(assetOut, Object.freeze(mutableRoutes));
    }
    directPairIndex.set(assetIn, byOutput);
  }
  return Object.freeze({ knownAssets, directPairIndex });
}

export function prepareServiceRoutingContext(
  rawSnapshotUtf8: Uint8Array,
  policy: ServiceRoutingPolicy,
  nowNanoseconds: () => unknown,
): PrepareServiceRoutingContextResult {
  if (policy !== SERVICE_ROUTING_POLICY_V1) {
    return setupFailure(
      'invalid-policy',
      'invalid-service-policy',
      'policy',
      'Service routing policy must be the captured service-policy-v1 capability.',
    );
  }
  if (typeof nowNanoseconds !== 'function') {
    return setupFailure(
      'invalid-dependency',
      'invalid-clock-dependency',
      'nowNanoseconds',
      'nowNanoseconds must be a function.',
    );
  }
  const decoded = decodeBoundedSnapshotJson(rawSnapshotUtf8, policy);
  if (!decoded.ok) {
    return publicationFailure(
      publicationError(
        decoded.error.code,
        decoded.error.path,
        decoded.error.message,
        decoded.error.limit === undefined ? undefined : { limit: decoded.error.limit },
      ),
    );
  }
  const parsed = parseLiquiditySnapshot(decoded.value);
  if (!parsed.ok) {
    const first = parsed.errors[0];
    return publicationFailure(
      publicationError(
        'snapshot-validation-failed',
        first?.path ?? '$',
        first?.message ?? 'Snapshot validation failed.',
        first === undefined ? undefined : { cause: first.code },
      ),
    );
  }
  if (!exactValuesFitPolicy(parsed.value, policy)) {
    return publicationFailure(
      publicationError(
        'exact-value-bit-limit',
        '$.pools',
        `Reserve or fee value exceeds ${policy.maxExactValueBits} bits.`,
        { limit: 'maxExactValueBits' },
      ),
    );
  }
  const canonicalBytes = Buffer.byteLength(
    serializeCanonicalSnapshotContent(parsed.value),
    'utf8',
  );
  if (canonicalBytes > policy.maxCanonicalSnapshotBytes) {
    return publicationFailure(
      publicationError(
        'canonical-snapshot-byte-limit',
        '$',
        `Canonical snapshot exceeds ${policy.maxCanonicalSnapshotBytes} bytes.`,
        { limit: 'maxCanonicalSnapshotBytes' },
      ),
    );
  }
  const prepared = prepareRoutingContext(parsed.value);
  if (!prepared.ok) {
    return publicationFailure(
      publicationError(
        'snapshot-checksum-mismatch',
        '$.snapshotChecksum',
        `Snapshot checksum mismatch: expected ${prepared.error.expected}.`,
      ),
    );
  }
  const indexes = buildPublicationIndexes(parsed.value, policy);
  if ('code' in indexes) return publicationFailure(indexes);
  const identity: PreparedServiceRoutingIdentity = Object.freeze({
    snapshotId: parsed.value.snapshotId,
    snapshotChecksum: parsed.value.snapshotChecksum,
    policyId: policy.policyId,
  });
  const context = Object.freeze({}) as PreparedServiceRoutingContext;
  preparedServiceStates.set(
    context,
    Object.freeze({
      policy,
      prepared: prepared.value,
      identity,
      knownAssets: indexes.knownAssets,
      directPairIndex: indexes.directPairIndex,
      nowNanoseconds,
    }),
  );
  return Object.freeze({ ok: true, value: context });
}

export function isPreparedServiceRoutingContext(
  value: unknown,
): value is PreparedServiceRoutingContext {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    preparedServiceStates.has(value as PreparedServiceRoutingContext)
  );
}

/** @internal */
export function preparedServiceRoutingIdentity(
  context: PreparedServiceRoutingContext,
): PreparedServiceRoutingIdentity | undefined {
  return preparedServiceStates.get(context)?.identity;
}

/** @internal */
export function preparedServiceRoutingPolicy(
  context: PreparedServiceRoutingContext,
): ServiceRoutingPolicy | undefined {
  return preparedServiceStates.get(context)?.policy;
}

/** @internal */
export function preparedServiceRoutingContextHasAsset(
  context: PreparedServiceRoutingContext,
  asset: string,
): boolean {
  return preparedServiceStates.get(context)?.knownAssets.has(asset) ?? false;
}

/** @internal */
export function preparedServiceRoutingBaseContext(
  context: PreparedServiceRoutingContext,
): PreparedRoutingContext {
  const state = preparedServiceStates.get(context);
  if (state === undefined) throw new TypeError('Unknown prepared service routing context.');
  return state.prepared;
}

/** @internal */
export function preparedServiceRoutingClock(
  context: PreparedServiceRoutingContext,
): (() => unknown) | undefined {
  return preparedServiceStates.get(context)?.nowNanoseconds;
}

/** @internal */
export function createPreparedServiceDirectRouteCursor(
  context: PreparedServiceRoutingContext,
  assetIn: string,
  assetOut: string,
): PreparedServiceDirectRouteCursor {
  const state = preparedServiceStates.get(context);
  if (state === undefined) throw new TypeError('Unknown prepared service routing context.');
  const routes = state.directPairIndex.get(assetIn)?.get(assetOut) ?? EMPTY_DIRECT_ROUTES;
  const cursor = Object.freeze({}) as PreparedServiceDirectRouteCursor;
  preparedServiceDirectCursors.set(cursor, { context, routes, index: 0 });
  return cursor;
}

/** @internal */
export function hasPreparedServiceDirectRoute(
  context: PreparedServiceRoutingContext,
  cursor: PreparedServiceDirectRouteCursor,
): boolean {
  const state = preparedServiceDirectCursors.get(cursor);
  return state !== undefined && state.context === context && state.index < state.routes.length;
}

/** @internal */
export function advancePreparedServiceDirectRoute(
  context: PreparedServiceRoutingContext,
  cursor: PreparedServiceDirectRouteCursor,
): readonly DirectionalRouteHop[] | undefined {
  const state = preparedServiceDirectCursors.get(cursor);
  if (state === undefined || state.context !== context) {
    throw new TypeError('Direct-route cursor does not belong to the service context.');
  }
  const route = state.routes[state.index];
  if (route !== undefined) state.index += 1;
  return route;
}
