import assert from 'node:assert/strict';
import test from 'node:test';

interface OraclePool {
  readonly poolId: string;
  readonly asset0: string;
  readonly reserve0: bigint;
  readonly asset1: string;
  readonly reserve1: bigint;
  readonly feeChargedNumerator: bigint;
  readonly feeDenominator: bigint;
}

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

interface GreedyTrace {
  readonly chunks: readonly bigint[];
  readonly plan: OraclePlan | undefined;
  readonly completedChunkSteps: number;
  readonly evaluations: number;
  readonly rejectedEvaluations: number;
}

function pool(
  poolId: string,
  reserveIn: bigint,
  reserveOut: bigint,
  assetIn = 'A',
  assetOut = 'C',
): OraclePool {
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

function directionalEdges(pools: readonly OraclePool[]): readonly OracleHop[] {
  return pools
    .flatMap((value) => [
      { assetIn: value.asset0, poolId: value.poolId, assetOut: value.asset1 },
      { assetIn: value.asset1, poolId: value.poolId, assetOut: value.asset0 },
    ])
    .sort(compareHop);
}

function isSimpleRoute(
  candidate: readonly OracleHop[],
  assetIn: string,
  assetOut: string,
): boolean {
  if (candidate.length === 0 || candidate[0]?.assetIn !== assetIn) return false;
  const visitedAssets = new Set([assetIn]);
  const visitedPools = new Set<string>();
  let currentAsset = assetIn;
  for (const hop of candidate) {
    if (
      hop.assetIn !== currentAsset ||
      visitedPools.has(hop.poolId) ||
      visitedAssets.has(hop.assetOut)
    ) {
      return false;
    }
    visitedPools.add(hop.poolId);
    visitedAssets.add(hop.assetOut);
    currentAsset = hop.assetOut;
  }
  return currentAsset === assetOut;
}

// This intentionally generates the Cartesian product of every directional
// edge instead of walking production adjacency buckets.
function exhaustiveSimpleRoutes(
  pools: readonly OraclePool[],
  assetIn: string,
  assetOut: string,
  maxHops: number,
): readonly (readonly OracleHop[])[] {
  const edges = directionalEdges(pools);
  const routes: OracleHop[][] = [];
  const generate = (prefix: readonly OracleHop[], targetLength: number): void => {
    if (prefix.length === targetLength) {
      if (isSimpleRoute(prefix, assetIn, assetOut)) {
        routes.push(prefix.map((hop) => ({ ...hop })));
      }
      return;
    }
    for (const edge of edges) generate([...prefix, edge], targetLength);
  };
  for (let length = 1; length <= maxHops; length += 1) generate([], length);
  return routes.sort(compareRoute);
}

function poolDisjointSubsets(
  routes: readonly (readonly OracleHop[])[],
  maxRoutes: number,
): readonly (readonly (readonly OracleHop[])[])[] {
  assert.ok(routes.length < 31, 'tiny bitmask oracle accepts fewer than 31 routes');
  const subsets: (readonly (readonly OracleHop[])[])[] = [];
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
    if (disjoint) subsets.push(selected);
  }
  return subsets.sort((left, right) => {
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
    assert.ok(quotientDigit <= 9n);
    quotient = quotient * 10n + quotientDigit;
    remainder -= quotientDigit * denominator;
  }
  return quotient;
}

function replayRoute(
  pools: readonly OraclePool[],
  route: readonly OracleHop[],
  amountIn: bigint,
): bigint | undefined {
  const states = new Map(pools.map((value) => [value.poolId, { ...value }] as const));
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
    if (currentAmount > 0n && amountOut === 0n) return undefined;
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
  pools: readonly OraclePool[],
  routes: readonly (readonly OracleHop[])[],
  allocations: readonly bigint[],
  amountIn: bigint,
): OraclePlan | undefined {
  assert.equal(routes.length, allocations.length);
  assert.equal(allocations.reduce((sum, allocation) => sum + allocation, 0n), amountIn);
  const legs: OracleLeg[] = [];
  for (let index = 0; index < routes.length; index += 1) {
    const allocation = allocations[index];
    const route = routes[index];
    assert.ok(allocation !== undefined && route !== undefined);
    if (allocation === 0n) continue;
    const amountOut = replayRoute(pools, route, allocation);
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

function nonnegativeCompositions(total: bigint, slots: number): readonly (readonly bigint[])[] {
  assert.ok(slots > 0);
  if (slots === 1) return [[total]];
  const output: bigint[][] = [];
  for (let allocation = 0n; allocation <= total; allocation += 1n) {
    for (const suffix of nonnegativeCompositions(total - allocation, slots - 1)) {
      output.push([allocation, ...suffix]);
    }
  }
  return output;
}

function exhaustivePlans(
  pools: readonly OraclePool[],
  candidateSets: readonly (readonly (readonly OracleHop[])[])[],
  amountIn: bigint,
): readonly OraclePlan[] {
  const plans: OraclePlan[] = [];
  for (const routes of candidateSets) {
    for (const allocations of nonnegativeCompositions(amountIn, routes.length)) {
      const plan = replayAllocation(pools, routes, allocations, amountIn);
      if (plan !== undefined) plans.push(plan);
    }
  }
  return plans.sort(comparePlan);
}

function chunkSchedule(amountIn: bigint, parts: number): readonly bigint[] {
  assert.ok(Number.isSafeInteger(parts) && parts > 0);
  const divisor = BigInt(parts);
  const base = amountIn / divisor;
  const remainder = amountIn % divisor;
  const chunks: bigint[] = [];
  if (base === 0n) {
    for (let index = 0n; index < remainder; index += 1n) chunks.push(1n);
    return chunks;
  }
  for (let index = 0; index < parts; index += 1) {
    chunks.push(base + (BigInt(index) < remainder ? 1n : 0n));
  }
  return chunks;
}

// This is an independent unbounded trace for fixture derivation. Every option
// is fresh-replayed, and the selected final allocation is replayed once more.
function greedyTrace(
  pools: readonly OraclePool[],
  routes: readonly (readonly OracleHop[])[],
  amountIn: bigint,
  parts: number,
): GreedyTrace {
  const chunks = chunkSchedule(amountIn, parts);
  let allocations = routes.map(() => 0n);
  let completedChunkSteps = 0;
  let evaluations = 0;
  let rejectedEvaluations = 0;
  let allocated = 0n;

  for (const chunk of chunks) {
    const options: { readonly routeIndex: number; readonly plan: OraclePlan }[] = [];
    for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
      const optionAllocations = [...allocations];
      optionAllocations[routeIndex] = (optionAllocations[routeIndex] ?? 0n) + chunk;
      evaluations += 1;
      const plan = replayAllocation(pools, routes, optionAllocations, allocated + chunk);
      if (plan === undefined) {
        rejectedEvaluations += 1;
      } else {
        options.push({ routeIndex, plan });
      }
    }
    if (options.length === 0) {
      return {
        chunks,
        plan: undefined,
        completedChunkSteps,
        evaluations,
        rejectedEvaluations,
      };
    }
    options.sort((left, right) => {
      if (left.plan.amountOut !== right.plan.amountOut) {
        return left.plan.amountOut > right.plan.amountOut ? -1 : 1;
      }
      return left.routeIndex - right.routeIndex;
    });
    const winner = options[0];
    assert.ok(winner !== undefined);
    allocations = routes.map((_, index) =>
      winner.plan.legs.find((leg) => compareRoute(leg.route, routes[index] ?? []) === 0)
        ?.allocation ?? 0n,
    );
    allocated += chunk;
    completedChunkSteps += 1;
  }

  // Distinct post-selection replay: option-score plans never become results.
  const plan = replayAllocation(pools, routes, allocations, amountIn);
  return { chunks, plan, completedChunkSteps, evaluations, rejectedEvaluations };
}

function routePoolIds(route: readonly OracleHop[]): readonly string[] {
  return route.map(({ poolId }) => poolId);
}

function allocationProjection(plan: OraclePlan | undefined) {
  assert.ok(plan !== undefined);
  return {
    amountOut: plan.amountOut,
    legs: plan.legs.map((leg) => ({
      allocation: leg.allocation,
      route: routePoolIds(leg.route),
      amountOut: leg.amountOut,
    })),
  };
}

function compositionTable(
  pools: readonly OraclePool[],
  routes: readonly (readonly OracleHop[])[],
  amountIn: bigint,
) {
  return nonnegativeCompositions(amountIn, routes.length).map((allocations) => {
    const plan = replayAllocation(pools, routes, allocations, amountIn);
    return { allocations, amountOut: plan?.amountOut ?? null };
  });
}

void test('independently generates Cartesian routes and rejects shared-pool subsets', () => {
  const tiePools = [pool('a-ac', 4n, 9n), pool('b-ac', 1n, 9n)];
  const tieRoutes = exhaustiveSimpleRoutes(tiePools, 'A', 'C', 1);
  assert.deepEqual(tieRoutes.map(routePoolIds), [['a-ac'], ['b-ac']]);
  assert.deepEqual(
    poolDisjointSubsets(tieRoutes, 2).map((set) => set.map(routePoolIds)),
    [[['a-ac']], [['b-ac']], [['a-ac'], ['b-ac']]],
  );

  const sharedPools = [
    pool('a-shared-ab', 10n, 10n, 'A', 'B'),
    pool('b-bc', 10n, 10n, 'B', 'C'),
    pool('c-bd', 10n, 10n, 'B', 'D'),
    pool('d-dc', 10n, 10n, 'D', 'C'),
  ];
  const sharedRoutes = exhaustiveSimpleRoutes(sharedPools, 'A', 'C', 3);
  assert.deepEqual(sharedRoutes.map(routePoolIds), [
    ['a-shared-ab', 'b-bc'],
    ['a-shared-ab', 'c-bd', 'd-dc'],
  ]);
  assert.deepEqual(
    poolDisjointSubsets(sharedRoutes, 2).map((set) => set.map(routePoolIds)),
    [[['a-shared-ab', 'b-bc']], [['a-shared-ab', 'c-bd', 'd-dc']]],
  );
});

void test('hand-checks the unit optimum and observable allocation-vector tie', () => {
  const pools = [pool('a-ac', 4n, 9n), pool('b-ac', 1n, 9n)];
  const routes = exhaustiveSimpleRoutes(pools, 'A', 'C', 1);
  assert.deepEqual(compositionTable(pools, routes, 3n), [
    { allocations: [0n, 3n], amountOut: 6n },
    { allocations: [1n, 2n], amountOut: 7n },
    { allocations: [2n, 1n], amountOut: 7n },
    { allocations: [3n, 0n], amountOut: 3n },
  ]);

  const candidateSets = poolDisjointSubsets(routes, 2);
  const optimum = exhaustivePlans(pools, candidateSets, 3n)[0];
  assert.deepEqual(allocationProjection(optimum), {
    amountOut: 7n,
    legs: [
      { allocation: 1n, route: ['a-ac'], amountOut: 1n },
      { allocation: 2n, route: ['b-ac'], amountOut: 6n },
    ],
  });

  const equal = replayAllocation(pools, routes, [2n, 1n], 3n);
  const greedy = greedyTrace(pools, routes, 3n, 3);
  assert.deepEqual(greedy.chunks, [1n, 1n, 1n]);
  assert.equal(greedy.completedChunkSteps, 3);
  assert.equal(greedy.evaluations, 6);
  assert.equal(greedy.rejectedEvaluations, 0);
  assert.deepEqual(allocationProjection(greedy.plan), allocationProjection(optimum));
  assert.ok(equal !== undefined && greedy.plan !== undefined);
  assert.equal(equal.amountOut, greedy.plan.amountOut);
  assert.equal(comparePlan(greedy.plan, equal), -1);

  const partsGreaterThanInput = greedyTrace(pools, routes, 3n, 5);
  assert.deepEqual(partsGreaterThanInput.chunks, [1n, 1n, 1n]);
  assert.equal(partsGreaterThanInput.completedChunkSteps, 3);
  assert.equal(partsGreaterThanInput.evaluations, 6);
  assert.deepEqual(
    allocationProjection(partsGreaterThanInput.plan),
    allocationProjection(optimum),
  );
});

void test('bounds a coarse greedy result below the hand-checked exhaustive optimum', () => {
  const pools = [pool('a-ac', 1n, 3n), pool('b-ac', 3n, 4n)];
  const routes = exhaustiveSimpleRoutes(pools, 'A', 'C', 1);
  assert.deepEqual(compositionTable(pools, routes, 5n), [
    { allocations: [0n, 5n], amountOut: 2n },
    { allocations: [1n, 4n], amountOut: 3n },
    { allocations: [2n, 3n], amountOut: 4n },
    { allocations: [3n, 2n], amountOut: 3n },
    { allocations: [4n, 1n], amountOut: 3n },
    { allocations: [5n, 0n], amountOut: 2n },
  ]);
  const optimum = exhaustivePlans(pools, poolDisjointSubsets(routes, 2), 5n)[0];
  const equal = replayAllocation(pools, routes, [3n, 2n], 5n);
  const greedy = greedyTrace(pools, routes, 5n, 2);
  assert.deepEqual(greedy.chunks, [3n, 2n]);
  assert.deepEqual(allocationProjection(greedy.plan), {
    amountOut: 3n,
    legs: [
      { allocation: 3n, route: ['a-ac'], amountOut: 2n },
      { allocation: 2n, route: ['b-ac'], amountOut: 1n },
    ],
  });
  assert.ok(optimum !== undefined && equal !== undefined && greedy.plan !== undefined);
  assert.equal(optimum.amountOut, 4n);
  assert.equal(equal.amountOut, 3n);
  assert.equal(greedy.plan.amountOut, equal.amountOut);
  assert.ok(comparePlan(optimum, greedy.plan) < 0);
});

void test('keeps the activation-barrier counterexample explicit and bounded', () => {
  const pools = [pool('a-ac', 1n, 2n), pool('b-ac', 2n, 2n)];
  const routes = exhaustiveSimpleRoutes(pools, 'A', 'C', 1);
  assert.deepEqual(compositionTable(pools, routes, 3n), [
    { allocations: [0n, 3n], amountOut: 1n },
    { allocations: [1n, 2n], amountOut: 2n },
    { allocations: [2n, 1n], amountOut: null },
    { allocations: [3n, 0n], amountOut: 1n },
  ]);
  const optimum = exhaustivePlans(pools, poolDisjointSubsets(routes, 2), 3n)[0];
  const greedy = greedyTrace(pools, routes, 3n, 3);
  assert.deepEqual(allocationProjection(optimum), {
    amountOut: 2n,
    legs: [
      { allocation: 1n, route: ['a-ac'], amountOut: 1n },
      { allocation: 2n, route: ['b-ac'], amountOut: 1n },
    ],
  });
  assert.deepEqual(allocationProjection(greedy.plan), {
    amountOut: 1n,
    legs: [{ allocation: 3n, route: ['a-ac'], amountOut: 1n }],
  });
  assert.equal(greedy.evaluations, 6);
  assert.equal(greedy.rejectedEvaluations, 3);
  assert.ok(optimum !== undefined && greedy.plan !== undefined);
  assert.ok(comparePlan(optimum, greedy.plan) < 0);
});

void test('reconstructs and improves a huge exact allocation without number coercion', () => {
  const unit = 10n ** 80n;
  const amountIn = 3n * unit + 2n;
  const pools = [pool('a-ac', unit, unit), pool('b-ac', unit, 2n * unit)];
  const routes = exhaustiveSimpleRoutes(pools, 'A', 'C', 1);
  const greedy = greedyTrace(pools, routes, amountIn, 3);
  assert.deepEqual(greedy.chunks, [unit + 1n, unit + 1n, unit]);
  assert.deepEqual(allocationProjection(greedy.plan), {
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
  assert.ok(greedy.plan !== undefined);
  assert.equal(
    greedy.plan.legs.reduce((sum, leg) => sum + leg.allocation, 0n),
    amountIn,
  );
  const equalAllocation = amountIn / 2n;
  const equal = replayAllocation(
    pools,
    routes,
    [equalAllocation, equalAllocation],
    amountIn,
  );
  assert.ok(equal !== undefined);
  assert.equal(equal.amountOut, (9n * unit) / 5n);
  assert.ok(comparePlan(greedy.plan, equal) < 0);
  assert.equal(typeof greedy.plan.amountOut, 'bigint');
});
