import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../src/domain/index.ts';
import {
  routeExactInputSplitGreedy,
  type GreedyExactInputSplitRouterRequest,
  type GreedyExactInputSplitValidationErrorCode,
  type GreedyExactInputSplitValidationErrorField,
} from '../src/router/greedy-exact-input-split/index.ts';

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
  return { snapshotId: 'greedy-snapshot', snapshotChecksum: 'greedy-checksum', pools };
}

function request(
  overrides: Partial<GreedyExactInputSplitRouterRequest> = {},
): GreedyExactInputSplitRouterRequest {
  return {
    snapshotId: 'greedy-snapshot',
    snapshotChecksum: 'greedy-checksum',
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 100n,
    maxHops: 1,
    maxPathExpansions: 100,
    maxRoutes: 2,
    maxCandidateSetExpansions: 100,
    greedyParts: 2,
    maxGreedyEvaluations: 100,
    ...overrides,
  };
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) assertDeepFrozen(Reflect.get(value, key), seen);
}

function success(result: ReturnType<typeof routeExactInputSplitGreedy>) {
  assert.equal(result.status, 'success');
  if (result.status !== 'success') throw new Error('Expected a successful greedy route.');
  return result.plan;
}

function allocations(result: ReturnType<typeof routeExactInputSplitGreedy>): bigint[] {
  return success(result).receipt.legs.map(({ allocation }) => allocation);
}

function poolIds(result: ReturnType<typeof routeExactInputSplitGreedy>): string[] {
  return success(result).receipt.legs.map(({ receipt }) => receipt.hops[0]?.poolId ?? '');
}

const M0_POOLS = [pool('left-ac', 100n, 100n), pool('right-ac', 100n, 100n)];

void test('normalizes the M0 evaluation frontier exactly at caps zero through four', () => {
  const expected = [
    { completedChunkSteps: 0, evaluations: 0, finalReplays: 0, termination: 'work-limit' },
    { completedChunkSteps: 0, evaluations: 1, finalReplays: 0, termination: 'work-limit' },
    { completedChunkSteps: 1, evaluations: 2, finalReplays: 0, termination: 'work-limit' },
    { completedChunkSteps: 1, evaluations: 3, finalReplays: 0, termination: 'work-limit' },
    { completedChunkSteps: 2, evaluations: 4, finalReplays: 1, termination: 'complete' },
  ] as const;

  for (let cap = 0; cap <= 4; cap += 1) {
    const result = routeExactInputSplitGreedy(
      snapshot(M0_POOLS),
      request({ maxGreedyEvaluations: cap }),
    );
    const plan = success(result);
    assert.equal(plan.receipt.amountOut, 66n);
    assert.deepEqual(allocations(result), [50n, 50n]);
    assert.equal(plan.search.baseline.status, 'success');
    assert.equal(plan.search.greedy.proposedCandidateSets, 1);
    assert.equal(plan.search.greedy.rejectedEvaluations, 0);
    assert.equal(plan.search.greedy.rejectedFinalReplays, 0);
    assert.equal(plan.search.greedy.rejectedCandidateSets, 0);
    assert.deepEqual(
      {
        completedChunkSteps: plan.search.greedy.completedChunkSteps,
        evaluations: plan.search.greedy.evaluations,
        finalReplays: plan.search.greedy.finalReplays,
        termination: plan.search.greedy.termination,
      },
      expected[cap],
    );
    assert.equal(plan.search.termination, cap === 4 ? 'complete' : 'work-limit');
    assertDeepFrozen(result);
  }
});

void test('uses the allocation-vector tie only after the cap-six final replay', () => {
  const pools = [pool('a-ac', 4n, 9n), pool('b-ac', 1n, 9n)];
  const capFive = routeExactInputSplitGreedy(
    snapshot(pools),
    request({
      amountIn: 3n,
      greedyParts: 3,
      maxGreedyEvaluations: 5,
    }),
  );
  const fivePlan = success(capFive);
  assert.equal(fivePlan.receipt.amountOut, 7n);
  assert.deepEqual(allocations(capFive), [2n, 1n]);
  assert.deepEqual(fivePlan.search.greedy, {
    proposedCandidateSets: 1,
    completedChunkSteps: 2,
    evaluations: 5,
    rejectedEvaluations: 0,
    finalReplays: 0,
    rejectedFinalReplays: 0,
    rejectedCandidateSets: 0,
    termination: 'work-limit',
  });

  const capSix = routeExactInputSplitGreedy(
    snapshot(pools),
    request({
      amountIn: 3n,
      greedyParts: 3,
      maxGreedyEvaluations: 6,
    }),
  );
  const sixPlan = success(capSix);
  assert.equal(sixPlan.receipt.amountOut, 7n);
  assert.deepEqual(allocations(capSix), [1n, 2n]);
  assert.deepEqual(sixPlan.search.greedy, {
    proposedCandidateSets: 1,
    completedChunkSteps: 3,
    evaluations: 6,
    rejectedEvaluations: 0,
    finalReplays: 1,
    rejectedFinalReplays: 0,
    rejectedCandidateSets: 0,
    termination: 'complete',
  });
  assert.equal(sixPlan.search.termination, 'complete');
});

void test('stops after positive chunks when parts exceeds the exact input', () => {
  const result = routeExactInputSplitGreedy(
    snapshot([pool('a-ac', 4n, 9n), pool('b-ac', 1n, 9n)]),
    request({ amountIn: 3n, greedyParts: 5, maxGreedyEvaluations: 6 }),
  );
  const plan = success(result);
  assert.deepEqual(allocations(result), [1n, 2n]);
  assert.equal(plan.receipt.amountOut, 7n);
  assert.equal(plan.search.greedy.completedChunkSteps, 3);
  assert.equal(plan.search.greedy.evaluations, 6);
  assert.equal(plan.search.greedy.finalReplays, 1);
  assert.equal(plan.search.greedy.termination, 'complete');
});

void test('keeps the safe equal baseline in the bounded coarse case', () => {
  const result = routeExactInputSplitGreedy(
    snapshot([pool('a-ac', 1n, 3n), pool('b-ac', 3n, 4n)]),
    request({ amountIn: 5n, greedyParts: 2, maxGreedyEvaluations: 4 }),
  );
  const plan = success(result);
  assert.equal(plan.receipt.amountOut, 3n);
  assert.deepEqual(allocations(result), [3n, 2n]);
  assert.equal(plan.search.baseline.status, 'success');
  assert.equal(plan.search.greedy.completedChunkSteps, 2);
  assert.equal(plan.search.greedy.evaluations, 4);
  assert.equal(plan.search.greedy.finalReplays, 1);
});

void test('reconstructs a 10^80-scale input exactly without number coercion', () => {
  const unit = 10n ** 80n;
  const amountIn = 3n * unit + 2n;
  const result = routeExactInputSplitGreedy(
    snapshot([pool('a-ac', unit, unit), pool('b-ac', unit, 2n * unit)]),
    request({
      amountIn,
      greedyParts: 3,
      maxGreedyEvaluations: 6,
    }),
  );
  const plan = success(result);
  assert.deepEqual(allocations(result), [unit + 1n, 2n * unit + 1n]);
  assert.equal(
    plan.receipt.legs.reduce((sum, { allocation }) => sum + allocation, 0n),
    amountIn,
  );
  assert.equal(plan.receipt.amountOut, (11n * unit - 2n) / 6n);
  assert.equal(typeof plan.receipt.amountOut, 'bigint');
});

void test('counts partial replay rejections without exposing scoring receipts', () => {
  const result = routeExactInputSplitGreedy(
    snapshot([pool('a-ac', 1n, 2n), pool('b-ac', 2n, 2n)]),
    request({ amountIn: 3n, greedyParts: 3, maxGreedyEvaluations: 6 }),
  );
  const plan = success(result);
  assert.equal(plan.receipt.amountOut, 1n);
  assert.deepEqual(allocations(result), [3n]);
  assert.deepEqual(poolIds(result), ['a-ac']);
  assert.deepEqual(plan.search.greedy, {
    proposedCandidateSets: 1,
    completedChunkSteps: 3,
    evaluations: 6,
    rejectedEvaluations: 3,
    finalReplays: 1,
    rejectedFinalReplays: 0,
    rejectedCandidateSets: 0,
    termination: 'complete',
  });
  assertDeepFrozen(result);
});

void test('never worsens full-objective quality as the evaluation cap increases', () => {
  const pools = [pool('a-ac', 4n, 9n), pool('b-ac', 1n, 9n)];
  const observed = [];
  for (let cap = 0; cap <= 6; cap += 1) {
    const result = routeExactInputSplitGreedy(
      snapshot(pools),
      request({ amountIn: 3n, greedyParts: 3, maxGreedyEvaluations: cap }),
    );
    const plan = success(result);
    observed.push({
      amountOut: plan.receipt.amountOut,
      allocations: allocations(result),
    });
  }
  assert.deepEqual(observed, [
    { amountOut: 7n, allocations: [2n, 1n] },
    { amountOut: 7n, allocations: [2n, 1n] },
    { amountOut: 7n, allocations: [2n, 1n] },
    { amountOut: 7n, allocations: [2n, 1n] },
    { amountOut: 7n, allocations: [2n, 1n] },
    { amountOut: 7n, allocations: [2n, 1n] },
    { amountOut: 7n, allocations: [1n, 2n] },
  ]);
});

function assertInvalid(
  inputSnapshot: LiquiditySnapshot,
  overrides: Partial<GreedyExactInputSplitRouterRequest>,
  code: GreedyExactInputSplitValidationErrorCode,
  field: GreedyExactInputSplitValidationErrorField,
): void {
  const result = routeExactInputSplitGreedy(inputSnapshot, request(overrides));
  assert.equal(result.status, 'invalid-request');
  if (result.status !== 'invalid-request') return;
  assert.equal(result.error.code, code);
  assert.equal(result.error.field, field);
  assert.notEqual(result.error.message.length, 0);
  assertDeepFrozen(result);
}

void test('extends baseline validation only after every inherited field', () => {
  const inputSnapshot = snapshot(M0_POOLS);
  assertInvalid(
    inputSnapshot,
    { snapshotChecksum: 'wrong', greedyParts: 0, maxGreedyEvaluations: -1 },
    'snapshot-identity-mismatch',
    'snapshotIdentity',
  );
  assertInvalid(inputSnapshot, { assetIn: '', greedyParts: 0 }, 'empty-identifier', 'assetIn');
  assertInvalid(inputSnapshot, { assetOut: '', greedyParts: 0 }, 'empty-identifier', 'assetOut');
  assertInvalid(inputSnapshot, { amountIn: 1 as unknown as bigint }, 'nonpositive-input', 'amountIn');
  assertInvalid(inputSnapshot, { assetOut: 'A', greedyParts: 0 }, 'same-asset-request', 'assetOut');
  assertInvalid(inputSnapshot, { maxHops: 0, greedyParts: 0 }, 'invalid-max-hops', 'maxHops');
  assertInvalid(
    inputSnapshot,
    { maxPathExpansions: -1, greedyParts: 0 },
    'invalid-max-path-expansions',
    'maxPathExpansions',
  );
  assertInvalid(inputSnapshot, { maxRoutes: 0, greedyParts: 0 }, 'invalid-max-routes', 'maxRoutes');
  assertInvalid(
    inputSnapshot,
    { maxCandidateSetExpansions: -1, greedyParts: 0 },
    'invalid-max-candidate-set-expansions',
    'maxCandidateSetExpansions',
  );
  assertInvalid(inputSnapshot, { assetIn: 'unknown', greedyParts: 0 }, 'unknown-asset', 'assetIn');
  assertInvalid(inputSnapshot, { assetOut: 'unknown', greedyParts: 0 }, 'unknown-asset', 'assetOut');
  for (const greedyParts of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
    assertInvalid(inputSnapshot, { greedyParts }, 'invalid-greedy-parts', 'greedyParts');
  }
  for (const maxGreedyEvaluations of [
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    2 ** 53,
  ]) {
    assertInvalid(
      inputSnapshot,
      { maxGreedyEvaluations },
      'invalid-max-greedy-evaluations',
      'maxGreedyEvaluations',
    );
  }
});

void test('is deterministic across pool permutations and deeply captures inputs', () => {
  const emoji = '\u{1f600}-pool';
  const privateUse = '\ue000-pool';
  const pools = [pool(privateUse, 100n, 100n), pool(emoji, 100n, 100n)];
  const inputSnapshot = snapshot(pools);
  const inputRequest = request({ greedyParts: 3, maxGreedyEvaluations: 6 });
  const snapshotBefore = structuredClone(inputSnapshot);
  const requestBefore = structuredClone(inputRequest);

  const first = routeExactInputSplitGreedy(inputSnapshot, inputRequest);
  const second = routeExactInputSplitGreedy(snapshot([...pools].reverse()), inputRequest);
  const repeated = routeExactInputSplitGreedy(inputSnapshot, inputRequest);

  assert.deepEqual(first, second);
  assert.deepEqual(first, repeated);
  assert.deepEqual(inputSnapshot, snapshotBefore);
  assert.deepEqual(inputRequest, requestBefore);
  assert.deepEqual(poolIds(first), [emoji, privateUse]);
  assertDeepFrozen(first);
});

void test('reports complete empty search and structural work limits without fabrication', () => {
  const disconnected = snapshot([
    pool('component-ab', 100n, 100n, 'A', 'B'),
    pool('component-cd', 100n, 100n, 'C', 'D'),
  ]);
  const complete = routeExactInputSplitGreedy(disconnected, request());
  assert.equal(complete.status, 'no-route');
  if (complete.status !== 'no-route') return;
  assert.equal(complete.reason, 'no-candidate');
  assert.equal(complete.search.greedy.finalReplays, 0);
  assert.equal(complete.search.termination, 'complete');

  const incomplete = routeExactInputSplitGreedy(
    disconnected,
    request({ maxPathExpansions: 0 }),
  );
  assert.equal(incomplete.status, 'no-plan');
  if (incomplete.status !== 'no-plan') return;
  assert.equal(incomplete.reason, 'work-limit');
  assert.equal(incomplete.search.termination, 'work-limit');
  assertDeepFrozen(incomplete);
});
