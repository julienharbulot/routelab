import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../../src/domain/index.ts';
import {
  resumeExactInputSinglePath,
  routeExactInputSinglePath,
  routeExactInputSinglePathInterruptible,
  routeExactInputSinglePathResumable,
  routeExactInputSinglePathWithDeadline,
  type ExactInputSinglePathResumableCheckpoint,
  type ExactInputSinglePathResumableResult,
  type ExactInputSinglePathRouterRequest,
} from '../../src/router/single-path/index.ts';

interface Edge {
  readonly assetIn: string;
  readonly poolId: string;
  readonly assetOut: string;
}

interface Hop extends Edge {
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly reserveInBefore: bigint;
  readonly reserveOutBefore: bigint;
  readonly reserveInAfter: bigint;
  readonly reserveOutAfter: bigint;
}

interface Receipt {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly hops: readonly Hop[];
}

interface Establishment {
  readonly enumeratedCandidates: number;
  readonly replayedCandidates: number;
  readonly rejectedCandidates: number;
}

interface Boundary {
  readonly expansions: number;
  readonly enumeratedCandidates: number;
  readonly replayedCandidates: number;
  readonly rejectedCandidates: number;
  readonly incumbent: Receipt | null;
}

interface Trace {
  readonly establishment: Establishment;
  readonly boundaries: readonly Boundary[];
  readonly totalExpansions: number;
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

function snapshot(
  pools: readonly ConstantProductPool[],
  snapshotId = 'immediate-oracle',
  snapshotChecksum = 'immediate-oracle-checksum',
): LiquiditySnapshot {
  return { snapshotId, snapshotChecksum, pools };
}

function request(
  value: LiquiditySnapshot,
  overrides: Partial<ExactInputSinglePathRouterRequest> = {},
): ExactInputSinglePathRouterRequest {
  return {
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 100n,
    maxHops: 2,
    maxExpansions: 0,
    ...overrides,
  };
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareEdges(left: Edge, right: Edge): number {
  return (
    compareText(left.assetIn, right.assetIn) ||
    compareText(left.poolId, right.poolId) ||
    compareText(left.assetOut, right.assetOut)
  );
}

function compareReceipts(left: Receipt, right: Receipt): number {
  if (left.amountOut > right.amountOut) return -1;
  if (left.amountOut < right.amountOut) return 1;
  if (left.hops.length !== right.hops.length) return left.hops.length - right.hops.length;
  for (let index = 0; index < left.hops.length; index += 1) {
    const leftHop = left.hops[index];
    const rightHop = right.hops[index];
    assert.ok(leftHop !== undefined && rightHop !== undefined);
    const comparison = compareEdges(leftHop, rightHop);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function directionalEdges(value: LiquiditySnapshot): readonly Edge[] {
  const edges = value.pools.flatMap((entry) => [
    { assetIn: entry.asset0, poolId: entry.poolId, assetOut: entry.asset1 },
    { assetIn: entry.asset1, poolId: entry.poolId, assetOut: entry.asset0 },
  ]);
  edges.sort(compareEdges);
  return edges;
}

function replay(
  value: LiquiditySnapshot,
  routingRequest: ExactInputSinglePathRouterRequest,
  route: readonly Edge[],
): Receipt | undefined {
  const states = new Map(value.pools.map((entry) => [entry.poolId, { ...entry }]));
  const hops: Hop[] = [];
  let currentAmount = routingRequest.amountIn;

  for (const edge of route) {
    const state = states.get(edge.poolId);
    assert.ok(state !== undefined);
    const forward = state.asset0 === edge.assetIn && state.asset1 === edge.assetOut;
    const reverse = state.asset1 === edge.assetIn && state.asset0 === edge.assetOut;
    assert.equal(forward || reverse, true);
    const reserveIn = forward ? state.reserve0 : state.reserve1;
    const reserveOut = forward ? state.reserve1 : state.reserve0;
    const retained = state.feeDenominator - state.feeChargedNumerator;
    const amountOut =
      (currentAmount * retained * reserveOut) /
      (reserveIn * state.feeDenominator + currentAmount * retained);
    if (currentAmount > 0n && amountOut === 0n) return undefined;
    const reserveInAfter = reserveIn + currentAmount;
    const reserveOutAfter = reserveOut - amountOut;
    states.set(edge.poolId, {
      ...state,
      reserve0: forward ? reserveInAfter : reserveOutAfter,
      reserve1: forward ? reserveOutAfter : reserveInAfter,
    });
    hops.push({
      ...edge,
      amountIn: currentAmount,
      amountOut,
      reserveInBefore: reserveIn,
      reserveOutBefore: reserveOut,
      reserveInAfter,
      reserveOutAfter,
    });
    currentAmount = amountOut;
  }

  return {
    snapshotId: routingRequest.snapshotId,
    snapshotChecksum: routingRequest.snapshotChecksum,
    assetIn: routingRequest.assetIn,
    assetOut: routingRequest.assetOut,
    amountIn: routingRequest.amountIn,
    amountOut: currentAmount,
    hops,
  };
}

function establish(
  value: LiquiditySnapshot,
  routingRequest: ExactInputSinglePathRouterRequest,
): { readonly summary: Establishment; readonly incumbent: Receipt | undefined } {
  const candidates = directionalEdges(value).filter(
    (edge) =>
      edge.assetIn === routingRequest.assetIn &&
      edge.assetOut === routingRequest.assetOut,
  );
  let rejectedCandidates = 0;
  let incumbent: Receipt | undefined;
  for (const candidate of candidates) {
    const receipt = replay(value, routingRequest, [candidate]);
    if (receipt === undefined) rejectedCandidates += 1;
    else if (incumbent === undefined || compareReceipts(receipt, incumbent) < 0) {
      incumbent = receipt;
    }
  }
  return {
    summary: {
      enumeratedCandidates: candidates.length,
      replayedCandidates: candidates.length,
      rejectedCandidates,
    },
    incumbent,
  };
}

function trace(
  value: LiquiditySnapshot,
  routingRequest: ExactInputSinglePathRouterRequest,
): Trace {
  const adjacency = new Map<string, Edge[]>();
  for (const edge of directionalEdges(value)) {
    adjacency.set(edge.assetIn, [...(adjacency.get(edge.assetIn) ?? []), edge]);
  }
  const baseline = establish(value, routingRequest);
  let incumbent = baseline.incumbent;
  let expansions = 0;
  let enumeratedCandidates = 0;
  let replayedCandidates = 0;
  let rejectedCandidates = 0;
  const boundaries: Boundary[] = [];
  const capture = (): void => {
    boundaries.push({
      expansions,
      enumeratedCandidates,
      replayedCandidates,
      rejectedCandidates,
      incumbent: incumbent ?? null,
    });
  };
  capture();

  const visit = (
    currentAsset: string,
    route: readonly Edge[],
    seenAssets: ReadonlySet<string>,
    seenPools: ReadonlySet<string>,
  ): void => {
    if (route.length >= routingRequest.maxHops) return;
    for (const edge of adjacency.get(currentAsset) ?? []) {
      expansions += 1;
      if (seenPools.has(edge.poolId) || seenAssets.has(edge.assetOut)) {
        capture();
        continue;
      }
      const nextRoute = [...route, edge];
      if (edge.assetOut === routingRequest.assetOut) {
        enumeratedCandidates += 1;
        replayedCandidates += 1;
        const receipt = replay(value, routingRequest, nextRoute);
        if (receipt === undefined) rejectedCandidates += 1;
        else if (incumbent === undefined || compareReceipts(receipt, incumbent) < 0) {
          incumbent = receipt;
        }
        capture();
        continue;
      }
      capture();
      if (nextRoute.length < routingRequest.maxHops) {
        visit(
          edge.assetOut,
          nextRoute,
          new Set([...seenAssets, edge.assetOut]),
          new Set([...seenPools, edge.poolId]),
        );
      }
    }
  };
  visit(routingRequest.assetIn, [], new Set([routingRequest.assetIn]), new Set());
  assert.equal(boundaries.length, expansions + 1);
  return { establishment: baseline.summary, boundaries, totalExpansions: expansions };
}

function expectedSearch(
  oracleTrace: Trace,
  expansion: number,
  termination: 'complete' | 'work-limit' | 'interrupted' | 'deadline',
): Record<string, unknown> {
  const boundary = oracleTrace.boundaries[expansion];
  assert.ok(boundary !== undefined);
  return {
    establishment: oracleTrace.establishment,
    expansions: boundary.expansions,
    enumeratedCandidates: boundary.enumeratedCandidates,
    replayedCandidates: boundary.replayedCandidates,
    rejectedCandidates: boundary.rejectedCandidates,
    termination,
  };
}

function checkpointFrom(
  result: ExactInputSinglePathResumableResult,
): ExactInputSinglePathResumableCheckpoint {
  if (!('checkpoint' in result) || result.checkpoint === null) {
    throw new Error('oracle scenario requires a resumable checkpoint');
  }
  return result.checkpoint;
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) assertDeepFrozen(Reflect.get(value, key), seen);
}

function permutations<T>(values: readonly T[]): readonly (readonly T[])[] {
  if (values.length === 0) return [[]];
  const result: T[][] = [];
  for (const [index, selected] of values.entries()) {
    const remaining = [...values.slice(0, index), ...values.slice(index + 1)];
    for (const suffix of permutations(remaining)) result.push([selected, ...suffix]);
  }
  return result;
}

function progressionGraph(): LiquiditySnapshot {
  return snapshot([
    pool('a-direct-ac', 'A', 1_000n, 'C', 1_000n),
    pool('b-hop-ab', 'A', 1_000n, 'B', 2_000n),
    pool('c-hop-bc', 'B', 2_000n, 'C', 2_000n),
  ]);
}

void test('independently enumerates and exact-replays every canonical direct edge', () => {
  const pools = [
    pool('\ue000', 'A', 1n, 'C', 2n),
    pool('\u{1f600}', 'C', 2n, 'A', 1n),
    pool('m-zero', 'A', 1_000n, 'C', 1n),
    pool('extra-ab', 'A', 1_000n, 'B', 1_000n),
  ];
  for (const ordered of permutations(pools)) {
    const value = snapshot(ordered);
    const routingRequest = request(value, { amountIn: 1n, maxHops: 1 });
    const oracle = establish(value, routingRequest);
    assert.deepEqual(oracle.summary, {
      enumeratedCandidates: 3,
      replayedCandidates: 3,
      rejectedCandidates: 1,
    });
    assert.equal(oracle.incumbent?.hops[0]?.poolId, '\u{1f600}');

    const actual = routeExactInputSinglePathInterruptible(
      value,
      routingRequest,
      { shouldInterrupt: () => false },
    );
    assert.equal(actual.status, 'success');
    if (actual.status !== 'success') continue;
    assert.deepEqual(actual.plan.receipt, oracle.incumbent);
    assert.deepEqual(actual.plan.search, {
      establishment: oracle.summary,
      expansions: 0,
      enumeratedCandidates: 0,
      replayedCandidates: 0,
      rejectedCandidates: 0,
      termination: 'work-limit',
    });
    assertDeepFrozen(actual);
  }
});

void test('uses output, fewer-hop, and raw-route order with huge exact values', () => {
  const fewerHop = snapshot([
    pool('a-ab', 'A', 100n, 'B', 200n),
    pool('b-bc', 'B', 100n, 'C', 100n),
    pool('z-direct', 'A', 100n, 'C', 100n),
  ]);
  const fewerRequest = request(fewerHop, { maxExpansions: 1_000 });
  const fewerTrace = trace(fewerHop, fewerRequest);
  const fewer = routeExactInputSinglePathResumable(
    fewerHop,
    fewerRequest,
    { shouldInterrupt: () => false },
  );
  assert.equal(fewer.status, 'success');
  if (fewer.status === 'success') {
    assert.deepEqual(fewer.plan.receipt, fewerTrace.boundaries.at(-1)?.incumbent);
    assert.equal(fewer.plan.receipt.amountOut, 50n);
    assert.deepEqual(fewer.plan.receipt.hops.map(({ poolId }) => poolId), ['z-direct']);
  }

  const huge = 10n ** 100n;
  const hugeValue = snapshot([
    pool('a-lower', 'A', huge, 'C', 2n * huge),
    pool('z-higher', 'A', huge, 'C', 2n * huge + 2n),
  ]);
  const hugeRequest = request(hugeValue, {
    amountIn: huge,
    maxHops: 1,
  });
  const oracle = establish(hugeValue, hugeRequest);
  const hugeResult = routeExactInputSinglePathInterruptible(
    hugeValue,
    hugeRequest,
    { shouldInterrupt: () => false },
  );
  assert.equal(hugeResult.status, 'success');
  if (hugeResult.status === 'success') {
    assert.deepEqual(hugeResult.plan.receipt, oracle.incumbent);
    assert.equal(hugeResult.plan.receipt.amountOut, huge + 1n);
    assert.equal(hugeResult.plan.receipt.hops[0]?.poolId, 'z-higher');
  }
});

void test('separates establishment from search and preserves typed no-plan without a baseline', () => {
  const value = progressionGraph();
  const oracleTrace = trace(value, request(value, { maxExpansions: 1_000 }));
  const zero = routeExactInputSinglePathResumable(
    value,
    request(value),
    { shouldInterrupt: () => false },
  );
  assert.equal(zero.status, 'success');
  if (zero.status === 'success') {
    assert.deepEqual(zero.plan.receipt, oracleTrace.boundaries[0]?.incumbent);
    assert.deepEqual(zero.plan.search, expectedSearch(oracleTrace, 0, 'work-limit'));
    assert.equal(zero.checkpoint?.enumeratedCandidates, 0);
    assert.deepEqual(zero.checkpoint?.establishment, {
      enumeratedCandidates: 1,
      replayedCandidates: 1,
      rejectedCandidates: 0,
    });
  }

  const disconnected = snapshot([
    pool('component-ab', 'A', 1_000n, 'B', 1_000n),
    pool('component-cd', 'C', 1_000n, 'D', 1_000n),
  ]);
  const absent = routeExactInputSinglePathResumable(
    disconnected,
    request(disconnected, { assetOut: 'D' }),
    { shouldInterrupt: () => false },
  );
  assert.equal(absent.status, 'no-plan');
  if (absent.status === 'no-plan') {
    assert.equal(absent.reason, 'work-limit');
    assert.deepEqual(absent.search.establishment, {
      enumeratedCandidates: 0,
      replayedCandidates: 0,
      rejectedCandidates: 0,
    });
  }

  const rejectedValue = snapshot([pool('zero-ac', 'A', 1_000n, 'C', 1n)]);
  const rejected = routeExactInputSinglePathResumable(
    rejectedValue,
    request(rejectedValue, { amountIn: 1n, maxHops: 1 }),
    { shouldInterrupt: () => false },
  );
  assert.equal(rejected.status, 'no-plan');
  if (rejected.status === 'no-plan') {
    assert.deepEqual(rejected.search.establishment, {
      enumeratedCandidates: 1,
      replayedCandidates: 1,
      rejectedCandidates: 1,
    });
    assert.equal(rejected.checkpoint.incumbent, null);
  }
});

void test('matches independent one-shot and cumulative traces with monotonic full objectives', () => {
  const value = progressionGraph();
  const baseRequest = request(value, { maxExpansions: 1_000 });
  const oracleTrace = trace(value, baseRequest);
  assert.equal(oracleTrace.totalExpansions, 4);

  let cumulative = routeExactInputSinglePathResumable(
    value,
    { ...baseRequest, maxExpansions: 0 },
    { shouldInterrupt: () => false },
  );
  let previous: Receipt | undefined;
  for (let cap = 0; cap <= oracleTrace.totalExpansions; cap += 1) {
    if (cap > 0) {
      cumulative = resumeExactInputSinglePath(
        checkpointFrom(cumulative),
        cap,
        { shouldInterrupt: () => false },
      );
    }
    const oneShot = routeExactInputSinglePathResumable(
      value,
      { ...baseRequest, maxExpansions: cap },
      { shouldInterrupt: () => false },
    );
    assert.deepEqual(cumulative, oneShot);
    assert.equal(oneShot.status, 'success');
    if (oneShot.status !== 'success') continue;
    const termination: 'complete' | 'work-limit' =
      cap === oracleTrace.totalExpansions ? 'complete' : 'work-limit';
    assert.deepEqual(oneShot.plan.search, expectedSearch(oracleTrace, cap, termination));
    assert.deepEqual(oneShot.plan.receipt, oracleTrace.boundaries[cap]?.incumbent);
    if (previous !== undefined) assert.ok(compareReceipts(oneShot.plan.receipt, previous) <= 0);
    previous = oneShot.plan.receipt;
  }
  assert.equal(previous?.amountOut, 165n);
});

void test('reuses checkpoint branches without repeating or cross-mutating establishment', () => {
  const value = progressionGraph();
  const initial = routeExactInputSinglePathResumable(
    value,
    request(value),
    { shouldInterrupt: () => false },
  );
  const source = checkpointFrom(initial);
  const sourceBefore = structuredClone(source);
  const atOne = resumeExactInputSinglePath(source, 1, { shouldInterrupt: () => false });
  const atThree = resumeExactInputSinglePath(source, 3, { shouldInterrupt: () => false });
  const repeatThree = resumeExactInputSinglePath(source, 3, { shouldInterrupt: () => false });
  assert.deepEqual(atThree, repeatThree);
  assert.deepEqual(source, sourceBefore);
  assert.notEqual(checkpointFrom(atOne), source);
  assert.equal(checkpointFrom(atOne).establishment, source.establishment);
  assert.equal(checkpointFrom(atThree).establishment, source.establishment);
  assertDeepFrozen(source);
  assertDeepFrozen(atThree);
});

void test('establishes before an expired deadline and excludes timing from checkpoint state', () => {
  const value = progressionGraph();
  const routingRequest = request(value, { maxExpansions: 100 });
  const oracleTrace = trace(value, routingRequest);
  const expired = routeExactInputSinglePathWithDeadline(value, routingRequest, {
    deadlineNanoseconds: 50n,
    nowNanoseconds: () => 50n,
  });
  assert.equal(expired.status, 'success');
  if (expired.status === 'success') {
    assert.deepEqual(expired.plan.receipt, oracleTrace.boundaries[0]?.incumbent);
    assert.deepEqual(expired.plan.search, expectedSearch(oracleTrace, 0, 'deadline'));
  }

  const deadlineAtOne = (deadline: bigint) =>
    routeExactInputSinglePathWithDeadline(value, routingRequest, {
      deadlineNanoseconds: deadline,
      nowNanoseconds: (() => {
        const samples = [deadline - 1n, deadline];
        return () => samples.shift() ?? deadline;
      })(),
    });
  const earlyEpoch = deadlineAtOne(10n);
  const hugeEpoch = deadlineAtOne(10n ** 100n);
  assert.deepEqual(earlyEpoch, hugeEpoch);
  assert.equal(earlyEpoch.status, 'success');
  if (earlyEpoch.status === 'success' && earlyEpoch.checkpoint !== null) {
    assert.deepEqual(earlyEpoch.plan.search, expectedSearch(oracleTrace, 1, 'deadline'));
    assert.equal('deadlineNanoseconds' in earlyEpoch.checkpoint, false);
    assert.equal('nowNanoseconds' in earlyEpoch.checkpoint, false);
    assert.equal('previousSample' in earlyEpoch.checkpoint, false);
  }
});

void test('captures inputs before callbacks and deep-freezes the authorized baseline', () => {
  const value = progressionGraph();
  const routingRequest = request(value, { maxExpansions: 100 });
  const expectedValue = structuredClone(value);
  const expectedRequest = structuredClone(routingRequest);
  const expected = establish(expectedValue, expectedRequest).incumbent;
  const actual = routeExactInputSinglePathInterruptible(value, routingRequest, {
    shouldInterrupt(checkpoint) {
      (value.pools as ConstantProductPool[]).splice(0);
      (routingRequest as { amountIn: bigint }).amountIn = 1n;
      assert.deepEqual(checkpoint.incumbent, expected);
      assertDeepFrozen(checkpoint);
      return true;
    },
  });
  assert.equal(actual.status, 'success');
  if (actual.status === 'success') {
    assert.deepEqual(actual.plan.receipt, expected);
    assert.equal(actual.plan.search.termination, 'interrupted');
  }
  assertDeepFrozen(actual);
});

void test('leaves noninterruptible zero-work semantics and public search shape unchanged', () => {
  const value = progressionGraph();
  const legacy = routeExactInputSinglePath(value, request(value));
  assert.deepEqual(legacy, {
    status: 'no-plan',
    reason: 'work-limit',
    search: {
      expansions: 0,
      enumeratedCandidates: 0,
      replayedCandidates: 0,
      rejectedCandidates: 0,
      termination: 'work-limit',
    },
  });
  assert.equal('establishment' in legacy.search, false);

  const anytime = routeExactInputSinglePathInterruptible(
    value,
    request(value),
    { shouldInterrupt: () => false },
  );
  assert.equal(anytime.status, 'success');
});
