import type { ConstantProductPool, LiquiditySnapshot } from '../../domain/index.ts';
import {
  replayExactInputSplit,
  type ExactInputSplitReplayLegReceipt,
  type ExactInputSplitReplayReceipt,
} from '../../replay/exact-input-split/index.ts';
import {
  routeExactInputSinglePath,
  type ExactInputSinglePathRouterResult,
  type ExactInputSinglePathSearchSummary,
} from '../single-path/index.ts';
import {
  enumeratePoolDisjointRouteSets,
  type PoolDisjointRouteSetSearchSummary,
} from '../../search/pool-disjoint-route-sets/index.ts';
import { buildDeterministicAdjacency } from '../../search/simple-paths/index.ts';
import { isStrictlyBetterSplitReceipt } from './objective.ts';

export interface ExactInputSplitRouterRequest {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly maxHops: number;
  readonly maxPathExpansions: number;
  readonly maxRoutes: number;
  readonly maxCandidateSetExpansions: number;
}

export type ExactInputSplitFallbackSummary =
  | {
      readonly status: 'success';
      readonly search: ExactInputSinglePathSearchSummary;
    }
  | {
      readonly status: 'no-route';
      readonly reason: 'no-candidate' | 'all-candidates-rejected';
      readonly search: ExactInputSinglePathSearchSummary;
    }
  | {
      readonly status: 'no-plan';
      readonly reason: 'work-limit';
      readonly search: ExactInputSinglePathSearchSummary;
    };

export interface ExactInputEqualSplitSearchSummary {
  readonly proposed: number;
  readonly replayed: number;
  readonly rejected: number;
  readonly skippedZeroLeg: number;
}

export interface ExactInputSplitSearchSummary {
  readonly fallback: ExactInputSplitFallbackSummary;
  readonly structural: PoolDisjointRouteSetSearchSummary;
  readonly equalSplit: ExactInputEqualSplitSearchSummary;
  readonly termination: 'complete' | 'work-limit';
}

export interface ExactInputSplitPlan {
  readonly receipt: ExactInputSplitReplayReceipt;
  readonly search: ExactInputSplitSearchSummary;
}

export type ExactInputSplitRouterValidationErrorCode =
  | 'snapshot-identity-mismatch'
  | 'empty-identifier'
  | 'nonpositive-input'
  | 'same-asset-request'
  | 'invalid-max-hops'
  | 'invalid-max-path-expansions'
  | 'invalid-max-routes'
  | 'invalid-max-candidate-set-expansions'
  | 'unknown-asset';

export type ExactInputSplitRouterValidationErrorField =
  | 'snapshotIdentity'
  | 'assetIn'
  | 'assetOut'
  | 'amountIn'
  | 'maxHops'
  | 'maxPathExpansions'
  | 'maxRoutes'
  | 'maxCandidateSetExpansions';

export interface ExactInputSplitRouterValidationError {
  readonly code: ExactInputSplitRouterValidationErrorCode;
  readonly field: ExactInputSplitRouterValidationErrorField;
  readonly message: string;
}

export type ExactInputSplitRouterResult =
  | { readonly status: 'success'; readonly plan: ExactInputSplitPlan }
  | {
      readonly status: 'no-route';
      readonly reason: 'no-candidate' | 'all-candidates-rejected';
      readonly search: ExactInputSplitSearchSummary;
    }
  | {
      readonly status: 'no-plan';
      readonly reason: 'work-limit';
      readonly search: ExactInputSplitSearchSummary;
    }
  | {
      readonly status: 'invalid-request';
      readonly error: ExactInputSplitRouterValidationError;
    };

type InvalidRequestResult = Extract<
  ExactInputSplitRouterResult,
  { readonly status: 'invalid-request' }
>;

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

function captureRequest(request: ExactInputSplitRouterRequest): ExactInputSplitRouterRequest {
  const snapshotId = request.snapshotId;
  const snapshotChecksum = request.snapshotChecksum;
  const assetIn = request.assetIn;
  const assetOut = request.assetOut;
  const amountIn = request.amountIn;
  const maxHops = request.maxHops;
  const maxPathExpansions = request.maxPathExpansions;
  const maxRoutes = request.maxRoutes;
  const maxCandidateSetExpansions = request.maxCandidateSetExpansions;
  return Object.freeze({
    snapshotId,
    snapshotChecksum,
    assetIn,
    assetOut,
    amountIn,
    maxHops,
    maxPathExpansions,
    maxRoutes,
    maxCandidateSetExpansions,
  });
}

function validationFailure(
  code: ExactInputSplitRouterValidationErrorCode,
  field: ExactInputSplitRouterValidationErrorField,
  message: string,
): InvalidRequestResult {
  const error: ExactInputSplitRouterValidationError = Object.freeze({ code, field, message });
  return Object.freeze({ status: 'invalid-request', error });
}

function validateRequest(
  snapshot: LiquiditySnapshot,
  request: ExactInputSplitRouterRequest,
  knownAssets: ReadonlySet<string>,
): InvalidRequestResult | undefined {
  if (
    request.snapshotId !== snapshot.snapshotId ||
    request.snapshotChecksum !== snapshot.snapshotChecksum
  ) {
    return validationFailure(
      'snapshot-identity-mismatch',
      'snapshotIdentity',
      'Request snapshotId and snapshotChecksum must match the supplied snapshot.',
    );
  }
  if (request.assetIn.length === 0) {
    return validationFailure('empty-identifier', 'assetIn', 'request.assetIn must not be empty.');
  }
  if (request.assetOut.length === 0) {
    return validationFailure(
      'empty-identifier',
      'assetOut',
      'request.assetOut must not be empty.',
    );
  }
  if (typeof request.amountIn !== 'bigint' || request.amountIn <= 0n) {
    return validationFailure(
      'nonpositive-input',
      'amountIn',
      'request.amountIn must be a positive bigint.',
    );
  }
  if (request.assetIn === request.assetOut) {
    return validationFailure(
      'same-asset-request',
      'assetOut',
      'request.assetIn and request.assetOut must be distinct.',
    );
  }
  if (!Number.isSafeInteger(request.maxHops) || request.maxHops <= 0) {
    return validationFailure(
      'invalid-max-hops',
      'maxHops',
      'request.maxHops must be a positive safe integer.',
    );
  }
  if (
    !Number.isSafeInteger(request.maxPathExpansions) ||
    request.maxPathExpansions < 0
  ) {
    return validationFailure(
      'invalid-max-path-expansions',
      'maxPathExpansions',
      'request.maxPathExpansions must be a nonnegative safe integer.',
    );
  }
  if (!Number.isSafeInteger(request.maxRoutes) || request.maxRoutes <= 0) {
    return validationFailure(
      'invalid-max-routes',
      'maxRoutes',
      'request.maxRoutes must be a positive safe integer.',
    );
  }
  if (
    !Number.isSafeInteger(request.maxCandidateSetExpansions) ||
    request.maxCandidateSetExpansions < 0
  ) {
    return validationFailure(
      'invalid-max-candidate-set-expansions',
      'maxCandidateSetExpansions',
      'request.maxCandidateSetExpansions must be a nonnegative safe integer.',
    );
  }
  if (!knownAssets.has(request.assetIn)) {
    return validationFailure(
      'unknown-asset',
      'assetIn',
      'request.assetIn must exist in the supplied snapshot.',
    );
  }
  if (!knownAssets.has(request.assetOut)) {
    return validationFailure(
      'unknown-asset',
      'assetOut',
      'request.assetOut must exist in the supplied snapshot.',
    );
  }
  return undefined;
}

function projectFallback(result: ExactInputSinglePathRouterResult): ExactInputSplitFallbackSummary {
  if (result.status === 'invalid-request') {
    throw new Error('Validated split request failed single-path request validation.');
  }
  if (result.status === 'success') {
    return Object.freeze({ status: 'success', search: result.plan.search });
  }
  if (result.status === 'no-route') {
    return Object.freeze({
      status: 'no-route',
      reason: result.reason,
      search: result.search,
    });
  }
  return Object.freeze({ status: 'no-plan', reason: 'work-limit', search: result.search });
}

function normalizeFallback(
  result: Extract<ExactInputSinglePathRouterResult, { readonly status: 'success' }>,
): ExactInputSplitReplayReceipt {
  const routeReceipt = result.plan.receipt;
  const leg: ExactInputSplitReplayLegReceipt = Object.freeze({
    allocation: routeReceipt.amountIn,
    receipt: routeReceipt,
  });
  return Object.freeze({
    snapshotId: routeReceipt.snapshotId,
    snapshotChecksum: routeReceipt.snapshotChecksum,
    assetIn: routeReceipt.assetIn,
    assetOut: routeReceipt.assetOut,
    amountIn: routeReceipt.amountIn,
    amountOut: routeReceipt.amountOut,
    legs: Object.freeze([leg]),
  });
}

function frozenEqualSplitSummary(
  proposed: number,
  replayed: number,
  rejected: number,
  skippedZeroLeg: number,
): ExactInputEqualSplitSearchSummary {
  return Object.freeze({ proposed, replayed, rejected, skippedZeroLeg });
}

export function routeExactInputSplit(
  snapshot: LiquiditySnapshot,
  request: ExactInputSplitRouterRequest,
): ExactInputSplitRouterResult {
  const capturedSnapshot = captureSnapshot(snapshot);
  const capturedRequest = captureRequest(request);
  const adjacency = buildDeterministicAdjacency(capturedSnapshot);
  const knownAssets = new Set(adjacency.buckets.map(({ assetIn }) => assetIn));
  const requestFailure = validateRequest(capturedSnapshot, capturedRequest, knownAssets);
  if (requestFailure !== undefined) return requestFailure;

  const fallbackResult = routeExactInputSinglePath(capturedSnapshot, {
    snapshotId: capturedRequest.snapshotId,
    snapshotChecksum: capturedRequest.snapshotChecksum,
    assetIn: capturedRequest.assetIn,
    assetOut: capturedRequest.assetOut,
    amountIn: capturedRequest.amountIn,
    maxHops: capturedRequest.maxHops,
    maxExpansions: capturedRequest.maxPathExpansions,
  });
  const fallback = projectFallback(fallbackResult);
  let incumbent =
    fallbackResult.status === 'success' ? normalizeFallback(fallbackResult) : undefined;

  const structuralResult = enumeratePoolDisjointRouteSets(adjacency, {
    snapshotId: capturedRequest.snapshotId,
    snapshotChecksum: capturedRequest.snapshotChecksum,
    assetIn: capturedRequest.assetIn,
    assetOut: capturedRequest.assetOut,
    maxHops: capturedRequest.maxHops,
    maxPathExpansions: capturedRequest.maxPathExpansions,
    maxRoutes: capturedRequest.maxRoutes,
    maxCandidateSetExpansions: capturedRequest.maxCandidateSetExpansions,
  });
  if (!structuralResult.ok) {
    throw new Error('Validated split request failed route-set enumeration.');
  }

  let proposed = 0;
  let replayed = 0;
  let rejected = 0;
  let skippedZeroLeg = 0;

  for (const { routes } of structuralResult.value.candidateSets) {
    if (routes.length < 2) continue;
    proposed += 1;
    const cardinality = BigInt(routes.length);
    const base = capturedRequest.amountIn / cardinality;
    if (base === 0n) {
      skippedZeroLeg += 1;
      continue;
    }
    const remainder = capturedRequest.amountIn % cardinality;
    const legs = routes.map((route, index) =>
      Object.freeze({
        allocation: base + (BigInt(index) < remainder ? 1n : 0n),
        route,
      }),
    );
    const reconstructed = legs.reduce((sum, { allocation }) => sum + allocation, 0n);
    if (reconstructed !== capturedRequest.amountIn) {
      throw new Error('Equal split reconstruction did not preserve the exact input.');
    }

    const replay = replayExactInputSplit(capturedSnapshot, {
      snapshotId: capturedRequest.snapshotId,
      snapshotChecksum: capturedRequest.snapshotChecksum,
      assetIn: capturedRequest.assetIn,
      assetOut: capturedRequest.assetOut,
      amountIn: capturedRequest.amountIn,
      legs,
    });
    replayed += 1;
    if (!replay.ok) {
      rejected += 1;
      continue;
    }
    if (
      incumbent === undefined ||
      isStrictlyBetterSplitReceipt(replay.value, incumbent)
    ) {
      incumbent = replay.value;
    }
  }

  const structural = structuralResult.value.search;
  const termination =
    structural.pathTermination === 'complete' &&
    structural.candidateSetTermination === 'complete'
      ? ('complete' as const)
      : ('work-limit' as const);
  const equalSplit = frozenEqualSplitSummary(proposed, replayed, rejected, skippedZeroLeg);
  const search: ExactInputSplitSearchSummary = Object.freeze({
    fallback,
    structural,
    equalSplit,
    termination,
  });

  if (incumbent !== undefined) {
    const plan: ExactInputSplitPlan = Object.freeze({ receipt: incumbent, search });
    return Object.freeze({ status: 'success', plan });
  }
  if (termination === 'work-limit') {
    return Object.freeze({ status: 'no-plan', reason: 'work-limit', search });
  }
  const reason =
    fallback.status === 'no-route' &&
    fallback.reason === 'no-candidate' &&
    equalSplit.proposed === 0
      ? ('no-candidate' as const)
      : ('all-candidates-rejected' as const);
  return Object.freeze({ status: 'no-route', reason, search });
}
