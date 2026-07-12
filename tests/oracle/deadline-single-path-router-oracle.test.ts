import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../../src/domain/index.ts';
import {
  resumeExactInputSinglePath,
  resumeExactInputSinglePathWithDeadline,
  routeExactInputSinglePath,
  routeExactInputSinglePathInterruptible,
  routeExactInputSinglePathResumable,
  routeExactInputSinglePathWithDeadline,
  type ExactInputSinglePathDeadlineControl,
  type ExactInputSinglePathDeadlineResult,
  type ExactInputSinglePathResumableCheckpoint,
  type ExactInputSinglePathResumableResult,
  type ExactInputSinglePathRouterRequest,
} from '../../src/router/single-path/index.ts';
import { parseAndVerifyCanonicalSinglePathRouterCase } from '../../src/serialization/canonical-router-case/index.ts';

interface Edge {
  readonly assetIn: string;
  readonly poolId: string;
  readonly assetOut: string;
}

interface HopReceipt extends Edge {
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
  readonly hops: readonly HopReceipt[];
}

interface Boundary {
  readonly establishment: Establishment;
  readonly expansions: number;
  readonly enumeratedCandidates: number;
  readonly replayedCandidates: number;
  readonly rejectedCandidates: number;
  readonly incumbent: Receipt | null;
}

interface Establishment {
  readonly enumeratedCandidates: number;
  readonly replayedCandidates: number;
  readonly rejectedCandidates: number;
}

interface Trace {
  readonly boundaries: readonly Boundary[];
  readonly totalExpansions: number;
}

interface Search {
  readonly establishment: Establishment;
  readonly expansions: number;
  readonly enumeratedCandidates: number;
  readonly replayedCandidates: number;
  readonly rejectedCandidates: number;
  readonly termination: 'complete' | 'work-limit' | 'deadline';
}

type Outcome =
  | { readonly status: 'success'; readonly receipt: Receipt; readonly search: Search }
  | {
      readonly status: 'no-route';
      readonly reason: 'no-candidate' | 'all-candidates-rejected';
      readonly search: Search;
    }
  | {
      readonly status: 'no-plan';
      readonly reason: 'work-limit' | 'deadline';
      readonly search: Search;
    };

const FIXTURE_DIRECTORY = fileURLToPath(
  new URL('../../fixtures/m3/router-cases/', import.meta.url),
);

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
    snapshotId: 'deadline-oracle',
    snapshotChecksum: 'deadline-oracle-checksum',
    pools,
  };
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
    maxExpansions: 1_000,
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

function replay(
  value: LiquiditySnapshot,
  routingRequest: ExactInputSinglePathRouterRequest,
  path: readonly Edge[],
): Receipt | undefined {
  const states = new Map(value.pools.map((entry) => [entry.poolId, { ...entry }]));
  const hops: HopReceipt[] = [];
  let currentAmount = routingRequest.amountIn;
  for (const edge of path) {
    const state = states.get(edge.poolId);
    assert.ok(state !== undefined);
    const forward = state.asset0 === edge.assetIn && state.asset1 === edge.assetOut;
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

function establishDirect(
  value: LiquiditySnapshot,
  routingRequest: ExactInputSinglePathRouterRequest,
): { readonly summary: Establishment; readonly incumbent: Receipt | undefined } {
  const candidates: Edge[] = [];
  for (const entry of value.pools) {
    if (entry.asset0 === routingRequest.assetIn && entry.asset1 === routingRequest.assetOut) {
      candidates.push({ assetIn: entry.asset0, poolId: entry.poolId, assetOut: entry.asset1 });
    }
    if (entry.asset1 === routingRequest.assetIn && entry.asset0 === routingRequest.assetOut) {
      candidates.push({ assetIn: entry.asset1, poolId: entry.poolId, assetOut: entry.asset0 });
    }
  }
  candidates.sort(compareEdges);
  let incumbent: Receipt | undefined;
  let rejectedCandidates = 0;
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
  withEstablishment = true,
): Trace {
  const adjacency = new Map<string, Edge[]>();
  for (const entry of value.pools) {
    const forward: Edge = {
      assetIn: entry.asset0,
      poolId: entry.poolId,
      assetOut: entry.asset1,
    };
    const reverse: Edge = {
      assetIn: entry.asset1,
      poolId: entry.poolId,
      assetOut: entry.asset0,
    };
    adjacency.set(forward.assetIn, [...(adjacency.get(forward.assetIn) ?? []), forward]);
    adjacency.set(reverse.assetIn, [...(adjacency.get(reverse.assetIn) ?? []), reverse]);
  }
  for (const edges of adjacency.values()) edges.sort(compareEdges);

  let expansions = 0;
  let enumeratedCandidates = 0;
  let replayedCandidates = 0;
  let rejectedCandidates = 0;
  const established = withEstablishment
    ? establishDirect(value, routingRequest)
    : {
        summary: {
          enumeratedCandidates: 0,
          replayedCandidates: 0,
          rejectedCandidates: 0,
        },
        incumbent: undefined,
      };
  const establishment = established.summary;
  let incumbent = established.incumbent;
  const boundaries: Boundary[] = [];
  const capture = (): void => {
    boundaries.push({
      establishment,
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
    path: readonly Edge[],
    assets: ReadonlySet<string>,
    pools: ReadonlySet<string>,
  ): void => {
    if (path.length >= routingRequest.maxHops) return;
    for (const edge of adjacency.get(currentAsset) ?? []) {
      expansions += 1;
      if (pools.has(edge.poolId) || assets.has(edge.assetOut)) {
        capture();
        continue;
      }
      const nextPath = [...path, edge];
      if (edge.assetOut === routingRequest.assetOut) {
        enumeratedCandidates += 1;
        replayedCandidates += 1;
        const receipt = replay(value, routingRequest, nextPath);
        if (receipt === undefined) rejectedCandidates += 1;
        else if (incumbent === undefined || compareReceipts(receipt, incumbent) < 0) {
          incumbent = receipt;
        }
        capture();
        continue;
      }
      capture();
      if (nextPath.length < routingRequest.maxHops) {
        visit(
          edge.assetOut,
          nextPath,
          new Set([...assets, edge.assetOut]),
          new Set([...pools, edge.poolId]),
        );
      }
    }
  };
  visit(routingRequest.assetIn, [], new Set([routingRequest.assetIn]), new Set());
  assert.equal(boundaries.length, expansions + 1);
  return { boundaries, totalExpansions: expansions };
}

function expected(
  oracleTrace: Trace,
  expansion: number,
  termination: Search['termination'],
): Outcome {
  const boundary = oracleTrace.boundaries[expansion];
  assert.ok(boundary !== undefined);
  const search: Search = {
    establishment: boundary.establishment,
    expansions: boundary.expansions,
    enumeratedCandidates: boundary.enumeratedCandidates,
    replayedCandidates: boundary.replayedCandidates,
    rejectedCandidates: boundary.rejectedCandidates,
    termination,
  };
  if (boundary.incumbent !== null) {
    return { status: 'success', receipt: boundary.incumbent, search };
  }
  if (termination !== 'complete') return { status: 'no-plan', reason: termination, search };
  return {
    status: 'no-route',
    reason:
      boundary.enumeratedCandidates === 0
        ? 'no-candidate'
        : 'all-candidates-rejected',
    search,
  };
}

function assertResult(actual: ExactInputSinglePathDeadlineResult, expected_: Outcome): void {
  assert.equal(actual.status, expected_.status);
  if (expected_.status === 'success') {
    assert.equal(actual.status, 'success');
    assert.deepEqual(actual.plan.receipt, expected_.receipt);
    assert.deepEqual(actual.plan.search, expected_.search);
    assert.equal(actual.checkpoint === null, expected_.search.termination === 'complete');
  } else if (expected_.status === 'no-route') {
    assert.equal(actual.status, 'no-route');
    assert.equal(actual.reason, expected_.reason);
    assert.deepEqual(actual.search, expected_.search);
    assert.equal(actual.checkpoint, null);
  } else {
    assert.equal(actual.status, 'no-plan');
    assert.equal(actual.reason, expected_.reason);
    assert.deepEqual(actual.search, expected_.search);
    assert.notEqual(actual.checkpoint, null);
  }
  if ('checkpoint' in actual && actual.checkpoint !== null) {
    const boundary = expected_.search;
    assert.deepEqual(actual.checkpoint.establishment, boundary.establishment);
    assert.equal(actual.checkpoint.expansions, boundary.expansions);
    assert.equal(actual.checkpoint.enumeratedCandidates, boundary.enumeratedCandidates);
    assert.equal(actual.checkpoint.replayedCandidates, boundary.replayedCandidates);
    assert.equal(actual.checkpoint.rejectedCandidates, boundary.rejectedCandidates);
    assert.deepEqual(
      actual.checkpoint.incumbent,
      expected_.status === 'success' ? expected_.receipt : null,
    );
    assert.equal('deadlineNanoseconds' in actual.checkpoint, false);
    assert.equal('nowNanoseconds' in actual.checkpoint, false);
    assert.equal('previousSample' in actual.checkpoint, false);
  }
  assertDeepFrozen(actual);
}

function legacyProjection(expected_: Outcome): unknown {
  const search = {
    expansions: expected_.search.expansions,
    enumeratedCandidates: expected_.search.enumeratedCandidates,
    replayedCandidates: expected_.search.replayedCandidates,
    rejectedCandidates: expected_.search.rejectedCandidates,
    termination: expected_.search.termination,
  };
  if (expected_.status === 'success') {
    return { status: 'success', plan: { receipt: expected_.receipt, search } };
  }
  return {
    status: expected_.status,
    reason: expected_.reason,
    search,
  };
}

function tokenFrom(
  result: ExactInputSinglePathDeadlineResult | ExactInputSinglePathResumableResult,
): ExactInputSinglePathResumableCheckpoint {
  assert.equal('checkpoint' in result, true);
  if (!('checkpoint' in result) || result.checkpoint === null) {
    throw new Error('deadline oracle requires a paused token');
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

function routingGraph(): LiquiditySnapshot {
  return snapshot([
    pool('a-direct', 'A', 1_000n, 'C', 1_000n),
    pool('b-ab', 'A', 1_000n, 'B', 2_000n),
    pool('c-bc', 'B', 2_000n, 'C', 2_000n),
  ]);
}

function countedControl(deadline: bigint, samples: readonly bigint[]): {
  readonly control: ExactInputSinglePathDeadlineControl;
  readonly deadlineReads: number;
  readonly clockReads: number;
  readonly clockCalls: number;
} {
  let deadlineReads = 0;
  let clockReads = 0;
  let clockCalls = 0;
  return {
    control: {
      get deadlineNanoseconds() {
        deadlineReads += 1;
        return deadline;
      },
      get nowNanoseconds() {
        clockReads += 1;
        return function (this: unknown): bigint {
          assert.equal(this, undefined);
          const sample = samples[clockCalls];
          if (sample === undefined) throw new Error('oracle clock exhausted');
          clockCalls += 1;
          return sample;
        };
      },
    },
    get deadlineReads() {
      return deadlineReads;
    },
    get clockReads() {
      return clockReads;
    },
    get clockCalls() {
      return clockCalls;
    },
  };
}

void test('forces deadline at every eligible boundary with exact independent state and call counts', () => {
  const value = routingGraph();
  const routingRequest = request(value);
  const oracleTrace = trace(value, routingRequest);
  assert.equal(oracleTrace.totalExpansions, 4);
  for (let boundary = 0; boundary < oracleTrace.totalExpansions; boundary += 1) {
    const counted = countedControl(
      100n,
      [...Array<bigint>(boundary).fill(99n), 100n],
    );
    const actual = routeExactInputSinglePathWithDeadline(
      value,
      routingRequest,
      counted.control,
    );
    assertResult(actual, expected(oracleTrace, boundary, 'deadline'));
    assert.equal(counted.deadlineReads, 1);
    assert.equal(counted.clockReads, 1);
    assert.equal(counted.clockCalls, boundary + 1);
  }

  const greater = countedControl(100n, [101n]);
  assertResult(
    routeExactInputSinglePathWithDeadline(value, routingRequest, greater.control),
    expected(oracleTrace, 0, 'deadline'),
  );
  assert.equal(greater.clockCalls, 1);

  const below = countedControl(100n, [99n, 99n, 99n, 99n]);
  assertResult(
    routeExactInputSinglePathWithDeadline(value, routingRequest, below.control),
    expected(oracleTrace, 4, 'complete'),
  );
  assert.equal(below.deadlineReads, 1);
  assert.equal(below.clockReads, 1);
  assert.equal(below.clockCalls, 4);
});

void test('complete and work-limit outrank deadline access at exact boundaries', () => {
  const value = routingGraph();
  let reads = 0;
  const unread = {
    get deadlineNanoseconds(): bigint {
      reads += 1;
      throw new Error('must remain unread');
    },
    get nowNanoseconds(): () => bigint {
      reads += 1;
      throw new Error('must remain unread');
    },
  };
  const invalid = routeExactInputSinglePathWithDeadline(
    value,
    request(value, { amountIn: 0n }),
    unread,
  );
  assert.equal(invalid.status, 'invalid-request');
  assert.equal(reads, 0);

  const zeroCap = routeExactInputSinglePathWithDeadline(
    value,
    request(value, { maxExpansions: 0 }),
    unread,
  );
  assert.equal(zeroCap.status, 'success');
  if (zeroCap.status === 'success') {
    assert.equal(zeroCap.plan.search.termination, 'work-limit');
    assert.equal(zeroCap.plan.receipt.hops[0]?.poolId, 'a-direct');
  }
  assert.equal(reads, 0);

  const oracleTrace = trace(value, request(value));
  const bounded = countedControl(100n, [99n, 99n]);
  assertResult(
    routeExactInputSinglePathWithDeadline(
      value,
      request(value, { maxExpansions: 2 }),
      bounded.control,
    ),
    expected(oracleTrace, 2, 'work-limit'),
  );
  assert.equal(bounded.clockCalls, 2);

  const direct = snapshot([pool('direct', 'A', 1_000n, 'C', 1_000n)]);
  const directTrace = trace(direct, request(direct, { maxHops: 1 }));
  const completion = countedControl(100n, [99n]);
  assertResult(
    routeExactInputSinglePathWithDeadline(
      direct,
      request(direct, { maxHops: 1, maxExpansions: 1 }),
      completion.control,
    ),
    expected(directTrace, 1, 'complete'),
  );
  assert.equal(completion.clockCalls, 1);
});

void test('uses bigint equality/greater/below semantics including huge clock values', () => {
  const value = routingGraph();
  const oracleTrace = trace(value, request(value));
  const huge = 10n ** 100n;
  for (const sample of [huge, huge + 1n]) {
    assertResult(
      routeExactInputSinglePathWithDeadline(value, request(value), {
        deadlineNanoseconds: huge,
        nowNanoseconds: () => sample,
      }),
      expected(oracleTrace, 0, 'deadline'),
    );
  }
  let calls = 0;
  const completed = routeExactInputSinglePathWithDeadline(value, request(value), {
    deadlineNanoseconds: huge,
    nowNanoseconds() {
      calls += 1;
      return huge - 1n;
    },
  });
  assertResult(completed, expected(oracleTrace, 4, 'complete'));
  assert.equal(calls, 4);
});

void test('maps deadline and clock configuration defects with exact lazy precedence', () => {
  const value = routingGraph();
  const invalidDeadlines: readonly ExactInputSinglePathDeadlineControl[] = [
    {
      get deadlineNanoseconds(): bigint {
        throw new Error('private deadline prose');
      },
      nowNanoseconds: () => 0n,
    },
    { deadlineNanoseconds: 1 as unknown as bigint, nowNanoseconds: () => 0n },
    { deadlineNanoseconds: -1n, nowNanoseconds: () => 0n },
  ];
  for (const candidate of invalidDeadlines) {
    let clockReads = 0;
    const result = routeExactInputSinglePathWithDeadline(value, request(value), {
      get deadlineNanoseconds() {
        return candidate.deadlineNanoseconds;
      },
      get nowNanoseconds() {
        clockReads += 1;
        return candidate.nowNanoseconds;
      },
    });
    assert.deepEqual(result, {
      status: 'deadline-error',
      error: { code: 'invalid-deadline-nanoseconds', field: 'deadlineNanoseconds' },
    });
    assert.equal(clockReads, 0);
    assert.equal('checkpoint' in result, false);
    assertDeepFrozen(result);
  }

  const invalidClocks: readonly ExactInputSinglePathDeadlineControl[] = [
    {
      deadlineNanoseconds: 10n,
      get nowNanoseconds(): () => bigint {
        throw new Error('private clock getter prose');
      },
    },
    { deadlineNanoseconds: 10n, nowNanoseconds: 1 as unknown as () => bigint },
    {
      deadlineNanoseconds: 10n,
      nowNanoseconds() {
        throw new Error('private invocation prose');
      },
    },
    { deadlineNanoseconds: 10n, nowNanoseconds: () => 1 as unknown as bigint },
    { deadlineNanoseconds: 10n, nowNanoseconds: () => -1n },
  ];
  for (const control of invalidClocks) {
    const result = routeExactInputSinglePathWithDeadline(value, request(value), control);
    assert.deepEqual(result, {
      status: 'deadline-error',
      error: { code: 'deadline-clock-failed', field: 'nowNanoseconds' },
    });
    assert.equal('checkpoint' in result, false);
    assertDeepFrozen(result);
  }

  const samples = [1n, 1n, 2n, 1n];
  const regressed = routeExactInputSinglePathWithDeadline(value, request(value), {
    deadlineNanoseconds: 100n,
    nowNanoseconds() {
      const sample = samples.shift();
      assert.ok(sample !== undefined);
      return sample;
    },
  });
  assert.deepEqual(regressed, {
    status: 'deadline-error',
    error: { code: 'deadline-clock-regressed', field: 'nowNanoseconds' },
  });
  assert.equal('checkpoint' in regressed, false);
  assertDeepFrozen(regressed);
});

void test('enforces token/cap precedence and preserves source after partial deadline errors', () => {
  const value = routingGraph();
  const source = tokenFrom(
    routeExactInputSinglePathResumable(
      value,
      request(value, { maxExpansions: 1 }),
      { shouldInterrupt: () => false },
    ),
  );
  const sourceBefore = structuredClone(source);
  let reads = 0;
  const unread = {
    get deadlineNanoseconds(): bigint {
      reads += 1;
      throw new Error('must remain unread');
    },
    get nowNanoseconds(): () => bigint {
      reads += 1;
      throw new Error('must remain unread');
    },
  };
  const forged = resumeExactInputSinglePathWithDeadline(
    { ...source },
    Number.NaN,
    unread,
  );
  assert.deepEqual(forged, {
    status: 'invalid-resume',
    error: { code: 'invalid-router-checkpoint', field: 'checkpoint' },
  });
  for (const cap of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, -1, 0]) {
    assert.deepEqual(resumeExactInputSinglePathWithDeadline(source, cap, unread), {
      status: 'invalid-resume',
      error: { code: 'invalid-resume-max-expansions', field: 'maxExpansions' },
    });
  }
  assert.equal(reads, 0);

  const equalCap = resumeExactInputSinglePathWithDeadline(source, 1, unread);
  assert.equal(equalCap.status, 'success');
  if (equalCap.status === 'success') assert.equal(equalCap.plan.search.termination, 'work-limit');
  assert.equal(reads, 0);
  assert.notEqual(tokenFrom(equalCap), source);
  assert.deepEqual(tokenFrom(equalCap), source);

  const branchSamples = [5n, 4n];
  const failedBranch = resumeExactInputSinglePathWithDeadline(source, 4, {
    deadlineNanoseconds: 100n,
    nowNanoseconds() {
      const sample = branchSamples.shift();
      assert.ok(sample !== undefined);
      return sample;
    },
  });
  assert.deepEqual(failedBranch, {
    status: 'deadline-error',
    error: { code: 'deadline-clock-regressed', field: 'nowNanoseconds' },
  });
  assert.equal('checkpoint' in failedBranch, false);
  assert.deepEqual(source, sourceBefore);

  const oracleTrace = trace(value, request(value));
  const recovered = resumeExactInputSinglePath(source, 4, {
    shouldInterrupt: () => false,
  });
  assert.equal(recovered.status, 'success');
  if (recovered.status === 'success') {
    assert.deepEqual(recovered.plan.receipt, oracleTrace.boundaries[4]?.incumbent);
    assert.equal(recovered.plan.search.termination, 'complete');
  }
});

void test('deadline tokens resume/reuse through both APIs with invocation-local clocks', () => {
  const value = routingGraph();
  const oracleTrace = trace(value, request(value));
  const paused = routeExactInputSinglePathWithDeadline(value, request(value), {
    deadlineNanoseconds: 1n,
    nowNanoseconds: (() => {
      const samples = [0n, 1n];
      return () => samples.shift() ?? 1n;
    })(),
  });
  assertResult(paused, expected(oracleTrace, 1, 'deadline'));
  const source = tokenFrom(paused);
  const sourceBefore = structuredClone(source);

  const ordinary = resumeExactInputSinglePath(source, 4, {
    shouldInterrupt: () => false,
  });
  assert.equal(ordinary.status, 'success');
  if (ordinary.status === 'success') {
    assert.deepEqual(ordinary.plan.receipt, oracleTrace.boundaries[4]?.incumbent);
  }

  const expiredAgain = resumeExactInputSinglePathWithDeadline(source, 4, {
    deadlineNanoseconds: 0n,
    nowNanoseconds: () => 0n,
  });
  assertResult(expiredAgain, expected(oracleTrace, 1, 'deadline'));
  assert.notEqual(tokenFrom(expiredAgain), source);
  assert.deepEqual(tokenFrom(expiredAgain), source);

  const deadlineComplete = resumeExactInputSinglePathWithDeadline(source, 4, {
    deadlineNanoseconds: 10n,
    nowNanoseconds: () => 0n,
  });
  assertResult(deadlineComplete, expected(oracleTrace, 4, 'complete'));
  assert.deepEqual(source, sourceBefore);

  const atTwo = resumeExactInputSinglePathWithDeadline(source, 2, {
    deadlineNanoseconds: 1_000n,
    nowNanoseconds: () => 900n,
  });
  assertResult(atTwo, expected(oracleTrace, 2, 'work-limit'));
  const atThree = resumeExactInputSinglePathWithDeadline(tokenFrom(atTwo), 3, {
    deadlineNanoseconds: 10n,
    nowNanoseconds: () => 0n,
  });
  assertResult(atThree, expected(oracleTrace, 3, 'work-limit'));
});

void test('captures caller/control once and isolates mutation plus reentrant routing', () => {
  const value = routingGraph();
  const routingRequest = request(value);
  const originalValue = structuredClone(value);
  const originalRequest = structuredClone(routingRequest);
  const oracleTrace = trace(originalValue, originalRequest);
  const source = tokenFrom(
    routeExactInputSinglePathResumable(
      originalValue,
      { ...originalRequest, maxExpansions: 1 },
      { shouldInterrupt: () => false },
    ),
  );
  let deadlineReads = 0;
  let clockReads = 0;
  let samples = 0;
  let nested: ExactInputSinglePathResumableResult | undefined;
  const mutable = {
    deadline: 100n,
    clock: () => 99n,
  };
  const actual = routeExactInputSinglePathWithDeadline(value, routingRequest, {
    get deadlineNanoseconds() {
      deadlineReads += 1;
      const mutableSnapshot = value as unknown as {
        snapshotId: string;
        pools: ConstantProductPool[];
      };
      const mutableRequest = routingRequest as unknown as { amountIn: bigint };
      mutableSnapshot.snapshotId = 'substituted';
      mutableSnapshot.pools = [pool('substitute', 'A', 1n, 'C', 1n)];
      mutableRequest.amountIn = 1n;
      return mutable.deadline;
    },
    get nowNanoseconds() {
      clockReads += 1;
      return function (this: unknown): bigint {
        assert.equal(this, undefined);
        samples += 1;
        mutable.deadline = 0n;
        mutable.clock = () => 200n;
        if (nested === undefined) {
          nested = resumeExactInputSinglePath(source, 2, {
            shouldInterrupt: () => false,
          });
        }
        return 99n;
      };
    },
  });
  assertResult(actual, expected(oracleTrace, 4, 'complete'));
  assert.equal(deadlineReads, 1);
  assert.equal(clockReads, 1);
  assert.equal(samples, 4);
  assert.ok(nested !== undefined);
  assertDeepFrozen(actual);
});

void test('covers no-incumbent/rejected/tie/cycle/permutation and huge routing values', () => {
  const noIncumbent = snapshot([
    pool('a-ab', 'A', 1_000n, 'B', 1_000n),
    pool('b-bc', 'B', 1_000n, 'C', 1_000n),
  ]);
  const noRequest = request(noIncumbent);
  const noTrace = trace(noIncumbent, noRequest);
  const atOne = countedControl(10n, [0n, 10n]);
  assertResult(
    routeExactInputSinglePathWithDeadline(noIncumbent, noRequest, atOne.control),
    expected(noTrace, 1, 'deadline'),
  );

  const rejected = snapshot([
    pool('a-zero', 'A', 1_000n, 'C', 1n),
    pool('b-good', 'A', 1n, 'C', 2n),
    pool('z-extra', 'A', 1_000n, 'B', 1_000n),
  ]);
  const rejectedRequest = request(rejected, { amountIn: 1n, maxHops: 1 });
  const rejectedTrace = trace(rejected, rejectedRequest);
  const afterReject = countedControl(10n, [0n, 10n]);
  assertResult(
    routeExactInputSinglePathWithDeadline(
      rejected,
      rejectedRequest,
      afterReject.control,
    ),
    expected(rejectedTrace, 1, 'deadline'),
  );

  const fewerHop = snapshot([
    pool('a-ab', 'A', 100n, 'B', 200n),
    pool('a-bc', 'B', 100n, 'C', 100n),
    pool('z-direct', 'A', 100n, 'C', 100n),
  ]);
  const fewerRequest = request(fewerHop);
  const fewerTrace = trace(fewerHop, fewerRequest);
  const fewer = routeExactInputSinglePathWithDeadline(fewerHop, fewerRequest, {
    deadlineNanoseconds: 100n,
    nowNanoseconds: () => 0n,
  });
  assertResult(fewer, expected(fewerTrace, fewerTrace.totalExpansions, 'complete'));
  assert.equal(fewer.status, 'success');
  if (fewer.status === 'success') {
    assert.deepEqual(fewer.plan.receipt.hops.map(({ poolId }) => poolId), ['z-direct']);
  }

  const huge = 10n ** 80n;
  const hugeValue = snapshot([
    pool('a-small', 'A', huge, 'C', 2n * huge),
    pool('z-large', 'A', huge, 'C', 2n * huge + 2n),
  ]);
  const hugeRequest = request(hugeValue, { amountIn: huge, maxHops: 1 });
  const hugeTrace = trace(hugeValue, hugeRequest);
  const hugeResult = routeExactInputSinglePathWithDeadline(hugeValue, hugeRequest, {
    deadlineNanoseconds: 10n ** 120n,
    nowNanoseconds: () => 10n ** 119n,
  });
  assertResult(hugeResult, expected(hugeTrace, hugeTrace.totalExpansions, 'complete'));
  assert.equal(hugeResult.status, 'success');
  if (hugeResult.status === 'success') {
    assert.equal(hugeResult.plan.receipt.amountOut, huge + 1n);
  }

  const cyclePools = [
    pool('a-direct', 'A', 1_000n, 'C', 1_000n),
    pool('z-direct', 'A', 1_000n, 'C', 1_000n),
    pool('ab', 'A', 1_000n, 'B', 1_000n),
    pool('bc', 'B', 1_000n, 'C', 1_000n),
    pool('ca', 'C', 1_000n, 'A', 1_000n),
  ];
  let reference: ExactInputSinglePathDeadlineResult | undefined;
  for (const order of permutations(cyclePools)) {
    const value = snapshot(order);
    const input = request(value, { maxHops: 3 });
    const oracleTrace = trace(value, input);
    const paused = routeExactInputSinglePathWithDeadline(value, input, {
      deadlineNanoseconds: 1n,
      nowNanoseconds: (() => {
        const samples = [0n, 1n];
        return () => samples.shift() ?? 1n;
      })(),
    });
    assertResult(paused, expected(oracleTrace, 1, 'deadline'));
    const completed = resumeExactInputSinglePathWithDeadline(
      tokenFrom(paused),
      oracleTrace.totalExpansions,
      { deadlineNanoseconds: 10n, nowNanoseconds: () => 0n },
    );
    assertResult(completed, expected(oracleTrace, oracleTrace.totalExpansions, 'complete'));
    if (reference === undefined) reference = completed;
    else assert.deepEqual(completed, reference);
  }
});

void test('keeps anytime API equivalence plus noninterruptible and canonical compatibility', async () => {
  const value = routingGraph();
  const baseRequest = request(value);
  const oracleTrace = trace(value, baseRequest);
  const legacyTrace = trace(value, baseRequest, false);
  for (let cap = 0; cap <= oracleTrace.totalExpansions; cap += 1) {
    const termination = cap === oracleTrace.totalExpansions ? 'complete' : 'work-limit';
    const expected_ = expected(oracleTrace, cap, termination);
    const deadline = routeExactInputSinglePathWithDeadline(
      value,
      { ...baseRequest, maxExpansions: cap },
      { deadlineNanoseconds: 100n, nowNanoseconds: () => 0n },
    );
    assertResult(deadline, expected_);
    const resumable = routeExactInputSinglePathResumable(
      value,
      { ...baseRequest, maxExpansions: cap },
      { shouldInterrupt: () => false },
    );
    assert.deepEqual(deadline, resumable);
    const interruptible = routeExactInputSinglePathInterruptible(
      value,
      { ...baseRequest, maxExpansions: cap },
      { shouldInterrupt: () => false },
    );
    if ('checkpoint' in deadline) {
      const projected = { ...deadline } as Record<string, unknown>;
      delete projected['checkpoint'];
      assert.deepEqual(projected, interruptible);
      assert.deepEqual(
        routeExactInputSinglePath(value, {
          ...baseRequest,
          maxExpansions: cap,
        }),
        legacyProjection(expected(legacyTrace, cap, termination)),
      );
    }
  }

  const vectors = [
    ['success.json', 1306, '35f4fde18b840bbaec6862264024ef22ab2c78f303d003635add6cd0a1735e3f'],
    ['no-route.json', 1077, 'dfb4ebd1e382efcc1961101c55223dd755a39891c3760e500bbf8ab4a3faeb23'],
    ['no-plan.json', 927, '05db31a8660fe3a3b71058f282f86ddd0d6d63bc929a8725a8aecccc96971ac1'],
  ] as const;
  for (const [filename, bytes, hash] of vectors) {
    const canonicalJson = await readFile(join(FIXTURE_DIRECTORY, filename), 'utf8');
    assert.equal(Buffer.byteLength(canonicalJson, 'utf8'), bytes);
    assert.equal(createHash('sha256').update(canonicalJson, 'utf8').digest('hex'), hash);
    assert.equal(parseAndVerifyCanonicalSinglePathRouterCase(canonicalJson).ok, true);
  }
});
