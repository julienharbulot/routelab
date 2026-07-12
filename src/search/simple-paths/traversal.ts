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

export interface FrozenSimplePathTraversalFrame {
  readonly path: readonly DirectionalRouteHop[];
  readonly visitedAssets: readonly string[];
  readonly visitedPools: readonly string[];
  readonly edges: readonly DirectionalRouteHop[];
  readonly nextEdgeIndex: number;
}

export interface FrozenSimplePathTraversalState {
  readonly request: TraversalRequest;
  readonly buckets: readonly TraversalAdjacencyBucket[];
  readonly stack: readonly FrozenSimplePathTraversalFrame[];
  readonly completePaths: readonly (readonly DirectionalRouteHop[])[];
  readonly expansions: number;
}

function frozenEdge(edge: DirectionalRouteHop): DirectionalRouteHop {
  return Object.freeze({
    assetIn: edge.assetIn,
    poolId: edge.poolId,
    assetOut: edge.assetOut,
  });
}

function frozenPath(path: readonly DirectionalRouteHop[]): readonly DirectionalRouteHop[] {
  return Object.freeze(path.map(frozenEdge));
}

function frozenEdges(edges: readonly DirectionalRouteHop[]): readonly DirectionalRouteHop[] {
  return Object.freeze(edges.map(frozenEdge));
}

export function createSimplePathTraversal(
  index: TraversalAdjacencyIndex,
  request: TraversalRequest,
): SimplePathTraversalState {
  const bucketsByAsset = new Map(index.buckets.map((bucket) => [bucket.assetIn, bucket]));
  return createSimplePathTraversalFromBuckets(bucketsByAsset, request);
}

export function createSimplePathTraversalFromBuckets(
  bucketsByAsset: ReadonlyMap<string, TraversalAdjacencyBucket>,
  request: TraversalRequest,
): SimplePathTraversalState {
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

export function freezeSimplePathTraversal(
  state: SimplePathTraversalState,
): FrozenSimplePathTraversalState {
  const request: TraversalRequest = Object.freeze({
    assetIn: state.request.assetIn,
    assetOut: state.request.assetOut,
    maxHops: state.request.maxHops,
  });
  const buckets = Object.freeze(
    [...state.bucketsByAsset.values()].map((bucket) =>
      Object.freeze({
        assetIn: bucket.assetIn,
        edges: frozenEdges(bucket.edges),
      }),
    ),
  );
  const stack = Object.freeze(
    state.stack.map((frame): FrozenSimplePathTraversalFrame =>
      Object.freeze({
        path: frozenPath(frame.path),
        visitedAssets: Object.freeze([...frame.visitedAssets]),
        visitedPools: Object.freeze([...frame.visitedPools]),
        edges: frozenEdges(frame.edges),
        nextEdgeIndex: frame.nextEdgeIndex,
      }),
    ),
  );
  const completePaths = Object.freeze(state.completePaths.map(frozenPath));
  return Object.freeze({
    request,
    buckets,
    stack,
    completePaths,
    expansions: state.expansions,
  });
}

export function cloneFrozenSimplePathTraversal(
  frozen: FrozenSimplePathTraversalState,
): SimplePathTraversalState {
  const buckets = frozen.buckets.map((bucket) => ({
    assetIn: bucket.assetIn,
    edges: frozenEdges(bucket.edges),
  }));
  return {
    request: Object.freeze({
      assetIn: frozen.request.assetIn,
      assetOut: frozen.request.assetOut,
      maxHops: frozen.request.maxHops,
    }),
    bucketsByAsset: new Map(buckets.map((bucket) => [bucket.assetIn, bucket])),
    stack: frozen.stack.map((frame) => ({
      path: frozenPath(frame.path),
      visitedAssets: new Set(frame.visitedAssets),
      visitedPools: new Set(frame.visitedPools),
      edges: frozenEdges(frame.edges),
      nextEdgeIndex: frame.nextEdgeIndex,
    })),
    completePaths: frozen.completePaths.map(frozenPath),
    expansions: frozen.expansions,
  };
}
