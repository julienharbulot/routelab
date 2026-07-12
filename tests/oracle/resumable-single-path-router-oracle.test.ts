import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../../src/domain/index.ts';
import {
  resumeExactInputSinglePath,
  routeExactInputSinglePath,
  routeExactInputSinglePathInterruptible,
  routeExactInputSinglePathResumable,
  type ExactInputSinglePathInterruptionCheckpoint,
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
  readonly expansions: number;
  readonly enumeratedCandidates: number;
  readonly replayedCandidates: number;
  readonly rejectedCandidates: number;
  readonly incumbent: Receipt | null;
}

interface Trace {
  readonly boundaries: readonly Boundary[];
  readonly totalExpansions: number;
}

interface Search {
  readonly expansions: number;
  readonly enumeratedCandidates: number;
  readonly replayedCandidates: number;
  readonly rejectedCandidates: number;
  readonly termination: 'complete' | 'work-limit' | 'interrupted';
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
      readonly reason: 'work-limit' | 'interrupted';
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
    snapshotId: 'resume-oracle',
    snapshotChecksum: 'resume-oracle-checksum',
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
  const states = new Map(
    value.pools.map((entry) => [entry.poolId, { ...entry }]),
  );
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

function trace(
  value: LiquiditySnapshot,
  routingRequest: ExactInputSinglePathRouterRequest,
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
  let incumbent: Receipt | undefined;
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
  visit(
    routingRequest.assetIn,
    [],
    new Set([routingRequest.assetIn]),
    new Set(),
  );
  assert.equal(boundaries.length, expansions + 1);
  return { boundaries, totalExpansions: expansions };
}

function expectedOutcome(
  oracleTrace: Trace,
  expansion: number,
  termination: Search['termination'],
): Outcome {
  const boundary = oracleTrace.boundaries[expansion];
  assert.ok(boundary !== undefined);
  const search: Search = {
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

function assertResult(
  actual: ExactInputSinglePathResumableResult,
  expected: Outcome,
): void {
  assert.equal(actual.status, expected.status);
  if (expected.status === 'success') {
    assert.equal(actual.status, 'success');
    assert.deepEqual(actual.plan.receipt, expected.receipt);
    assert.deepEqual(actual.plan.search, expected.search);
    assert.equal(actual.checkpoint === null, expected.search.termination === 'complete');
  } else if (expected.status === 'no-route') {
    assert.equal(actual.status, 'no-route');
    assert.equal(actual.reason, expected.reason);
    assert.deepEqual(actual.search, expected.search);
    assert.equal(actual.checkpoint, null);
  } else {
    assert.equal(actual.status, 'no-plan');
    assert.equal(actual.reason, expected.reason);
    assert.deepEqual(actual.search, expected.search);
    assert.notEqual(actual.checkpoint, null);
  }
  if ('checkpoint' in actual && actual.checkpoint !== null) {
    assertToken(actual.checkpoint, expected);
  }
  assertDeepFrozen(actual);
}

function assertToken(token: ExactInputSinglePathResumableCheckpoint, expected: Outcome): void {
  assert.equal(token.kind, 'routelab.in-memory-router-checkpoint.v1');
  assert.equal(token.expansions, expected.search.expansions);
  assert.equal(token.enumeratedCandidates, expected.search.enumeratedCandidates);
  assert.equal(token.replayedCandidates, expected.search.replayedCandidates);
  assert.equal(token.rejectedCandidates, expected.search.rejectedCandidates);
  assert.deepEqual(token.incumbent, expected.status === 'success' ? expected.receipt : null);
  assert.equal('maxExpansions' in token, false);
  assert.equal('frontier' in token, false);
  assert.equal('snapshot' in token, false);
  assert.equal('request' in token, false);
  assertDeepFrozen(token);
}

function tokenFrom(result: ExactInputSinglePathResumableResult): ExactInputSinglePathResumableCheckpoint {
  assert.equal('checkpoint' in result, true);
  if (!('checkpoint' in result) || result.checkpoint === null) {
    throw new Error('oracle scenario requires a paused token');
  }
  return result.checkpoint;
}

function withoutToken(result: ExactInputSinglePathResumableResult): unknown {
  if (!('checkpoint' in result)) return result;
  const projected = { ...result } as Record<string, unknown>;
  delete projected['checkpoint'];
  return projected;
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) assertDeepFrozen(Reflect.get(value, key), seen);
}

function partitions(total: number): readonly (readonly number[])[] {
  const intermediate = Array.from({ length: total }, (_value, index) => index);
  const result: number[][] = [];
  for (let mask = 0; mask < 1 << intermediate.length; mask += 1) {
    result.push([
      ...intermediate.filter((_value, index) => (mask & (1 << index)) !== 0),
      total,
    ]);
  }
  return result;
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

void test('matches every work-limit partition and every interrupted boundary to one cumulative trace', () => {
  const value = routingGraph();
  const baseRequest = request(value);
  const oracleTrace = trace(value, baseRequest);
  assert.equal(oracleTrace.totalExpansions, 4);

  for (const caps of partitions(oracleTrace.totalExpansions)) {
    let actual: ExactInputSinglePathResumableResult | undefined;
    for (const [index, cap] of caps.entries()) {
      if (index === 0) {
        actual = routeExactInputSinglePathResumable(
          value,
          { ...baseRequest, maxExpansions: cap },
          { shouldInterrupt: () => false },
        );
      } else {
        assert.ok(actual !== undefined);
        actual = resumeExactInputSinglePath(tokenFrom(actual), cap, {
          shouldInterrupt: () => false,
        });
      }
      const termination = cap === oracleTrace.totalExpansions ? 'complete' : 'work-limit';
      const expected = expectedOutcome(oracleTrace, cap, termination);
      assert.ok(actual !== undefined);
      assertResult(actual, expected);

      const oneShot = routeExactInputSinglePathResumable(
        value,
        { ...baseRequest, maxExpansions: cap },
        { shouldInterrupt: () => false },
      );
      assertResult(oneShot, expected);
      assert.deepEqual(withoutToken(actual), withoutToken(oneShot));
    }
  }

  for (let boundary = 0; boundary < oracleTrace.totalExpansions; boundary += 1) {
    const paused = routeExactInputSinglePathResumable(
      value,
      baseRequest,
      {
        shouldInterrupt(checkpoint) {
          return checkpoint.expansions === boundary;
        },
      },
    );
    assertResult(paused, expectedOutcome(oracleTrace, boundary, 'interrupted'));
    const completed = resumeExactInputSinglePath(
      tokenFrom(paused),
      oracleTrace.totalExpansions,
      { shouldInterrupt: () => false },
    );
    assertResult(
      completed,
      expectedOutcome(oracleTrace, oracleTrace.totalExpansions, 'complete'),
    );
  }
});

void test('reuses and branches tokens in both orders without consumption or cross-mutation', () => {
  const value = routingGraph();
  const baseRequest = request(value);
  const oracleTrace = trace(value, baseRequest);
  const initial = routeExactInputSinglePathResumable(
    value,
    { ...baseRequest, maxExpansions: 1 },
    { shouldInterrupt: () => false },
  );
  const source = tokenFrom(initial);
  const sourceBefore = structuredClone(source);

  const branchTwo = resumeExactInputSinglePath(source, 2, {
    shouldInterrupt: () => false,
  });
  const branchFour = resumeExactInputSinglePath(source, 4, {
    shouldInterrupt: () => false,
  });
  const repeatFour = resumeExactInputSinglePath(source, 4, {
    shouldInterrupt: () => false,
  });
  assertResult(branchTwo, expectedOutcome(oracleTrace, 2, 'work-limit'));
  assertResult(branchFour, expectedOutcome(oracleTrace, 4, 'complete'));
  assert.deepEqual(branchFour, repeatFour);
  assert.deepEqual(source, sourceBefore);
  assert.notEqual(tokenFrom(branchTwo), source);

  const viaThree = resumeExactInputSinglePath(tokenFrom(branchTwo), 3, {
    shouldInterrupt: () => false,
  });
  const viaFour = resumeExactInputSinglePath(tokenFrom(viaThree), 4, {
    shouldInterrupt: () => false,
  });
  assert.deepEqual(viaFour, branchFour);

  const reverseFour = resumeExactInputSinglePath(source, 4, {
    shouldInterrupt: () => false,
  });
  const reverseTwo = resumeExactInputSinglePath(source, 2, {
    shouldInterrupt: () => false,
  });
  assert.deepEqual(reverseFour, branchFour);
  assert.deepEqual(withoutToken(reverseTwo), withoutToken(branchTwo));
  assert.notEqual(tokenFrom(reverseTwo), tokenFrom(branchTwo));
  assert.deepEqual(tokenFrom(reverseTwo), tokenFrom(branchTwo));
  assertDeepFrozen(source);
});

void test('returns fresh equal-boundary tokens and enforces token/cap/control precedence', () => {
  const value = routingGraph();
  const sourceResult = routeExactInputSinglePathResumable(
    value,
    request(value, { maxExpansions: 1 }),
    { shouldInterrupt: () => false },
  );
  const source = tokenFrom(sourceResult);
  let equalControlReads = 0;
  const equalCap = resumeExactInputSinglePath(source, 1, {
    get shouldInterrupt(): (
      checkpoint: ExactInputSinglePathInterruptionCheckpoint,
    ) => boolean {
      equalControlReads += 1;
      throw new Error('cap must win');
    },
  });
  assert.equal(equalControlReads, 0);
  const equalToken = tokenFrom(equalCap);
  assert.notEqual(equalToken, source);
  assert.deepEqual(equalToken, source);
  assert.equal(equalCap.status, 'success');
  if (equalCap.status === 'success') assert.equal(equalCap.plan.search.termination, 'work-limit');

  const immediate = resumeExactInputSinglePath(source, 4, {
    shouldInterrupt: () => true,
  });
  const immediateToken = tokenFrom(immediate);
  assert.notEqual(immediateToken, source);
  assert.deepEqual(immediateToken, source);
  assert.equal(immediate.status, 'success');
  if (immediate.status === 'success') {
    assert.equal(immediate.plan.search.termination, 'interrupted');
  }

  const jsonClone = JSON.parse(
    JSON.stringify(source, (_key, value_: unknown) =>
      typeof value_ === 'bigint' ? value_.toString(10) : value_,
    ),
  ) as ExactInputSinglePathResumableCheckpoint;
  const invalidTokens = [
    { ...source } as ExactInputSinglePathResumableCheckpoint,
    structuredClone(source),
    jsonClone,
    new Proxy(source, {
      get() {
        throw new Error('proxy fields must not be read');
      },
    }),
    null as unknown as ExactInputSinglePathResumableCheckpoint,
    1 as unknown as ExactInputSinglePathResumableCheckpoint,
  ];
  for (const invalidToken of invalidTokens) {
    let reads = 0;
    const invalid = resumeExactInputSinglePath(invalidToken, Number.NaN, {
      get shouldInterrupt() {
        reads += 1;
        return () => false;
      },
    });
    assert.deepEqual(invalid, {
      status: 'invalid-resume',
      error: { code: 'invalid-router-checkpoint', field: 'checkpoint' },
    });
    assert.equal(reads, 0);
    assertDeepFrozen(invalid);
  }

  for (const cap of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, -1, 2 ** 53, 0]) {
    let reads = 0;
    const invalid = resumeExactInputSinglePath(source, cap, {
      get shouldInterrupt() {
        reads += 1;
        return () => false;
      },
    });
    assert.deepEqual(invalid, {
      status: 'invalid-resume',
      error: { code: 'invalid-resume-max-expansions', field: 'maxExpansions' },
    });
    assert.equal(reads, 0);
    assertDeepFrozen(invalid);
  }
});

void test('resume control failures discard partial branches and leave the reusable source intact', () => {
  const value = routingGraph();
  const oracleTrace = trace(value, request(value));
  let invalidControlReads = 0;
  const invalidInitial = routeExactInputSinglePathResumable(
    value,
    request(value, { amountIn: 0n }),
    {
      get shouldInterrupt() {
        invalidControlReads += 1;
        return () => false;
      },
    },
  );
  assert.equal(invalidInitial.status, 'invalid-request');
  assert.equal(invalidControlReads, 0);
  assert.equal('checkpoint' in invalidInitial, false);

  const source = tokenFrom(
    routeExactInputSinglePathResumable(
      value,
      request(value, { maxExpansions: 1 }),
      { shouldInterrupt: () => false },
    ),
  );
  const sourceBefore = structuredClone(source);

  const getterFailure = resumeExactInputSinglePath(source, 4, {
    get shouldInterrupt(): (
      checkpoint: ExactInputSinglePathInterruptionCheckpoint,
    ) => boolean {
      throw new Error('private getter prose');
    },
  });
  assert.deepEqual(getterFailure, {
    status: 'control-error',
    error: { code: 'interruption-check-failed' },
  });
  assert.equal('checkpoint' in getterFailure, false);
  assert.deepEqual(
    resumeExactInputSinglePath(source, 4, {
      shouldInterrupt: 1 as unknown as () => boolean,
    }),
    getterFailure,
  );

  let getterReads = 0;
  let calls = 0;
  const invocationFailure = resumeExactInputSinglePath(source, 4, {
    get shouldInterrupt() {
      getterReads += 1;
      return () => {
        calls += 1;
        if (calls === 2) throw new Error('private invocation prose');
        return false;
      };
    },
  });
  assert.deepEqual(invocationFailure, getterFailure);
  assert.equal(getterReads, 1);
  assert.equal(calls, 2);
  assert.deepEqual(source, sourceBefore);

  const recovered = resumeExactInputSinglePath(source, 4, {
    shouldInterrupt: () => false,
  });
  assertResult(recovered, expectedOutcome(oracleTrace, 4, 'complete'));
});

void test('captures caller state defensively and supports mutation plus reentrant branch resumes', () => {
  const value = routingGraph();
  const routingRequest = request(value, { maxExpansions: 1 });
  const frozenInput = structuredClone(value);
  const frozenRequest = structuredClone(routingRequest);
  const oracleTrace = trace(frozenInput, { ...frozenRequest, maxExpansions: 1_000 });
  const source = tokenFrom(
    routeExactInputSinglePathResumable(value, routingRequest, {
      shouldInterrupt: () => false,
    }),
  );

  const mutableSnapshot = value as unknown as {
    snapshotId: string;
    pools: ConstantProductPool[];
  };
  const mutableRequest = routingRequest as unknown as {
    amountIn: bigint;
    assetIn: string;
    assetOut: string;
    maxHops: number;
  };
  mutableSnapshot.snapshotId = 'substituted';
  mutableSnapshot.pools = [pool('substitute', 'A', 1n, 'C', 1n)];
  mutableRequest.amountIn = 1n;
  mutableRequest.assetIn = 'C';
  mutableRequest.assetOut = 'A';
  mutableRequest.maxHops = 1;

  let nested: ExactInputSinglePathResumableResult | undefined;
  let callbackReads = 0;
  const outer = resumeExactInputSinglePath(source, 4, {
    get shouldInterrupt() {
      callbackReads += 1;
      return (checkpoint: ExactInputSinglePathInterruptionCheckpoint) => {
        assertDeepFrozen(checkpoint);
        assert.equal(Reflect.set(checkpoint, 'expansions', 999), false);
        if (nested === undefined) {
          nested = resumeExactInputSinglePath(source, 2, {
            shouldInterrupt: () => false,
          });
        }
        return false;
      };
    },
  });
  assert.equal(callbackReads, 1);
  assertResult(outer, expectedOutcome(oracleTrace, 4, 'complete'));
  assert.ok(nested !== undefined);
  assertResult(nested, expectedOutcome(oracleTrace, 2, 'work-limit'));
  assert.equal(outer.status, 'success');
  if (outer.status === 'success') {
    assert.equal(outer.plan.receipt.amountIn, 100n);
    assert.equal(outer.plan.receipt.amountOut, 165n);
  }
  assertDeepFrozen(source);
});

void test('covers rejections, objective ties, huge values, monotonic incumbents, and permutations', () => {
  const rejected = snapshot([
    pool('a-zero', 'A', 1_000n, 'C', 1n),
    pool('b-good', 'A', 1n, 'C', 2n),
    pool('z-extra', 'A', 1_000n, 'B', 1_000n),
  ]);
  const rejectedRequest = request(rejected, {
    amountIn: 1n,
    maxHops: 1,
  });
  const rejectedTrace = trace(rejected, rejectedRequest);
  const rejectedAtOne = routeExactInputSinglePathResumable(
    rejected,
    { ...rejectedRequest, maxExpansions: 1 },
    { shouldInterrupt: () => false },
  );
  assertResult(rejectedAtOne, expectedOutcome(rejectedTrace, 1, 'work-limit'));
  assert.equal(tokenFrom(rejectedAtOne).incumbent, null);
  const rejectedComplete = resumeExactInputSinglePath(
    tokenFrom(rejectedAtOne),
    rejectedTrace.totalExpansions,
    { shouldInterrupt: () => false },
  );
  assertResult(
    rejectedComplete,
    expectedOutcome(rejectedTrace, rejectedTrace.totalExpansions, 'complete'),
  );

  const fewerHop = snapshot([
    pool('a-ab', 'A', 100n, 'B', 200n),
    pool('a-bc', 'B', 100n, 'C', 100n),
    pool('z-direct', 'A', 100n, 'C', 100n),
  ]);
  const fewerRequest = request(fewerHop);
  const fewerTrace = trace(fewerHop, fewerRequest);
  const fewerFinal = routeExactInputSinglePathResumable(
    fewerHop,
    { ...fewerRequest, maxExpansions: fewerTrace.totalExpansions },
    { shouldInterrupt: () => false },
  );
  assertResult(
    fewerFinal,
    expectedOutcome(fewerTrace, fewerTrace.totalExpansions, 'complete'),
  );
  assert.equal(fewerFinal.status, 'success');
  if (fewerFinal.status === 'success') {
    assert.deepEqual(fewerFinal.plan.receipt.hops.map(({ poolId }) => poolId), ['z-direct']);
  }

  const utf16 = snapshot([
    pool('\u{1f600}', 'A', 100n, 'C', 100n),
    pool('\ue000', 'A', 100n, 'C', 100n),
  ]);
  const utf16Request = request(utf16, { maxHops: 1 });
  const utf16Trace = trace(utf16, utf16Request);
  const utf16Expected = expectedOutcome(
    utf16Trace,
    utf16Trace.totalExpansions,
    'complete',
  );
  for (const order of permutations(utf16.pools)) {
    const paused = routeExactInputSinglePathResumable(
      snapshot(order),
      { ...utf16Request, maxExpansions: 1 },
      { shouldInterrupt: () => false },
    );
    const completed = resumeExactInputSinglePath(
      tokenFrom(paused),
      utf16Trace.totalExpansions,
      { shouldInterrupt: () => false },
    );
    assertResult(completed, utf16Expected);
  }

  const huge = 10n ** 80n;
  const hugeSnapshot = snapshot([
    pool('a-small', 'A', huge, 'C', 2n * huge),
    pool('z-large', 'A', huge, 'C', 2n * huge + 2n),
  ]);
  const hugeRequest = request(hugeSnapshot, { amountIn: huge, maxHops: 1 });
  const hugeTrace = trace(hugeSnapshot, hugeRequest);
  const hugePause = routeExactInputSinglePathResumable(
    hugeSnapshot,
    { ...hugeRequest, maxExpansions: 1 },
    { shouldInterrupt: () => false },
  );
  const hugeComplete = resumeExactInputSinglePath(
    tokenFrom(hugePause),
    hugeTrace.totalExpansions,
    { shouldInterrupt: () => false },
  );
  assertResult(
    hugeComplete,
    expectedOutcome(hugeTrace, hugeTrace.totalExpansions, 'complete'),
  );
  assert.equal(hugeComplete.status, 'success');
  if (hugeComplete.status === 'success') {
    assert.equal(hugeComplete.plan.receipt.amountOut, huge + 1n);
  }

  let previous: Receipt | undefined;
  for (let cap = 0; cap < fewerTrace.totalExpansions; cap += 1) {
    const paused = routeExactInputSinglePathResumable(
      fewerHop,
      { ...fewerRequest, maxExpansions: cap },
      { shouldInterrupt: () => false },
    );
    const incumbent = tokenFrom(paused).incumbent;
    if (incumbent === null) continue;
    if (previous !== undefined) assert.ok(compareReceipts(incumbent, previous) <= 0);
    previous = incumbent;
  }

  const cyclePools = [
    pool('a-direct', 'A', 1_000n, 'C', 1_000n),
    pool('z-direct', 'A', 1_000n, 'C', 1_000n),
    pool('ab', 'A', 1_000n, 'B', 1_000n),
    pool('bc', 'B', 1_000n, 'C', 1_000n),
    pool('ca', 'C', 1_000n, 'A', 1_000n),
  ];
  let reference: ExactInputSinglePathResumableResult | undefined;
  for (const order of permutations(cyclePools)) {
    const value = snapshot(order);
    const input = request(value, { maxHops: 3 });
    const oracleTrace = trace(value, input);
    const initial = routeExactInputSinglePathResumable(
      value,
      { ...input, maxExpansions: 1 },
      { shouldInterrupt: () => false },
    );
    const completed = resumeExactInputSinglePath(
      tokenFrom(initial),
      oracleTrace.totalExpansions,
      { shouldInterrupt: () => false },
    );
    assertResult(
      completed,
      expectedOutcome(oracleTrace, oracleTrace.totalExpansions, 'complete'),
    );
    if (reference === undefined) reference = completed;
    else assert.deepEqual(completed, reference);
  }
});

void test('preserves RLT-040, legacy, and canonical vectors unchanged', async () => {
  const value = routingGraph();
  const baseRequest = request(value);
  const oracleTrace = trace(value, baseRequest);
  for (let cap = 0; cap <= oracleTrace.totalExpansions; cap += 1) {
    const termination = cap === oracleTrace.totalExpansions ? 'complete' : 'work-limit';
    const expected = expectedOutcome(oracleTrace, cap, termination);
    const resumable = routeExactInputSinglePathResumable(
      value,
      { ...baseRequest, maxExpansions: cap },
      { shouldInterrupt: () => false },
    );
    assertResult(resumable, expected);
    const interruptible = routeExactInputSinglePathInterruptible(
      value,
      { ...baseRequest, maxExpansions: cap },
      { shouldInterrupt: () => false },
    );
    assert.deepEqual(withoutToken(resumable), interruptible);
    const legacy = routeExactInputSinglePath(value, {
      ...baseRequest,
      maxExpansions: cap,
    });
    assert.deepEqual(withoutToken(resumable), legacy);
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

void test('public tokens expose only the frozen opaque field contract in exact order', () => {
  const value = routingGraph();
  const paused = routeExactInputSinglePathResumable(
    value,
    request(value, { maxExpansions: 1 }),
    { shouldInterrupt: () => false },
  );
  const token = tokenFrom(paused);
  assert.deepEqual(Object.keys(token), [
    'kind',
    'snapshotId',
    'snapshotChecksum',
    'assetIn',
    'assetOut',
    'amountIn',
    'maxHops',
    'expansions',
    'enumeratedCandidates',
    'replayedCandidates',
    'rejectedCandidates',
    'incumbent',
  ]);
  assert.equal(token.amountIn, 100n);
  assert.equal(token.maxHops, 2);
  assertDeepFrozen(paused);
});
