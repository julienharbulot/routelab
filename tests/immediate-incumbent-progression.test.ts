import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../src/domain/index.ts';
import {
  resumeExactInputSinglePath,
  routeExactInputSinglePath,
  routeExactInputSinglePathInterruptible,
  routeExactInputSinglePathResumable,
  routeExactInputSinglePathWithDeadline,
  type ExactInputSinglePathResumableCheckpoint,
  type ExactInputSinglePathResumableResult,
  type ExactInputSinglePathRouterRequest,
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
    snapshotId: 'establishment-snapshot',
    snapshotChecksum: 'establishment-checksum',
    pools,
  };
}

function request(
  overrides: Partial<ExactInputSinglePathRouterRequest> = {},
): ExactInputSinglePathRouterRequest {
  return {
    snapshotId: 'establishment-snapshot',
    snapshotChecksum: 'establishment-checksum',
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 100n,
    maxHops: 2,
    maxExpansions: 0,
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

function checkpointFrom(
  result: ExactInputSinglePathResumableResult,
): ExactInputSinglePathResumableCheckpoint {
  if (!('checkpoint' in result) || result.checkpoint === null) {
    throw new Error('expected checkpoint');
  }
  return result.checkpoint;
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
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map(
      (rest) => [value, ...rest],
    ),
  );
}

void test('zero search work exact-replays every canonical direct edge and selects exact ties', () => {
  const directPools = [
    pool('z-tied-ac', 'A', 1n, 'C', 2n),
    pool('a-tied-ac', 'A', 1n, 'C', 2n),
    pool('m-rejected-ac', 'A', 1_000n, 'C', 1n),
    pool('extra-ab', 'A', 1_000n, 'B', 1_000n),
  ];

  for (const order of permutations(directPools)) {
    const result = routeExactInputSinglePathInterruptible(
      snapshot(order),
      request({ amountIn: 1n, maxHops: 1 }),
      { shouldInterrupt: () => false },
    );
    assert.equal(result.status, 'success');
    if (result.status !== 'success') continue;
    assert.equal(result.plan.search.termination, 'work-limit');
    assert.equal(result.plan.search.expansions, 0);
    assert.deepEqual(result.plan.search.establishment, {
      enumeratedCandidates: 3,
      replayedCandidates: 3,
      rejectedCandidates: 1,
    });
    assert.equal(result.plan.search.enumeratedCandidates, 0);
    assert.equal(result.plan.receipt.hops[0]?.poolId, 'a-tied-ac');
    assertDeepFrozen(result);
  }
});

void test('already-reached deadline is sampled only after exact baseline establishment', () => {
  let samples = 0;
  const result = routeExactInputSinglePathWithDeadline(routingGraph(), request({
    maxExpansions: 100,
  }), {
    deadlineNanoseconds: 50n,
    nowNanoseconds() {
      samples += 1;
      return 50n;
    },
  });

  assert.equal(samples, 1);
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.equal(result.plan.search.termination, 'deadline');
  assert.equal(result.plan.search.expansions, 0);
  assert.equal(result.plan.receipt.hops[0]?.poolId, 'a-direct-ac');
  assert.deepEqual(result.plan.search.establishment, {
    enumeratedCandidates: 1,
    replayedCandidates: 1,
    rejectedCandidates: 0,
  });
});

void test('zero work retains typed no-plan when direct establishment is absent or rejected', () => {
  const disconnected = snapshot([
    pool('component-ab', 'A', 1_000n, 'B', 1_000n),
    pool('component-cd', 'C', 1_000n, 'D', 1_000n),
  ]);
  const absent = routeExactInputSinglePathResumable(
    disconnected,
    request({ assetOut: 'D' }),
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

  const rejected = routeExactInputSinglePathResumable(
    snapshot([pool('zero-output-ac', 'A', 1_000n, 'C', 1n)]),
    request({ amountIn: 1n, maxHops: 1 }),
    { shouldInterrupt: () => false },
  );
  assert.equal(rejected.status, 'no-plan');
  if (rejected.status === 'no-plan') {
    assert.equal(rejected.reason, 'work-limit');
    assert.deepEqual(rejected.search.establishment, {
      enumeratedCandidates: 1,
      replayedCandidates: 1,
      rejectedCandidates: 1,
    });
    assert.equal(rejected.checkpoint.incumbent, null);
  }
});

void test('huge bigint baselines are exact and independent of pool insertion order', () => {
  const scale = 10n ** 100n;
  const pools = [
    pool('lower-ac', 'A', scale, 'C', scale),
    pool('higher-ac', 'A', scale, 'C', 3n * scale),
    pool('extra-ab', 'A', scale, 'B', scale),
  ];
  const results = permutations(pools).map((order) =>
    routeExactInputSinglePathResumable(
      snapshot(order),
      request({ amountIn: scale, maxHops: 1 }),
      { shouldInterrupt: () => false },
    ),
  );
  for (const result of results) assert.deepEqual(result, results[0]);
  const first = results[0];
  assert.equal(first?.status, 'success');
  if (first?.status !== 'success') return;
  assert.equal(first.plan.receipt.amountIn, scale);
  assert.equal(first.plan.receipt.amountOut, (3n * scale) / 2n);
  assert.equal(first.plan.receipt.hops[0]?.poolId, 'higher-ac');
});

void test('one-shot and cumulative resumed objectives are monotonic with search work', () => {
  const oneShotOutputs: bigint[] = [];
  for (let maxExpansions = 0; maxExpansions <= 4; maxExpansions += 1) {
    const result = routeExactInputSinglePathResumable(
      routingGraph(),
      request({ maxExpansions }),
      { shouldInterrupt: () => false },
    );
    assert.equal(result.status, 'success');
    if (result.status === 'success') oneShotOutputs.push(result.plan.receipt.amountOut);
  }
  assert.deepEqual(oneShotOutputs, [90n, 90n, 90n, 90n, 165n]);

  let cumulative = routeExactInputSinglePathResumable(
    routingGraph(),
    request(),
    { shouldInterrupt: () => false },
  );
  const cumulativeOutputs: bigint[] = [];
  if (cumulative.status === 'success') cumulativeOutputs.push(cumulative.plan.receipt.amountOut);
  for (let maxExpansions = 1; maxExpansions <= 4; maxExpansions += 1) {
    cumulative = resumeExactInputSinglePath(
      checkpointFrom(cumulative),
      maxExpansions,
      { shouldInterrupt: () => false },
    );
    assert.equal(cumulative.status, 'success');
    if (cumulative.status === 'success') {
      cumulativeOutputs.push(cumulative.plan.receipt.amountOut);
    }
  }
  assert.deepEqual(cumulativeOutputs, oneShotOutputs);
});

void test('establishment is frozen into reusable branches and is never charged again', () => {
  const initial = routeExactInputSinglePathResumable(
    routingGraph(),
    request(),
    { shouldInterrupt: () => false },
  );
  const source = checkpointFrom(initial);
  const sourceBefore = structuredClone(source);
  const atOne = resumeExactInputSinglePath(source, 1, {
    shouldInterrupt: () => false,
  });
  const atThree = resumeExactInputSinglePath(source, 3, {
    shouldInterrupt: () => false,
  });
  const repeatAtThree = resumeExactInputSinglePath(source, 3, {
    shouldInterrupt: () => false,
  });

  assert.deepEqual(source, sourceBefore);
  assert.deepEqual(atThree, repeatAtThree);
  for (const result of [initial, atOne, atThree]) {
    assert.equal(result.status, 'success');
    if (result.status !== 'success') continue;
    assert.deepEqual(result.plan.search.establishment, {
      enumeratedCandidates: 1,
      replayedCandidates: 1,
      rejectedCandidates: 0,
    });
  }
  assert.equal(checkpointFrom(atOne).establishment, source.establishment);
  assertDeepFrozen(source);
  assertDeepFrozen(atOne);
});

void test('caller mutation at the first callback cannot alter captured establishment state', () => {
  const input = routingGraph();
  const inputRequest = request({ maxExpansions: 100 });
  const expected = structuredClone(input);
  const result = routeExactInputSinglePathInterruptible(input, inputRequest, {
    shouldInterrupt(checkpoint) {
      (input.pools as ConstantProductPool[]).splice(0);
      (inputRequest as { amountIn: bigint }).amountIn = 1n;
      assert.equal(checkpoint.incumbent?.amountOut, 90n);
      assertDeepFrozen(checkpoint);
      return true;
    },
  });

  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.equal(result.plan.receipt.amountIn, 100n);
  assert.equal(result.plan.receipt.amountOut, 90n);
  assert.equal(expected.pools.length, 3);
  assertDeepFrozen(result);
});

void test('noninterruptible routing preserves canonical-compatible zero-work behavior', () => {
  const legacy = routeExactInputSinglePath(routingGraph(), request());
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
  assert.equal(legacy.status, 'no-plan');
  if (legacy.status !== 'no-plan') return;
  assert.deepEqual(Object.keys(legacy.search), [
    'expansions',
    'enumeratedCandidates',
    'replayedCandidates',
    'rejectedCandidates',
    'termination',
  ]);

  const anytime = routeExactInputSinglePathInterruptible(
    routingGraph(),
    request(),
    { shouldInterrupt: () => false },
  );
  assert.equal(anytime.status, 'success');
});
