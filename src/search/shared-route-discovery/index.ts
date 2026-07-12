import {
  discoverPreparedSimplePaths,
  type PreparedRouteDiscoveryError,
  type PreparedRouteDiscoveryErrorCode,
  type PreparedRouteDiscoveryErrorField,
  type PreparedRouteDiscoveryRequest,
  type PreparedRoutingContext,
} from '../../runtime/prepared-routing-context/index.ts';
import {
  enumeratePoolDisjointCandidateSetsFromPaths,
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

export function discoverSharedRoutes(
  context: PreparedRoutingContext,
  request: SharedRouteDiscoveryRequest,
): SharedRouteDiscoveryResult {
  const capturedRequest = captureRequest(request);
  const pathResult = discoverPreparedSimplePaths(context, capturedRequest);
  if (!pathResult.ok) return pathResult;

  const paths = pathResult.value.paths;
  const setResult = enumeratePoolDisjointCandidateSetsFromPaths(
    paths,
    capturedRequest.maxRoutes,
    capturedRequest.maxCandidateSetExpansions,
    2,
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
