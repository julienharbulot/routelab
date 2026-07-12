import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../../src/domain/index.ts';
import type { DirectionalRouteHop } from '../../src/replay/exact-input-route/index.ts';
import {
  routeExactInputSplit,
  type ExactInputSplitRouterRequest,
  type ExactInputSplitRouterValidationErrorCode,
  type ExactInputSplitRouterValidationErrorField,
} from '../../src/router/split-exact-input/index.ts';

interface OracleLeg {
  readonly allocation: bigint;
  readonly route: readonly DirectionalRouteHop[];
  readonly amountOut: bigint;
}

interface OraclePlan {
  readonly amountOut: bigint;
  readonly legs: readonly OracleLeg[];
}

interface OracleOutcome {
  readonly plan: OraclePlan | undefined;
  readonly paths: readonly (readonly DirectionalRouteHop[])[];
  readonly candidateSetCount: number;
  readonly proposed: number;
  readonly replayed: number;
  readonly rejected: number;
  readonly skippedZeroLeg: number;
}

function pool(
  poolId: string,
  asset0: string,
  reserve0: bigint,
  asset1: string,
  reserve1: bigint,
  feeChargedNumerator = 0n,
  feeDenominator = 1n,
): ConstantProductPool {
  return {
    poolId,
    asset0,
    reserve0,
    asset1,
    reserve1,
    feeChargedNumerator,
    feeDenominator,
  };
}

function snapshot(pools: readonly ConstantProductPool[]): LiquiditySnapshot {
  return {
    snapshotId: 'oracle-router-snapshot',
    snapshotChecksum: 'oracle-router-checksum',
    pools,
  };
}

function request(
  overrides: Partial<ExactInputSplitRouterRequest> = {},
): ExactInputSplitRouterRequest {
  return {
    snapshotId: 'oracle-router-snapshot',
    snapshotChecksum: 'oracle-router-checksum',
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 100n,
    maxHops: 1,
    maxPathExpansions: 10_000,
    maxRoutes: 3,
    maxCandidateSetExpansions: 10_000,
    ...overrides,
  };
}

function compareRawUtf16(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareHop(left: DirectionalRouteHop, right: DirectionalRouteHop): number {
  return (
    compareRawUtf16(left.assetIn, right.assetIn) ||
    compareRawUtf16(left.poolId, right.poolId) ||
    compareRawUtf16(left.assetOut, right.assetOut)
  );
}

function compareRoute(
  left: readonly DirectionalRouteHop[],
  right: readonly DirectionalRouteHop[],
): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const leftHop = left[index];
    const rightHop = right[index];
    assert.ok(leftHop !== undefined && rightHop !== undefined);
    const comparison = compareHop(leftHop, rightHop);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

function comparePlan(left: OraclePlan, right: OraclePlan): number {
  if (left.amountOut !== right.amountOut) return left.amountOut > right.amountOut ? -1 : 1;
  if (left.legs.length !== right.legs.length) return left.legs.length - right.legs.length;
  const leftHops = left.legs.reduce((sum, leg) => sum + leg.route.length, 0);
  const rightHops = right.legs.reduce((sum, leg) => sum + leg.route.length, 0);
  if (leftHops !== rightHops) return leftHops - rightHops;
  for (let index = 0; index < left.legs.length; index += 1) {
    const leftLeg = left.legs[index];
    const rightLeg = right.legs[index];
    assert.ok(leftLeg !== undefined && rightLeg !== undefined);
    const routeComparison = compareRoute(leftLeg.route, rightLeg.route);
    if (routeComparison !== 0) return routeComparison;
  }
  for (let index = 0; index < left.legs.length; index += 1) {
    const leftAllocation = left.legs[index]?.allocation;
    const rightAllocation = right.legs[index]?.allocation;
    assert.ok(leftAllocation !== undefined && rightAllocation !== undefined);
    if (leftAllocation !== rightAllocation) return leftAllocation < rightAllocation ? -1 : 1;
  }
  return 0;
}

function directionalEdges(pools: readonly ConstantProductPool[]): readonly DirectionalRouteHop[] {
  return pools
    .flatMap((value) => [
      { assetIn: value.asset0, poolId: value.poolId, assetOut: value.asset1 },
      { assetIn: value.asset1, poolId: value.poolId, assetOut: value.asset0 },
    ])
    .sort(compareHop);
}

function isSimpleRoute(
  candidate: readonly DirectionalRouteHop[],
  input: ExactInputSplitRouterRequest,
): boolean {
  if (candidate.length === 0 || candidate[0]?.assetIn !== input.assetIn) return false;
  const assets = new Set([input.assetIn]);
  const pools = new Set<string>();
  let currentAsset = input.assetIn;
  for (const hop of candidate) {
    if (hop.assetIn !== currentAsset || pools.has(hop.poolId) || assets.has(hop.assetOut)) {
      return false;
    }
    pools.add(hop.poolId);
    assets.add(hop.assetOut);
    currentAsset = hop.assetOut;
  }
  return currentAsset === input.assetOut;
}

// Deliberately generate the Cartesian product of all directional edges rather
// than walking production adjacency buckets.
function exhaustivePaths(
  value: LiquiditySnapshot,
  input: ExactInputSplitRouterRequest,
): readonly (readonly DirectionalRouteHop[])[] {
  const edges = directionalEdges(value.pools);
  const output: DirectionalRouteHop[][] = [];
  const generate = (prefix: readonly DirectionalRouteHop[], targetLength: number): void => {
    if (prefix.length === targetLength) {
      if (isSimpleRoute(prefix, input)) output.push(prefix.map((hop) => ({ ...hop })));
      return;
    }
    for (const edge of edges) generate([...prefix, edge], targetLength);
  };
  for (let length = 1; length <= input.maxHops; length += 1) generate([], length);
  return output.sort(compareRoute);
}

function candidateSets(
  paths: readonly (readonly DirectionalRouteHop[])[],
  maxRoutes: number,
): readonly (readonly (readonly DirectionalRouteHop[])[])[] {
  assert.ok(paths.length < 31, 'tiny bitmask oracle supports fewer than 31 routes');
  const sets: (readonly (readonly DirectionalRouteHop[])[])[] = [];
  for (let mask = 1; mask < 2 ** paths.length; mask += 1) {
    const selected = paths.filter((_, index) => (mask & 2 ** index) !== 0);
    if (selected.length > maxRoutes) continue;
    const usedPools = new Set<string>();
    let disjoint = true;
    for (const candidate of selected) {
      for (const { poolId } of candidate) {
        if (usedPools.has(poolId)) disjoint = false;
        usedPools.add(poolId);
      }
    }
    if (disjoint) sets.push(selected);
  }
  return sets.sort((left, right) => {
    if (left.length !== right.length) return left.length - right.length;
    for (let index = 0; index < left.length; index += 1) {
      const leftRoute = left[index];
      const rightRoute = right[index];
      assert.ok(leftRoute !== undefined && rightRoute !== undefined);
      const comparison = compareRoute(leftRoute, rightRoute);
      if (comparison !== 0) return comparison;
    }
    return 0;
  });
}

function floorDivideWithoutDivision(numerator: bigint, denominator: bigint): bigint {
  let quotient = 0n;
  let remainder = 0n;
  for (const digit of numerator.toString(10)) {
    remainder = remainder * 10n + BigInt(digit);
    let quotientDigit = 0n;
    while ((quotientDigit + 1n) * denominator <= remainder) quotientDigit += 1n;
    quotient = quotient * 10n + quotientDigit;
    remainder -= quotientDigit * denominator;
  }
  return quotient;
}

function replayRouteAmount(
  value: LiquiditySnapshot,
  route: readonly DirectionalRouteHop[],
  amountIn: bigint,
): bigint | undefined {
  const states = new Map(value.pools.map((entry) => [entry.poolId, { ...entry }] as const));
  let currentAmount = amountIn;
  for (const hop of route) {
    const state = states.get(hop.poolId);
    if (state === undefined) return undefined;
    const forward = state.asset0 === hop.assetIn && state.asset1 === hop.assetOut;
    const reverse = state.asset1 === hop.assetIn && state.asset0 === hop.assetOut;
    if (!forward && !reverse) return undefined;
    const reserveIn = forward ? state.reserve0 : state.reserve1;
    const reserveOut = forward ? state.reserve1 : state.reserve0;
    const retained = state.feeDenominator - state.feeChargedNumerator;
    const amountOut = floorDivideWithoutDivision(
      currentAmount * retained * reserveOut,
      reserveIn * state.feeDenominator + currentAmount * retained,
    );
    if (amountOut === 0n) return undefined;
    states.set(hop.poolId, {
      ...state,
      reserve0: forward ? reserveIn + currentAmount : reserveOut - amountOut,
      reserve1: forward ? reserveOut - amountOut : reserveIn + currentAmount,
    });
    currentAmount = amountOut;
  }
  return currentAmount;
}

function independentlyRoute(
  value: LiquiditySnapshot,
  input: ExactInputSplitRouterRequest,
): OracleOutcome {
  const paths = exhaustivePaths(value, input);
  const sets = candidateSets(paths, input.maxRoutes);
  const plans: OraclePlan[] = [];
  for (const path of paths) {
    const amountOut = replayRouteAmount(value, path, input.amountIn);
    if (amountOut !== undefined) {
      plans.push({
        amountOut,
        legs: [{ allocation: input.amountIn, route: path, amountOut }],
      });
    }
  }

  let proposed = 0;
  let replayed = 0;
  let rejected = 0;
  let skippedZeroLeg = 0;
  for (const set of sets) {
    if (set.length < 2) continue;
    proposed += 1;
    const cardinality = BigInt(set.length);
    const base = input.amountIn / cardinality;
    if (base === 0n) {
      skippedZeroLeg += 1;
      continue;
    }
    replayed += 1;
    const remainder = input.amountIn % cardinality;
    const legs = set.map((path, index): OracleLeg | undefined => {
      const allocation = base + (BigInt(index) < remainder ? 1n : 0n);
      const amountOut = replayRouteAmount(value, path, allocation);
      return amountOut === undefined ? undefined : { allocation, route: path, amountOut };
    });
    if (legs.some((leg) => leg === undefined)) {
      rejected += 1;
      continue;
    }
    const successfulLegs = legs.filter((leg): leg is OracleLeg => leg !== undefined);
    assert.equal(
      successfulLegs.reduce((sum, leg) => sum + leg.allocation, 0n),
      input.amountIn,
    );
    plans.push({
      amountOut: successfulLegs.reduce((sum, leg) => sum + leg.amountOut, 0n),
      legs: successfulLegs,
    });
  }
  plans.sort(comparePlan);
  return {
    plan: plans[0],
    paths,
    candidateSetCount: sets.length,
    proposed,
    replayed,
    rejected,
    skippedZeroLeg,
  };
}

function planProjection(plan: OraclePlan) {
  return {
    amountOut: plan.amountOut,
    legs: plan.legs.map((leg) => ({
      allocation: leg.allocation,
      route: leg.route.map(({ poolId }) => poolId),
      amountOut: leg.amountOut,
    })),
  };
}

function actualPlanProjection(result: ReturnType<typeof routeExactInputSplit>) {
  assert.equal(result.status, 'success');
  if (result.status !== 'success') throw new Error('expected a successful split plan');
  return {
    amountOut: result.plan.receipt.amountOut,
    legs: result.plan.receipt.legs.map(({ allocation, receipt }) => ({
      allocation,
      route: receipt.hops.map(({ poolId }) => poolId),
      amountOut: receipt.amountOut,
    })),
  };
}

function assertMatchesIndependentOracle(
  value: LiquiditySnapshot,
  input: ExactInputSplitRouterRequest,
): ReturnType<typeof routeExactInputSplit> {
  const expected = independentlyRoute(value, input);
  assert.ok(expected.plan !== undefined);
  const actual = routeExactInputSplit(value, input);
  assert.deepEqual(actualPlanProjection(actual), planProjection(expected.plan));
  assert.equal(actual.status, 'success');
  if (actual.status !== 'success') return actual;
  assert.equal(actual.plan.search.structural.enumeratedPaths, expected.paths.length);
  assert.equal(
    actual.plan.search.structural.enumeratedCandidateSets,
    expected.candidateSetCount,
  );
  assert.deepEqual(actual.plan.search.equalSplit, {
    proposed: expected.proposed,
    replayed: expected.replayed,
    rejected: expected.rejected,
    skippedZeroLeg: expected.skippedZeroLeg,
  });
  return actual;
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) assertDeepFrozen(Reflect.get(value, key), seen);
}

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length === 0) return [[]];
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += 1) {
    const selected = values[index];
    assert.ok(selected !== undefined);
    const remaining = [...values.slice(0, index), ...values.slice(index + 1)];
    for (const suffix of permutations(remaining)) output.push([selected, ...suffix]);
  }
  return output;
}

void test('matches the M0 exhaustive no-split/equal table and exact search projection', () => {
  const value = snapshot([
    pool('left-ac', 'A', 100n, 'C', 100n),
    pool('right-ac', 'A', 100n, 'C', 100n),
  ]);
  const input = request({ maxRoutes: 2 });
  const result = assertMatchesIndependentOracle(value, input);
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.deepEqual(actualPlanProjection(result), {
    amountOut: 66n,
    legs: [
      { allocation: 50n, route: ['left-ac'], amountOut: 33n },
      { allocation: 50n, route: ['right-ac'], amountOut: 33n },
    ],
  });
  assert.deepEqual(result.plan.search, {
    fallback: {
      status: 'success',
      search: {
        expansions: 2,
        enumeratedCandidates: 2,
        replayedCandidates: 2,
        rejectedCandidates: 0,
        termination: 'complete',
      },
    },
    structural: {
      pathExpansions: 2,
      enumeratedPaths: 2,
      pathTermination: 'complete',
      candidateSetExpansions: 5,
      enumeratedCandidateSets: 3,
      candidateSetTermination: 'complete',
    },
    equalSplit: { proposed: 1, replayed: 1, rejected: 0, skippedZeroLeg: 0 },
    termination: 'complete',
  });
  assertDeepFrozen(result);
});

void test('selects the exhaustive uneven winner by legs then route key', () => {
  const value = snapshot([
    pool('p0-ac', 'A', 5n, 'C', 12n),
    pool('p1-ac', 'A', 6n, 'C', 12n),
    pool('p2-ac', 'A', 8n, 'C', 15n),
  ]);
  const input = request({ amountIn: 5n });
  const oracle = independentlyRoute(value, input);
  assert.equal(oracle.paths.length, 3);
  assert.equal(oracle.candidateSetCount, 7);
  assert.ok(oracle.plan !== undefined);
  assert.deepEqual(planProjection(oracle.plan), {
    amountOut: 7n,
    legs: [
      { allocation: 3n, route: ['p0-ac'], amountOut: 4n },
      { allocation: 2n, route: ['p1-ac'], amountOut: 3n },
    ],
  });
  const actual = assertMatchesIndependentOracle(value, input);
  assert.equal(actual.status, 'success');
  if (actual.status !== 'success') return;
  assert.deepEqual(actual.plan.search.structural, {
    pathExpansions: 3,
    enumeratedPaths: 3,
    pathTermination: 'complete',
    candidateSetExpansions: 16,
    enumeratedCandidateSets: 7,
    candidateSetTermination: 'complete',
  });
});

void test('independently prefers fewer total hops after an exact output and leg tie', () => {
  const value = snapshot([
    pool('a-direct', 'A', 100n, 'C', 100n),
    pool('b-ab', 'A', 100n, 'B', 200n),
    pool('b-bc', 'B', 100n, 'C', 84n),
    pool('c-direct', 'A', 100n, 'C', 100n),
  ]);
  const input = request({ maxHops: 2, maxRoutes: 2 });
  const actual = assertMatchesIndependentOracle(value, input);
  assert.deepEqual(actualPlanProjection(actual), {
    amountOut: 66n,
    legs: [
      { allocation: 50n, route: ['a-direct'], amountOut: 33n },
      { allocation: 50n, route: ['c-direct'], amountOut: 33n },
    ],
  });
});

void test('agrees exhaustively across tiny direct and multi-hop candidate sets', () => {
  const value = snapshot([
    pool('a-direct', 'A', 7n, 'C', 13n),
    pool('b-ab', 'A', 5n, 'B', 11n, 1n, 4n),
    pool('b-bc', 'B', 8n, 'C', 12n, 1n, 5n),
    pool('z-direct', 'A', 9n, 'C', 14n),
  ]);
  for (const amountIn of [1n, 2n, 3n, 5n, 8n]) {
    assertMatchesIndependentOracle(
      value,
      request({ amountIn, maxHops: 2, maxRoutes: 3 }),
    );
  }
});

void test('preserves fallback through zero set work, incomplete improvement, and rejection', () => {
  const m0 = snapshot([
    pool('left-ac', 'A', 100n, 'C', 100n),
    pool('right-ac', 'A', 100n, 'C', 100n),
  ]);
  const zeroSetWork = routeExactInputSplit(
    m0,
    request({ maxRoutes: 2, maxCandidateSetExpansions: 0 }),
  );
  assert.deepEqual(actualPlanProjection(zeroSetWork), {
    amountOut: 50n,
    legs: [{ allocation: 100n, route: ['left-ac'], amountOut: 50n }],
  });
  assert.equal(zeroSetWork.status, 'success');
  if (zeroSetWork.status !== 'success') return;
  assert.equal(zeroSetWork.plan.search.termination, 'work-limit');

  const incompleteImprovement = routeExactInputSplit(
    m0,
    request({ maxRoutes: 2, maxCandidateSetExpansions: 4 }),
  );
  assert.equal(incompleteImprovement.status, 'success');
  if (incompleteImprovement.status !== 'success') return;
  assert.equal(incompleteImprovement.plan.receipt.amountOut, 66n);
  assert.equal(incompleteImprovement.plan.search.termination, 'work-limit');

  const rejected = routeExactInputSplit(
    snapshot([
      pool('a-good', 'A', 1n, 'C', 2n),
      pool('z-zero', 'A', 100n, 'C', 1n),
    ]),
    request({ amountIn: 2n, maxRoutes: 2 }),
  );
  assert.deepEqual(actualPlanProjection(rejected), {
    amountOut: 1n,
    legs: [{ allocation: 2n, route: ['a-good'], amountOut: 1n }],
  });
  assert.equal(rejected.status, 'success');
  if (rejected.status !== 'success') return;
  assert.deepEqual(rejected.plan.search.equalSplit, {
    proposed: 1,
    replayed: 1,
    rejected: 1,
    skippedZeroLeg: 0,
  });
});

void test('reconstructs zero-leg skips and huge allocations exactly', () => {
  const small = snapshot([
    pool('p0-ac', 'A', 1n, 'C', 2n),
    pool('p1-ac', 'A', 1n, 'C', 2n),
    pool('p2-ac', 'A', 1n, 'C', 2n),
  ]);
  const skipped = assertMatchesIndependentOracle(small, request({ amountIn: 2n }));
  assert.equal(skipped.status, 'success');
  if (skipped.status !== 'success') return;
  assert.deepEqual(skipped.plan.search.equalSplit, {
    proposed: 4,
    replayed: 3,
    rejected: 0,
    skippedZeroLeg: 1,
  });
  assert.deepEqual(
    skipped.plan.receipt.legs.map(({ allocation }) => allocation),
    [1n, 1n],
  );

  const unit = 10n ** 80n;
  const huge = assertMatchesIndependentOracle(
    snapshot([
      pool('p0-ac', 'A', unit, 'C', 2n * unit),
      pool('p1-ac', 'A', unit, 'C', 2n * unit),
      pool('p2-ac', 'A', unit, 'C', 2n * unit),
    ]),
    request({ amountIn: 3n * unit + 2n }),
  );
  assert.equal(huge.status, 'success');
  if (huge.status !== 'success') return;
  assert.equal(huge.plan.receipt.amountOut, 3n * unit);
  assert.deepEqual(
    huge.plan.receipt.legs.map(({ allocation, receipt }) => [allocation, receipt.amountOut]),
    [
      [unit + 1n, unit],
      [unit + 1n, unit],
      [unit, unit],
    ],
  );
});

void test('uses raw UTF-16 plan keys independently of all pool permutations', () => {
  const pools = [
    pool('A-pool', 'A', 1n, 'C', 2n),
    pool('z-pool', 'A', 1n, 'C', 2n),
    pool('\u{1f600}-pool', 'A', 1n, 'C', 2n),
    pool('\ue000-pool', 'A', 1n, 'C', 2n),
  ];
  for (const order of permutations(pools)) {
    const actual = assertMatchesIndependentOracle(
      snapshot(order),
      request({ amountIn: 2n, maxRoutes: 2 }),
    );
    assert.deepEqual(actualPlanProjection(actual), {
      amountOut: 2n,
      legs: [
        { allocation: 1n, route: ['A-pool'], amountOut: 1n },
        { allocation: 1n, route: ['z-pool'], amountOut: 1n },
      ],
    });
  }
});

function assertInvalid(
  value: LiquiditySnapshot,
  overrides: Partial<ExactInputSplitRouterRequest>,
  code: ExactInputSplitRouterValidationErrorCode,
  field: ExactInputSplitRouterValidationErrorField,
): void {
  const actual = routeExactInputSplit(value, request(overrides));
  assert.equal(actual.status, 'invalid-request');
  if (actual.status !== 'invalid-request') return;
  assert.equal(actual.error.code, code);
  assert.equal(actual.error.field, field);
  assert.notEqual(actual.error.message.length, 0);
  assertDeepFrozen(actual);
}

void test('validates exact and unsafe structural inputs in frozen precedence', () => {
  const value = snapshot([pool('only-ac', 'A', 10n, 'C', 10n)]);
  assertInvalid(
    value,
    { snapshotChecksum: 'wrong', assetIn: '', amountIn: 0n, maxHops: 0 },
    'snapshot-identity-mismatch',
    'snapshotIdentity',
  );
  assertInvalid(value, { assetIn: '', amountIn: 0n }, 'empty-identifier', 'assetIn');
  assertInvalid(value, { assetOut: '', amountIn: 0n }, 'empty-identifier', 'assetOut');
  assertInvalid(value, { amountIn: 1 as unknown as bigint }, 'nonpositive-input', 'amountIn');
  assertInvalid(value, { amountIn: 0n, assetOut: 'A' }, 'nonpositive-input', 'amountIn');
  assertInvalid(value, { assetOut: 'A', maxHops: 0 }, 'same-asset-request', 'assetOut');
  assertInvalid(value, { maxHops: Number.NaN }, 'invalid-max-hops', 'maxHops');
  assertInvalid(
    value,
    { maxPathExpansions: Number.POSITIVE_INFINITY },
    'invalid-max-path-expansions',
    'maxPathExpansions',
  );
  assertInvalid(value, { maxRoutes: 1.5 }, 'invalid-max-routes', 'maxRoutes');
  assertInvalid(
    value,
    { maxCandidateSetExpansions: Number.MAX_SAFE_INTEGER + 1 },
    'invalid-max-candidate-set-expansions',
    'maxCandidateSetExpansions',
  );
  assertInvalid(value, { assetIn: 'missing' }, 'unknown-asset', 'assetIn');
  assertInvalid(value, { assetOut: 'missing' }, 'unknown-asset', 'assetOut');
});

void test('classifies complete and incomplete failures and captures callers once', () => {
  const disconnected = snapshot([
    pool('ab', 'A', 10n, 'B', 10n),
    pool('cd', 'C', 10n, 'D', 10n),
  ]);
  const noRoute = routeExactInputSplit(disconnected, request());
  assert.equal(noRoute.status, 'no-route');
  if (noRoute.status !== 'no-route') return;
  assert.equal(noRoute.reason, 'no-candidate');
  assertDeepFrozen(noRoute);
  const noPlan = routeExactInputSplit(disconnected, request({ maxPathExpansions: 0 }));
  assert.equal(noPlan.status, 'no-plan');
  if (noPlan.status !== 'no-plan') return;
  assert.equal(noPlan.reason, 'work-limit');
  assertDeepFrozen(noPlan);
  const allRejected = routeExactInputSplit(
    snapshot([pool('tiny-ac', 'A', 100n, 'C', 1n)]),
    request({ amountIn: 1n }),
  );
  assert.equal(allRejected.status, 'no-route');
  if (allRejected.status !== 'no-route') return;
  assert.equal(allRejected.reason, 'all-candidates-rejected');

  const reads = new Map<string, number>();
  const count = <T>(key: string, value: T): T => {
    reads.set(key, (reads.get(key) ?? 0) + 1);
    return value;
  };
  const mutable = { poolId: 'only-ac' };
  const getterPool = {
    get poolId() {
      return count('pool.poolId', mutable.poolId);
    },
    get asset0() {
      return count('pool.asset0', 'A');
    },
    get reserve0() {
      return count('pool.reserve0', 10n);
    },
    get asset1() {
      return count('pool.asset1', 'C');
    },
    get reserve1() {
      return count('pool.reserve1', 20n);
    },
    get feeChargedNumerator() {
      return count('pool.feeChargedNumerator', 0n);
    },
    get feeDenominator() {
      return count('pool.feeDenominator', 1n);
    },
  };
  const getterSnapshot = {
    get snapshotId() {
      return count('snapshot.snapshotId', 'oracle-router-snapshot');
    },
    get snapshotChecksum() {
      return count('snapshot.snapshotChecksum', 'oracle-router-checksum');
    },
    get pools() {
      return count('snapshot.pools', [getterPool]);
    },
  } as LiquiditySnapshot;
  const stable = request({ amountIn: 10n, maxRoutes: 1 });
  const descriptors: PropertyDescriptorMap = {};
  for (const key of Object.keys(stable) as (keyof ExactInputSplitRouterRequest)[]) {
    descriptors[key] = {
      enumerable: true,
      get() {
        if (key === 'snapshotId') mutable.poolId = 'changed-after-snapshot-capture';
        return count(`request.${key}`, stable[key]);
      },
    };
  }
  const getterRequest = Object.defineProperties({}, descriptors) as ExactInputSplitRouterRequest;
  const captured = routeExactInputSplit(getterSnapshot, getterRequest);
  assert.equal(captured.status, 'success');
  if (captured.status !== 'success') return;
  assert.equal(captured.plan.receipt.legs[0]?.receipt.hops[0]?.poolId, 'only-ac');
  for (const readCount of reads.values()) assert.equal(readCount, 1);
  assert.equal(reads.size, 3 + 7 + 9);
  assertDeepFrozen(captured);
});
