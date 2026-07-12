import type { DirectionalRouteHop } from '../../replay/exact-input-route/index.ts';

interface TraversalAdjacencyBucket {
  readonly assetIn: string;
  readonly edges: readonly DirectionalRouteHop[];
}

interface TraversalAdjacencyIndex {
  readonly buckets: readonly TraversalAdjacencyBucket[];
}

interface TraversalRequest {
  readonly assetIn: string;
  readonly assetOut: string;
  readonly maxHops: number;
}

interface TraversalFrame {
  readonly path: readonly DirectionalRouteHop[];
  readonly visitedAssets: ReadonlySet<string>;
  readonly visitedPools: ReadonlySet<string>;
  readonly edges: readonly DirectionalRouteHop[];
  nextEdgeIndex: number;
}

export interface SimplePathTraversalState {
  readonly request: TraversalRequest;
  readonly bucketsByAsset: ReadonlyMap<string, TraversalAdjacencyBucket>;
  readonly stack: TraversalFrame[];
  readonly completePaths: (readonly DirectionalRouteHop[])[];
  expansions: number;
}

function frozenPath(path: readonly DirectionalRouteHop[]): readonly DirectionalRouteHop[] {
  return Object.freeze(
    path.map((edge) =>
      Object.freeze({
        assetIn: edge.assetIn,
        poolId: edge.poolId,
        assetOut: edge.assetOut,
      }),
    ),
  );
}

export function createSimplePathTraversal(
  index: TraversalAdjacencyIndex,
  request: TraversalRequest,
): SimplePathTraversalState {
  const bucketsByAsset = new Map(index.buckets.map((bucket) => [bucket.assetIn, bucket]));
  const initialBucket = bucketsByAsset.get(request.assetIn);
  if (initialBucket === undefined) {
    throw new Error('Validated traversal requires a known input asset.');
  }

  return {
    request,
    bucketsByAsset,
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
}

export function normalizeSimplePathTraversal(state: SimplePathTraversalState): boolean {
  while (state.stack.length > 0) {
    const frame = state.stack[state.stack.length - 1];
    if (frame === undefined) break;
    if (
      frame.path.length < state.request.maxHops &&
      frame.nextEdgeIndex < frame.edges.length
    ) {
      return false;
    }
    state.stack.pop();
  }
  return true;
}

export function expandSimplePathTraversal(
  state: SimplePathTraversalState,
): readonly DirectionalRouteHop[] | undefined {
  const frame = state.stack[state.stack.length - 1];
  if (frame === undefined) {
    throw new Error('Cannot expand a completed traversal.');
  }

  const edge = frame.edges[frame.nextEdgeIndex];
  frame.nextEdgeIndex += 1;
  state.expansions += 1;
  if (edge === undefined) {
    throw new Error('Traversal reached an unavailable canonical edge.');
  }

  if (frame.visitedPools.has(edge.poolId) || frame.visitedAssets.has(edge.assetOut)) {
    return undefined;
  }

  const nextPath = [...frame.path, edge];
  if (edge.assetOut === state.request.assetOut) {
    const completedPath = frozenPath(nextPath);
    state.completePaths.push(completedPath);
    return completedPath;
  }

  const nextBucket = state.bucketsByAsset.get(edge.assetOut);
  if (nextBucket === undefined) return undefined;

  state.stack.push({
    path: nextPath,
    visitedAssets: new Set([...frame.visitedAssets, edge.assetOut]),
    visitedPools: new Set([...frame.visitedPools, edge.poolId]),
    edges: nextBucket.edges,
    nextEdgeIndex: 0,
  });
  return undefined;
}
