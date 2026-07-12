import {
  enumerateSimplePaths,
  type AdjacencyBucket,
  type DeterministicAdjacencyIndex,
} from '../simple-paths/index.ts';

export interface PoolDisjointRouteSetEnumerationRequest {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly maxHops: number;
  readonly maxPathExpansions: number;
  readonly maxRoutes: number;
  readonly maxCandidateSetExpansions: number;
}

type PoolDisjointRoute = DeterministicAdjacencyIndex['buckets'][number]['edges'];

export interface PoolDisjointRouteCandidateSet {
  readonly routes: readonly PoolDisjointRoute[];
}

export interface PoolDisjointRouteSetSearchSummary {
  readonly pathExpansions: number;
  readonly enumeratedPaths: number;
  readonly pathTermination: 'complete' | 'work-limit';
  readonly candidateSetExpansions: number;
  readonly enumeratedCandidateSets: number;
  readonly candidateSetTermination: 'complete' | 'work-limit';
}

export interface PoolDisjointRouteSetEnumerationValue {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly candidateSets: readonly PoolDisjointRouteCandidateSet[];
  readonly search: PoolDisjointRouteSetSearchSummary;
}

export type PoolDisjointRouteSetEnumerationErrorCode =
  | 'snapshot-identity-mismatch'
  | 'empty-identifier'
  | 'same-asset-request'
  | 'invalid-max-hops'
  | 'invalid-max-path-expansions'
  | 'invalid-max-routes'
  | 'invalid-max-candidate-set-expansions'
  | 'unknown-asset';

export type PoolDisjointRouteSetEnumerationErrorField =
  | 'snapshotIdentity'
  | 'assetIn'
  | 'assetOut'
  | 'maxHops'
  | 'maxPathExpansions'
  | 'maxRoutes'
  | 'maxCandidateSetExpansions';

export interface PoolDisjointRouteSetEnumerationError {
  readonly code: PoolDisjointRouteSetEnumerationErrorCode;
  readonly field: PoolDisjointRouteSetEnumerationErrorField;
  readonly message: string;
}

export type PoolDisjointRouteSetEnumerationResult =
  | {
      readonly ok: true;
      readonly value: PoolDisjointRouteSetEnumerationValue;
    }
  | {
      readonly ok: false;
      readonly error: PoolDisjointRouteSetEnumerationError;
    };

type PoolDisjointRouteSetEnumerationFailure = Extract<
  PoolDisjointRouteSetEnumerationResult,
  { readonly ok: false }
>;

function captureEdge(edge: PoolDisjointRoute[number]): PoolDisjointRoute[number] {
  const assetIn = edge.assetIn;
  const poolId = edge.poolId;
  const assetOut = edge.assetOut;
  return Object.freeze({ assetIn, poolId, assetOut });
}

function captureBucket(bucket: AdjacencyBucket): AdjacencyBucket {
  const assetIn = bucket.assetIn;
  const sourceEdges = bucket.edges;
  const edges = Object.freeze(Array.from(sourceEdges, captureEdge));
  return Object.freeze({ assetIn, edges });
}

function captureIndex(index: DeterministicAdjacencyIndex): DeterministicAdjacencyIndex {
  const snapshotId = index.snapshotId;
  const snapshotChecksum = index.snapshotChecksum;
  const sourceBuckets = index.buckets;
  const buckets = Object.freeze(Array.from(sourceBuckets, captureBucket));
  return Object.freeze({ snapshotId, snapshotChecksum, buckets });
}

function captureRequest(
  request: PoolDisjointRouteSetEnumerationRequest,
): PoolDisjointRouteSetEnumerationRequest {
  return Object.freeze({
    snapshotId: request.snapshotId,
    snapshotChecksum: request.snapshotChecksum,
    assetIn: request.assetIn,
    assetOut: request.assetOut,
    maxHops: request.maxHops,
    maxPathExpansions: request.maxPathExpansions,
    maxRoutes: request.maxRoutes,
    maxCandidateSetExpansions: request.maxCandidateSetExpansions,
  });
}

function failure(
  code: PoolDisjointRouteSetEnumerationErrorCode,
  field: PoolDisjointRouteSetEnumerationErrorField,
  message: string,
): PoolDisjointRouteSetEnumerationFailure {
  const error: PoolDisjointRouteSetEnumerationError = Object.freeze({
    code,
    field,
    message,
  });
  return Object.freeze({ ok: false, error });
}

function validateRequest(
  index: DeterministicAdjacencyIndex,
  request: PoolDisjointRouteSetEnumerationRequest,
  knownAssets: ReadonlySet<string>,
): PoolDisjointRouteSetEnumerationFailure | undefined {
  if (
    request.snapshotId !== index.snapshotId ||
    request.snapshotChecksum !== index.snapshotChecksum
  ) {
    return failure(
      'snapshot-identity-mismatch',
      'snapshotIdentity',
      'request snapshotId and snapshotChecksum must match the adjacency index identity.',
    );
  }
  if (request.assetIn.length === 0) {
    return failure('empty-identifier', 'assetIn', 'request.assetIn must not be empty.');
  }
  if (request.assetOut.length === 0) {
    return failure('empty-identifier', 'assetOut', 'request.assetOut must not be empty.');
  }
  if (request.assetIn === request.assetOut) {
    return failure(
      'same-asset-request',
      'assetOut',
      'request.assetIn and request.assetOut must be distinct.',
    );
  }
  if (!Number.isSafeInteger(request.maxHops) || request.maxHops <= 0) {
    return failure(
      'invalid-max-hops',
      'maxHops',
      'request.maxHops must be a positive safe integer.',
    );
  }
  if (
    !Number.isSafeInteger(request.maxPathExpansions) ||
    request.maxPathExpansions < 0
  ) {
    return failure(
      'invalid-max-path-expansions',
      'maxPathExpansions',
      'request.maxPathExpansions must be a nonnegative safe integer.',
    );
  }
  if (!Number.isSafeInteger(request.maxRoutes) || request.maxRoutes <= 0) {
    return failure(
      'invalid-max-routes',
      'maxRoutes',
      'request.maxRoutes must be a positive safe integer.',
    );
  }
  if (
    !Number.isSafeInteger(request.maxCandidateSetExpansions) ||
    request.maxCandidateSetExpansions < 0
  ) {
    return failure(
      'invalid-max-candidate-set-expansions',
      'maxCandidateSetExpansions',
      'request.maxCandidateSetExpansions must be a nonnegative safe integer.',
    );
  }
  if (!knownAssets.has(request.assetIn)) {
    return failure(
      'unknown-asset',
      'assetIn',
      'request.assetIn must exist in the adjacency index.',
    );
  }
  if (!knownAssets.has(request.assetOut)) {
    return failure(
      'unknown-asset',
      'assetOut',
      'request.assetOut must exist in the adjacency index.',
    );
  }
  return undefined;
}

interface CombinationFrame {
  nextRouteIndex: number;
  readonly addedRouteIndex: number | undefined;
}

function routeIsPoolDisjoint(
  route: PoolDisjointRoute,
  usedPoolIds: ReadonlySet<string>,
): boolean {
  return route.every(({ poolId }) => !usedPoolIds.has(poolId));
}

function addRoutePools(route: PoolDisjointRoute, usedPoolIds: Set<string>): void {
  for (const { poolId } of route) usedPoolIds.add(poolId);
}

function removeRoutePools(route: PoolDisjointRoute, usedPoolIds: Set<string>): void {
  for (const { poolId } of route) usedPoolIds.delete(poolId);
}

function frozenCandidateSet(
  routes: readonly PoolDisjointRoute[],
): PoolDisjointRouteCandidateSet {
  return Object.freeze({ routes: Object.freeze([...routes]) });
}

export function enumeratePoolDisjointRouteSets(
  index: DeterministicAdjacencyIndex,
  request: PoolDisjointRouteSetEnumerationRequest,
): PoolDisjointRouteSetEnumerationResult {
  const capturedIndex = captureIndex(index);
  const capturedRequest = captureRequest(request);
  const knownAssets = new Set(
    capturedIndex.buckets.map(({ assetIn }) => assetIn),
  );
  const requestFailure = validateRequest(
    capturedIndex,
    capturedRequest,
    knownAssets,
  );
  if (requestFailure !== undefined) return requestFailure;

  const pathResult = enumerateSimplePaths(
    capturedIndex,
    Object.freeze({
      snapshotId: capturedRequest.snapshotId,
      snapshotChecksum: capturedRequest.snapshotChecksum,
      assetIn: capturedRequest.assetIn,
      assetOut: capturedRequest.assetOut,
      maxHops: capturedRequest.maxHops,
      maxExpansions: capturedRequest.maxPathExpansions,
    }),
  );
  if (!pathResult.ok) {
    throw new Error('Validated route-set request failed simple-path enumeration.');
  }

  const paths = pathResult.value.paths;
  const candidateSets: PoolDisjointRouteCandidateSet[] = [];
  let candidateSetExpansions = 0;
  let candidateSetTermination: 'complete' | 'work-limit' = 'complete';
  const maximumCardinality = Math.min(capturedRequest.maxRoutes, paths.length);

  cardinalities: for (
    let targetCardinality = 1;
    targetCardinality <= maximumCardinality;
    targetCardinality += 1
  ) {
    const selectedRoutes: PoolDisjointRoute[] = [];
    const usedPoolIds = new Set<string>();
    const stack: CombinationFrame[] = [
      { nextRouteIndex: 0, addedRouteIndex: undefined },
    ];

    while (stack.length > 0) {
      while (stack.at(-1)?.nextRouteIndex === paths.length) {
        const exhausted = stack.pop();
        if (exhausted?.addedRouteIndex === undefined) continue;
        const removedRoute = selectedRoutes.pop();
        if (removedRoute === undefined) {
          throw new Error('Combination frontier lost its selected route.');
        }
        removeRoutePools(removedRoute, usedPoolIds);
      }
      const frame = stack.at(-1);
      if (frame === undefined) break;
      if (
        candidateSetExpansions ===
        capturedRequest.maxCandidateSetExpansions
      ) {
        candidateSetTermination = 'work-limit';
        break cardinalities;
      }

      const routeIndex = frame.nextRouteIndex;
      frame.nextRouteIndex += 1;
      candidateSetExpansions += 1;
      const route = paths[routeIndex];
      if (route === undefined) {
        throw new Error('Combination frontier reached an unavailable route.');
      }
      if (!routeIsPoolDisjoint(route, usedPoolIds)) continue;

      selectedRoutes.push(route);
      addRoutePools(route, usedPoolIds);
      if (selectedRoutes.length === targetCardinality) {
        candidateSets.push(frozenCandidateSet(selectedRoutes));
        selectedRoutes.pop();
        removeRoutePools(route, usedPoolIds);
        continue;
      }
      stack.push({
        nextRouteIndex: routeIndex + 1,
        addedRouteIndex: routeIndex,
      });
    }
  }

  const search: PoolDisjointRouteSetSearchSummary = Object.freeze({
    pathExpansions: pathResult.value.expansions,
    enumeratedPaths: paths.length,
    pathTermination: pathResult.value.termination,
    candidateSetExpansions,
    enumeratedCandidateSets: candidateSets.length,
    candidateSetTermination,
  });
  const value: PoolDisjointRouteSetEnumerationValue = Object.freeze({
    snapshotId: capturedRequest.snapshotId,
    snapshotChecksum: capturedRequest.snapshotChecksum,
    assetIn: capturedRequest.assetIn,
    assetOut: capturedRequest.assetOut,
    candidateSets: Object.freeze(candidateSets),
    search,
  });
  return Object.freeze({ ok: true, value });
}
