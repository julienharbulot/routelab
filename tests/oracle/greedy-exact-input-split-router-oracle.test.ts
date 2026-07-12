import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../../src/domain/index.ts';
import {
  routeExactInputSplitGreedy,
  type GreedyExactInputSplitRouterRequest,
  type GreedyExactInputSplitValidationErrorCode,
  type GreedyExactInputSplitValidationErrorField,
} from '../../src/router/greedy-exact-input-split/index.ts';

interface OracleHop {
  readonly assetIn: string;
  readonly poolId: string;
  readonly assetOut: string;
}

interface OracleLeg {
  readonly allocation: bigint;
  readonly route: readonly OracleHop[];
  readonly amountOut: bigint;
}

interface OraclePlan {
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly legs: readonly OracleLeg[];
}

interface OracleGreedySummary {
  readonly proposedCandidateSets: number;
  readonly completedChunkSteps: number;
  readonly evaluations: number;
  readonly rejectedEvaluations: number;
  readonly finalReplays: number;
  readonly rejectedFinalReplays: number;
  readonly rejectedCandidateSets: number;
  readonly termination: 'complete' | 'work-limit';
}

interface OracleRun {
  readonly baseline: OraclePlan | undefined;
  readonly incumbent: OraclePlan | undefined;
  readonly authorizedPlans: readonly OraclePlan[];
  readonly greedy: OracleGreedySummary;
}

function pool(
  poolId: string,
  reserveIn: bigint,
  reserveOut: bigint,
  assetIn = 'A',
  assetOut = 'C',
): ConstantProductPool {
  return {
    poolId,
    asset0: assetIn,
    reserve0: reserveIn,
    asset1: assetOut,
    reserve1: reserveOut,
    feeChargedNumerator: 0n,
    feeDenominator: 1n,
  };
}

function snapshot(pools: readonly ConstantProductPool[]): LiquiditySnapshot {
  return {
    snapshotId: 'greedy-oracle-snapshot',
    snapshotChecksum: 'greedy-oracle-checksum',
    pools,
  };
}

function request(
  overrides: Partial<GreedyExactInputSplitRouterRequest> = {},
): GreedyExactInputSplitRouterRequest {
  return {
    snapshotId: 'greedy-oracle-snapshot',
    snapshotChecksum: 'greedy-oracle-checksum',
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 3n,
    maxHops: 1,
    maxPathExpansions: 10_000,
    maxRoutes: 2,
    maxCandidateSetExpansions: 10_000,
    greedyParts: 3,
    maxGreedyEvaluations: 10_000,
    ...overrides,
  };
}

function compareRawUtf16(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareHop(left: OracleHop, right: OracleHop): number {
  return (
    compareRawUtf16(left.assetIn, right.assetIn) ||
    compareRawUtf16(left.poolId, right.poolId) ||
    compareRawUtf16(left.assetOut, right.assetOut)
  );
}

function compareRoute(left: readonly OracleHop[], right: readonly OracleHop[]): number {
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

function directionalEdges(pools: readonly ConstantProductPool[]): readonly OracleHop[] {
  return pools
    .flatMap((value) => [
      { assetIn: value.asset0, poolId: value.poolId, assetOut: value.asset1 },
      { assetIn: value.asset1, poolId: value.poolId, assetOut: value.asset0 },
    ])
    .sort(compareHop);
}

function isSimpleRoute(
  candidate: readonly OracleHop[],
  input: GreedyExactInputSplitRouterRequest,
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

// Cartesian products keep route expectations independent from adjacency search.
function exhaustiveRoutes(
  value: LiquiditySnapshot,
  input: GreedyExactInputSplitRouterRequest,
): readonly (readonly OracleHop[])[] {
  const edges = directionalEdges(value.pools);
  const routes: OracleHop[][] = [];
  const generate = (prefix: readonly OracleHop[], targetLength: number): void => {
    if (prefix.length === targetLength) {
      if (isSimpleRoute(prefix, input)) routes.push(prefix.map((hop) => ({ ...hop })));
      return;
    }
    for (const edge of edges) generate([...prefix, edge], targetLength);
  };
  for (let length = 1; length <= input.maxHops; length += 1) generate([], length);
  return routes.sort(compareRoute);
}

function candidateSets(
  routes: readonly (readonly OracleHop[])[],
  maxRoutes: number,
): readonly (readonly (readonly OracleHop[])[])[] {
  assert.ok(routes.length < 31);
  const sets: (readonly (readonly OracleHop[])[])[] = [];
  for (let mask = 1; mask < 2 ** routes.length; mask += 1) {
    const selected = routes.filter((_, index) => (mask & 2 ** index) !== 0);
    if (selected.length > maxRoutes) continue;
    const usedPools = new Set<string>();
    let disjoint = true;
    for (const route of selected) {
      for (const { poolId } of route) {
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

function replayRoute(
  value: LiquiditySnapshot,
  route: readonly OracleHop[],
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

function replayAllocation(
  value: LiquiditySnapshot,
  routes: readonly (readonly OracleHop[])[],
  allocations: readonly bigint[],
  amountIn: bigint,
): OraclePlan | undefined {
  assert.equal(routes.length, allocations.length);
  assert.equal(allocations.reduce((sum, allocation) => sum + allocation, 0n), amountIn);
  const legs: OracleLeg[] = [];
  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
    const allocation = allocations[index];
    assert.ok(route !== undefined && allocation !== undefined);
    if (allocation === 0n) continue;
    const amountOut = replayRoute(value, route, allocation);
    if (amountOut === undefined) return undefined;
    legs.push({ allocation, route, amountOut });
  }
  if (legs.length === 0) return undefined;
  return {
    amountIn,
    amountOut: legs.reduce((sum, leg) => sum + leg.amountOut, 0n),
    legs,
  };
}

function compositions(total: bigint, slots: number): readonly (readonly bigint[])[] {
  if (slots === 1) return [[total]];
  const output: bigint[][] = [];
  for (let allocation = 0n; allocation <= total; allocation += 1n) {
    for (const suffix of compositions(total - allocation, slots - 1)) {
      output.push([allocation, ...suffix]);
    }
  }
  return output;
}

function exhaustiveOptimum(
  value: LiquiditySnapshot,
  input: GreedyExactInputSplitRouterRequest,
): OraclePlan | undefined {
  const routes = exhaustiveRoutes(value, input);
  const plans: OraclePlan[] = [];
  for (const set of candidateSets(routes, input.maxRoutes)) {
    for (const allocation of compositions(input.amountIn, set.length)) {
      const plan = replayAllocation(value, set, allocation, input.amountIn);
      if (plan !== undefined) plans.push(plan);
    }
  }
  return plans.sort(comparePlan)[0];
}

function baselinePlans(
  value: LiquiditySnapshot,
  input: GreedyExactInputSplitRouterRequest,
  sets: readonly (readonly (readonly OracleHop[])[])[],
): readonly OraclePlan[] {
  const plans: OraclePlan[] = [];
  for (const set of sets) {
    if (set.length === 1) {
      const plan = replayAllocation(value, set, [input.amountIn], input.amountIn);
      if (plan !== undefined) plans.push(plan);
      continue;
    }
    const cardinality = BigInt(set.length);
    const base = input.amountIn / cardinality;
    if (base === 0n) continue;
    const remainder = input.amountIn % cardinality;
    const allocations = set.map((_, index) =>
      base + (BigInt(index) < remainder ? 1n : 0n),
    );
    const plan = replayAllocation(value, set, allocations, input.amountIn);
    if (plan !== undefined) plans.push(plan);
  }
  return plans;
}

function chunks(amountIn: bigint, parts: number): readonly bigint[] {
  const base = amountIn / BigInt(parts);
  const remainder = amountIn % BigInt(parts);
  const output: bigint[] = [];
  if (base === 0n) {
    for (let index = 0n; index < remainder; index += 1n) output.push(1n);
    return output;
  }
  for (let index = 0; index < parts; index += 1) {
    output.push(base + (BigInt(index) < remainder ? 1n : 0n));
  }
  return output;
}

function independentRun(
  value: LiquiditySnapshot,
  input: GreedyExactInputSplitRouterRequest,
): OracleRun {
  const routes = exhaustiveRoutes(value, input);
  const sets = candidateSets(routes, input.maxRoutes);
  const baselineCandidates = baselinePlans(value, input, sets);
  const authorizedPlans = [...baselineCandidates];
  let incumbent = [...baselineCandidates].sort(comparePlan)[0];
  const baseline = incumbent;
  let proposedCandidateSets = 0;
  let completedChunkSteps = 0;
  let evaluations = 0;
  let rejectedEvaluations = 0;
  let finalReplays = 0;
  const rejectedFinalReplays = 0;
  let rejectedCandidateSets = 0;

  for (const set of sets) {
    if (set.length < 2) continue;
    proposedCandidateSets += 1;
    let allocations = set.map(() => 0n);
    let allocated = 0n;
    for (const chunk of chunks(input.amountIn, input.greedyParts)) {
      let winningIndex: number | undefined;
      let winningOut: bigint | undefined;
      for (let index = 0; index < set.length; index += 1) {
        if (evaluations === input.maxGreedyEvaluations) {
          return {
            baseline,
            incumbent,
            authorizedPlans,
            greedy: {
              proposedCandidateSets,
              completedChunkSteps,
              evaluations,
              rejectedEvaluations,
              finalReplays,
              rejectedFinalReplays,
              rejectedCandidateSets,
              termination: 'work-limit',
            },
          };
        }
        const option = [...allocations];
        option[index] = (option[index] ?? 0n) + chunk;
        evaluations += 1;
        const score = replayAllocation(value, set, option, allocated + chunk);
        if (score === undefined) {
          rejectedEvaluations += 1;
        } else if (winningOut === undefined || score.amountOut > winningOut) {
          winningIndex = index;
          winningOut = score.amountOut;
        }
      }
      if (winningIndex === undefined) {
        rejectedCandidateSets += 1;
        allocations = [];
        break;
      }
      allocations[winningIndex] = (allocations[winningIndex] ?? 0n) + chunk;
      allocated += chunk;
      completedChunkSteps += 1;
    }
    if (allocations.length === 0) continue;
    finalReplays += 1;
    const finalPlan = replayAllocation(value, set, allocations, input.amountIn);
    assert.ok(finalPlan !== undefined);
    authorizedPlans.push(finalPlan);
    if (incumbent === undefined || comparePlan(finalPlan, incumbent) < 0) incumbent = finalPlan;
  }

  return {
    baseline,
    incumbent,
    authorizedPlans,
    greedy: {
      proposedCandidateSets,
      completedChunkSteps,
      evaluations,
      rejectedEvaluations,
      finalReplays,
      rejectedFinalReplays,
      rejectedCandidateSets,
      termination: 'complete',
    },
  };
}

function oracleProjection(plan: OraclePlan) {
  return {
    amountIn: plan.amountIn,
    amountOut: plan.amountOut,
    legs: plan.legs.map((leg) => ({
      allocation: leg.allocation,
      route: leg.route.map(({ poolId }) => poolId),
      amountOut: leg.amountOut,
    })),
  };
}

function actualProjection(result: ReturnType<typeof routeExactInputSplitGreedy>) {
  assert.equal(result.status, 'success');
  if (result.status !== 'success') throw new Error('expected greedy success');
  return {
    amountIn: result.plan.receipt.amountIn,
    amountOut: result.plan.receipt.amountOut,
    legs: result.plan.receipt.legs.map(({ allocation, receipt }) => ({
      allocation,
      route: receipt.hops.map(({ poolId }) => poolId),
      amountOut: receipt.amountOut,
    })),
  };
}

function planFromActual(result: ReturnType<typeof routeExactInputSplitGreedy>): OraclePlan {
  assert.equal(result.status, 'success');
  if (result.status !== 'success') throw new Error('expected greedy success');
  return {
    amountIn: result.plan.receipt.amountIn,
    amountOut: result.plan.receipt.amountOut,
    legs: result.plan.receipt.legs.map(({ allocation, receipt }) => ({
      allocation,
      amountOut: receipt.amountOut,
      route: receipt.hops.map(({ assetIn, poolId, assetOut }) => ({
        assetIn,
        poolId,
        assetOut,
      })),
    })),
  };
}

function assertBoundedAgreement(
  value: LiquiditySnapshot,
  input: GreedyExactInputSplitRouterRequest,
  compareExhaustively = true,
): ReturnType<typeof routeExactInputSplitGreedy> {
  const expected = independentRun(value, input);
  assert.ok(expected.incumbent !== undefined);
  const actual = routeExactInputSplitGreedy(value, input);
  assert.deepEqual(actualProjection(actual), oracleProjection(expected.incumbent));
  assert.equal(actual.status, 'success');
  if (actual.status !== 'success') return actual;
  assert.deepEqual(actual.plan.search.greedy, expected.greedy);
  const actualPlan = planFromActual(actual);
  assert.ok(
    expected.authorizedPlans.some((plan) => comparePlan(plan, actualPlan) === 0),
    'returned plan must be one independently evaluated authorized candidate',
  );
  assert.ok(expected.baseline !== undefined);
  assert.ok(comparePlan(actualPlan, expected.baseline) <= 0, 'result must preserve baseline');
  assert.equal(
    actualPlan.legs.reduce((sum, leg) => sum + leg.allocation, 0n),
    input.amountIn,
  );
  if (compareExhaustively) {
    const optimum = exhaustiveOptimum(value, input);
    assert.ok(optimum !== undefined);
    assert.ok(actualPlan.amountOut <= optimum.amountOut);
    assert.ok(comparePlan(optimum, actualPlan) <= 0);
  }
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

void test('matches the exhaustive unit optimum and cap-five/six allocation tie', () => {
  const value = snapshot([pool('a-ac', 4n, 9n), pool('b-ac', 1n, 9n)]);
  const capFiveInput = request({ maxGreedyEvaluations: 5 });
  const capFive = assertBoundedAgreement(value, capFiveInput);
  assert.deepEqual(actualProjection(capFive), {
    amountIn: 3n,
    amountOut: 7n,
    legs: [
      { allocation: 2n, route: ['a-ac'], amountOut: 3n },
      { allocation: 1n, route: ['b-ac'], amountOut: 4n },
    ],
  });
  assert.equal(capFive.status, 'success');
  if (capFive.status !== 'success') return;
  assert.equal(capFive.plan.search.greedy.termination, 'work-limit');

  const capSixInput = request({ maxGreedyEvaluations: 6 });
  const capSix = assertBoundedAgreement(value, capSixInput);
  assert.deepEqual(actualProjection(capSix), {
    amountIn: 3n,
    amountOut: 7n,
    legs: [
      { allocation: 1n, route: ['a-ac'], amountOut: 1n },
      { allocation: 2n, route: ['b-ac'], amountOut: 6n },
    ],
  });
  assert.equal(capSix.status, 'success');
  if (capSix.status !== 'success') return;
  assert.equal(capSix.plan.search.greedy.finalReplays, 1);
  assert.equal(capSix.plan.search.greedy.termination, 'complete');
  assertDeepFrozen(capSix);
});

void test('matches every M0 greedy evaluation cap from zero through four', () => {
  const value = snapshot([pool('left-ac', 100n, 100n), pool('right-ac', 100n, 100n)]);
  for (let cap = 0; cap <= 4; cap += 1) {
    const input = request({
      amountIn: 100n,
      greedyParts: 2,
      maxGreedyEvaluations: cap,
    });
    const actual = assertBoundedAgreement(value, input);
    assert.equal(actual.status, 'success');
    if (actual.status !== 'success') continue;
    assert.equal(actual.plan.receipt.amountOut, 66n);
    assert.deepEqual(
      actual.plan.receipt.legs.map(({ allocation }) => allocation),
      [50n, 50n],
    );
    assert.equal(actual.plan.search.termination, cap === 4 ? 'complete' : 'work-limit');
  }
});

void test('keeps coarse and activation-barrier outcomes bounded by exhaustive allocation', () => {
  const coarseValue = snapshot([pool('a-ac', 1n, 3n), pool('b-ac', 3n, 4n)]);
  const coarseInput = request({ amountIn: 5n, greedyParts: 2, maxGreedyEvaluations: 4 });
  const coarse = assertBoundedAgreement(coarseValue, coarseInput);
  assert.equal(coarse.status, 'success');
  if (coarse.status !== 'success') return;
  assert.equal(coarse.plan.receipt.amountOut, 3n);
  assert.equal(exhaustiveOptimum(coarseValue, coarseInput)?.amountOut, 4n);

  const barrierValue = snapshot([pool('a-ac', 1n, 2n), pool('b-ac', 2n, 2n)]);
  const barrierInput = request({ amountIn: 3n, greedyParts: 3, maxGreedyEvaluations: 6 });
  const barrier = assertBoundedAgreement(barrierValue, barrierInput);
  assert.deepEqual(actualProjection(barrier), {
    amountIn: 3n,
    amountOut: 1n,
    legs: [{ allocation: 3n, route: ['a-ac'], amountOut: 1n }],
  });
  assert.equal(barrier.status, 'success');
  if (barrier.status !== 'success') return;
  assert.equal(barrier.plan.search.greedy.rejectedEvaluations, 3);
  assert.equal(barrier.plan.search.greedy.finalReplays, 1);
  assert.equal(exhaustiveOptimum(barrierValue, barrierInput)?.amountOut, 2n);
});

void test('stops at positive chunks when parts exceeds input', () => {
  const value = snapshot([pool('a-ac', 4n, 9n), pool('b-ac', 1n, 9n)]);
  const input = request({ greedyParts: 5, maxGreedyEvaluations: 6 });
  const actual = assertBoundedAgreement(value, input);
  assert.equal(actual.status, 'success');
  if (actual.status !== 'success') return;
  assert.deepEqual(actual.plan.search.greedy, {
    proposedCandidateSets: 1,
    completedChunkSteps: 3,
    evaluations: 6,
    rejectedEvaluations: 0,
    finalReplays: 1,
    rejectedFinalReplays: 0,
    rejectedCandidateSets: 0,
    termination: 'complete',
  });
  assert.deepEqual(actualProjection(actual).legs.map(({ allocation }) => allocation), [1n, 2n]);
});

void test('reconstructs the huge configured greedy candidate exactly', () => {
  const unit = 10n ** 80n;
  const value = snapshot([pool('a-ac', unit, unit), pool('b-ac', unit, 2n * unit)]);
  const input = request({
    amountIn: 3n * unit + 2n,
    greedyParts: 3,
    maxGreedyEvaluations: 6,
  });
  const actual = assertBoundedAgreement(value, input, false);
  assert.deepEqual(actualProjection(actual), {
    amountIn: 3n * unit + 2n,
    amountOut: (11n * unit - 2n) / 6n,
    legs: [
      { allocation: unit + 1n, route: ['a-ac'], amountOut: unit / 2n },
      {
        allocation: 2n * unit + 1n,
        route: ['b-ac'],
        amountOut: (4n * unit - 1n) / 3n,
      },
    ],
  });
});

void test('never worsens full-objective quality over every tie-fixture cap', () => {
  const value = snapshot([pool('a-ac', 4n, 9n), pool('b-ac', 1n, 9n)]);
  let prior: OraclePlan | undefined;
  for (let cap = 0; cap <= 6; cap += 1) {
    const input = request({ maxGreedyEvaluations: cap });
    const actual = assertBoundedAgreement(value, input);
    const current = planFromActual(actual);
    if (prior !== undefined) assert.ok(comparePlan(current, prior) <= 0);
    prior = current;
  }
});

function assertInvalid(
  value: LiquiditySnapshot,
  overrides: Partial<GreedyExactInputSplitRouterRequest>,
  code: GreedyExactInputSplitValidationErrorCode,
  field: GreedyExactInputSplitValidationErrorField,
): void {
  const actual = routeExactInputSplitGreedy(value, request(overrides));
  assert.equal(actual.status, 'invalid-request');
  if (actual.status !== 'invalid-request') return;
  assert.equal(actual.error.code, code);
  assert.equal(actual.error.field, field);
  assert.notEqual(actual.error.message.length, 0);
  assertDeepFrozen(actual);
}

void test('validates inherited and greedy unsafe fields in frozen order', () => {
  const value = snapshot([pool('only-ac', 10n, 10n)]);
  assertInvalid(
    value,
    { snapshotChecksum: 'wrong', greedyParts: 0, maxGreedyEvaluations: -1 },
    'snapshot-identity-mismatch',
    'snapshotIdentity',
  );
  assertInvalid(value, { assetIn: '', greedyParts: 0 }, 'empty-identifier', 'assetIn');
  assertInvalid(value, { assetOut: '', greedyParts: 0 }, 'empty-identifier', 'assetOut');
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
  assertInvalid(value, { assetIn: 'missing', greedyParts: 0 }, 'unknown-asset', 'assetIn');
  assertInvalid(value, { assetOut: 'missing', greedyParts: 0 }, 'unknown-asset', 'assetOut');
  assertInvalid(value, { greedyParts: 0 }, 'invalid-greedy-parts', 'greedyParts');
  assertInvalid(
    value,
    { maxGreedyEvaluations: Number.NaN },
    'invalid-max-greedy-evaluations',
    'maxGreedyEvaluations',
  );
});

void test('is raw-UTF-16 permutation invariant and deeply captures reentrant callers', () => {
  const emoji = '\u{1f600}-pool';
  const privateUse = '\ue000-pool';
  const pools = [pool(privateUse, 100n, 100n), pool(emoji, 100n, 100n)];
  const input = request({
    amountIn: 100n,
    greedyParts: 2,
    maxGreedyEvaluations: 4,
  });
  const results = permutations(pools).map((order) =>
    assertBoundedAgreement(snapshot(order), input),
  );
  assert.deepEqual(results[0], results[1]);
  const first = results[0];
  assert.ok(first !== undefined);
  assert.deepEqual(actualProjection(first).legs.map(({ route }) => route), [
    [emoji],
    [privateUse],
  ]);
  assertDeepFrozen(first);

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
      return count('snapshot.snapshotId', 'greedy-oracle-snapshot');
    },
    get snapshotChecksum() {
      return count('snapshot.snapshotChecksum', 'greedy-oracle-checksum');
    },
    get pools() {
      return count('snapshot.pools', [getterPool]);
    },
  } as LiquiditySnapshot;
  const stable = request({ amountIn: 10n, maxRoutes: 1 });
  const descriptors: PropertyDescriptorMap = {};
  for (const key of Object.keys(stable) as (keyof GreedyExactInputSplitRouterRequest)[]) {
    descriptors[key] = {
      enumerable: true,
      get() {
        if (key === 'snapshotId') mutable.poolId = 'changed-after-capture';
        if (key === 'snapshotChecksum') {
          const nested = routeExactInputSplitGreedy(
            snapshot([pool('nested-ac', 10n, 20n)]),
            request({ amountIn: 10n, maxRoutes: 1 }),
          );
          assert.equal(nested.status, 'success');
        }
        return count(`request.${key}`, stable[key]);
      },
    };
  }
  const getterRequest = Object.defineProperties(
    {},
    descriptors,
  ) as GreedyExactInputSplitRouterRequest;
  const captured = routeExactInputSplitGreedy(getterSnapshot, getterRequest);
  assert.equal(captured.status, 'success');
  if (captured.status !== 'success') return;
  assert.equal(captured.plan.receipt.legs[0]?.receipt.hops[0]?.poolId, 'only-ac');
  for (const readCount of reads.values()) assert.equal(readCount, 1);
  assert.equal(reads.size, 3 + 7 + 11);
  assertDeepFrozen(captured);
});
