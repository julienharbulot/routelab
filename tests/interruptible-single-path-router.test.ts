import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../src/domain/index.ts';
import {
  routeExactInputSinglePath,
  routeExactInputSinglePathInterruptible,
  type ExactInputSinglePathInterruptionCheckpoint,
  type ExactInputSinglePathRouterRequest,
  type ExactInputSinglePathRouterResult,
} from '../src/router/single-path/index.ts';

function pool(
  poolId: string,
  asset0: string,
  reserve0: bigint,
  asset1: string,
  reserve1: bigint,
): ConstantProductPool {
  return {
    poolId,
    asset0,
    reserve0,
    asset1,
    reserve1,
    feeChargedNumerator: 0n,
    feeDenominator: 1n,
  };
}

function snapshot(pools: readonly ConstantProductPool[]): LiquiditySnapshot {
  return {
    snapshotId: 'interruptible-snapshot',
    snapshotChecksum: 'interruptible-checksum',
    pools,
  };
}

function request(
  overrides: Partial<ExactInputSinglePathRouterRequest> = {},
): ExactInputSinglePathRouterRequest {
  return {
    snapshotId: 'interruptible-snapshot',
    snapshotChecksum: 'interruptible-checksum',
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 100n,
    maxHops: 2,
    maxExpansions: 100,
    ...overrides,
  };
}

function routingGraph(): LiquiditySnapshot {
  return snapshot([
    pool('a-direct-ac', 'A', 1_000n, 'C', 1_000n),
    pool('b-hop-ab', 'A', 1_000n, 'B', 2_000n),
    pool('c-hop-bc', 'B', 2_000n, 'C', 2_000n),
  ]);
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

interface MutablePool {
  poolId: string;
  asset0: string;
  reserve0: bigint;
  asset1: string;
  reserve1: bigint;
  feeChargedNumerator: bigint;
  feeDenominator: bigint;
}

interface MutableSnapshot {
  snapshotId: string;
  snapshotChecksum: string;
  pools: MutablePool[];
}

interface MutableRequest {
  snapshotId: string;
  snapshotChecksum: string;
  assetIn: string;
  assetOut: string;
  amountIn: bigint;
  maxHops: number;
  maxExpansions: number;
}

function legacyCheckpoint(result: ExactInputSinglePathRouterResult) {
  assert.notEqual(result.status, 'invalid-request');
  if (result.status === 'invalid-request') throw new Error('expected a valid legacy result');
  const search = result.status === 'success' ? result.plan.search : result.search;
  return {
    expansions: search.expansions,
    enumeratedCandidates: search.enumeratedCandidates,
    replayedCandidates: search.replayedCandidates,
    rejectedCandidates: search.rejectedCandidates,
    incumbent: result.status === 'success' ? result.plan.receipt : null,
  };
}

function permutations<T>(values: readonly T[]): readonly (readonly T[])[] {
  if (values.length === 0) return [[]];
  const result: T[][] = [];
  for (const [index, value] of values.entries()) {
    const remaining = [...values.slice(0, index), ...values.slice(index + 1)];
    for (const permutation of permutations(remaining)) {
      result.push([value, ...permutation]);
    }
  }
  return result;
}

void test('presents every reachable boundary with separate establishment and search accounting', () => {
  const inputSnapshot = routingGraph();
  const checkpoints: ExactInputSinglePathInterruptionCheckpoint[] = [];
  const complete = routeExactInputSinglePathInterruptible(
    inputSnapshot,
    request(),
    {
      shouldInterrupt(checkpoint) {
        checkpoints.push(checkpoint);
        return false;
      },
    },
  );

  assert.deepEqual(
    checkpoints.map(({ expansions }) => expansions),
    [0, 1, 2, 3],
  );
  assert.equal(complete.status, 'success');
  if (complete.status !== 'success') return;
  assert.equal(complete.plan.search.termination, 'complete');
  assert.equal(complete.plan.search.expansions, 4);
  assert.equal(complete.plan.receipt.amountOut, 165n);
  assert.deepEqual(complete.plan.search.establishment, {
    enumeratedCandidates: 1,
    replayedCandidates: 1,
    rejectedCandidates: 0,
  });

  for (const checkpoint of checkpoints) {
    const legacy = routeExactInputSinglePath(
      inputSnapshot,
      request({ maxExpansions: checkpoint.expansions }),
    );
    const legacyValue = legacyCheckpoint(legacy);
    assert.deepEqual(checkpoint.establishment, {
      enumeratedCandidates: 1,
      replayedCandidates: 1,
      rejectedCandidates: 0,
    });
    assert.deepEqual(
      {
        expansions: checkpoint.expansions,
        enumeratedCandidates: checkpoint.enumeratedCandidates,
        replayedCandidates: checkpoint.replayedCandidates,
        rejectedCandidates: checkpoint.rejectedCandidates,
      },
      {
        expansions: legacyValue.expansions,
        enumeratedCandidates: legacyValue.enumeratedCandidates,
        replayedCandidates: legacyValue.replayedCandidates,
        rejectedCandidates: legacyValue.rejectedCandidates,
      },
    );
    assert.notEqual(checkpoint.incumbent, null);
    assert.equal(
      checkpoint.incumbent?.amountOut,
      legacyValue.incumbent?.amountOut ?? 90n,
    );
    assertDeepFrozen(checkpoint);

    const interrupted = routeExactInputSinglePathInterruptible(
      inputSnapshot,
      request(),
      {
        shouldInterrupt(current) {
          return current.expansions === checkpoint.expansions;
        },
      },
    );
    assert.equal(interrupted.status, 'success');
    if (interrupted.status === 'success') {
      assert.equal(interrupted.plan.search.termination, 'interrupted');
      assert.deepEqual(interrupted.plan.receipt, checkpoint.incumbent);
      assert.deepEqual(
        { ...interrupted.plan.search, termination: undefined },
        {
          establishment: checkpoint.establishment,
          expansions: checkpoint.expansions,
          enumeratedCandidates: checkpoint.enumeratedCandidates,
          replayedCandidates: checkpoint.replayedCandidates,
          rejectedCandidates: checkpoint.rejectedCandidates,
          termination: undefined,
        },
      );
    }
    assertDeepFrozen(interrupted);
  }
});

void test('orders complete before work-limit and work-limit before callback', () => {
  const direct = snapshot([pool('direct-ac', 'A', 1_000n, 'C', 1_000n)]);
  let completionCalls = 0;
  const completed = routeExactInputSinglePathInterruptible(
    direct,
    request({ maxHops: 1, maxExpansions: 1 }),
    {
      shouldInterrupt() {
        completionCalls += 1;
        return false;
      },
    },
  );
  assert.equal(completed.status, 'success');
  if (completed.status === 'success') {
    assert.equal(completed.plan.search.termination, 'complete');
  }
  assert.equal(completionCalls, 1);

  let zeroBudgetCalls = 0;
  const zeroBudget = routeExactInputSinglePathInterruptible(
    direct,
    request({ maxHops: 1, maxExpansions: 0 }),
    {
      shouldInterrupt() {
        zeroBudgetCalls += 1;
        throw new Error('budget must win');
      },
    },
  );
  assert.equal(zeroBudget.status, 'success');
  if (zeroBudget.status === 'success') {
    assert.equal(zeroBudget.plan.search.termination, 'work-limit');
    assert.equal(zeroBudget.plan.search.expansions, 0);
    assert.equal(zeroBudget.plan.receipt.hops[0]?.poolId, 'direct-ac');
  }
  assert.equal(zeroBudgetCalls, 0);

  let boundedCalls = 0;
  const bounded = routeExactInputSinglePathInterruptible(
    routingGraph(),
    request({ maxExpansions: 1 }),
    {
      shouldInterrupt() {
        boundedCalls += 1;
        return false;
      },
    },
  );
  assert.equal(bounded.status, 'success');
  if (bounded.status === 'success') {
    assert.equal(bounded.plan.search.termination, 'work-limit');
    assert.equal(bounded.plan.search.expansions, 1);
  }
  assert.equal(boundedCalls, 1);
});

void test('distinguishes interrupted, work-limit, and complete no-route without incumbents', () => {
  const disconnected = snapshot([
    pool('component-ab', 'A', 1_000n, 'B', 1_000n),
    pool('component-cd', 'C', 1_000n, 'D', 1_000n),
  ]);
  const disconnectedRequest = request({ assetOut: 'D', maxHops: 2 });

  const interrupted = routeExactInputSinglePathInterruptible(
    disconnected,
    disconnectedRequest,
    { shouldInterrupt: () => true },
  );
  assert.deepEqual(interrupted, {
    status: 'no-plan',
    reason: 'interrupted',
    search: {
      establishment: {
        enumeratedCandidates: 0,
        replayedCandidates: 0,
        rejectedCandidates: 0,
      },
      expansions: 0,
      enumeratedCandidates: 0,
      replayedCandidates: 0,
      rejectedCandidates: 0,
      termination: 'interrupted',
    },
  });

  const workLimit = routeExactInputSinglePathInterruptible(
    disconnected,
    { ...disconnectedRequest, maxExpansions: 0 },
    { shouldInterrupt: () => true },
  );
  assert.equal(workLimit.status, 'no-plan');
  if (workLimit.status === 'no-plan') assert.equal(workLimit.reason, 'work-limit');

  const complete = routeExactInputSinglePathInterruptible(
    disconnected,
    disconnectedRequest,
    { shouldInterrupt: () => false },
  );
  assert.equal(complete.status, 'no-route');
  if (complete.status === 'no-route') {
    assert.equal(complete.reason, 'no-candidate');
    assert.equal(complete.search.termination, 'complete');
  }
});

void test('validates before one-time control capture and maps every control failure atomically', () => {
  const inputSnapshot = routingGraph();
  let invalidControlReads = 0;
  const invalid = routeExactInputSinglePathInterruptible(
    inputSnapshot,
    request({ amountIn: 0n }),
    {
      get shouldInterrupt(): (
        checkpoint: ExactInputSinglePathInterruptionCheckpoint,
      ) => boolean {
        invalidControlReads += 1;
        throw new Error('must not be read');
      },
    },
  );
  assert.equal(invalid.status, 'invalid-request');
  assert.equal(invalidControlReads, 0);

  const captureThrow = routeExactInputSinglePathInterruptible(
    inputSnapshot,
    request(),
    {
      get shouldInterrupt(): (
        checkpoint: ExactInputSinglePathInterruptionCheckpoint,
      ) => boolean {
        throw new Error('private capture prose');
      },
    },
  );
  assert.deepEqual(captureThrow, {
    status: 'control-error',
    error: { code: 'interruption-check-failed' },
  });
  assertDeepFrozen(captureThrow);

  const nonFunction = routeExactInputSinglePathInterruptible(
    inputSnapshot,
    request(),
    { shouldInterrupt: 1 as unknown as () => boolean },
  );
  assert.deepEqual(nonFunction, captureThrow);

  let controlReads = 0;
  const invocationThrow = routeExactInputSinglePathInterruptible(
    inputSnapshot,
    request(),
    {
      get shouldInterrupt() {
        controlReads += 1;
        return () => {
          throw new Error('private predicate prose');
        };
      },
    },
  );
  assert.deepEqual(invocationThrow, captureThrow);
  assert.equal(controlReads, 1);
  assert.deepEqual(Object.keys(invocationThrow), ['status', 'error']);
});

void test('replay rejection is atomic and checkpoints retain a validated incumbent only', () => {
  const inputSnapshot = snapshot([
    pool('a-valid-ac', 'A', 1n, 'C', 2n),
    pool('b-zero-ac', 'A', 1_000n, 'C', 1n),
    pool('c-extra-ab', 'A', 1_000n, 'B', 1_000n),
  ]);
  let observed: ExactInputSinglePathInterruptionCheckpoint | undefined;
  const result = routeExactInputSinglePathInterruptible(
    inputSnapshot,
    request({ amountIn: 1n, maxHops: 1 }),
    {
      shouldInterrupt(checkpoint) {
        if (checkpoint.expansions === 2) {
          observed = checkpoint;
          return true;
        }
        return false;
      },
    },
  );

  assert.equal(result.status, 'success');
  if (result.status !== 'success' || observed === undefined) return;
  assert.equal(result.plan.search.termination, 'interrupted');
  assert.equal(result.plan.receipt.hops[0]?.poolId, 'a-valid-ac');
  assert.deepEqual(observed, {
    establishment: {
      enumeratedCandidates: 2,
      replayedCandidates: 2,
      rejectedCandidates: 1,
    },
    expansions: 2,
    enumeratedCandidates: 2,
    replayedCandidates: 2,
    rejectedCandidates: 1,
    incumbent: result.plan.receipt,
  });
  assertDeepFrozen(observed);

  const noIncumbentSnapshot = snapshot([
    pool('a-zero-ac', 'A', 1_000n, 'C', 1n),
    pool('b-extra-ab', 'A', 1_000n, 'B', 1_000n),
  ]);
  const noIncumbent = routeExactInputSinglePathInterruptible(
    noIncumbentSnapshot,
    request({ amountIn: 1n, maxHops: 1 }),
    {
      shouldInterrupt(checkpoint) {
        return checkpoint.expansions === 1;
      },
    },
  );
  assert.deepEqual(noIncumbent, {
    status: 'no-plan',
    reason: 'interrupted',
    search: {
      establishment: {
        enumeratedCandidates: 1,
        replayedCandidates: 1,
        rejectedCandidates: 1,
      },
      expansions: 1,
      enumeratedCandidates: 1,
      replayedCandidates: 1,
      rejectedCandidates: 1,
      termination: 'interrupted',
    },
  });

  const allRejected = routeExactInputSinglePathInterruptible(
    noIncumbentSnapshot,
    request({ amountIn: 1n, maxHops: 1 }),
    { shouldInterrupt: () => false },
  );
  assert.equal(allRejected.status, 'no-route');
  if (allRejected.status === 'no-route') {
    assert.equal(allRejected.reason, 'all-candidates-rejected');
  }
});

void test('is permutation-invariant and preserves huge exact replayed incumbents', () => {
  const scale = 10n ** 60n;
  const pools = [
    pool('a-lower-ac', 'A', scale, 'C', scale),
    pool('b-higher-ac', 'A', scale, 'C', 2n * scale),
    pool('c-extra-ab', 'A', scale, 'B', scale),
  ];
  const results = permutations(pools).map((order) =>
    routeExactInputSinglePathInterruptible(
      snapshot(order),
      request({ amountIn: scale, maxHops: 1 }),
      {
        shouldInterrupt(checkpoint) {
          return checkpoint.expansions === 2;
        },
      },
    ),
  );

  for (const result of results) assert.deepEqual(result, results[0]);
  const first = results[0];
  assert.equal(first?.status, 'success');
  if (first?.status !== 'success') return;
  assert.equal(first.plan.search.termination, 'interrupted');
  assert.equal(first.plan.receipt.amountIn, scale);
  assert.equal(first.plan.receipt.amountOut, scale);
  assert.equal(first.plan.receipt.hops[0]?.poolId, 'b-higher-ac');
  assertDeepFrozen(first);
});

void test('does not mutate caller inputs and keeps callback-visible state deeply frozen', () => {
  const inputSnapshot = routingGraph();
  const inputRequest = request();
  const snapshotBefore = structuredClone(inputSnapshot);
  const requestBefore = structuredClone(inputRequest);
  const seen: ExactInputSinglePathInterruptionCheckpoint[] = [];

  const result = routeExactInputSinglePathInterruptible(
    inputSnapshot,
    inputRequest,
    {
      shouldInterrupt(checkpoint) {
        seen.push(checkpoint);
        assertDeepFrozen(checkpoint);
        return false;
      },
    },
  );

  assert.deepEqual(inputSnapshot, snapshotBefore);
  assert.deepEqual(inputRequest, requestBefore);
  assert.equal(seen.length, 4);
  assertDeepFrozen(result);
});

void test('callback reentrancy cannot change entry-captured request or snapshot state', () => {
  const inputSnapshot = routingGraph();
  const inputRequest = request();
  const snapshotAtEntry = structuredClone(inputSnapshot);
  const requestAtEntry = structuredClone(inputRequest);
  const expected = routeExactInputSinglePathInterruptible(
    snapshotAtEntry,
    requestAtEntry,
    { shouldInterrupt: () => false },
  );
  const mutableSnapshot = inputSnapshot as unknown as MutableSnapshot;
  const mutableRequest = inputRequest as unknown as MutableRequest;
  const originalPools = [...mutableSnapshot.pools];
  const checkpoints: ExactInputSinglePathInterruptionCheckpoint[] = [];
  let mutated = false;

  const actual = routeExactInputSinglePathInterruptible(
    inputSnapshot,
    inputRequest,
    {
      shouldInterrupt(checkpoint) {
        checkpoints.push(checkpoint);
        if (!mutated) {
          mutated = true;
          mutableRequest.snapshotId = 'mutated-snapshot';
          mutableRequest.snapshotChecksum = 'mutated-checksum';
          mutableRequest.assetIn = 'C';
          mutableRequest.assetOut = 'A';
          mutableRequest.amountIn = 200n;
          mutableRequest.maxHops = 1;
          mutableRequest.maxExpansions = 0;

          mutableSnapshot.snapshotId = 'mutated-snapshot';
          mutableSnapshot.snapshotChecksum = 'mutated-checksum';
          mutableSnapshot.pools = [];
          for (const [index, value] of originalPools.entries()) {
            value.poolId = `mutated-${index}`;
            value.asset0 = 'X';
            value.reserve0 = 1n;
            value.asset1 = 'Y';
            value.reserve1 = 1n;
            value.feeChargedNumerator = 1n;
            value.feeDenominator = 2n;
          }
          mutableSnapshot.pools.push(pool('injected', 'X', 1n, 'Y', 1n));
        }
        return false;
      },
    },
  );

  assert.deepEqual(actual, expected);
  assert.equal(actual.status, 'success');
  if (actual.status !== 'success') return;
  assert.equal(actual.plan.receipt.amountIn, 100n);
  assert.equal(actual.plan.receipt.amountOut, 165n);
  assert.deepEqual(
    actual.plan.receipt.hops.map(({ poolId }) => poolId),
    ['b-hop-ab', 'c-hop-bc'],
  );
  for (const checkpoint of checkpoints) {
    const legacy = routeExactInputSinglePath(
      snapshotAtEntry,
      { ...requestAtEntry, maxExpansions: checkpoint.expansions },
    );
    const legacyValue = legacyCheckpoint(legacy);
    assert.deepEqual(
      {
        expansions: checkpoint.expansions,
        enumeratedCandidates: checkpoint.enumeratedCandidates,
        replayedCandidates: checkpoint.replayedCandidates,
        rejectedCandidates: checkpoint.rejectedCandidates,
      },
      {
        expansions: legacyValue.expansions,
        enumeratedCandidates: legacyValue.enumeratedCandidates,
        replayedCandidates: legacyValue.replayedCandidates,
        rejectedCandidates: legacyValue.rejectedCandidates,
      },
    );
    assert.equal(
      checkpoint.incumbent?.amountOut,
      legacyValue.incumbent?.amountOut ?? 90n,
    );
  }
  assertDeepFrozen(actual);
});
