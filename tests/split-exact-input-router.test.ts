import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../src/domain/index.ts';
import {
  routeExactInputSplit,
  type ExactInputSplitRouterRequest,
  type ExactInputSplitRouterValidationErrorCode,
  type ExactInputSplitRouterValidationErrorField,
} from '../src/router/split-exact-input/index.ts';

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
  return { snapshotId: 'router-snapshot', snapshotChecksum: 'router-checksum', pools };
}

function request(
  overrides: Partial<ExactInputSplitRouterRequest> = {},
): ExactInputSplitRouterRequest {
  return {
    snapshotId: 'router-snapshot',
    snapshotChecksum: 'router-checksum',
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 100n,
    maxHops: 1,
    maxPathExpansions: 100,
    maxRoutes: 2,
    maxCandidateSetExpansions: 100,
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

function routePoolIds(result: ReturnType<typeof routeExactInputSplit>): string[][] {
  assert.equal(result.status, 'success');
  if (result.status !== 'success') throw new Error('Expected a successful split route.');
  return result.plan.receipt.legs.map(({ receipt }) =>
    receipt.hops.map(({ poolId }) => poolId),
  );
}

const M0_POOLS = [
  pool('left-ac', 'A', 100n, 'C', 100n),
  pool('right-ac', 'A', 100n, 'C', 100n),
];

void test('selects the exact M0 equal split over the exact no-split fallback', () => {
  const result = routeExactInputSplit(snapshot(M0_POOLS), request());

  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.equal(result.plan.receipt.amountIn, 100n);
  assert.equal(result.plan.receipt.amountOut, 66n);
  assert.deepEqual(
    result.plan.receipt.legs.map(({ allocation, receipt }) => [
      allocation,
      receipt.hops[0]?.poolId,
      receipt.amountOut,
    ]),
    [
      [50n, 'left-ac', 33n],
      [50n, 'right-ac', 33n],
    ],
  );
  assert.deepEqual(result.plan.search, {
    fallback: {
      status: 'success',
      search: {
        expansions: 2,
        enumeratedCandidates: 2,
        replayedCandidates: 2,
        rejectedCandidates: 0,
        termination: 'complete',
      },
    },
    structural: {
      pathExpansions: 2,
      enumeratedPaths: 2,
      pathTermination: 'complete',
      candidateSetExpansions: 5,
      enumeratedCandidateSets: 3,
      candidateSetTermination: 'complete',
    },
    equalSplit: { proposed: 1, replayed: 1, rejected: 0, skippedZeroLeg: 0 },
    termination: 'complete',
  });
  assertDeepFrozen(result);
});

void test('keeps the fallback through zero set work and incomplete structural work', () => {
  const result = routeExactInputSplit(
    snapshot(M0_POOLS),
    request({ maxCandidateSetExpansions: 0 }),
  );

  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.equal(result.plan.receipt.amountOut, 50n);
  assert.equal(result.plan.receipt.legs.length, 1);
  assert.equal(result.plan.search.fallback.status, 'success');
  assert.equal(result.plan.search.structural.pathTermination, 'complete');
  assert.equal(result.plan.search.structural.candidateSetTermination, 'work-limit');
  assert.deepEqual(result.plan.search.equalSplit, {
    proposed: 0,
    replayed: 0,
    rejected: 0,
    skippedZeroLeg: 0,
  });
  assert.equal(result.plan.search.termination, 'work-limit');
});

void test('preserves the fallback when an equal split exact replay is rejected', () => {
  const result = routeExactInputSplit(
    snapshot([
      pool('left-ac', 'A', 2n, 'C', 2n),
      pool('right-ac', 'A', 2n, 'C', 2n),
    ]),
    request({ amountIn: 2n }),
  );

  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.equal(result.plan.receipt.amountOut, 1n);
  assert.equal(result.plan.receipt.legs.length, 1);
  assert.deepEqual(result.plan.search.equalSplit, {
    proposed: 1,
    replayed: 1,
    rejected: 1,
    skippedZeroLeg: 0,
  });
});

void test('prefers fewer legs and then fewer total hops on exact output ties', () => {
  const fewerLegs = routeExactInputSplit(
    snapshot([
      pool('left-ac', 'A', 1n, 'C', 3n),
      pool('right-ac', 'A', 1n, 'C', 3n),
    ]),
    request({ amountIn: 2n }),
  );
  assert.equal(fewerLegs.status, 'success');
  if (fewerLegs.status !== 'success') return;
  assert.equal(fewerLegs.plan.receipt.amountOut, 2n);
  assert.equal(fewerLegs.plan.receipt.legs.length, 1);
  assert.deepEqual(fewerLegs.plan.search.equalSplit, {
    proposed: 1,
    replayed: 1,
    rejected: 0,
    skippedZeroLeg: 0,
  });

  const fewerHops = routeExactInputSplit(
    snapshot([
      pool('a-direct', 'A', 100n, 'C', 100n),
      pool('b-ab', 'A', 100n, 'B', 200n),
      pool('b-bc', 'B', 100n, 'C', 84n),
      pool('c-direct', 'A', 100n, 'C', 100n),
    ]),
    request({ maxHops: 2 }),
  );
  assert.equal(fewerHops.status, 'success');
  if (fewerHops.status !== 'success') return;
  assert.equal(fewerHops.plan.receipt.amountOut, 66n);
  assert.deepEqual(routePoolIds(fewerHops), [['a-direct'], ['c-direct']]);
});

void test('reconstructs uneven and huge allocations exactly in canonical route order', () => {
  const uneven = routeExactInputSplit(snapshot(M0_POOLS), request({ amountIn: 101n }));
  assert.equal(uneven.status, 'success');
  if (uneven.status !== 'success') return;
  assert.deepEqual(
    uneven.plan.receipt.legs.map(({ allocation }) => allocation),
    [51n, 50n],
  );
  assert.equal(
    uneven.plan.receipt.legs.reduce((sum, { allocation }) => sum + allocation, 0n),
    101n,
  );

  const scale = 10n ** 60n;
  const huge = routeExactInputSplit(
    snapshot([
      pool('left-ac', 'A', scale, 'C', scale),
      pool('right-ac', 'A', scale, 'C', scale),
    ]),
    request({ amountIn: scale + 1n }),
  );
  assert.equal(huge.status, 'success');
  if (huge.status !== 'success') return;
  assert.deepEqual(
    huge.plan.receipt.legs.map(({ allocation }) => allocation),
    [scale / 2n + 1n, scale / 2n],
  );
  assert.equal(huge.plan.receipt.amountIn, scale + 1n);
});

void test('skips route sets whose equal allocation would contain zero legs', () => {
  const result = routeExactInputSplit(
    snapshot([
      pool('left-ac', 'A', 1n, 'C', 2n),
      pool('right-ac', 'A', 1n, 'C', 2n),
    ]),
    request({ amountIn: 1n }),
  );

  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.equal(result.plan.receipt.legs.length, 1);
  assert.equal(result.plan.receipt.amountOut, 1n);
  assert.deepEqual(result.plan.search.equalSplit, {
    proposed: 1,
    replayed: 0,
    rejected: 0,
    skippedZeroLeg: 1,
  });
});

void test('uses deterministic route keys for split ties across input permutations', () => {
  const emoji = '\u{1f600}-pool';
  const privateUse = '\ue000-pool';
  const pools = [
    pool('z-pool', 'A', 100n, 'C', 100n),
    pool(privateUse, 'A', 100n, 'C', 100n),
    pool(emoji, 'A', 100n, 'C', 100n),
  ];
  const first = routeExactInputSplit(snapshot(pools), request());
  const second = routeExactInputSplit(snapshot([...pools].reverse()), request());

  assert.deepEqual(first, second);
  assert.deepEqual(routePoolIds(first), [['z-pool'], [emoji]]);
});

void test('distinguishes complete empty no-route from incomplete no-plan', () => {
  const disconnected = snapshot([
    pool('component-ab', 'A', 100n, 'B', 100n),
    pool('component-cd', 'C', 100n, 'D', 100n),
  ]);
  const complete = routeExactInputSplit(disconnected, request());
  assert.equal(complete.status, 'no-route');
  if (complete.status !== 'no-route') return;
  assert.equal(complete.reason, 'no-candidate');
  assert.equal(complete.search.fallback.status, 'no-route');
  assert.equal(complete.search.equalSplit.proposed, 0);
  assert.equal(complete.search.termination, 'complete');
  assertDeepFrozen(complete);

  const incomplete = routeExactInputSplit(disconnected, request({ maxPathExpansions: 0 }));
  assert.equal(incomplete.status, 'no-plan');
  if (incomplete.status !== 'no-plan') return;
  assert.equal(incomplete.reason, 'work-limit');
  assert.equal(incomplete.search.fallback.status, 'no-plan');
  assert.equal(incomplete.search.termination, 'work-limit');
  assertDeepFrozen(incomplete);

  const allRejected = routeExactInputSplit(
    snapshot([pool('tiny-ac', 'A', 1_000n, 'C', 1n)]),
    request({ amountIn: 1n }),
  );
  assert.equal(allRejected.status, 'no-route');
  if (allRejected.status !== 'no-route') return;
  assert.equal(allRejected.reason, 'all-candidates-rejected');
  assert.equal(allRejected.search.fallback.status, 'no-route');
  assert.equal(allRejected.search.equalSplit.proposed, 0);
});

function assertInvalid(
  inputSnapshot: LiquiditySnapshot,
  overrides: Partial<ExactInputSplitRouterRequest>,
  code: ExactInputSplitRouterValidationErrorCode,
  field: ExactInputSplitRouterValidationErrorField,
): void {
  const result = routeExactInputSplit(inputSnapshot, request(overrides));
  assert.equal(result.status, 'invalid-request');
  if (result.status !== 'invalid-request') return;
  assert.equal(result.error.code, code);
  assert.equal(result.error.field, field);
  assert.notEqual(result.error.message.length, 0);
  assertDeepFrozen(result);
}

void test('validates every router field in the frozen first-error order', () => {
  const inputSnapshot = snapshot(M0_POOLS);
  assertInvalid(
    inputSnapshot,
    {
      snapshotChecksum: 'wrong',
      assetIn: '',
      assetOut: '',
      amountIn: 0n,
      maxHops: 0,
    },
    'snapshot-identity-mismatch',
    'snapshotIdentity',
  );
  assertInvalid(inputSnapshot, { assetIn: '', amountIn: 0n }, 'empty-identifier', 'assetIn');
  assertInvalid(inputSnapshot, { assetOut: '', amountIn: 0n }, 'empty-identifier', 'assetOut');
  assertInvalid(inputSnapshot, { amountIn: 0n, assetOut: 'A' }, 'nonpositive-input', 'amountIn');
  assertInvalid(
    inputSnapshot,
    { amountIn: 1 as unknown as bigint },
    'nonpositive-input',
    'amountIn',
  );
  assertInvalid(inputSnapshot, { assetOut: 'A', maxHops: 0 }, 'same-asset-request', 'assetOut');
  assertInvalid(inputSnapshot, { maxHops: 0 }, 'invalid-max-hops', 'maxHops');
  assertInvalid(
    inputSnapshot,
    { maxPathExpansions: -1 },
    'invalid-max-path-expansions',
    'maxPathExpansions',
  );
  assertInvalid(inputSnapshot, { maxRoutes: 0 }, 'invalid-max-routes', 'maxRoutes');
  assertInvalid(
    inputSnapshot,
    { maxCandidateSetExpansions: -1 },
    'invalid-max-candidate-set-expansions',
    'maxCandidateSetExpansions',
  );
  assertInvalid(inputSnapshot, { assetIn: 'unknown' }, 'unknown-asset', 'assetIn');
  assertInvalid(inputSnapshot, { assetOut: 'unknown' }, 'unknown-asset', 'assetOut');
});

void test('captures inputs once, does not mutate them, and returns no caller aliases', () => {
  const inputSnapshot = snapshot(M0_POOLS.map((value) => ({ ...value })));
  const inputRequest = request();
  const snapshotBefore = structuredClone(inputSnapshot);
  const requestBefore = structuredClone(inputRequest);

  const first = routeExactInputSplit(inputSnapshot, inputRequest);
  const second = routeExactInputSplit(inputSnapshot, inputRequest);

  assert.deepEqual(first, second);
  assert.deepEqual(inputSnapshot, snapshotBefore);
  assert.deepEqual(inputRequest, requestBefore);
  assertDeepFrozen(first);
  assert.equal(first.status, 'success');
  if (first.status !== 'success') return;
  assert.notEqual(first.plan.receipt.legs, inputSnapshot.pools);
});
