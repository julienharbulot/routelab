import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../../src/domain/index.ts';
import {
  routeExactInputSplitAnytime,
  type ExactInputSplitRuntimeCheckpoint,
  type ExactInputSplitRuntimeControl,
  type ExactInputSplitRuntimeRequest,
  type ExactInputSplitRuntimeResult,
  type ExactInputSplitRuntimeWorkKind,
  type ExactInputSplitWorkCaps,
  type ExactInputSplitWorkCounters,
} from '../../src/router/anytime-exact-input-split/index.ts';
import {
  prepareRoutingContext,
  type PreparedRoutingContext,
} from '../../src/runtime/prepared-routing-context/index.ts';

interface Hop {
  readonly assetIn: string;
  readonly poolId: string;
  readonly assetOut: string;
}

interface ReferenceLeg {
  readonly allocation: bigint;
  readonly route: readonly Hop[];
  readonly amountOut: bigint;
}

interface ReferencePlan {
  readonly amountOut: bigint;
  readonly legs: readonly ReferenceLeg[];
}

interface ExpectedBoundary {
  readonly kind: ExactInputSplitRuntimeWorkKind;
  readonly counters: ExactInputSplitWorkCounters;
  readonly incumbentAmountOut: bigint;
}

const COMPLETE_CAPS: ExactInputSplitWorkCaps = {
  maxPathExpansions: 1_000,
  maxBestSingleCandidateReplays: 1_000,
  maxCandidateSetExpansions: 1_000,
  maxEqualProposalReplays: 1_000,
  maxGreedyOptionReplays: 1_000,
  maxFinalAuthorizationReplays: 1_000,
};

const ZERO_ADVANCED_COUNTERS: ExactInputSplitWorkCounters = {
  directCandidates: 2,
  directCandidateReplays: 2,
  directCandidateRejections: 0,
  pathExpansions: 0,
  bestSingleCandidateReplays: 0,
  bestSingleCandidateRejections: 0,
  candidateSetExpansions: 0,
  equalProposalReplays: 0,
  equalProposalRejections: 0,
  greedyOptionReplays: 0,
  greedyOptionRejections: 0,
  finalAuthorizationReplays: 0,
  finalAuthorizationRejections: 0,
};

function compareRawUtf16(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareHop(left: Hop, right: Hop): number {
  return (
    compareRawUtf16(left.assetIn, right.assetIn) ||
    compareRawUtf16(left.poolId, right.poolId) ||
    compareRawUtf16(left.assetOut, right.assetOut)
  );
}

function compareRoute(left: readonly Hop[], right: readonly Hop[]): number {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const comparison = compareHop(left[index]!, right[index]!);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

function canonicalLegs(legs: readonly ReferenceLeg[]): readonly ReferenceLeg[] {
  return [...legs].sort((left, right) => compareRoute(left.route, right.route));
}

function comparePlan(left: ReferencePlan, right: ReferencePlan): number {
  if (left.amountOut !== right.amountOut) return left.amountOut > right.amountOut ? -1 : 1;
  if (left.legs.length !== right.legs.length) return left.legs.length - right.legs.length;
  const leftHops = left.legs.reduce((sum, leg) => sum + leg.route.length, 0);
  const rightHops = right.legs.reduce((sum, leg) => sum + leg.route.length, 0);
  if (leftHops !== rightHops) return leftHops - rightHops;
  for (let index = 0; index < left.legs.length; index += 1) {
    const routeComparison = compareRoute(left.legs[index]!.route, right.legs[index]!.route);
    if (routeComparison !== 0) return routeComparison;
  }
  for (let index = 0; index < left.legs.length; index += 1) {
    const leftAllocation = left.legs[index]!.allocation;
    const rightAllocation = right.legs[index]!.allocation;
    if (leftAllocation !== rightAllocation) return leftAllocation < rightAllocation ? -1 : 1;
  }
  return 0;
}

function pool(
  poolId: string,
  reserve0 = 100n,
  reserve1 = 100n,
  asset0 = 'A',
  asset1 = 'C',
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

// Deliberately local: the oracle does not import production serialization.
function canonicalSnapshotContent(snapshot: LiquiditySnapshot): string {
  const pools = [...snapshot.pools]
    .sort((left, right) => compareRawUtf16(left.poolId, right.poolId))
    .map((candidate) => ({
      poolId: candidate.poolId,
      asset0: candidate.asset0,
      reserve0: candidate.reserve0.toString(10),
      asset1: candidate.asset1,
      reserve1: candidate.reserve1.toString(10),
      feeChargedNumerator: candidate.feeChargedNumerator.toString(10),
      feeDenominator: candidate.feeDenominator.toString(10),
    }));
  return JSON.stringify({ schemaVersion: 'routelab.snapshot.v1', pools });
}

function checksum(snapshot: LiquiditySnapshot): string {
  return `sha256:${createHash('sha256').update(canonicalSnapshotContent(snapshot), 'utf8').digest('hex')}`;
}

function snapshot(
  pools: readonly ConstantProductPool[],
  snapshotId = 'anytime-split-oracle',
): LiquiditySnapshot {
  const pending: LiquiditySnapshot = { snapshotId, snapshotChecksum: 'pending', pools };
  return { ...pending, snapshotChecksum: checksum(pending) };
}

function prepare(value: LiquiditySnapshot): PreparedRoutingContext {
  const result = prepareRoutingContext(value);
  if (!result.ok) assert.fail(`preparation rejected independent checksum: ${result.error.code}`);
  return result.value;
}

function request(
  value: LiquiditySnapshot,
  overrides: Partial<ExactInputSplitRuntimeRequest> = {},
): ExactInputSplitRuntimeRequest {
  return {
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 100n,
    maxHops: 1,
    maxRoutes: 2,
    greedyParts: 2,
    ...overrides,
  };
}

function control(overrides: Partial<ExactInputSplitWorkCaps> = {}): ExactInputSplitRuntimeControl {
  return { workCaps: { ...COMPLETE_CAPS, ...overrides } };
}

function success(result: ExactInputSplitRuntimeResult) {
  if (result.status !== 'success') assert.fail(`expected success, received ${result.status}`);
  return result.plan;
}

function resultCounters(result: ExactInputSplitRuntimeResult): ExactInputSplitWorkCounters {
  if (result.status === 'success') return result.plan.search.counters;
  if ('search' in result) return result.search.counters;
  assert.fail(`result ${result.status} has no work ledger`);
}

function resultTermination(result: ExactInputSplitRuntimeResult): string {
  if (result.status === 'success') return result.plan.search.termination;
  if ('search' in result) return result.search.termination;
  assert.fail(`result ${result.status} has no termination`);
}

function resultIncumbentAmount(result: ExactInputSplitRuntimeResult): bigint | null {
  if (result.status === 'success') return result.plan.receipt.amountOut;
  if (result.status === 'control-error' || result.status === 'deadline-error') {
    return result.incumbent?.amountOut ?? null;
  }
  return null;
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) assertDeepFrozen(Reflect.get(value, key), seen);
}

function directedEdges(pools: readonly ConstantProductPool[]): Hop[] {
  return pools.flatMap((candidate) => [
    { assetIn: candidate.asset0, poolId: candidate.poolId, assetOut: candidate.asset1 },
    { assetIn: candidate.asset1, poolId: candidate.poolId, assetOut: candidate.asset0 },
  ]);
}

function isSimpleRoute(route: readonly Hop[], assetIn: string, assetOut: string): boolean {
  if (route[0]?.assetIn !== assetIn) return false;
  const assets = new Set([assetIn]);
  const pools = new Set<string>();
  let nextAsset = assetIn;
  for (const hop of route) {
    if (hop.assetIn !== nextAsset || assets.has(hop.assetOut) || pools.has(hop.poolId)) return false;
    assets.add(hop.assetOut);
    pools.add(hop.poolId);
    nextAsset = hop.assetOut;
  }
  return nextAsset === assetOut;
}

// A deliberately slow Cartesian reference, structurally unlike production DFS.
function simpleRoutes(
  pools: readonly ConstantProductPool[],
  assetIn: string,
  assetOut: string,
  maxHops: number,
): Hop[][] {
  const edges = directedEdges(pools);
  const routes: Hop[][] = [];
  function generate(prefix: readonly Hop[]): void {
    if (prefix.length > 0 && isSimpleRoute(prefix, assetIn, assetOut)) routes.push(prefix.map((hop) => ({ ...hop })));
    if (prefix.length === maxHops) return;
    for (const edge of edges) generate([...prefix, edge]);
  }
  generate([]);
  routes.sort(compareRoute);
  return routes;
}

function outgoingEdges(pools: readonly ConstantProductPool[]): ReadonlyMap<string, readonly Hop[]> {
  const outgoing = new Map<string, Hop[]>();
  for (const edge of directedEdges(pools)) {
    const bucket = outgoing.get(edge.assetIn) ?? [];
    bucket.push(edge);
    outgoing.set(edge.assetIn, bucket);
  }
  for (const bucket of outgoing.values()) bucket.sort(compareHop);
  return outgoing;
}

// Counts attempted outgoing edges in a recursive reference traversal.
function pathExpansionCount(
  pools: readonly ConstantProductPool[],
  assetIn: string,
  assetOut: string,
  maxHops: number,
): number {
  const outgoing = outgoingEdges(pools);
  let expansions = 0;
  function visit(asset: string, hops: number, assets: ReadonlySet<string>, usedPools: ReadonlySet<string>): void {
    if (hops === maxHops) return;
    for (const edge of outgoing.get(asset) ?? []) {
      expansions += 1;
      if (assets.has(edge.assetOut) || usedPools.has(edge.poolId)) continue;
      if (edge.assetOut === assetOut) continue;
      visit(
        edge.assetOut,
        hops + 1,
        new Set([...assets, edge.assetOut]),
        new Set([...usedPools, edge.poolId]),
      );
    }
  }
  visit(assetIn, 0, new Set([assetIn]), new Set());
  return expansions;
}

function combinations<T>(values: readonly T[], cardinality: number): T[][] {
  const output: T[][] = [];
  function choose(start: number, selected: readonly T[]): void {
    if (selected.length === cardinality) {
      output.push([...selected]);
      return;
    }
    for (let index = start; index < values.length; index += 1) choose(index + 1, [...selected, values[index]!]);
  }
  choose(0, []);
  return output;
}

function disjointSets(routes: readonly (readonly Hop[])[], maxRoutes: number): Hop[][][] {
  const output: Hop[][][] = [];
  for (let cardinality = 2; cardinality <= Math.min(maxRoutes, routes.length); cardinality += 1) {
    for (const candidates of combinations(routes, cardinality)) {
      const ids = candidates.flatMap((route) => route.map((hop) => hop.poolId));
      if (new Set(ids).size === ids.length) output.push(candidates.map((route) => [...route]));
    }
  }
  return output;
}

// Each visited combination-tree edge is one candidate-set expansion.
function candidateSetExpansionCount(routes: readonly (readonly Hop[])[], maxRoutes: number): number {
  let expansions = 0;
  for (let cardinality = 2; cardinality <= Math.min(maxRoutes, routes.length); cardinality += 1) {
    function visit(start: number, selected: readonly (readonly Hop[])[], usedPools: ReadonlySet<string>): void {
      for (let index = start; index < routes.length; index += 1) {
        expansions += 1;
        const route = routes[index]!;
        if (route.some((hop) => usedPools.has(hop.poolId))) continue;
        if (selected.length + 1 === cardinality) continue;
        visit(
          index + 1,
          [...selected, route],
          new Set([...usedPools, ...route.map((hop) => hop.poolId)]),
        );
      }
    }
    visit(0, [], new Set());
  }
  return expansions;
}

function directionalPool(poolValue: ConstantProductPool, assetIn: string) {
  if (poolValue.asset0 === assetIn) {
    return { reserveIn: poolValue.reserve0, reserveOut: poolValue.reserve1, reverse: false };
  }
  if (poolValue.asset1 === assetIn) {
    return { reserveIn: poolValue.reserve1, reserveOut: poolValue.reserve0, reverse: true };
  }
  return undefined;
}

function quote(amountIn: bigint, poolValue: ConstantProductPool, assetIn: string): bigint | undefined {
  const direction = directionalPool(poolValue, assetIn);
  if (direction === undefined) return undefined;
  const multiplier = poolValue.feeDenominator - poolValue.feeChargedNumerator;
  return (
    amountIn * multiplier * direction.reserveOut /
    (direction.reserveIn * poolValue.feeDenominator + amountIn * multiplier)
  );
}

function replayRoute(
  pools: readonly ConstantProductPool[],
  route: readonly Hop[],
  amountIn: bigint,
): bigint | undefined {
  const state = new Map(pools.map((candidate) => [candidate.poolId, { ...candidate }]));
  let amount = amountIn;
  for (const hop of route) {
    const current = state.get(hop.poolId);
    if (current === undefined) return undefined;
    const direction = directionalPool(current, hop.assetIn);
    if (direction === undefined) return undefined;
    const amountOut = quote(amount, current, hop.assetIn);
    if (amountOut === undefined || amountOut === 0n) return undefined;
    const next = direction.reverse
      ? { ...current, reserve1: current.reserve1 + amount, reserve0: current.reserve0 - amountOut }
      : { ...current, reserve0: current.reserve0 + amount, reserve1: current.reserve1 - amountOut };
    state.set(hop.poolId, next);
    amount = amountOut;
  }
  return amount;
}

function replayPlan(
  pools: readonly ConstantProductPool[],
  routes: readonly (readonly Hop[])[],
  allocations: readonly bigint[],
): ReferencePlan | undefined {
  const legs: ReferenceLeg[] = [];
  for (let index = 0; index < routes.length; index += 1) {
    const allocation = allocations[index]!;
    if (allocation === 0n) continue;
    const amountOut = replayRoute(pools, routes[index]!, allocation);
    if (amountOut === undefined) return undefined;
    legs.push({ allocation, route: routes[index]!, amountOut });
  }
  const ordered = canonicalLegs(legs);
  return { amountOut: ordered.reduce((sum, leg) => sum + leg.amountOut, 0n), legs: ordered };
}

function equalPlan(
  pools: readonly ConstantProductPool[],
  routes: readonly (readonly Hop[])[],
  amountIn: bigint,
): ReferencePlan | undefined {
  const cardinality = BigInt(routes.length);
  const base = amountIn / cardinality;
  const remainder = amountIn % cardinality;
  if (base === 0n) return undefined;
  return replayPlan(
    pools,
    routes,
    routes.map((_, index) => base + (BigInt(index) < remainder ? 1n : 0n)),
  );
}

function chunks(amountIn: bigint, parts: number): bigint[] {
  const divisor = BigInt(parts);
  const base = amountIn / divisor;
  const remainder = amountIn % divisor;
  if (base === 0n) return Array.from({ length: Number(remainder) }, () => 1n);
  return Array.from({ length: parts }, (_, index) => base + (BigInt(index) < remainder ? 1n : 0n));
}

function greedyPlan(
  pools: readonly ConstantProductPool[],
  routes: readonly (readonly Hop[])[],
  amountIn: bigint,
  parts: number,
): ReferencePlan | undefined {
  const allocations = routes.map(() => 0n);
  for (const chunk of chunks(amountIn, parts)) {
    let winner: { readonly index: number; readonly output: bigint } | undefined;
    for (let index = 0; index < routes.length; index += 1) {
      const option = [...allocations];
      option[index] = option[index]! + chunk;
      const candidate = replayPlan(pools, routes, option);
      if (candidate !== undefined && (winner === undefined || candidate.amountOut > winner.output)) {
        winner = { index, output: candidate.amountOut };
      }
    }
    if (winner === undefined) return undefined;
    allocations[winner.index] = allocations[winner.index]! + chunk;
  }
  return replayPlan(pools, routes, allocations);
}

function referenceComplete(
  pools: readonly ConstantProductPool[],
  runtimeRequest: ExactInputSplitRuntimeRequest,
): ReferencePlan | undefined {
  const routes = simpleRoutes(pools, runtimeRequest.assetIn, runtimeRequest.assetOut, runtimeRequest.maxHops);
  const plans: ReferencePlan[] = [];
  for (const route of routes) {
    const plan = replayPlan(pools, [route], [runtimeRequest.amountIn]);
    if (plan !== undefined) plans.push(plan);
  }
  for (const routesInSet of disjointSets(routes, runtimeRequest.maxRoutes)) {
    const equal = equalPlan(pools, routesInSet, runtimeRequest.amountIn);
    if (equal !== undefined) plans.push(equal);
    const greedy = greedyPlan(pools, routesInSet, runtimeRequest.amountIn, runtimeRequest.greedyParts);
    if (greedy !== undefined) plans.push(greedy);
  }
  return plans.sort(comparePlan)[0];
}

function assertMatchesReference(
  pools: readonly ConstantProductPool[],
  runtimeRequest: ExactInputSplitRuntimeRequest,
  result: ExactInputSplitRuntimeResult,
): void {
  const expected = referenceComplete(pools, runtimeRequest);
  if (expected === undefined) {
    assert.equal(result.status, 'no-route');
    return;
  }
  const plan = success(result);
  assert.equal(plan.receipt.amountOut, expected.amountOut);
  assert.deepEqual(
    plan.receipt.legs.map((leg) => ({
      allocation: leg.allocation,
      route: leg.receipt.hops.map(({ assetIn, poolId, assetOut }) => ({ assetIn, poolId, assetOut })),
      amountOut: leg.receipt.amountOut,
    })),
    expected.legs,
  );
}

function counters(overrides: Partial<ExactInputSplitWorkCounters> = {}): ExactInputSplitWorkCounters {
  return { ...ZERO_ADVANCED_COUNTERS, ...overrides };
}

const TRACE_BOUNDARIES: readonly ExpectedBoundary[] = [
  { kind: 'path-expansion', counters: counters(), incumbentAmountOut: 50n },
  { kind: 'path-expansion', counters: counters({ pathExpansions: 1 }), incumbentAmountOut: 50n },
  { kind: 'best-single-candidate-replay', counters: counters({ pathExpansions: 2 }), incumbentAmountOut: 50n },
  { kind: 'best-single-candidate-replay', counters: counters({ pathExpansions: 2, bestSingleCandidateReplays: 1 }), incumbentAmountOut: 50n },
  { kind: 'candidate-set-expansion', counters: counters({ pathExpansions: 2, bestSingleCandidateReplays: 2 }), incumbentAmountOut: 50n },
  { kind: 'candidate-set-expansion', counters: counters({ pathExpansions: 2, bestSingleCandidateReplays: 2, candidateSetExpansions: 1 }), incumbentAmountOut: 50n },
  { kind: 'candidate-set-expansion', counters: counters({ pathExpansions: 2, bestSingleCandidateReplays: 2, candidateSetExpansions: 2 }), incumbentAmountOut: 50n },
  { kind: 'equal-proposal-replay', counters: counters({ pathExpansions: 2, bestSingleCandidateReplays: 2, candidateSetExpansions: 3 }), incumbentAmountOut: 50n },
  { kind: 'final-authorization-replay', counters: counters({ pathExpansions: 2, bestSingleCandidateReplays: 2, candidateSetExpansions: 3, equalProposalReplays: 1 }), incumbentAmountOut: 50n },
  { kind: 'greedy-option-replay', counters: counters({ pathExpansions: 2, bestSingleCandidateReplays: 2, candidateSetExpansions: 3, equalProposalReplays: 1, finalAuthorizationReplays: 1 }), incumbentAmountOut: 66n },
  { kind: 'greedy-option-replay', counters: counters({ pathExpansions: 2, bestSingleCandidateReplays: 2, candidateSetExpansions: 3, equalProposalReplays: 1, greedyOptionReplays: 1, finalAuthorizationReplays: 1 }), incumbentAmountOut: 66n },
  { kind: 'greedy-option-replay', counters: counters({ pathExpansions: 2, bestSingleCandidateReplays: 2, candidateSetExpansions: 3, equalProposalReplays: 1, greedyOptionReplays: 2, finalAuthorizationReplays: 1 }), incumbentAmountOut: 66n },
  { kind: 'greedy-option-replay', counters: counters({ pathExpansions: 2, bestSingleCandidateReplays: 2, candidateSetExpansions: 3, equalProposalReplays: 1, greedyOptionReplays: 3, finalAuthorizationReplays: 1 }), incumbentAmountOut: 66n },
];

const SPLIT_POOLS = [pool('left-ac'), pool('right-ac')];

void test('independent exact model derives 100 -> direct 50 -> split 66 and every work counter', () => {
  const value = snapshot(SPLIT_POOLS);
  const runtimeRequest = request(value);
  const routes = simpleRoutes(SPLIT_POOLS, 'A', 'C', 1);
  assert.equal(pathExpansionCount(SPLIT_POOLS, 'A', 'C', 1), 2);
  assert.equal(candidateSetExpansionCount(routes, 2), 3);
  assert.equal(replayRoute(SPLIT_POOLS, [routes[0]![0]!], 100n), 50n);
  assert.equal(equalPlan(SPLIT_POOLS, routes, 100n)?.amountOut, 66n);

  const result = routeExactInputSplitAnytime(prepare(value), runtimeRequest, control());
  assertMatchesReference(SPLIT_POOLS, runtimeRequest, result);
  assert.deepEqual(success(result).search, {
    counters: counters({
      pathExpansions: 2,
      bestSingleCandidateReplays: 2,
      candidateSetExpansions: 3,
      equalProposalReplays: 1,
      greedyOptionReplays: 4,
      finalAuthorizationReplays: 1,
    }),
    termination: 'complete',
  });
});

void test('covers no-direct, rejected-direct, and a better multi-hop exact single candidate', () => {
  const noDirectPools = [
    pool('ax', 100n, 100n, 'A', 'X'),
    pool('xc', 100n, 100n, 'X', 'C'),
  ];
  const noDirect = snapshot(noDirectPools, 'no-direct');
  const noDirectRequest = request(noDirect, { maxHops: 2, maxRoutes: 1 });
  const noDirectResult = routeExactInputSplitAnytime(prepare(noDirect), noDirectRequest, control());
  assertMatchesReference(noDirectPools, noDirectRequest, noDirectResult);
  assert.equal(success(noDirectResult).receipt.amountOut, 33n);
  assert.equal(success(noDirectResult).search.counters.directCandidates, 0);

  const rejectedPools = [pool('direct-zero', 100n, 1n), ...noDirectPools];
  const rejected = snapshot(rejectedPools, 'rejected-direct');
  const rejectedRequest = request(rejected, { amountIn: 1n, maxHops: 2, maxRoutes: 1 });
  const rejectedResult = routeExactInputSplitAnytime(prepare(rejected), rejectedRequest, control());
  assert.equal(rejectedResult.status, 'no-route');
  if (rejectedResult.status === 'no-route') {
    assert.equal(rejectedResult.reason, 'all-candidates-rejected');
    assert.equal(rejectedResult.search.counters.directCandidateRejections, 1);
  }

  const betterPools = [pool('direct-ac', 100n, 50n), ...noDirectPools];
  const better = snapshot(betterPools, 'best-single');
  const betterRequest = request(better, { maxHops: 2, maxRoutes: 1 });
  const betterResult = routeExactInputSplitAnytime(
    prepare(better),
    betterRequest,
    control({ maxFinalAuthorizationReplays: 0 }),
  );
  assert.equal(success(betterResult).receipt.amountOut, 33n);
  assert.deepEqual(
    success(betterResult).receipt.legs[0]?.receipt.hops.map(({ poolId }) => poolId),
    ['ax', 'xc'],
  );
  assert.equal(success(betterResult).search.counters.finalAuthorizationReplays, 0);
  assert.equal(success(betterResult).search.counters.candidateSetExpansions, 0);
  assert.equal(success(betterResult).search.counters.equalProposalReplays, 0);
  assert.equal(success(betterResult).search.counters.greedyOptionReplays, 0);
  assert.equal(success(betterResult).search.termination, 'complete');
});

void test('equal and greedy exact improvements match independent reconstruction, including tie behavior', () => {
  const asymmetricPools = [
    pool('left-ac', 50n, 50n),
    pool('right-ac', 50n, 100n),
  ];
  const asymmetric = snapshot(asymmetricPools, 'greedy-improves');
  const asymmetricRequest = request(asymmetric, { greedyParts: 4 });
  const routes = simpleRoutes(asymmetricPools, 'A', 'C', 1);
  assert.equal(replayPlan(asymmetricPools, [routes[1]!], [100n])?.amountOut, 66n);
  assert.equal(equalPlan(asymmetricPools, routes, 100n)?.amountOut, 75n);
  const greedy = greedyPlan(asymmetricPools, routes, 100n, 4);
  assert.equal(greedy?.amountOut, 76n);
  assert.deepEqual(greedy?.legs.map(({ allocation }) => allocation), [25n, 75n]);
  const improved = routeExactInputSplitAnytime(prepare(asymmetric), asymmetricRequest, control());
  assertMatchesReference(asymmetricPools, asymmetricRequest, improved);
  assert.equal(success(improved).search.counters.finalAuthorizationReplays, 2);
  assert.equal(success(improved).search.counters.greedyOptionReplays, 8);

  const symmetric = snapshot(SPLIT_POOLS, 'greedy-tie');
  const tied = routeExactInputSplitAnytime(prepare(symmetric), request(symmetric), control());
  assert.deepEqual(success(tied).receipt.legs.map(({ allocation }) => allocation), [50n, 50n]);
  assert.equal(success(tied).search.counters.finalAuthorizationReplays, 1);
});

void test('reconstructs huge bigint inputs exactly without number coercion', () => {
  const unit = 10n ** 90n;
  const pools = [
    pool('left-ac', unit, unit),
    pool('right-ac', unit, 2n * unit),
  ];
  const value = snapshot(pools, 'huge-bigint');
  const runtimeRequest = request(value, { amountIn: 3n * unit + 2n, greedyParts: 3 });
  const result = routeExactInputSplitAnytime(prepare(value), runtimeRequest, control());
  assertMatchesReference(pools, runtimeRequest, result);
  const plan = success(result);
  assert.equal(plan.receipt.legs.reduce((sum, leg) => sum + leg.allocation, 0n), runtimeRequest.amountIn);
  assert.equal(typeof plan.receipt.amountIn, 'bigint');
  assert.equal(typeof plan.receipt.amountOut, 'bigint');
  for (const leg of plan.receipt.legs) assert.equal(typeof leg.allocation, 'bigint');
});

void test('uses raw UTF-16 route order and is invariant to input pool permutation', () => {
  const emoji = pool('😀-ac');
  const privateUse = pool('\uE000-ac');
  const forward = snapshot([privateUse, emoji], 'utf16-order');
  const reverse = snapshot([emoji, privateUse], 'utf16-order');
  assert.equal(forward.snapshotChecksum, reverse.snapshotChecksum);
  assert.equal(
    forward.snapshotChecksum,
    'sha256:b122efa9b969b119744869b3d1162b926ec628b4fc866aaa7a4146fb4b164892',
  );
  const caps = control({
    maxPathExpansions: 0,
    maxBestSingleCandidateReplays: 0,
    maxCandidateSetExpansions: 0,
    maxEqualProposalReplays: 0,
    maxGreedyOptionReplays: 0,
    maxFinalAuthorizationReplays: 0,
  });
  const left = routeExactInputSplitAnytime(prepare(forward), request(forward), caps);
  const right = routeExactInputSplitAnytime(prepare(reverse), request(reverse), caps);
  assert.deepEqual(right, left);
  assert.equal(success(left).receipt.legs[0]?.receipt.hops[0]?.poolId, '😀-ac');
});

void test('one captured context and one shared frontier match independent expansion ledgers without recharge', () => {
  const sourcePools = [pool('left-ac'), pool('right-ac')];
  const value = snapshot(sourcePools, 'captured-context');
  const context = prepare(value);
  (sourcePools[0] as { reserve1: bigint }).reserve1 = 1n;
  const result = routeExactInputSplitAnytime(context, request(value), control({
    maxBestSingleCandidateReplays: 1,
    maxEqualProposalReplays: 0,
  }));
  const plan = success(result);
  assert.equal(plan.receipt.amountOut, 66n);
  assert.equal(plan.search.counters.pathExpansions, 2);
  assert.equal(plan.search.counters.candidateSetExpansions, 3);
  assert.equal(plan.search.counters.bestSingleCandidateReplays, 1);
  assert.equal(plan.search.counters.directCandidateReplays, 2);
  assert.equal(plan.search.counters.greedyOptionReplays, 4);
  assert.equal(plan.search.counters.finalAuthorizationReplays, 1);
  assert.equal(plan.search.termination, 'work-limit');
});

void test('interrupts before every occurrence of every eligible unit with the pending unit unaccounted', () => {
  const value = snapshot(SPLIT_POOLS, 'interrupt-matrix');
  for (let target = 0; target < TRACE_BOUNDARIES.length; target += 1) {
    let checks = 0;
    const expected = TRACE_BOUNDARIES[target]!;
    const result = routeExactInputSplitAnytime(prepare(value), request(value), {
      workCaps: COMPLETE_CAPS,
      shouldInterrupt(checkpoint) {
        assertDeepFrozen(checkpoint);
        assert.deepEqual(checkpoint.counters, TRACE_BOUNDARIES[checks]!.counters);
        assert.equal(checkpoint.nextWorkKind, TRACE_BOUNDARIES[checks]!.kind);
        assert.equal(checkpoint.incumbent?.amountOut, TRACE_BOUNDARIES[checks]!.incumbentAmountOut);
        const stop = checks === target;
        checks += 1;
        return stop;
      },
    });
    assert.equal(resultTermination(result), 'interrupted');
    assert.deepEqual(resultCounters(result), expected.counters);
    assert.equal(resultIncumbentAmount(result), expected.incumbentAmountOut);
    assert.equal(resultCounters(result).directCandidateReplays, 2);
  }
});

void test('samples the deadline at every eligible boundary after the direct incumbent exists', () => {
  const value = snapshot(SPLIT_POOLS, 'deadline-matrix');
  for (let target = 0; target < TRACE_BOUNDARIES.length; target += 1) {
    let samples = 0;
    const expected = TRACE_BOUNDARIES[target]!;
    const result = routeExactInputSplitAnytime(prepare(value), request(value), {
      workCaps: COMPLETE_CAPS,
      deadline: {
        deadlineNanoseconds: BigInt(target),
        nowNanoseconds: () => BigInt(samples++),
      },
    });
    assert.equal(resultTermination(result), 'deadline');
    assert.deepEqual(resultCounters(result), expected.counters);
    assert.equal(resultIncumbentAmount(result), expected.incumbentAmountOut);
    assert.equal(resultCounters(result).directCandidateReplays, 2);
  }
});

void test('returns typed null-incumbent stops when no direct route exists', () => {
  const pools = [
    pool('ax', 100n, 100n, 'A', 'X'),
    pool('xc', 100n, 100n, 'X', 'C'),
  ];
  const value = snapshot(pools, 'null-incumbent-stop');
  const runtimeRequest = request(value, { maxHops: 2, maxRoutes: 1 });
  let checkpoint: ExactInputSplitRuntimeCheckpoint | undefined;
  const interrupted = routeExactInputSplitAnytime(prepare(value), runtimeRequest, {
    workCaps: COMPLETE_CAPS,
    shouldInterrupt(current) {
      checkpoint = current;
      return true;
    },
  });
  assert.equal(interrupted.status, 'no-plan');
  if (interrupted.status === 'no-plan') assert.equal(interrupted.reason, 'interrupted');
  assert.equal(checkpoint?.nextWorkKind, 'path-expansion');
  assert.equal(checkpoint?.incumbent, null);
  assert.deepEqual(resultCounters(interrupted), {
    ...ZERO_ADVANCED_COUNTERS,
    directCandidates: 0,
    directCandidateReplays: 0,
  });

  const deadline = routeExactInputSplitAnytime(prepare(value), runtimeRequest, {
    workCaps: COMPLETE_CAPS,
    deadline: { deadlineNanoseconds: 0n, nowNanoseconds: () => 0n },
  });
  assert.equal(deadline.status, 'no-plan');
  if (deadline.status === 'no-plan') assert.equal(deadline.reason, 'deadline');
  assert.deepEqual(resultCounters(deadline), resultCounters(interrupted));
});

void test('tests every independent cap from zero through natural exhaustion and stage continuation', () => {
  const value = snapshot(SPLIT_POOLS, 'cap-matrix');
  const cases = [
    { field: 'maxPathExpansions', counter: 'pathExpansions', natural: 2 },
    { field: 'maxBestSingleCandidateReplays', counter: 'bestSingleCandidateReplays', natural: 2 },
    { field: 'maxCandidateSetExpansions', counter: 'candidateSetExpansions', natural: 3 },
    { field: 'maxEqualProposalReplays', counter: 'equalProposalReplays', natural: 1 },
    { field: 'maxGreedyOptionReplays', counter: 'greedyOptionReplays', natural: 4 },
    { field: 'maxFinalAuthorizationReplays', counter: 'finalAuthorizationReplays', natural: 1 },
  ] as const;
  for (const capCase of cases) {
    for (let cap = 0; cap <= capCase.natural; cap += 1) {
      const result = routeExactInputSplitAnytime(
        prepare(value),
        request(value),
        control({ [capCase.field]: cap }),
      );
      assert.equal(resultCounters(result)[capCase.counter], cap);
      assert.equal(
        resultTermination(result),
        cap === capCase.natural ? 'complete' : 'work-limit',
        `${capCase.field}=${cap}`,
      );
      assert.equal(resultIncumbentAmount(result) !== null, true);
    }
  }

  const equalClosed = routeExactInputSplitAnytime(
    prepare(value),
    request(value),
    control({ maxEqualProposalReplays: 0 }),
  );
  assert.equal(success(equalClosed).search.counters.equalProposalReplays, 0);
  assert.equal(success(equalClosed).search.counters.greedyOptionReplays, 4);
  assert.equal(success(equalClosed).search.counters.finalAuthorizationReplays, 1);
  assert.equal(success(equalClosed).receipt.amountOut, 66n);

  const authorizationClosed = routeExactInputSplitAnytime(
    prepare(value),
    request(value),
    control({ maxFinalAuthorizationReplays: 0 }),
  );
  assert.equal(success(authorizationClosed).search.counters.equalProposalReplays, 1);
  assert.equal(success(authorizationClosed).search.counters.greedyOptionReplays, 4);
  assert.equal(success(authorizationClosed).receipt.amountOut, 50n);

  const pathPrefix = routeExactInputSplitAnytime(
    prepare(value),
    request(value),
    control({ maxPathExpansions: 1 }),
  );
  assert.equal(success(pathPrefix).search.counters.bestSingleCandidateReplays, 1);
  assert.equal(success(pathPrefix).search.counters.candidateSetExpansions, 0);

  const setPrefix = routeExactInputSplitAnytime(
    prepare(value),
    request(value),
    control({ maxCandidateSetExpansions: 2 }),
  );
  assert.equal(success(setPrefix).search.counters.equalProposalReplays, 1);
  assert.equal(success(setPrefix).search.counters.greedyOptionReplays, 4);
  assert.equal(success(setPrefix).receipt.amountOut, 66n);
  assert.deepEqual(
    routeExactInputSplitAnytime(
      prepare(value),
      request(value),
      control({ maxCandidateSetExpansions: 2 }),
    ),
    setPrefix,
  );
});

void test('increasing heterogeneous caps is monotonic under the complete split objective', () => {
  const value = snapshot(SPLIT_POOLS, 'monotonic-caps');
  const observed: ReferencePlan[] = [];
  for (const cap of [0, 1, 2, 3, 4]) {
    const result = routeExactInputSplitAnytime(prepare(value), request(value), {
      workCaps: {
        maxPathExpansions: cap,
        maxBestSingleCandidateReplays: cap,
        maxCandidateSetExpansions: cap,
        maxEqualProposalReplays: cap,
        maxGreedyOptionReplays: cap,
        maxFinalAuthorizationReplays: cap,
      },
    });
    const receipt = success(result).receipt;
    observed.push({
      amountOut: receipt.amountOut,
      legs: receipt.legs.map((leg) => ({
        allocation: leg.allocation,
        route: leg.receipt.hops.map(({ assetIn, poolId, assetOut }) => ({ assetIn, poolId, assetOut })),
        amountOut: leg.receipt.amountOut,
      })),
    });
  }
  assert.deepEqual(observed.map(({ amountOut }) => amountOut), [50n, 50n, 66n, 66n, 66n]);
  for (let index = 1; index < observed.length; index += 1) {
    assert.ok(comparePlan(observed[index]!, observed[index - 1]!) <= 0);
  }
});

void test('best-single authorizes directly; equal and greedy scoring receipts never authorize', () => {
  const pools = [pool('left-ac', 50n, 50n), pool('right-ac', 50n, 100n)];
  const value = snapshot(pools, 'authorization-separation');
  const runtimeRequest = request(value, { greedyParts: 4 });

  let finalOccurrences = 0;
  const beforeEqualAuthorization = routeExactInputSplitAnytime(prepare(value), runtimeRequest, {
    workCaps: COMPLETE_CAPS,
    shouldInterrupt(checkpoint) {
      if (checkpoint.nextWorkKind !== 'final-authorization-replay') return false;
      finalOccurrences += 1;
      return finalOccurrences === 1;
    },
  });
  assert.equal(success(beforeEqualAuthorization).receipt.amountOut, 66n);
  assert.equal(success(beforeEqualAuthorization).search.counters.equalProposalReplays, 1);
  assert.equal(success(beforeEqualAuthorization).search.counters.finalAuthorizationReplays, 0);

  finalOccurrences = 0;
  const beforeGreedyAuthorization = routeExactInputSplitAnytime(prepare(value), runtimeRequest, {
    workCaps: COMPLETE_CAPS,
    shouldInterrupt(checkpoint) {
      if (checkpoint.nextWorkKind !== 'final-authorization-replay') return false;
      finalOccurrences += 1;
      return finalOccurrences === 2;
    },
  });
  assert.equal(success(beforeGreedyAuthorization).receipt.amountOut, 75n);
  assert.equal(success(beforeGreedyAuthorization).search.counters.greedyOptionReplays, 8);
  assert.equal(success(beforeGreedyAuthorization).search.counters.finalAuthorizationReplays, 1);

  const oneAuthorization = routeExactInputSplitAnytime(
    prepare(value),
    runtimeRequest,
    control({ maxFinalAuthorizationReplays: 1 }),
  );
  assert.equal(success(oneAuthorization).receipt.amountOut, 75n);
  assert.equal(success(oneAuthorization).search.termination, 'work-limit');
  const twoAuthorizations = routeExactInputSplitAnytime(
    prepare(value),
    runtimeRequest,
    control({ maxFinalAuthorizationReplays: 2 }),
  );
  assert.equal(success(twoAuthorizations).receipt.amountOut, 76n);
  assert.equal(success(twoAuthorizations).search.termination, 'complete');

  for (const [cap, amountOut, termination] of [
    [0, 66n, 'work-limit'],
    [1, 75n, 'work-limit'],
    [2, 76n, 'complete'],
  ] as const) {
    const capped = routeExactInputSplitAnytime(
      prepare(value),
      runtimeRequest,
      control({ maxFinalAuthorizationReplays: cap }),
    );
    assert.equal(success(capped).receipt.amountOut, amountOut);
    assert.equal(success(capped).search.termination, termination);
    assert.equal(success(capped).search.counters.finalAuthorizationReplays, cap);
  }

  let samples = 0;
  const beforeSecondAuthorization = routeExactInputSplitAnytime(prepare(value), runtimeRequest, {
    workCaps: COMPLETE_CAPS,
    deadline: {
      deadlineNanoseconds: 17n,
      nowNanoseconds: () => BigInt(samples++),
    },
  });
  assert.equal(success(beforeSecondAuthorization).search.termination, 'deadline');
  assert.equal(success(beforeSecondAuthorization).receipt.amountOut, 75n);
  assert.equal(success(beforeSecondAuthorization).search.counters.greedyOptionReplays, 8);
  assert.equal(success(beforeSecondAuthorization).search.counters.finalAuthorizationReplays, 1);
});

void test('classifies callback failures and keeps frozen pre-unit state unchanged', () => {
  const value = snapshot(SPLIT_POOLS, 'callback-errors');
  const failures = [
    () => { throw new Error('oracle callback failure'); },
    (() => 'not-boolean') as unknown as () => boolean,
  ];
  for (const shouldInterrupt of failures) {
    const result = routeExactInputSplitAnytime(prepare(value), request(value), {
      workCaps: COMPLETE_CAPS,
      shouldInterrupt,
    });
    assert.equal(result.status, 'control-error');
    assert.deepEqual(resultCounters(result), TRACE_BOUNDARIES[0]!.counters);
    assert.equal(resultIncumbentAmount(result), 50n);
    assertDeepFrozen(result);
  }

  let calls = 0;
  const later = routeExactInputSplitAnytime(prepare(value), request(value), {
    workCaps: COMPLETE_CAPS,
    shouldInterrupt() {
      calls += 1;
      if (calls === 2) throw new Error('later failure');
      return false;
    },
  });
  assert.equal(later.status, 'control-error');
  assert.deepEqual(resultCounters(later), TRACE_BOUNDARIES[1]!.counters);
  assert.equal(resultIncumbentAmount(later), 50n);
});

void test('classifies throwing, non-bigint, negative, and regressing clocks without charging pending work', () => {
  const value = snapshot(SPLIT_POOLS, 'clock-errors');
  const invalidClocks: readonly (() => unknown)[] = [
    () => { throw new Error('clock failed'); },
    () => 0,
    () => -1n,
  ];
  for (const invalidClock of invalidClocks) {
    const result = routeExactInputSplitAnytime(prepare(value), request(value), {
      workCaps: COMPLETE_CAPS,
      deadline: {
        deadlineNanoseconds: 100n,
        nowNanoseconds: invalidClock as () => bigint,
      },
    });
    assert.equal(result.status, 'deadline-error');
    assert.deepEqual(resultCounters(result), TRACE_BOUNDARIES[0]!.counters);
    assert.equal(resultIncumbentAmount(result), 50n);
  }

  const samples = [2n, 1n];
  const regression = routeExactInputSplitAnytime(prepare(value), request(value), {
    workCaps: COMPLETE_CAPS,
    deadline: { deadlineNanoseconds: 100n, nowNanoseconds: () => samples.shift()! },
  });
  assert.equal(regression.status, 'deadline-error');
  if (regression.status === 'deadline-error') {
    assert.equal(regression.error.code, 'deadline-clock-regressed');
  }
  assert.deepEqual(resultCounters(regression), TRACE_BOUNDARIES[1]!.counters);
  assert.equal(resultIncumbentAmount(regression), 50n);
});

void test('gives callback priority over clock and does not observe controls behind a zero cap', () => {
  const value = snapshot(SPLIT_POOLS, 'control-priority');
  let clocks = 0;
  const interrupted = routeExactInputSplitAnytime(prepare(value), request(value), {
    workCaps: COMPLETE_CAPS,
    shouldInterrupt: () => true,
    deadline: {
      deadlineNanoseconds: 0n,
      nowNanoseconds: () => { clocks += 1; return 0n; },
    },
  });
  assert.equal(resultTermination(interrupted), 'interrupted');
  assert.equal(clocks, 0);

  let callbacks = 0;
  const capped = routeExactInputSplitAnytime(prepare(value), request(value), {
    workCaps: { ...COMPLETE_CAPS, maxPathExpansions: 0 },
    shouldInterrupt: () => { callbacks += 1; return true; },
    deadline: {
      deadlineNanoseconds: 0n,
      nowNanoseconds: () => { clocks += 1; return 0n; },
    },
  });
  assert.equal(success(capped).search.termination, 'work-limit');
  assert.equal(callbacks, 0);
  assert.equal(clocks, 0);
});

void test('captures request/control once, validates exact types, identity, checksum, and context capability', () => {
  const value = snapshot(SPLIT_POOLS, 'capture-validation');
  const context = prepare(value);
  const reads = new Map<string, number>();
  const read = <T>(name: string, result: T): T => {
    reads.set(name, (reads.get(name) ?? 0) + 1);
    return result;
  };
  const baseRequest = request(value);
  const requestFields = [
    'snapshotId', 'snapshotChecksum', 'assetIn', 'assetOut',
    'amountIn', 'maxHops', 'maxRoutes', 'greedyParts',
  ] as const;
  const requestSource = Object.defineProperties({}, Object.fromEntries(
    requestFields.map((field) => [field, { get: () => read(`request.${field}`, baseRequest[field]) }]),
  )) as ExactInputSplitRuntimeRequest;
  const capFields = [
    'maxPathExpansions', 'maxBestSingleCandidateReplays', 'maxCandidateSetExpansions',
    'maxEqualProposalReplays', 'maxGreedyOptionReplays', 'maxFinalAuthorizationReplays',
  ] as const;
  const capsSource = Object.defineProperties({}, Object.fromEntries(
    capFields.map((field) => [field, { get: () => read(`caps.${field}`, COMPLETE_CAPS[field]) }]),
  )) as ExactInputSplitWorkCaps;
  const controlSource = Object.defineProperties({}, {
    workCaps: { get: () => read('control.workCaps', capsSource) },
    shouldInterrupt: { get: () => read('control.shouldInterrupt', undefined) },
    deadline: { get: () => read('control.deadline', undefined) },
  }) as ExactInputSplitRuntimeControl;
  assert.equal(routeExactInputSplitAnytime(context, requestSource, controlSource).status, 'success');
  for (const [field, count] of reads) assert.equal(count, 1, field);

  const badAmount = routeExactInputSplitAnytime(
    context,
    { ...baseRequest, amountIn: 100 as unknown as bigint },
    control(),
  );
  assert.deepEqual(badAmount, {
    status: 'invalid-request',
    error: { code: 'nonpositive-input', field: 'amountIn' },
  });
  const badCap = routeExactInputSplitAnytime(context, baseRequest, {
    workCaps: { ...COMPLETE_CAPS, maxPathExpansions: 1n as unknown as number },
  });
  assert.equal(badCap.status, 'invalid-control');
  const badDeadline = routeExactInputSplitAnytime(context, baseRequest, {
    workCaps: COMPLETE_CAPS,
    deadline: { deadlineNanoseconds: 1 as unknown as bigint, nowNanoseconds: () => 0n },
  });
  assert.equal(badDeadline.status, 'invalid-control');

  const wrongIdentity = routeExactInputSplitAnytime(
    context,
    { ...baseRequest, snapshotChecksum: `${baseRequest.snapshotChecksum}-forged` },
    control(),
  );
  assert.deepEqual(wrongIdentity, {
    status: 'invalid-request',
    error: { code: 'snapshot-identity-mismatch', field: 'snapshotIdentity' },
  });
  const forged = routeExactInputSplitAnytime(
    Object.freeze({}) as PreparedRoutingContext,
    baseRequest,
    control(),
  );
  assert.deepEqual(forged, {
    status: 'invalid-request',
    error: { code: 'snapshot-identity-mismatch', field: 'snapshotIdentity' },
  });

  const checksumMismatch: LiquiditySnapshot = { ...value, snapshotChecksum: 'sha256:forged' };
  const preparation = prepareRoutingContext(checksumMismatch);
  assert.equal(preparation.ok, false);
  if (!preparation.ok) {
    assert.equal(preparation.error.actual, 'sha256:forged');
    assert.equal(preparation.error.expected, value.snapshotChecksum);
  }
});
