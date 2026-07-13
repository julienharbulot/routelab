import {
  discoverPreparedSimplePaths,
  isPreparedSimplePathList,
  type PreparedRouteDiscoveryError,
  type PreparedRouteDiscoveryErrorCode,
  type PreparedRouteDiscoveryErrorField,
  type PreparedRouteDiscoveryRequest,
  type PreparedRoutingContext,
} from '../../runtime/prepared-routing-context/index.ts';
import {
  type PoolDisjointRouteCandidateSet,
} from '../pool-disjoint-route-sets/index.ts';

export type SharedRouteDiscoveryRequest = PreparedRouteDiscoveryRequest;
export type SharedRouteDiscoveryErrorCode = PreparedRouteDiscoveryErrorCode;
export type SharedRouteDiscoveryErrorField = PreparedRouteDiscoveryErrorField;
export type SharedRouteDiscoveryError = PreparedRouteDiscoveryError;

export interface SharedRouteDiscoverySearchSummary {
  readonly pathExpansions: number;
  readonly enumeratedPaths: number;
  readonly pathTermination: 'complete' | 'work-limit';
  readonly candidateSetExpansions: number;
  readonly enumeratedCandidateSets: number;
  readonly candidateSetTermination: 'complete' | 'work-limit';
}

export interface SharedRouteDiscoveryValue {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly paths: PreparedSimplePathList;
  readonly candidateSets: readonly PoolDisjointRouteCandidateSet[];
  readonly search: SharedRouteDiscoverySearchSummary;
}

type PreparedSimplePathList = Extract<
  ReturnType<typeof discoverPreparedSimplePaths>,
  { readonly ok: true }
>['value']['paths'];

export type SharedRouteDiscoveryResult =
  | { readonly ok: true; readonly value: SharedRouteDiscoveryValue }
  | { readonly ok: false; readonly error: SharedRouteDiscoveryError };

function captureRequest(
  request: SharedRouteDiscoveryRequest,
): SharedRouteDiscoveryRequest {
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

type SharedRoute = PreparedSimplePathList[number];

interface CandidateSetCombinationFrame {
  nextRouteIndex: number;
  readonly addedRouteIndex: number | undefined;
}

declare const sharedCandidateSetFrontierBrand: unique symbol;

/** @internal */
export interface SharedCandidateSetFrontier {
  readonly [sharedCandidateSetFrontierBrand]: typeof sharedCandidateSetFrontierBrand;
}

interface SharedCandidateSetFrontierState {
  readonly paths: PreparedSimplePathList;
  readonly maximumCardinality: number;
  targetCardinality: number;
  readonly selectedRoutes: SharedRoute[];
  readonly usedPoolIds: Set<string>;
  readonly stack: CandidateSetCombinationFrame[];
  readonly candidateSets: PoolDisjointRouteCandidateSet[];
}

const candidateSetFrontiers = new WeakMap<
  SharedCandidateSetFrontier,
  SharedCandidateSetFrontierState
>();

interface SharedCandidateSetEnumerationValue {
  readonly candidateSets: readonly PoolDisjointRouteCandidateSet[];
  readonly expansions: number;
  readonly termination: 'complete' | 'work-limit';
}

function routeIsPoolDisjoint(
  route: SharedRoute,
  usedPoolIds: ReadonlySet<string>,
): boolean {
  return route.every(({ poolId }) => !usedPoolIds.has(poolId));
}

function addRoutePools(route: SharedRoute, usedPoolIds: Set<string>): void {
  for (const { poolId } of route) usedPoolIds.add(poolId);
}

function removeRoutePools(route: SharedRoute, usedPoolIds: Set<string>): void {
  for (const { poolId } of route) usedPoolIds.delete(poolId);
}

function frozenCandidateSet(
  routes: readonly SharedRoute[],
): PoolDisjointRouteCandidateSet {
  return Object.freeze({ routes: Object.freeze([...routes]) });
}

function enumerateSharedSplitCandidateSets(
  paths: PreparedSimplePathList,
  maxRoutes: number,
  maxCandidateSetExpansions: number,
): SharedCandidateSetEnumerationValue {
  const candidateSets: PoolDisjointRouteCandidateSet[] = [];
  let expansions = 0;
  let termination: 'complete' | 'work-limit' = 'complete';
  const maximumCardinality = Math.min(maxRoutes, paths.length);

  cardinalities: for (
    let targetCardinality = 2;
    targetCardinality <= maximumCardinality;
    targetCardinality += 1
  ) {
    const selectedRoutes: SharedRoute[] = [];
    const usedPoolIds = new Set<string>();
    const stack: CandidateSetCombinationFrame[] = [
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
      if (expansions === maxCandidateSetExpansions) {
        termination = 'work-limit';
        break cardinalities;
      }

      const routeIndex = frame.nextRouteIndex;
      frame.nextRouteIndex += 1;
      expansions += 1;
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

  return Object.freeze({
    candidateSets: Object.freeze(candidateSets),
    expansions,
    termination,
  });
}

function beginCandidateSetCardinality(state: SharedCandidateSetFrontierState): void {
  state.selectedRoutes.length = 0;
  state.usedPoolIds.clear();
  state.stack.length = 0;
  if (state.targetCardinality <= state.maximumCardinality) {
    state.stack.push({ nextRouteIndex: 0, addedRouteIndex: undefined });
  }
}

function normalizeCandidateSetFrontier(state: SharedCandidateSetFrontierState): boolean {
  while (state.targetCardinality <= state.maximumCardinality) {
    while (state.stack.at(-1)?.nextRouteIndex === state.paths.length) {
      const exhausted = state.stack.pop();
      if (exhausted?.addedRouteIndex === undefined) continue;
      const removedRoute = state.selectedRoutes.pop();
      if (removedRoute === undefined) {
        throw new Error('Combination frontier lost its selected route.');
      }
      removeRoutePools(removedRoute, state.usedPoolIds);
    }
    if (state.stack.length > 0) return false;
    state.targetCardinality += 1;
    beginCandidateSetCardinality(state);
  }
  return true;
}

/** Creates one opaque combination frontier over the supplied canonical path list. @internal */
export function createSharedCandidateSetFrontier(
  paths: PreparedSimplePathList,
  maxRoutes: number,
): SharedCandidateSetFrontier {
  if (!isPreparedSimplePathList(paths)) {
    throw new TypeError('Candidate-set frontier requires a prepared path-list capability.');
  }
  const state: SharedCandidateSetFrontierState = {
    paths,
    maximumCardinality: Math.min(maxRoutes, paths.length),
    targetCardinality: 2,
    selectedRoutes: [],
    usedPoolIds: new Set<string>(),
    stack: [],
    candidateSets: [],
  };
  beginCandidateSetCardinality(state);
  const frontier = Object.freeze({}) as SharedCandidateSetFrontier;
  candidateSetFrontiers.set(frontier, state);
  return frontier;
}

/** Reports whether a combination-expansion unit is pending after free normalization. @internal */
export function hasSharedCandidateSetExpansion(
  frontier: SharedCandidateSetFrontier,
): boolean {
  const state = candidateSetFrontiers.get(frontier);
  if (state === undefined) throw new TypeError('Unknown candidate-set frontier.');
  return !normalizeCandidateSetFrontier(state);
}

/** Executes exactly one atomic pool-disjoint combination expansion. @internal */
export function expandSharedCandidateSetFrontier(
  frontier: SharedCandidateSetFrontier,
): void {
  const state = candidateSetFrontiers.get(frontier);
  if (state === undefined) throw new TypeError('Unknown candidate-set frontier.');
  if (normalizeCandidateSetFrontier(state)) {
    throw new Error('Cannot expand a completed candidate-set frontier.');
  }
  const frame = state.stack.at(-1);
  if (frame === undefined) throw new Error('Candidate-set frontier lost its active frame.');
  const routeIndex = frame.nextRouteIndex;
  frame.nextRouteIndex += 1;
  const route = state.paths[routeIndex];
  if (route === undefined) {
    throw new Error('Combination frontier reached an unavailable route.');
  }
  if (!routeIsPoolDisjoint(route, state.usedPoolIds)) return;

  state.selectedRoutes.push(route);
  addRoutePools(route, state.usedPoolIds);
  if (state.selectedRoutes.length === state.targetCardinality) {
    state.candidateSets.push(frozenCandidateSet(state.selectedRoutes));
    state.selectedRoutes.pop();
    removeRoutePools(route, state.usedPoolIds);
    return;
  }
  state.stack.push({
    nextRouteIndex: routeIndex + 1,
    addedRouteIndex: routeIndex,
  });
}

/** Materializes the exact candidate sets produced by the frontier prefix. @internal */
export function materializeSharedCandidateSets(
  frontier: SharedCandidateSetFrontier,
): readonly PoolDisjointRouteCandidateSet[] {
  const state = candidateSetFrontiers.get(frontier);
  if (state === undefined) throw new TypeError('Unknown candidate-set frontier.');
  return Object.freeze([...state.candidateSets]);
}

/**
 * Capability-guarded shared structural discovery for composed routing stages.
 * @internal
 */
export function discoverSharedRoutes(
  context: PreparedRoutingContext,
  request: SharedRouteDiscoveryRequest,
): SharedRouteDiscoveryResult {
  const capturedRequest = captureRequest(request);
  const pathResult = discoverPreparedSimplePaths(context, capturedRequest);
  if (!pathResult.ok) return pathResult;

  const paths = pathResult.value.paths;
  const setResult = enumerateSharedSplitCandidateSets(
    paths,
    capturedRequest.maxRoutes,
    capturedRequest.maxCandidateSetExpansions,
  );
  const search: SharedRouteDiscoverySearchSummary = Object.freeze({
    pathExpansions: pathResult.value.expansions,
    enumeratedPaths: paths.length,
    pathTermination: pathResult.value.termination,
    candidateSetExpansions: setResult.expansions,
    enumeratedCandidateSets: setResult.candidateSets.length,
    candidateSetTermination: setResult.termination,
  });
  const value: SharedRouteDiscoveryValue = Object.freeze({
    snapshotId: pathResult.value.snapshotId,
    snapshotChecksum: pathResult.value.snapshotChecksum,
    assetIn: pathResult.value.assetIn,
    assetOut: pathResult.value.assetOut,
    paths,
    candidateSets: setResult.candidateSets,
    search,
  });
  return Object.freeze({ ok: true, value });
}
