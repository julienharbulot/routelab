import type { ConstantProductPool, LiquiditySnapshot } from '../../domain/index.ts';
import {
  replayExactInputSplit,
  type ExactInputSplitReplayReceipt,
} from '../../replay/exact-input-split/index.ts';
import type { DirectionalRouteHop } from '../../replay/exact-input-route/index.ts';
import {
  enumeratePoolDisjointRouteSets,
  type PoolDisjointRouteSetSearchSummary,
} from '../../search/pool-disjoint-route-sets/index.ts';
import { buildDeterministicAdjacency } from '../../search/simple-paths/index.ts';
import {
  routeExactInputSplit,
  type ExactInputSplitRouterResult,
  type ExactInputSplitSearchSummary,
} from '../split-exact-input/index.ts';
import { isStrictlyBetterSplitReceipt } from '../split-exact-input/objective.ts';

export interface GreedyExactInputSplitRouterRequest {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly maxHops: number;
  readonly maxPathExpansions: number;
  readonly maxRoutes: number;
  readonly maxCandidateSetExpansions: number;
  readonly greedyParts: number;
  readonly maxGreedyEvaluations: number;
}

export type GreedyExactInputSplitBaselineSummary =
  | {
      readonly status: 'success';
      readonly search: ExactInputSplitSearchSummary;
    }
  | {
      readonly status: 'no-route';
      readonly reason: 'no-candidate' | 'all-candidates-rejected';
      readonly search: ExactInputSplitSearchSummary;
    }
  | {
      readonly status: 'no-plan';
      readonly reason: 'work-limit';
      readonly search: ExactInputSplitSearchSummary;
    };

export interface GreedyExactInputSplitAllocationSummary {
  readonly proposedCandidateSets: number;
  readonly completedChunkSteps: number;
  readonly evaluations: number;
  readonly rejectedEvaluations: number;
  readonly finalReplays: number;
  readonly rejectedFinalReplays: number;
  readonly rejectedCandidateSets: number;
  readonly termination: 'complete' | 'work-limit';
}

export interface GreedyExactInputSplitSearchSummary {
  readonly baseline: GreedyExactInputSplitBaselineSummary;
  readonly structural: PoolDisjointRouteSetSearchSummary;
  readonly greedy: GreedyExactInputSplitAllocationSummary;
  readonly termination: 'complete' | 'work-limit';
}

export interface GreedyExactInputSplitPlan {
  readonly receipt: ExactInputSplitReplayReceipt;
  readonly search: GreedyExactInputSplitSearchSummary;
}

export type GreedyExactInputSplitValidationErrorCode =
  | 'snapshot-identity-mismatch'
  | 'empty-identifier'
  | 'nonpositive-input'
  | 'same-asset-request'
  | 'invalid-max-hops'
  | 'invalid-max-path-expansions'
  | 'invalid-max-routes'
  | 'invalid-max-candidate-set-expansions'
  | 'unknown-asset'
  | 'invalid-greedy-parts'
  | 'invalid-max-greedy-evaluations';

export type GreedyExactInputSplitValidationErrorField =
  | 'snapshotIdentity'
  | 'assetIn'
  | 'assetOut'
  | 'amountIn'
  | 'maxHops'
  | 'maxPathExpansions'
  | 'maxRoutes'
  | 'maxCandidateSetExpansions'
  | 'greedyParts'
  | 'maxGreedyEvaluations';

export interface GreedyExactInputSplitValidationError {
  readonly code: GreedyExactInputSplitValidationErrorCode;
  readonly field: GreedyExactInputSplitValidationErrorField;
  readonly message: string;
}

export type GreedyExactInputSplitRouterResult =
  | { readonly status: 'success'; readonly plan: GreedyExactInputSplitPlan }
  | {
      readonly status: 'no-route';
      readonly reason: 'no-candidate' | 'all-candidates-rejected';
      readonly search: GreedyExactInputSplitSearchSummary;
    }
  | {
      readonly status: 'no-plan';
      readonly reason: 'work-limit';
      readonly search: GreedyExactInputSplitSearchSummary;
    }
  | {
      readonly status: 'invalid-request';
      readonly error: GreedyExactInputSplitValidationError;
    };

type InvalidRequestResult = Extract<
  GreedyExactInputSplitRouterResult,
  { readonly status: 'invalid-request' }
>;

type CandidateRoute = readonly DirectionalRouteHop[];

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

function captureRequest(
  request: GreedyExactInputSplitRouterRequest,
): GreedyExactInputSplitRouterRequest {
  const snapshotId = request.snapshotId;
  const snapshotChecksum = request.snapshotChecksum;
  const assetIn = request.assetIn;
  const assetOut = request.assetOut;
  const amountIn = request.amountIn;
  const maxHops = request.maxHops;
  const maxPathExpansions = request.maxPathExpansions;
  const maxRoutes = request.maxRoutes;
  const maxCandidateSetExpansions = request.maxCandidateSetExpansions;
  const greedyParts = request.greedyParts;
  const maxGreedyEvaluations = request.maxGreedyEvaluations;
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
    greedyParts,
    maxGreedyEvaluations,
  });
}

function validationFailure(
  code: GreedyExactInputSplitValidationErrorCode,
  field: GreedyExactInputSplitValidationErrorField,
  message: string,
): InvalidRequestResult {
  const error: GreedyExactInputSplitValidationError = Object.freeze({ code, field, message });
  return Object.freeze({ status: 'invalid-request', error });
}

function validateRequest(
  snapshot: LiquiditySnapshot,
  request: GreedyExactInputSplitRouterRequest,
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
  if (!Number.isSafeInteger(request.greedyParts) || request.greedyParts <= 0) {
    return validationFailure(
      'invalid-greedy-parts',
      'greedyParts',
      'request.greedyParts must be a positive safe integer.',
    );
  }
  if (
    !Number.isSafeInteger(request.maxGreedyEvaluations) ||
    request.maxGreedyEvaluations < 0
  ) {
    return validationFailure(
      'invalid-max-greedy-evaluations',
      'maxGreedyEvaluations',
      'request.maxGreedyEvaluations must be a nonnegative safe integer.',
    );
  }
  return undefined;
}

function baselineRequest(request: GreedyExactInputSplitRouterRequest) {
  return Object.freeze({
    snapshotId: request.snapshotId,
    snapshotChecksum: request.snapshotChecksum,
    assetIn: request.assetIn,
    assetOut: request.assetOut,
    amountIn: request.amountIn,
    maxHops: request.maxHops,
    maxPathExpansions: request.maxPathExpansions,
    maxRoutes: request.maxRoutes,
    maxCandidateSetExpansions: request.maxCandidateSetExpansions,
  });
}

function projectBaseline(
  result: ExactInputSplitRouterResult,
): GreedyExactInputSplitBaselineSummary {
  if (result.status === 'invalid-request') {
    throw new Error('Validated greedy request failed baseline request validation.');
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

function* positiveChunks(amountIn: bigint, parts: number): Generator<bigint> {
  const divisor = BigInt(parts);
  const base = amountIn / divisor;
  const remainder = amountIn % divisor;
  if (base === 0n) {
    for (let index = 0n; index < remainder; index += 1n) yield 1n;
    return;
  }
  for (let index = 0; index < parts; index += 1) {
    yield base + (BigInt(index) < remainder ? 1n : 0n);
  }
}

function positiveLegs(
  routes: readonly CandidateRoute[],
  allocations: readonly bigint[],
) {
  return routes.flatMap((route, index) => {
    const allocation = allocations[index];
    if (allocation === undefined) {
      throw new Error('Greedy allocation reached an unavailable route allocation.');
    }
    return allocation === 0n ? [] : [Object.freeze({ allocation, route })];
  });
}

function frozenGreedySummary(
  proposedCandidateSets: number,
  completedChunkSteps: number,
  evaluations: number,
  rejectedEvaluations: number,
  finalReplays: number,
  rejectedFinalReplays: number,
  rejectedCandidateSets: number,
  termination: 'complete' | 'work-limit',
): GreedyExactInputSplitAllocationSummary {
  return Object.freeze({
    proposedCandidateSets,
    completedChunkSteps,
    evaluations,
    rejectedEvaluations,
    finalReplays,
    rejectedFinalReplays,
    rejectedCandidateSets,
    termination,
  });
}

export function routeExactInputSplitGreedy(
  snapshot: LiquiditySnapshot,
  request: GreedyExactInputSplitRouterRequest,
): GreedyExactInputSplitRouterResult {
  const capturedSnapshot = captureSnapshot(snapshot);
  const capturedRequest = captureRequest(request);
  const knownAssets = new Set(
    capturedSnapshot.pools.flatMap(({ asset0, asset1 }) => [asset0, asset1]),
  );
  const requestFailure = validateRequest(capturedSnapshot, capturedRequest, knownAssets);
  if (requestFailure !== undefined) return requestFailure;

  const baselineResult = routeExactInputSplit(
    capturedSnapshot,
    baselineRequest(capturedRequest),
  );
  const baseline = projectBaseline(baselineResult);
  let incumbent =
    baselineResult.status === 'success' ? baselineResult.plan.receipt : undefined;

  const adjacency = buildDeterministicAdjacency(capturedSnapshot);
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
    throw new Error('Validated greedy request failed route-set enumeration.');
  }

  let proposedCandidateSets = 0;
  let completedChunkSteps = 0;
  let evaluations = 0;
  let rejectedEvaluations = 0;
  let finalReplays = 0;
  let rejectedFinalReplays = 0;
  let rejectedCandidateSets = 0;
  let greedyTermination: 'complete' | 'work-limit' = 'complete';

  candidateSets: for (const { routes } of structuralResult.value.candidateSets) {
    if (routes.length < 2) continue;
    proposedCandidateSets += 1;
    const allocations = routes.map(() => 0n);
    let allocatedSum = 0n;

    for (const chunk of positiveChunks(
      capturedRequest.amountIn,
      capturedRequest.greedyParts,
    )) {
      let winningRouteIndex: number | undefined;
      let winningAmountOut: bigint | undefined;

      for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
        if (evaluations === capturedRequest.maxGreedyEvaluations) {
          greedyTermination = 'work-limit';
          break candidateSets;
        }
        const optionAllocations = [...allocations];
        const priorAllocation = optionAllocations[routeIndex];
        if (priorAllocation === undefined) {
          throw new Error('Greedy option reached an unavailable route allocation.');
        }
        optionAllocations[routeIndex] = priorAllocation + chunk;
        const partialAmountIn = allocatedSum + chunk;
        evaluations += 1;
        const scoreReplay = replayExactInputSplit(capturedSnapshot, {
          snapshotId: capturedRequest.snapshotId,
          snapshotChecksum: capturedRequest.snapshotChecksum,
          assetIn: capturedRequest.assetIn,
          assetOut: capturedRequest.assetOut,
          amountIn: partialAmountIn,
          legs: positiveLegs(routes, optionAllocations),
        });
        if (!scoreReplay.ok) {
          rejectedEvaluations += 1;
          continue;
        }
        if (
          winningAmountOut === undefined ||
          scoreReplay.value.amountOut > winningAmountOut
        ) {
          winningRouteIndex = routeIndex;
          winningAmountOut = scoreReplay.value.amountOut;
        }
      }

      if (winningRouteIndex === undefined) {
        rejectedCandidateSets += 1;
        continue candidateSets;
      }
      const priorAllocation = allocations[winningRouteIndex];
      if (priorAllocation === undefined) {
        throw new Error('Greedy winner reached an unavailable route allocation.');
      }
      allocations[winningRouteIndex] = priorAllocation + chunk;
      allocatedSum += chunk;
      completedChunkSteps += 1;
    }

    if (allocatedSum !== capturedRequest.amountIn) {
      throw new Error('Completed greedy allocation did not reconstruct request.amountIn.');
    }
    const legs = positiveLegs(routes, allocations);
    const reconstructed = legs.reduce((sum, { allocation }) => sum + allocation, 0n);
    if (reconstructed !== capturedRequest.amountIn) {
      throw new Error('Normalized greedy allocation did not preserve request.amountIn.');
    }

    // Score receipts are deliberately not retained. Authorization uses this
    // distinct post-selection full-input replay only.
    finalReplays += 1;
    const finalReplay = replayExactInputSplit(capturedSnapshot, {
      snapshotId: capturedRequest.snapshotId,
      snapshotChecksum: capturedRequest.snapshotChecksum,
      assetIn: capturedRequest.assetIn,
      assetOut: capturedRequest.assetOut,
      amountIn: capturedRequest.amountIn,
      legs,
    });
    if (!finalReplay.ok) {
      rejectedFinalReplays += 1;
      rejectedCandidateSets += 1;
      continue;
    }
    if (
      incumbent === undefined ||
      isStrictlyBetterSplitReceipt(finalReplay.value, incumbent)
    ) {
      incumbent = finalReplay.value;
    }
  }

  const structural = structuralResult.value.search;
  const greedy = frozenGreedySummary(
    proposedCandidateSets,
    completedChunkSteps,
    evaluations,
    rejectedEvaluations,
    finalReplays,
    rejectedFinalReplays,
    rejectedCandidateSets,
    greedyTermination,
  );
  const termination =
    baseline.search.termination === 'complete' &&
    structural.pathTermination === 'complete' &&
    structural.candidateSetTermination === 'complete' &&
    greedy.termination === 'complete'
      ? ('complete' as const)
      : ('work-limit' as const);
  const search: GreedyExactInputSplitSearchSummary = Object.freeze({
    baseline,
    structural,
    greedy,
    termination,
  });

  if (incumbent !== undefined) {
    const plan: GreedyExactInputSplitPlan = Object.freeze({ receipt: incumbent, search });
    return Object.freeze({ status: 'success', plan });
  }
  if (termination === 'work-limit') {
    return Object.freeze({ status: 'no-plan', reason: 'work-limit', search });
  }
  const reason =
    baseline.status === 'no-route' &&
    baseline.reason === 'no-candidate' &&
    greedy.finalReplays === 0
      ? ('no-candidate' as const)
      : ('all-candidates-rejected' as const);
  return Object.freeze({ status: 'no-route', reason, search });
}
