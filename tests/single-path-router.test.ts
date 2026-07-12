import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../src/domain/index.ts';
import {
  routeExactInputSinglePath,
  type ExactInputSinglePathRouterRequest,
  type ExactInputSinglePathRouterValidationErrorCode,
  type ExactInputSinglePathRouterValidationErrorField,
} from '../src/router/single-path/index.ts';

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
    snapshotId: 'snapshot-1',
    snapshotChecksum: 'checksum-1',
    pools,
  };
}

function request(
  overrides: Partial<ExactInputSinglePathRouterRequest> = {},
): ExactInputSinglePathRouterRequest {
  return {
    snapshotId: 'snapshot-1',
    snapshotChecksum: 'checksum-1',
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 100n,
    maxHops: 3,
    maxExpansions: 100,
    ...overrides,
  };
}

function assertInvalid(
  inputSnapshot: LiquiditySnapshot,
  overrides: Partial<ExactInputSinglePathRouterRequest>,
  code: ExactInputSinglePathRouterValidationErrorCode,
  field: ExactInputSinglePathRouterValidationErrorField,
): void {
  const result = routeExactInputSinglePath(inputSnapshot, request(overrides));

  assert.equal(result.status, 'invalid-request');
  if (result.status !== 'invalid-request') return;
  assert.equal(result.error.code, code);
  assert.equal(result.error.field, field);
  assert.notEqual(result.error.message.length, 0);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.error), true);
}

void test('fresh-replays all candidates and selects the exact two-hop and zero-fee winners', () => {
  const twoHop = snapshot([
    pool('direct-ac', 'A', 1_000n, 'C', 1_000n),
    pool('hop-ab', 'A', 1_000n, 'B', 2_000n),
    pool('hop-bc', 'B', 2_000n, 'C', 2_000n),
  ]);
  const twoHopResult = routeExactInputSinglePath(twoHop, request());

  assert.equal(twoHopResult.status, 'success');
  if (twoHopResult.status !== 'success') return;
  assert.equal(twoHopResult.plan.receipt.amountOut, 165n);
  assert.deepEqual(
    twoHopResult.plan.receipt.hops.map((hop) => hop.poolId),
    ['hop-ab', 'hop-bc'],
  );
  assert.deepEqual(twoHopResult.plan.search, {
    expansions: 4,
    enumeratedCandidates: 2,
    replayedCandidates: 2,
    rejectedCandidates: 0,
    termination: 'complete',
  });

  const feeComparison = snapshot([
    pool('high-fee-ac', 'A', 1_000n, 'C', 1_000n, 90n, 100n),
    pool('zero-fee-ac', 'A', 1_000n, 'C', 1_000n),
  ]);
  const feeResult = routeExactInputSinglePath(feeComparison, request({ maxHops: 1 }));

  assert.equal(feeResult.status, 'success');
  if (feeResult.status !== 'success') return;
  assert.equal(feeResult.plan.receipt.amountOut, 90n);
  assert.equal(feeResult.plan.receipt.hops[0]?.poolId, 'zero-fee-ac');
  assert.equal(feeResult.plan.search.replayedCandidates, 2);
});

void test('uses fewer hops and then raw UTF-16 directional route order for exact ties', () => {
  const fewerHops = snapshot([
    pool('direct-ac', 'A', 1_000n, 'C', 1_000n),
    pool('first-ab', 'A', 900n, 'B', 1_000n),
    pool('second-bc', 'B', 1_000n, 'C', 1_000n),
  ]);
  const fewerHopsResult = routeExactInputSinglePath(fewerHops, request());

  assert.equal(fewerHopsResult.status, 'success');
  if (fewerHopsResult.status !== 'success') return;
  assert.equal(fewerHopsResult.plan.receipt.amountOut, 90n);
  assert.equal(fewerHopsResult.plan.receipt.hops.length, 1);
  assert.equal(fewerHopsResult.plan.receipt.hops[0]?.poolId, 'direct-ac');

  const emojiPoolId = '\u{1f600}-pool';
  const privateUsePoolId = '\ue000-pool';
  const rawTiePools = [
    pool(privateUsePoolId, 'A', 1_000n, 'C', 1_000n),
    pool(emojiPoolId, 'A', 1_000n, 'C', 1_000n),
  ];
  const first = routeExactInputSinglePath(snapshot(rawTiePools), request({ maxHops: 1 }));
  const second = routeExactInputSinglePath(
    snapshot([...rawTiePools].reverse()),
    request({ maxHops: 1 }),
  );

  assert.deepEqual(first, second);
  assert.equal(first.status, 'success');
  if (first.status !== 'success') return;
  assert.equal(first.plan.receipt.hops[0]?.poolId, emojiPoolId);
});

void test('compares exact incumbent outputs far above the safe-integer range', () => {
  const scale = 10n ** 60n;
  const inputSnapshot = snapshot([
    pool('a-lower-ac', 'A', scale, 'C', scale),
    pool('z-higher-ac', 'A', scale, 'C', 2n * scale),
  ]);
  const result = routeExactInputSinglePath(
    inputSnapshot,
    request({ amountIn: scale, maxHops: 1 }),
  );

  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.equal(result.plan.receipt.amountIn, scale);
  assert.equal(result.plan.receipt.amountOut, scale);
  assert.equal(result.plan.receipt.hops[0]?.poolId, 'z-higher-ac');
  assert.equal(result.plan.search.replayedCandidates, 2);
});

void test('replays every candidate and preserves a valid incumbent after a rejection', () => {
  const inputSnapshot = snapshot([
    pool('a-valid-ac', 'A', 1n, 'C', 2n),
    pool('z-zero-output-ac', 'A', 1_000n, 'C', 1n),
  ]);
  const result = routeExactInputSinglePath(inputSnapshot, request({ amountIn: 1n }));

  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.equal(result.plan.receipt.hops[0]?.poolId, 'a-valid-ac');
  assert.equal(result.plan.receipt.amountOut, 1n);
  assert.deepEqual(result.plan.search, {
    expansions: 2,
    enumeratedCandidates: 2,
    replayedCandidates: 2,
    rejectedCandidates: 1,
    termination: 'complete',
  });
});

void test('distinguishes complete absence, all rejected, and incomplete no-plan outcomes', () => {
  const disconnected = snapshot([
    pool('component-ab', 'A', 1_000n, 'B', 1_000n),
    pool('component-cd', 'C', 1_000n, 'D', 1_000n),
  ]);
  const disconnectedResult = routeExactInputSinglePath(
    disconnected,
    request({ assetOut: 'D' }),
  );
  assert.equal(disconnectedResult.status, 'no-route');
  if (disconnectedResult.status !== 'no-route') return;
  assert.equal(disconnectedResult.reason, 'no-candidate');
  assert.equal(disconnectedResult.search.termination, 'complete');
  assert.equal(disconnectedResult.search.enumeratedCandidates, 0);
  assert.equal(Object.isFrozen(disconnectedResult), true);
  assert.equal(Object.isFrozen(disconnectedResult.search), true);

  const allRejected = snapshot([pool('tiny-ac', 'A', 1_000n, 'C', 1n)]);
  const rejectedResult = routeExactInputSinglePath(allRejected, request({ amountIn: 1n }));
  assert.equal(rejectedResult.status, 'no-route');
  if (rejectedResult.status !== 'no-route') return;
  assert.equal(rejectedResult.reason, 'all-candidates-rejected');
  assert.deepEqual(rejectedResult.search, {
    expansions: 1,
    enumeratedCandidates: 1,
    replayedCandidates: 1,
    rejectedCandidates: 1,
    termination: 'complete',
  });

  const noPlanResult = routeExactInputSinglePath(
    allRejected,
    request({ amountIn: 1n, maxExpansions: 0 }),
  );
  assert.equal(noPlanResult.status, 'no-plan');
  if (noPlanResult.status !== 'no-plan') return;
  assert.equal(noPlanResult.reason, 'work-limit');
  assert.deepEqual(noPlanResult.search, {
    expansions: 0,
    enumeratedCandidates: 0,
    replayedCandidates: 0,
    rejectedCandidates: 0,
    termination: 'work-limit',
  });
  assert.equal(Object.isFrozen(noPlanResult), true);
  assert.equal(Object.isFrozen(noPlanResult.search), true);
});

void test('returns a valid explored incumbent truthfully when later work is cut off', () => {
  const inputSnapshot = snapshot([
    pool('a-direct-ac', 'A', 1_000n, 'C', 1_000n),
    pool('z-ab', 'A', 1_000n, 'B', 1_000n),
  ]);
  const result = routeExactInputSinglePath(
    inputSnapshot,
    request({ maxExpansions: 1 }),
  );

  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.equal(result.plan.receipt.hops[0]?.poolId, 'a-direct-ac');
  assert.deepEqual(result.plan.search, {
    expansions: 1,
    enumeratedCandidates: 1,
    replayedCandidates: 1,
    rejectedCandidates: 0,
    termination: 'work-limit',
  });
});

void test('applies every request validation rule in frozen precedence order', () => {
  const inputSnapshot = snapshot([
    pool('ab', 'A', 1_000n, 'B', 1_000n),
    pool('bc', 'B', 1_000n, 'C', 1_000n),
  ]);

  assertInvalid(
    inputSnapshot,
    {
      snapshotChecksum: 'wrong',
      assetIn: '',
      assetOut: '',
      amountIn: 0n,
      maxHops: 0,
      maxExpansions: -1,
    },
    'snapshot-identity-mismatch',
    'snapshotIdentity',
  );
  assertInvalid(inputSnapshot, { assetIn: '', amountIn: 0n }, 'empty-identifier', 'assetIn');
  assertInvalid(inputSnapshot, { assetOut: '', amountIn: 0n }, 'empty-identifier', 'assetOut');
  assertInvalid(
    inputSnapshot,
    { amountIn: 0n, assetOut: 'A', maxHops: 0 },
    'nonpositive-input',
    'amountIn',
  );
  assertInvalid(inputSnapshot, { amountIn: -1n }, 'nonpositive-input', 'amountIn');
  assertInvalid(inputSnapshot, { assetOut: 'A', maxHops: 0 }, 'same-asset-request', 'assetOut');

  for (const maxHops of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
    assertInvalid(inputSnapshot, { maxHops }, 'invalid-max-hops', 'maxHops');
  }
  for (const maxExpansions of [
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    2 ** 53,
  ]) {
    assertInvalid(
      inputSnapshot,
      { maxExpansions },
      'invalid-max-expansions',
      'maxExpansions',
    );
  }
  assertInvalid(
    inputSnapshot,
    { assetIn: 'unknown', assetOut: 'also-unknown' },
    'unknown-asset',
    'assetIn',
  );
  assertInvalid(inputSnapshot, { assetOut: 'unknown' }, 'unknown-asset', 'assetOut');
});

void test('deep-freezes results while preserving caller snapshot and request values', () => {
  const inputSnapshot = snapshot([
    pool('direct-ac', 'A', 1_000n, 'C', 1_000n),
    pool('other-ab', 'A', 1_000n, 'B', 1_000n),
  ]);
  const inputRequest = request();
  const snapshotBefore = structuredClone(inputSnapshot);
  const requestBefore = structuredClone(inputRequest);

  const first = routeExactInputSinglePath(inputSnapshot, inputRequest);
  const second = routeExactInputSinglePath(inputSnapshot, inputRequest);

  assert.deepEqual(first, second);
  assert.deepEqual(inputSnapshot, snapshotBefore);
  assert.deepEqual(inputRequest, requestBefore);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first.status, 'success');
  if (first.status !== 'success') return;
  assert.equal(Object.isFrozen(first.plan), true);
  assert.equal(Object.isFrozen(first.plan.search), true);
  assert.equal(Object.isFrozen(first.plan.receipt), true);
  assert.equal(Object.isFrozen(first.plan.receipt.hops), true);
  assert.equal(first.plan.receipt.hops.every((hop) => Object.isFrozen(hop)), true);
  assert.notEqual(first.plan.receipt.hops, inputSnapshot.pools);
});
