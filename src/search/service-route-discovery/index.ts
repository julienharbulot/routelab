import type { DirectionalRouteHop } from '../../replay/exact-input-route/index.ts';
import type { PoolDisjointRouteCandidateSet } from '../pool-disjoint-route-sets/index.ts';

declare const serviceRouteDiscoveryFrontierBrand: unique symbol;

/** @internal */
export interface ServiceRouteDiscoveryFrontier {
  readonly [serviceRouteDiscoveryFrontierBrand]:
    typeof serviceRouteDiscoveryFrontierBrand;
}

export type ServiceRouteDiscoveryStepResult =
  | { readonly emitted: false }
  | {
      readonly emitted: true;
      readonly candidateSet: PoolDisjointRouteCandidateSet;
    };

interface CombinationFrame {
  nextRouteIndex: number;
  readonly addedRouteIndex: number | undefined;
}

interface FrontierState {
  readonly maxRoutes: number;
  readonly maxHops: number;
  readonly paths: Array<readonly DirectionalRouteHop[]>;
  readonly selectedRoutes: Array<readonly DirectionalRouteHop[]>;
  readonly usedPoolIds: Set<string>;
  readonly stack: CombinationFrame[];
  anchorIndex: number;
  targetCardinality: number;
  inputClosed: boolean;
}

const frontierStates = new WeakMap<ServiceRouteDiscoveryFrontier, FrontierState>();
const NO_CANDIDATE_SET = Object.freeze({ emitted: false as const });

function stateOf(frontier: ServiceRouteDiscoveryFrontier): FrontierState {
  const state = frontierStates.get(frontier);
  if (state === undefined) throw new TypeError('Unknown service route-discovery frontier.');
  return state;
}

function compareRawUtf16(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareHops(left: DirectionalRouteHop, right: DirectionalRouteHop): number {
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
    const leftHop = left[index];
    const rightHop = right[index];
    if (leftHop === undefined || rightHop === undefined) {
      throw new Error('Service path comparison reached an unavailable hop.');
    }
    const comparison = compareHops(leftHop, rightHop);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

function capturePath(
  source: readonly DirectionalRouteHop[],
  maxHops: number,
): readonly DirectionalRouteHop[] {
  if (
    !Number.isSafeInteger(source.length) ||
    source.length < 1 ||
    source.length > maxHops
  ) {
    throw new TypeError('Service discovery path violates its hop bound.');
  }
  const path: DirectionalRouteHop[] = [];
  const assets = new Set<string>();
  const pools = new Set<string>();
  for (let index = 0; index < source.length; index += 1) {
    const hop = source[index];
    if (
      hop === undefined ||
      typeof hop.assetIn !== 'string' ||
      typeof hop.poolId !== 'string' ||
      typeof hop.assetOut !== 'string' ||
      hop.assetIn.length === 0 ||
      hop.poolId.length === 0 ||
      hop.assetOut.length === 0 ||
      hop.assetIn === hop.assetOut ||
      (index > 0 && source[index - 1]?.assetOut !== hop.assetIn) ||
      pools.has(hop.poolId) ||
      assets.has(hop.assetOut)
    ) {
      throw new TypeError('Service discovery path is not a bounded simple route.');
    }
    if (index === 0) assets.add(hop.assetIn);
    pools.add(hop.poolId);
    assets.add(hop.assetOut);
    path.push(
      Object.freeze({
        assetIn: hop.assetIn,
        poolId: hop.poolId,
        assetOut: hop.assetOut,
      }),
    );
  }
  return Object.freeze(path);
}

function routeIsPoolDisjoint(
  route: readonly DirectionalRouteHop[],
  usedPoolIds: ReadonlySet<string>,
): boolean {
  for (const hop of route) {
    if (usedPoolIds.has(hop.poolId)) return false;
  }
  return true;
}

function addRoutePools(
  route: readonly DirectionalRouteHop[],
  usedPoolIds: Set<string>,
): void {
  for (const hop of route) usedPoolIds.add(hop.poolId);
}

function removeRoutePools(
  route: readonly DirectionalRouteHop[],
  usedPoolIds: Set<string>,
): void {
  for (const hop of route) usedPoolIds.delete(hop.poolId);
}

function beginCurrentCardinality(state: FrontierState): void {
  state.selectedRoutes.length = 0;
  state.usedPoolIds.clear();
  state.stack.length = 0;
  if (
    state.anchorIndex < state.paths.length &&
    state.targetCardinality <= Math.min(state.maxRoutes, state.anchorIndex + 1)
  ) {
    state.stack.push({ nextRouteIndex: 0, addedRouteIndex: undefined });
  }
}

function frozenCandidateSet(
  routes: readonly (readonly DirectionalRouteHop[])[],
): PoolDisjointRouteCandidateSet {
  return Object.freeze({ routes: Object.freeze([...routes]) });
}

export function createServiceRouteDiscoveryFrontier(
  maxRoutes: number,
  maxHops: number,
): ServiceRouteDiscoveryFrontier {
  if (!Number.isSafeInteger(maxRoutes) || maxRoutes < 2 || maxRoutes > 4) {
    throw new TypeError('Service discovery maxRoutes must be an integer from 2 through 4.');
  }
  if (!Number.isSafeInteger(maxHops) || maxHops < 1 || maxHops > 4) {
    throw new TypeError('Service discovery maxHops must be an integer from 1 through 4.');
  }
  const frontier = Object.freeze({}) as ServiceRouteDiscoveryFrontier;
  frontierStates.set(frontier, {
    maxRoutes,
    maxHops,
    paths: [],
    selectedRoutes: [],
    usedPoolIds: new Set(),
    stack: [],
    anchorIndex: 1,
    targetCardinality: 2,
    inputClosed: false,
  });
  return frontier;
}

export function appendServiceRouteDiscoveryPath(
  frontier: ServiceRouteDiscoveryFrontier,
  sourcePath: readonly DirectionalRouteHop[],
): void {
  const state = stateOf(frontier);
  if (state.inputClosed) throw new TypeError('Service discovery path input is closed.');
  const path = capturePath(sourcePath, state.maxHops);
  const previous = state.paths.at(-1);
  if (previous !== undefined && comparePaths(previous, path) >= 0) {
    throw new TypeError('Service discovery paths must append in strict canonical order.');
  }
  state.paths.push(path);
  if (
    state.stack.length === 0 &&
    state.selectedRoutes.length === 0 &&
    state.anchorIndex < state.paths.length &&
    state.targetCardinality <= Math.min(state.maxRoutes, state.anchorIndex + 1)
  ) {
    beginCurrentCardinality(state);
  }
}

export function closeServiceRouteDiscoveryPathInput(
  frontier: ServiceRouteDiscoveryFrontier,
): void {
  stateOf(frontier).inputClosed = true;
}

export function hasServiceRouteDiscoveryStep(
  frontier: ServiceRouteDiscoveryFrontier,
): boolean {
  const state = stateOf(frontier);
  return state.anchorIndex < state.paths.length;
}

export function serviceRouteDiscoveryIsComplete(
  frontier: ServiceRouteDiscoveryFrontier,
): boolean {
  const state = stateOf(frontier);
  return state.inputClosed && state.anchorIndex >= state.paths.length;
}

export function advanceServiceRouteDiscoveryFrontier(
  frontier: ServiceRouteDiscoveryFrontier,
): ServiceRouteDiscoveryStepResult {
  const state = stateOf(frontier);
  if (state.anchorIndex >= state.paths.length) {
    throw new Error('Service route-discovery frontier has no pending primitive step.');
  }
  const maximumCardinality = Math.min(state.maxRoutes, state.anchorIndex + 1);
  if (state.targetCardinality > maximumCardinality) {
    beginCurrentCardinality(state);
    state.anchorIndex += 1;
    state.targetCardinality = 2;
    beginCurrentCardinality(state);
    return NO_CANDIDATE_SET;
  }
  if (state.stack.length === 0 && state.selectedRoutes.length === 0) {
    beginCurrentCardinality(state);
  }
  if (state.selectedRoutes.length === state.targetCardinality - 1) {
    const anchor = state.paths[state.anchorIndex];
    if (anchor === undefined) {
      throw new Error('Service candidate-set frontier lost its anchor path.');
    }
    const candidateSet = routeIsPoolDisjoint(anchor, state.usedPoolIds)
      ? frozenCandidateSet([...state.selectedRoutes, anchor])
      : undefined;
    const removed = state.selectedRoutes.pop();
    if (removed === undefined) {
      throw new Error('Service candidate-set frontier lost its selected route.');
    }
    removeRoutePools(removed, state.usedPoolIds);
    return candidateSet === undefined
      ? NO_CANDIDATE_SET
      : Object.freeze({ emitted: true, candidateSet });
  }

  let cleanupCount = 0;
  while (state.stack.at(-1)?.nextRouteIndex === state.anchorIndex) {
    const exhausted = state.stack.pop();
    cleanupCount += 1;
    if (cleanupCount > state.maxRoutes) {
      throw new Error('Service candidate-set cleanup exceeded maxRoutes.');
    }
    if (exhausted?.addedRouteIndex === undefined) continue;
    const removed = state.selectedRoutes.pop();
    if (removed === undefined) {
      throw new Error('Service candidate-set frontier lost its selected route.');
    }
    removeRoutePools(removed, state.usedPoolIds);
  }
  if (state.stack.length === 0) {
    state.targetCardinality += 1;
    beginCurrentCardinality(state);
    return NO_CANDIDATE_SET;
  }

  const frame = state.stack.at(-1);
  if (frame === undefined) throw new Error('Service candidate-set frontier lost its frame.');
  const routeIndex = frame.nextRouteIndex;
  frame.nextRouteIndex += 1;
  const route = state.paths[routeIndex];
  if (route === undefined) {
    throw new Error('Service candidate-set frontier reached an unavailable route.');
  }
  if (!routeIsPoolDisjoint(route, state.usedPoolIds)) return NO_CANDIDATE_SET;
  state.selectedRoutes.push(route);
  addRoutePools(route, state.usedPoolIds);
  if (state.selectedRoutes.length < state.targetCardinality - 1) {
    state.stack.push({ nextRouteIndex: routeIndex + 1, addedRouteIndex: routeIndex });
  }
  return NO_CANDIDATE_SET;
}
