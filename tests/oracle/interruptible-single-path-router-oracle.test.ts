import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../../src/domain/index.ts';
import {
  routeExactInputSinglePath,
  routeExactInputSinglePathInterruptible,
  type ExactInputSinglePathInterruptionCheckpoint,
  type ExactInputSinglePathInterruptibleResult,
  type ExactInputSinglePathRouterRequest,
  type ExactInputSinglePathRouterResult,
} from '../../src/router/single-path/index.ts';
import { parseAndVerifyCanonicalSinglePathRouterCase } from '../../src/serialization/canonical-router-case/index.ts';

interface OracleEdge {
  readonly assetIn: string;
  readonly poolId: string;
  readonly assetOut: string;
}

interface OracleHopReceipt extends OracleEdge {
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly reserveInBefore: bigint;
  readonly reserveOutBefore: bigint;
  readonly reserveInAfter: bigint;
  readonly reserveOutAfter: bigint;
}

interface OracleReceipt {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly hops: readonly OracleHopReceipt[];
}

interface OracleBoundary {
  readonly expansions: number;
  readonly enumeratedCandidates: number;
  readonly replayedCandidates: number;
  readonly rejectedCandidates: number;
  readonly incumbent: OracleReceipt | null;
}

interface OracleTrace {
  readonly boundaries: readonly OracleBoundary[];
  readonly totalExpansions: number;
}

interface OracleSearch {
  readonly expansions: number;
  readonly enumeratedCandidates: number;
  readonly replayedCandidates: number;
  readonly rejectedCandidates: number;
  readonly termination: 'complete' | 'work-limit' | 'interrupted';
}

type OracleOutcome =
  | { readonly status: 'success'; readonly receipt: OracleReceipt; readonly search: OracleSearch }
  | {
      readonly status: 'no-route';
      readonly reason: 'no-candidate' | 'all-candidates-rejected';
      readonly search: OracleSearch;
    }
  | {
      readonly status: 'no-plan';
      readonly reason: 'work-limit' | 'interrupted';
      readonly search: OracleSearch;
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

function snapshot(
  pools: readonly ConstantProductPool[],
  snapshotId = 'interrupt-oracle',
  snapshotChecksum = 'interrupt-oracle-checksum',
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
    assetOut: 'D',
    amountIn: 100n,
    maxHops: 3,
    maxExpansions: 1_000,
    ...overrides,
  };
}

function compareRaw(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareEdges(left: OracleEdge, right: OracleEdge): number {
  return (
    compareRaw(left.assetIn, right.assetIn) ||
    compareRaw(left.poolId, right.poolId) ||
    compareRaw(left.assetOut, right.assetOut)
  );
}

function compareRoutes(
  left: readonly OracleHopReceipt[],
  right: readonly OracleHopReceipt[],
): number {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const leftHop = left[index];
    const rightHop = right[index];
    assert.ok(leftHop !== undefined && rightHop !== undefined);
    const comparison = compareEdges(leftHop, rightHop);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

function compareReceipts(left: OracleReceipt, right: OracleReceipt): number {
  if (left.amountOut > right.amountOut) return -1;
  if (left.amountOut < right.amountOut) return 1;
  if (left.hops.length !== right.hops.length) return left.hops.length - right.hops.length;
  return compareRoutes(left.hops, right.hops);
}

function replayIndependently(
  value: LiquiditySnapshot,
  routingRequest: ExactInputSinglePathRouterRequest,
  path: readonly OracleEdge[],
): OracleReceipt | undefined {
  const states = new Map(
    value.pools.map((entry) => [
      entry.poolId,
      {
        ...entry,
      },
    ]),
  );
  const hops: OracleHopReceipt[] = [];
  let amountIn = routingRequest.amountIn;

  for (const edge of path) {
    const state = states.get(edge.poolId);
    assert.ok(state !== undefined);
    const forward = state.asset0 === edge.assetIn && state.asset1 === edge.assetOut;
    const reverse = state.asset1 === edge.assetIn && state.asset0 === edge.assetOut;
    assert.equal(forward || reverse, true);
    const reserveIn = forward ? state.reserve0 : state.reserve1;
    const reserveOut = forward ? state.reserve1 : state.reserve0;
    const retainedMultiplier = state.feeDenominator - state.feeChargedNumerator;
    const numerator = amountIn * retainedMultiplier * reserveOut;
    const denominator = reserveIn * state.feeDenominator + amountIn * retainedMultiplier;
    const amountOut = numerator / denominator;
    if (amountIn > 0n && amountOut === 0n) return undefined;
    const reserveInAfter = reserveIn + amountIn;
    const reserveOutAfter = reserveOut - amountOut;
    states.set(edge.poolId, {
      ...state,
      reserve0: forward ? reserveInAfter : reserveOutAfter,
      reserve1: forward ? reserveOutAfter : reserveInAfter,
    });
    hops.push({
      ...edge,
      amountIn,
      amountOut,
      reserveInBefore: reserveIn,
      reserveOutBefore: reserveOut,
      reserveInAfter,
      reserveOutAfter,
    });
    amountIn = amountOut;
  }

  return {
    snapshotId: routingRequest.snapshotId,
    snapshotChecksum: routingRequest.snapshotChecksum,
    assetIn: routingRequest.assetIn,
    assetOut: routingRequest.assetOut,
    amountIn: routingRequest.amountIn,
    amountOut: amountIn,
    hops,
  };
}

function traceIndependently(
  value: LiquiditySnapshot,
  routingRequest: ExactInputSinglePathRouterRequest,
): OracleTrace {
  const adjacency = new Map<string, OracleEdge[]>();
  for (const entry of value.pools) {
    const forward: OracleEdge = {
      assetIn: entry.asset0,
      poolId: entry.poolId,
      assetOut: entry.asset1,
    };
    const reverse: OracleEdge = {
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
  let incumbent: OracleReceipt | undefined;
  const boundaries: OracleBoundary[] = [];

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
    assetIn: string,
    path: readonly OracleEdge[],
    seenAssets: ReadonlySet<string>,
    seenPools: ReadonlySet<string>,
  ): void => {
    if (path.length >= routingRequest.maxHops) return;
    for (const edge of adjacency.get(assetIn) ?? []) {
      expansions += 1;
      const usable = !seenPools.has(edge.poolId) && !seenAssets.has(edge.assetOut);
      if (!usable) {
        capture();
        continue;
      }

      const nextPath = [...path, edge];
      if (edge.assetOut === routingRequest.assetOut) {
        enumeratedCandidates += 1;
        replayedCandidates += 1;
        const receipt = replayIndependently(value, routingRequest, nextPath);
        if (receipt === undefined) {
          rejectedCandidates += 1;
        } else if (incumbent === undefined || compareReceipts(receipt, incumbent) < 0) {
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
          new Set([...seenAssets, edge.assetOut]),
          new Set([...seenPools, edge.poolId]),
        );
      }
    }
  };

  visit(
    routingRequest.assetIn,
    [],
    new Set([routingRequest.assetIn]),
    new Set(),
  );
  assert.equal(boundaries.length, expansions + 1);
  return { boundaries, totalExpansions: expansions };
}

function oracleOutcome(
  trace: OracleTrace,
  expansions: number,
  termination: OracleSearch['termination'],
): OracleOutcome {
  const boundary = trace.boundaries[expansions];
  assert.ok(boundary !== undefined);
  const search: OracleSearch = {
    expansions: boundary.expansions,
    enumeratedCandidates: boundary.enumeratedCandidates,
    replayedCandidates: boundary.replayedCandidates,
    rejectedCandidates: boundary.rejectedCandidates,
    termination,
  };
  if (boundary.incumbent !== null) {
    return { status: 'success', receipt: boundary.incumbent, search };
  }
  if (termination !== 'complete') {
    return { status: 'no-plan', reason: termination, search };
  }
  return {
    status: 'no-route',
    reason:
      boundary.enumeratedCandidates === 0
        ? 'no-candidate'
        : 'all-candidates-rejected',
    search,
  };
}

function assertInterruptibleMatches(
  actual: ExactInputSinglePathInterruptibleResult,
  expected: OracleOutcome,
): void {
  assert.equal(actual.status, expected.status);
  if (expected.status === 'success') {
    assert.equal(actual.status, 'success');
    assert.deepEqual(actual.plan.receipt, expected.receipt);
    assert.deepEqual(actual.plan.search, expected.search);
  } else if (expected.status === 'no-route') {
    assert.equal(actual.status, 'no-route');
    assert.equal(actual.reason, expected.reason);
    assert.deepEqual(actual.search, expected.search);
  } else {
    assert.equal(actual.status, 'no-plan');
    assert.equal(actual.reason, expected.reason);
    assert.deepEqual(actual.search, expected.search);
  }
  assertDeepFrozen(actual);
}

function assertLegacyMatches(
  actual: ExactInputSinglePathRouterResult,
  expected: OracleOutcome,
): void {
  assert.notEqual(expected.search.termination, 'interrupted');
  assert.equal(actual.status, expected.status);
  if (expected.status === 'success') {
    assert.equal(actual.status, 'success');
    assert.deepEqual(actual.plan.receipt, expected.receipt);
    assert.deepEqual(actual.plan.search, expected.search);
  } else if (expected.status === 'no-route') {
    assert.equal(actual.status, 'no-route');
    assert.equal(actual.reason, expected.reason);
    assert.deepEqual(actual.search, expected.search);
  } else {
    assert.equal(actual.status, 'no-plan');
    assert.equal(actual.reason, 'work-limit');
    assert.deepEqual(actual.search, expected.search);
  }
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) {
    assertDeepFrozen(Reflect.get(value, key), seen);
  }
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

function classicGraph(): LiquiditySnapshot {
  return snapshot([
    pool('ab', 'A', 1_000n, 'B', 1_500n),
    pool('ac', 'A', 1_000n, 'C', 1_200n),
    pool('bc', 'B', 1_000n, 'C', 1_000n),
    pool('bd', 'B', 1_000n, 'D', 1_300n),
    pool('cd', 'C', 1_000n, 'D', 1_100n),
  ]);
}

void test('forces every boundary and matches the independent trace plus every legacy budget-N result', () => {
  const value = classicGraph();
  const baseRequest = request(value);
  const trace = traceIndependently(value, baseRequest);
  assert.equal(trace.totalExpansions, 14);

  let previousIncumbent: OracleReceipt | undefined;
  for (const boundary of trace.boundaries) {
    if (boundary.incumbent === null) continue;
    if (previousIncumbent !== undefined) {
      assert.ok(compareReceipts(boundary.incumbent, previousIncumbent) <= 0);
    }
    previousIncumbent = boundary.incumbent;
  }

  for (let expansion = 0; expansion < trace.totalExpansions; expansion += 1) {
    let observed: ExactInputSinglePathInterruptionCheckpoint | undefined;
    const interrupted = routeExactInputSinglePathInterruptible(
      value,
      baseRequest,
      {
        shouldInterrupt(checkpoint) {
          if (checkpoint.expansions === expansion) observed = checkpoint;
          return checkpoint.expansions === expansion;
        },
      },
    );
    assertInterruptibleMatches(
      interrupted,
      oracleOutcome(trace, expansion, 'interrupted'),
    );
    assert.deepEqual(observed, trace.boundaries[expansion]);
    assertDeepFrozen(observed);
    assert.deepEqual(Object.keys(observed ?? {}), [
      'expansions',
      'enumeratedCandidates',
      'replayedCandidates',
      'rejectedCandidates',
      'incumbent',
    ]);

    const budgetRequest = { ...baseRequest, maxExpansions: expansion };
    const legacy = routeExactInputSinglePath(value, budgetRequest);
    const expectedBudget = oracleOutcome(trace, expansion, 'work-limit');
    assertLegacyMatches(legacy, expectedBudget);

    let budgetBoundaryCalls = 0;
    const interruptibleBudget = routeExactInputSinglePathInterruptible(
      value,
      budgetRequest,
      {
        shouldInterrupt(checkpoint) {
          if (checkpoint.expansions === expansion) budgetBoundaryCalls += 1;
          return checkpoint.expansions === expansion;
        },
      },
    );
    assertInterruptibleMatches(interruptibleBudget, expectedBudget);
    assert.equal(budgetBoundaryCalls, 0);
  }

  let finalBoundaryCalls = 0;
  const exactCompleteRequest = {
    ...baseRequest,
    maxExpansions: trace.totalExpansions,
  };
  const completed = routeExactInputSinglePathInterruptible(
    value,
    exactCompleteRequest,
    {
      shouldInterrupt(checkpoint) {
        if (checkpoint.expansions === trace.totalExpansions) finalBoundaryCalls += 1;
        return checkpoint.expansions === trace.totalExpansions;
      },
    },
  );
  const expectedComplete = oracleOutcome(
    trace,
    trace.totalExpansions,
    'complete',
  );
  assertInterruptibleMatches(completed, expectedComplete);
  assertLegacyMatches(routeExactInputSinglePath(value, exactCompleteRequest), expectedComplete);
  assert.equal(finalBoundaryCalls, 0);
});

void test('matches the independent cyclic/parallel oracle across all 720 pool permutations', () => {
  const pools = [
    pool('a-direct', 'A', 1_000n, 'D', 1_000n),
    pool('z-direct', 'A', 1_000n, 'D', 1_000n),
    pool('ab', 'A', 1_000n, 'B', 1_300n),
    pool('bc', 'B', 1_000n, 'C', 1_000n),
    pool('ca', 'C', 1_000n, 'A', 1_000n),
    pool('bd', 'B', 1_000n, 'D', 1_200n),
  ];
  let reference: ExactInputSinglePathInterruptibleResult | undefined;
  for (const orderedPools of permutations(pools)) {
    const value = snapshot(orderedPools);
    const routingRequest = request(value);
    const trace = traceIndependently(value, routingRequest);
    const expected = oracleOutcome(trace, trace.totalExpansions, 'complete');
    const actual = routeExactInputSinglePathInterruptible(
      value,
      routingRequest,
      { shouldInterrupt: () => false },
    );
    assertInterruptibleMatches(actual, expected);
    if (reference === undefined) reference = actual;
    else assert.deepEqual(actual, reference);
  }
  assert.equal(reference?.status, 'success');
  if (reference?.status === 'success') {
    assert.equal(reference.plan.receipt.amountOut, 126n);
    assert.deepEqual(
      reference.plan.receipt.hops.map(({ poolId }) => poolId),
      ['ab', 'bd'],
    );
  }
});

void test('rejected zero-output candidates preserve only validated incumbents at checkpoints', () => {
  const validThenRejected = snapshot([
    pool('a-good', 'A', 1n, 'C', 2n),
    pool('b-zero', 'A', 1_000n, 'C', 1n),
    pool('z-extra', 'A', 1_000n, 'B', 1_000n),
  ]);
  const validRequest = request(validThenRejected, {
    assetOut: 'C',
    amountIn: 1n,
    maxHops: 1,
  });
  const validTrace = traceIndependently(validThenRejected, validRequest);
  assert.deepEqual(validTrace.boundaries[2], {
    expansions: 2,
    enumeratedCandidates: 2,
    replayedCandidates: 2,
    rejectedCandidates: 1,
    incumbent: validTrace.boundaries[1]?.incumbent,
  });
  const interrupted = routeExactInputSinglePathInterruptible(
    validThenRejected,
    validRequest,
    { shouldInterrupt: (checkpoint) => checkpoint.expansions === 2 },
  );
  assertInterruptibleMatches(interrupted, oracleOutcome(validTrace, 2, 'interrupted'));

  const rejectedThenValid = snapshot([
    pool('a-zero', 'A', 1_000n, 'C', 1n),
    pool('b-good', 'A', 1n, 'C', 2n),
    pool('z-extra', 'A', 1_000n, 'B', 1_000n),
  ]);
  const rejectedRequest = request(rejectedThenValid, {
    assetOut: 'C',
    amountIn: 1n,
    maxHops: 1,
  });
  const rejectedTrace = traceIndependently(rejectedThenValid, rejectedRequest);
  assert.equal(rejectedTrace.boundaries[1]?.incumbent, null);
  assertInterruptibleMatches(
    routeExactInputSinglePathInterruptible(
      rejectedThenValid,
      rejectedRequest,
      { shouldInterrupt: (checkpoint) => checkpoint.expansions === 1 },
    ),
    oracleOutcome(rejectedTrace, 1, 'interrupted'),
  );
  const completed = oracleOutcome(
    rejectedTrace,
    rejectedTrace.totalExpansions,
    'complete',
  );
  assertInterruptibleMatches(
    routeExactInputSinglePathInterruptible(
      rejectedThenValid,
      rejectedRequest,
      { shouldInterrupt: () => false },
    ),
    completed,
  );
});

void test('applies fewer-hop, raw UTF-16, and huge-bigint incumbent objectives exactly', () => {
  const fewerHops = snapshot([
    pool('a-ab', 'A', 100n, 'B', 200n),
    pool('a-bc', 'B', 100n, 'C', 100n),
    pool('z-direct', 'A', 100n, 'C', 100n),
  ]);
  const fewerRequest = request(fewerHops, {
    assetOut: 'C',
    amountIn: 100n,
    maxHops: 2,
  });
  const fewerTrace = traceIndependently(fewerHops, fewerRequest);
  const fewerExpected = oracleOutcome(fewerTrace, fewerTrace.totalExpansions, 'complete');
  assertInterruptibleMatches(
    routeExactInputSinglePathInterruptible(
      fewerHops,
      fewerRequest,
      { shouldInterrupt: () => false },
    ),
    fewerExpected,
  );
  assert.equal(fewerExpected.status, 'success');
  if (fewerExpected.status === 'success') {
    assert.equal(fewerExpected.receipt.amountOut, 50n);
    assert.deepEqual(fewerExpected.receipt.hops.map(({ poolId }) => poolId), ['z-direct']);
  }

  const utf16 = snapshot([
    pool('\u{1f600}', 'A', 100n, 'C', 100n),
    pool('\ue000', 'A', 100n, 'C', 100n),
  ]);
  const utf16Request = request(utf16, { assetOut: 'C', maxHops: 1 });
  const utf16Trace = traceIndependently(utf16, utf16Request);
  const utf16Expected = oracleOutcome(utf16Trace, utf16Trace.totalExpansions, 'complete');
  assert.equal(utf16Expected.status, 'success');
  if (utf16Expected.status === 'success') {
    assert.equal(utf16Expected.receipt.hops[0]?.poolId, '\u{1f600}');
  }
  for (const order of permutations(utf16.pools)) {
    assertInterruptibleMatches(
      routeExactInputSinglePathInterruptible(
        snapshot(order),
        utf16Request,
        { shouldInterrupt: () => false },
      ),
      utf16Expected,
    );
  }

  const huge = 10n ** 80n;
  const hugeSnapshot = snapshot([
    pool('a-smaller', 'A', huge, 'C', 2n * huge),
    pool('z-larger', 'A', huge, 'C', 2n * huge + 2n),
  ]);
  const hugeRequest = request(hugeSnapshot, {
    assetOut: 'C',
    amountIn: huge,
    maxHops: 1,
  });
  const hugeTrace = traceIndependently(hugeSnapshot, hugeRequest);
  const hugeExpected = oracleOutcome(hugeTrace, hugeTrace.totalExpansions, 'complete');
  assertInterruptibleMatches(
    routeExactInputSinglePathInterruptible(
      hugeSnapshot,
      hugeRequest,
      { shouldInterrupt: () => false },
    ),
    hugeExpected,
  );
  assert.equal(hugeExpected.status, 'success');
  if (hugeExpected.status === 'success') {
    assert.equal(hugeExpected.receipt.amountOut, huge + 1n);
    assert.equal(hugeExpected.receipt.hops[0]?.poolId, 'z-larger');
  }
});

void test('distinguishes interrupted, budgeted, complete-empty, and all-rejected outcomes', () => {
  const disconnected = snapshot([
    pool('component-ab', 'A', 1_000n, 'B', 1_000n),
    pool('component-cd', 'C', 1_000n, 'D', 1_000n),
  ]);
  const disconnectedRequest = request(disconnected, { maxHops: 2 });
  const trace = traceIndependently(disconnected, disconnectedRequest);
  assertInterruptibleMatches(
    routeExactInputSinglePathInterruptible(
      disconnected,
      disconnectedRequest,
      { shouldInterrupt: () => true },
    ),
    oracleOutcome(trace, 0, 'interrupted'),
  );
  assertInterruptibleMatches(
    routeExactInputSinglePathInterruptible(
      disconnected,
      { ...disconnectedRequest, maxExpansions: 0 },
      { shouldInterrupt: () => true },
    ),
    oracleOutcome(trace, 0, 'work-limit'),
  );
  assertInterruptibleMatches(
    routeExactInputSinglePathInterruptible(
      disconnected,
      disconnectedRequest,
      { shouldInterrupt: () => false },
    ),
    oracleOutcome(trace, trace.totalExpansions, 'complete'),
  );

  const rejected = snapshot([
    pool('zero-ac', 'A', 1_000n, 'C', 1n),
  ]);
  const rejectedRequest = request(rejected, {
    assetOut: 'C',
    amountIn: 1n,
    maxHops: 1,
  });
  const rejectedTrace = traceIndependently(rejected, rejectedRequest);
  const rejectedExpected = oracleOutcome(
    rejectedTrace,
    rejectedTrace.totalExpansions,
    'complete',
  );
  assert.equal(rejectedExpected.status, 'no-route');
  if (rejectedExpected.status === 'no-route') {
    assert.equal(rejectedExpected.reason, 'all-candidates-rejected');
  }
  assertInterruptibleMatches(
    routeExactInputSinglePathInterruptible(
      rejected,
      rejectedRequest,
      { shouldInterrupt: () => false },
    ),
    rejectedExpected,
  );
});

void test('validates before one-time callback capture and maps capture/invocation failures atomically', () => {
  const value = classicGraph();
  let invalidReads = 0;
  const invalid = routeExactInputSinglePathInterruptible(
    value,
    request(value, { amountIn: 0n }),
    {
      get shouldInterrupt(): (
        checkpoint: ExactInputSinglePathInterruptionCheckpoint,
      ) => boolean {
        invalidReads += 1;
        throw new Error('must not be read');
      },
    },
  );
  assert.equal(invalid.status, 'invalid-request');
  assert.equal(invalidReads, 0);

  const expectedControlError = {
    status: 'control-error',
    error: { code: 'interruption-check-failed' },
  };
  const captureThrow = routeExactInputSinglePathInterruptible(
    value,
    request(value),
    {
      get shouldInterrupt(): (
        checkpoint: ExactInputSinglePathInterruptionCheckpoint,
      ) => boolean {
        throw new Error('private getter prose');
      },
    },
  );
  assert.deepEqual(captureThrow, expectedControlError);
  assert.deepEqual(
    routeExactInputSinglePathInterruptible(
      value,
      request(value),
      { shouldInterrupt: 1 as unknown as () => boolean },
    ),
    expectedControlError,
  );

  let getterReads = 0;
  let callbackCalls = 0;
  const captured = routeExactInputSinglePathInterruptible(
    value,
    request(value),
    {
      get shouldInterrupt() {
        getterReads += 1;
        return (checkpoint: ExactInputSinglePathInterruptionCheckpoint) => {
          callbackCalls += 1;
          assertDeepFrozen(checkpoint);
          assert.equal(Reflect.set(checkpoint, 'expansions', 999), false);
          return false;
        };
      },
    },
  );
  assert.equal(getterReads, 1);
  assert.equal(callbackCalls, traceIndependently(value, request(value)).totalExpansions);
  assertDeepFrozen(captured);

  let invocationReads = 0;
  const invocationThrow = routeExactInputSinglePathInterruptible(
    value,
    request(value),
    {
      get shouldInterrupt() {
        invocationReads += 1;
        return () => {
          throw new Error('private invocation prose');
        };
      },
    },
  );
  assert.deepEqual(invocationThrow, expectedControlError);
  assert.equal(invocationReads, 1);
  assert.deepEqual(Object.keys(invocationThrow), ['status', 'error']);
  assertDeepFrozen(invocationThrow);

  const afterIncumbent = snapshot([
    pool('a-direct', 'A', 1_000n, 'D', 1_000n),
    pool('z-extra', 'A', 1_000n, 'B', 1_000n),
  ]);
  const noPartial = routeExactInputSinglePathInterruptible(
    afterIncumbent,
    request(afterIncumbent, { maxHops: 1 }),
    {
      shouldInterrupt(checkpoint) {
        if (checkpoint.expansions === 1) throw new Error('hide incumbent');
        return false;
      },
    },
  );
  assert.deepEqual(noPartial, expectedControlError);
  assert.equal('plan' in noPartial, false);
});

void test('deep-freezes callback graphs/results without mutating or aliasing caller inputs', () => {
  const value = classicGraph();
  const routingRequest = request(value);
  const snapshotBefore = structuredClone(value);
  const requestBefore = structuredClone(routingRequest);
  const seen: ExactInputSinglePathInterruptionCheckpoint[] = [];
  const actual = routeExactInputSinglePathInterruptible(
    value,
    routingRequest,
    {
      shouldInterrupt(checkpoint) {
        seen.push(checkpoint);
        assertDeepFrozen(checkpoint);
        if (checkpoint.incumbent !== null) {
          for (const sourcePool of value.pools) {
            assert.notEqual(checkpoint.incumbent, sourcePool);
            assert.equal(checkpoint.incumbent.hops.includes(sourcePool as never), false);
          }
        }
        return false;
      },
    },
  );
  assert.deepEqual(value, snapshotBefore);
  assert.deepEqual(routingRequest, requestBefore);
  assert.equal(Object.isFrozen(value), false);
  assert.equal(Object.isFrozen(routingRequest), false);
  assert.equal(seen.length, traceIndependently(value, routingRequest).totalExpansions);
  assertDeepFrozen(actual);

  const firstPool = value.pools[0] as { reserve0: bigint };
  firstPool.reserve0 = 1n;
  const mutableRequest = routingRequest as { amountIn: bigint };
  mutableRequest.amountIn = 1n;
  assert.equal(actual.status, 'success');
  if (actual.status === 'success') {
    assert.equal(actual.plan.receipt.amountIn, 100n);
  }
});

void test('keeps all integrated canonical case bytes, file hashes, run hashes, and statuses unchanged', async () => {
  const vectors = [
    {
      filename: 'success.json',
      bytes: 1306,
      fileHash: '35f4fde18b840bbaec6862264024ef22ab2c78f303d003635add6cd0a1735e3f',
      runHash: 'sha256:c4b3c03b960ba1405c1b1f86a92fd7e6d51d5a5a59ab22caefd689b18efc4011',
      status: 'success',
    },
    {
      filename: 'no-route.json',
      bytes: 1077,
      fileHash: 'dfb4ebd1e382efcc1961101c55223dd755a39891c3760e500bbf8ab4a3faeb23',
      runHash: 'sha256:e93bc0384de0d99417a10ed0fc8b86cfb44645253cf087e38a0e5f7db6be8d90',
      status: 'no-route',
    },
    {
      filename: 'no-plan.json',
      bytes: 927,
      fileHash: '05db31a8660fe3a3b71058f282f86ddd0d6d63bc929a8725a8aecccc96971ac1',
      runHash: 'sha256:abc4690200fa7aab7f82b16c1d9c4a4e88535449e02b449e1210d54fa498fed4',
      status: 'no-plan',
    },
  ] as const;
  for (const vector of vectors) {
    const canonicalJson = await readFile(join(FIXTURE_DIRECTORY, vector.filename), 'utf8');
    assert.equal(Buffer.byteLength(canonicalJson, 'utf8'), vector.bytes);
    assert.equal(
      createHash('sha256').update(canonicalJson, 'utf8').digest('hex'),
      vector.fileHash,
    );
    const parsed = parseAndVerifyCanonicalSinglePathRouterCase(canonicalJson);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) continue;
    assert.equal(parsed.value.canonicalJson, canonicalJson);
    assert.equal(parsed.value.run.determinismHash, vector.runHash);
    assert.equal(parsed.value.run.routerResult.status, vector.status);
  }
});
