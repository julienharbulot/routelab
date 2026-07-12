import type { LiquiditySnapshot } from '../../domain/index.ts';
import type { DirectionalRouteHop } from '../../replay/exact-input-route/index.ts';

export interface AdjacencyBucket {
  readonly assetIn: string;
  readonly edges: readonly DirectionalRouteHop[];
}

export interface DeterministicAdjacencyIndex {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly buckets: readonly AdjacencyBucket[];
}

export interface SimplePathEnumerationRequest {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly maxHops: number;
  readonly maxExpansions: number;
}

export type SimplePathEnumerationErrorCode =
  | 'snapshot-identity-mismatch'
  | 'empty-identifier'
  | 'same-asset-request'
  | 'invalid-max-hops'
  | 'invalid-max-expansions'
  | 'unknown-asset';

export type SimplePathEnumerationErrorField =
  | 'snapshotIdentity'
  | 'assetIn'
  | 'assetOut'
  | 'maxHops'
  | 'maxExpansions';

export interface SimplePathEnumerationError {
  readonly code: SimplePathEnumerationErrorCode;
  readonly field: SimplePathEnumerationErrorField;
  readonly message: string;
}

export interface SimplePathEnumerationValue {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly paths: readonly (readonly DirectionalRouteHop[])[];
  readonly expansions: number;
  readonly termination: 'complete' | 'work-limit';
}

export type SimplePathEnumerationResult =
  | { readonly ok: true; readonly value: SimplePathEnumerationValue }
  | { readonly ok: false; readonly error: SimplePathEnumerationError };

interface TraversalFrame {
  readonly path: readonly DirectionalRouteHop[];
  readonly visitedAssets: ReadonlySet<string>;
  readonly visitedPools: ReadonlySet<string>;
  readonly edges: readonly DirectionalRouteHop[];
  nextEdgeIndex: number;
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

function frozenEdge(
  assetIn: string,
  poolId: string,
  assetOut: string,
): DirectionalRouteHop {
  return Object.freeze({ assetIn, poolId, assetOut });
}

function frozenPath(path: readonly DirectionalRouteHop[]): readonly DirectionalRouteHop[] {
  return Object.freeze(
    path.map((edge) => frozenEdge(edge.assetIn, edge.poolId, edge.assetOut)),
  );
}

function failure(
  code: SimplePathEnumerationErrorCode,
  field: SimplePathEnumerationErrorField,
  message: string,
): SimplePathEnumerationResult {
  const error: SimplePathEnumerationError = Object.freeze({ code, field, message });
  return Object.freeze({ ok: false, error });
}

export function buildDeterministicAdjacency(
  snapshot: LiquiditySnapshot,
): DeterministicAdjacencyIndex {
  const edgesByAsset = new Map<string, DirectionalRouteHop[]>();

  for (const pool of snapshot.pools) {
    const forward = frozenEdge(pool.asset0, pool.poolId, pool.asset1);
    const reverse = frozenEdge(pool.asset1, pool.poolId, pool.asset0);

    const forwardEdges = edgesByAsset.get(forward.assetIn) ?? [];
    forwardEdges.push(forward);
    edgesByAsset.set(forward.assetIn, forwardEdges);

    const reverseEdges = edgesByAsset.get(reverse.assetIn) ?? [];
    reverseEdges.push(reverse);
    edgesByAsset.set(reverse.assetIn, reverseEdges);
  }

  const buckets = [...edgesByAsset.entries()]
    .sort(([left], [right]) => compareRawUtf16(left, right))
    .map(([assetIn, unsortedEdges]): AdjacencyBucket => {
      const edges = Object.freeze([...unsortedEdges].sort(compareEdges));
      return Object.freeze({ assetIn, edges });
    });

  return Object.freeze({
    snapshotId: snapshot.snapshotId,
    snapshotChecksum: snapshot.snapshotChecksum,
    buckets: Object.freeze(buckets),
  });
}

function validateRequest(
  index: DeterministicAdjacencyIndex,
  request: SimplePathEnumerationRequest,
  knownAssets: ReadonlySet<string>,
): SimplePathEnumerationResult | undefined {
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
  if (!Number.isSafeInteger(request.maxExpansions) || request.maxExpansions < 0) {
    return failure(
      'invalid-max-expansions',
      'maxExpansions',
      'request.maxExpansions must be a nonnegative safe integer.',
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

export function enumerateSimplePaths(
  index: DeterministicAdjacencyIndex,
  request: SimplePathEnumerationRequest,
): SimplePathEnumerationResult {
  const bucketsByAsset = new Map(index.buckets.map((bucket) => [bucket.assetIn, bucket]));
  const knownAssets = new Set(bucketsByAsset.keys());
  const requestFailure = validateRequest(index, request, knownAssets);
  if (requestFailure !== undefined) return requestFailure;

  const initialBucket = bucketsByAsset.get(request.assetIn);
  if (initialBucket === undefined) {
    return failure('unknown-asset', 'assetIn', 'request.assetIn must exist in the adjacency index.');
  }

  const stack: TraversalFrame[] = [
    {
      path: [],
      visitedAssets: new Set([request.assetIn]),
      visitedPools: new Set(),
      edges: initialBucket.edges,
      nextEdgeIndex: 0,
    },
  ];
  const completePaths: (readonly DirectionalRouteHop[])[] = [];
  let expansions = 0;
  let termination: 'complete' | 'work-limit' = 'complete';

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame === undefined) break;

    if (frame.path.length >= request.maxHops || frame.nextEdgeIndex >= frame.edges.length) {
      stack.pop();
      continue;
    }

    if (expansions === request.maxExpansions) {
      termination = 'work-limit';
      break;
    }

    const edge = frame.edges[frame.nextEdgeIndex];
    frame.nextEdgeIndex += 1;
    expansions += 1;
    if (edge === undefined) {
      throw new Error('Traversal reached an unavailable canonical edge.');
    }

    if (frame.visitedPools.has(edge.poolId) || frame.visitedAssets.has(edge.assetOut)) {
      continue;
    }

    const nextPath = [...frame.path, edge];
    if (edge.assetOut === request.assetOut) {
      completePaths.push(frozenPath(nextPath));
      continue;
    }

    const nextBucket = bucketsByAsset.get(edge.assetOut);
    if (nextBucket === undefined) {
      continue;
    }

    stack.push({
      path: nextPath,
      visitedAssets: new Set([...frame.visitedAssets, edge.assetOut]),
      visitedPools: new Set([...frame.visitedPools, edge.poolId]),
      edges: nextBucket.edges,
      nextEdgeIndex: 0,
    });
  }

  const paths = Object.freeze([...completePaths].sort(comparePaths));
  const value: SimplePathEnumerationValue = Object.freeze({
    snapshotId: request.snapshotId,
    snapshotChecksum: request.snapshotChecksum,
    assetIn: request.assetIn,
    assetOut: request.assetOut,
    paths,
    expansions,
    termination,
  });
  return Object.freeze({ ok: true, value });
}
