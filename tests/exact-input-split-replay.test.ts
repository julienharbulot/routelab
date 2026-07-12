import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../src/domain/index.ts';
import {
  replayExactInputSplit,
  type ExactInputSplitReplayErrorCode,
  type ExactInputSplitReplayRequest,
} from '../src/replay/exact-input-split/index.ts';
import type { ExactInputRouteReplayErrorCode } from '../src/replay/exact-input-route/index.ts';

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
  return { snapshotId: 'split-snapshot', snapshotChecksum: 'split-checksum', pools };
}

function request(
  overrides: Partial<ExactInputSplitReplayRequest> = {},
): ExactInputSplitReplayRequest {
  return {
    snapshotId: 'split-snapshot',
    snapshotChecksum: 'split-checksum',
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 100n,
    legs: [
      {
        allocation: 50n,
        route: [{ assetIn: 'A', poolId: 'left-ac', assetOut: 'C' }],
      },
      {
        allocation: 50n,
        route: [{ assetIn: 'A', poolId: 'right-ac', assetOut: 'C' }],
      },
    ],
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

function assertFailure(
  inputSnapshot: LiquiditySnapshot,
  inputRequest: ExactInputSplitReplayRequest,
  code: ExactInputSplitReplayErrorCode,
  legIndex: number | null = null,
  causeCode: ExactInputRouteReplayErrorCode | null = null,
): void {
  const result = replayExactInputSplit(inputSnapshot, inputRequest);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.error, {
    code,
    message: result.error.message,
    legIndex,
    causeCode,
  });
  assert.notEqual(result.error.message.length, 0);
  assert.equal('value' in result, false);
  assertDeepFrozen(result);
}

const M0_POOLS = [
  pool('left-ac', 'A', 100n, 'C', 100n),
  pool('right-ac', 'A', 100n, 'C', 100n),
];

void test('atomically replays the M0 equal split to the exact summed output', () => {
  const inputSnapshot = snapshot(M0_POOLS);
  const inputRequest = request();
  const snapshotBefore = structuredClone(inputSnapshot);
  const requestBefore = structuredClone(inputRequest);

  const result = replayExactInputSplit(inputSnapshot, inputRequest);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.amountIn, 100n);
  assert.equal(result.value.amountOut, 66n);
  assert.deepEqual(
    result.value.legs.map(({ allocation, receipt }) => ({
      allocation,
      poolId: receipt.hops[0]?.poolId,
      amountOut: receipt.amountOut,
    })),
    [
      { allocation: 50n, poolId: 'left-ac', amountOut: 33n },
      { allocation: 50n, poolId: 'right-ac', amountOut: 33n },
    ],
  );
  assert.deepEqual(inputSnapshot, snapshotBefore);
  assert.deepEqual(inputRequest, requestBefore);
  assert.notEqual(result.value.legs, inputRequest.legs);
  assertDeepFrozen(result);
});

void test('sums huge bigint allocations and outputs without approximate coercion', () => {
  const scale = 10n ** 60n;
  const result = replayExactInputSplit(
    snapshot([
      pool('left-ac', 'A', scale, 'C', scale),
      pool('right-ac', 'A', scale, 'C', scale),
    ]),
    request({
      amountIn: scale + 1n,
      legs: [
        {
          allocation: scale / 2n + 1n,
          route: [{ assetIn: 'A', poolId: 'left-ac', assetOut: 'C' }],
        },
        {
          allocation: scale / 2n,
          route: [{ assetIn: 'A', poolId: 'right-ac', assetOut: 'C' }],
        },
      ],
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.legs[0]?.allocation, scale / 2n + 1n);
  assert.equal(result.value.legs[1]?.allocation, scale / 2n);
  assert.equal(
    result.value.amountOut,
    result.value.legs[0].receipt.amountOut + result.value.legs[1].receipt.amountOut,
  );
});

void test('applies the frozen request and allocation first-error order safely', () => {
  const inputSnapshot = snapshot(M0_POOLS);
  assertFailure(
    inputSnapshot,
    request({ snapshotChecksum: 'wrong', assetIn: '', amountIn: 0n, legs: [] }),
    'snapshot-identity-mismatch',
  );
  assertFailure(inputSnapshot, request({ assetIn: '', amountIn: 0n }), 'empty-identifier');
  assertFailure(inputSnapshot, request({ assetOut: '', amountIn: 0n }), 'empty-identifier');
  assertFailure(inputSnapshot, request({ amountIn: 0n, assetOut: 'A' }), 'nonpositive-input');
  assertFailure(inputSnapshot, request({ amountIn: -1n }), 'nonpositive-input');
  assertFailure(
    inputSnapshot,
    request({ amountIn: 1 as unknown as bigint }),
    'nonpositive-input',
  );
  assertFailure(inputSnapshot, request({ assetOut: 'A', legs: [] }), 'same-asset-request');
  assertFailure(inputSnapshot, request({ legs: [] }), 'empty-legs');
  assertFailure(
    inputSnapshot,
    request({ legs: [{ allocation: 0n, route: [] }] }),
    'nonpositive-allocation',
    0,
  );
  assertFailure(
    inputSnapshot,
    request({ legs: [{ allocation: 1 as unknown as bigint, route: [] }] }),
    'nonpositive-allocation',
    0,
  );
  assertFailure(
    inputSnapshot,
    request({ amountIn: 1n, legs: [{ allocation: 1n, route: [] }] }),
    'empty-route',
    0,
  );
  assertFailure(inputSnapshot, request({ amountIn: 101n }), 'allocation-sum-mismatch');
});

void test('rejects duplicate, unsorted, and cross-leg shared routes canonically', () => {
  const duplicate = request({
    legs: [
      { allocation: 50n, route: [{ assetIn: 'A', poolId: 'left-ac', assetOut: 'C' }] },
      { allocation: 50n, route: [{ assetIn: 'A', poolId: 'left-ac', assetOut: 'C' }] },
    ],
  });
  assertFailure(snapshot(M0_POOLS), duplicate, 'duplicate-route', 1);

  assertFailure(
    snapshot(M0_POOLS),
    request({ legs: [...request().legs].reverse() }),
    'noncanonical-route-order',
    1,
  );

  const sharedSnapshot = snapshot([
    pool('a-first', 'A', 100n, 'B', 100n),
    pool('b-second', 'A', 100n, 'D', 100n),
    pool('d-b', 'D', 100n, 'B', 100n),
    pool('shared-bc', 'B', 100n, 'C', 100n),
  ]);
  assertFailure(
    sharedSnapshot,
    request({
      legs: [
        {
          allocation: 50n,
          route: [
            { assetIn: 'A', poolId: 'a-first', assetOut: 'B' },
            { assetIn: 'B', poolId: 'shared-bc', assetOut: 'C' },
          ],
        },
        {
          allocation: 50n,
          route: [
            { assetIn: 'A', poolId: 'b-second', assetOut: 'D' },
            { assetIn: 'D', poolId: 'd-b', assetOut: 'B' },
            { assetIn: 'B', poolId: 'shared-bc', assetOut: 'C' },
          ],
        },
      ],
    }),
    'shared-pool',
    1,
  );
});

void test('leaves within-leg duplicate pools and other route failures to exact replay', () => {
  const inputSnapshot = snapshot([
    pool('repeat-ab', 'A', 100n, 'B', 100n),
    pool('final-ac', 'A', 100n, 'C', 100n),
    pool('tiny-ac', 'A', 1_000n, 'C', 1n),
  ]);
  assertFailure(
    inputSnapshot,
    request({
      amountIn: 10n,
      legs: [
        {
          allocation: 10n,
          route: [
            { assetIn: 'A', poolId: 'repeat-ab', assetOut: 'B' },
            { assetIn: 'B', poolId: 'repeat-ab', assetOut: 'A' },
            { assetIn: 'A', poolId: 'final-ac', assetOut: 'C' },
          ],
        },
      ],
    }),
    'leg-replay-failed',
    0,
    'duplicate-pool',
  );
  assertFailure(
    inputSnapshot,
    request({
      amountIn: 1n,
      legs: [
        {
          allocation: 1n,
          route: [{ assetIn: 'A', poolId: 'tiny-ac', assetOut: 'C' }],
        },
      ],
    }),
    'leg-replay-failed',
    0,
    'hop-transition-failed',
  );
});

void test('uses raw UTF-16 route ordering and rejects instead of sorting', () => {
  const emoji = '\u{1f600}-pool';
  const privateUse = '\ue000-pool';
  const inputSnapshot = snapshot([
    pool(privateUse, 'A', 100n, 'C', 100n),
    pool(emoji, 'A', 100n, 'C', 100n),
  ]);
  const canonical = request({
    legs: [
      { allocation: 50n, route: [{ assetIn: 'A', poolId: emoji, assetOut: 'C' }] },
      { allocation: 50n, route: [{ assetIn: 'A', poolId: privateUse, assetOut: 'C' }] },
    ],
  });
  assert.equal(replayExactInputSplit(inputSnapshot, canonical).ok, true);
  assertFailure(
    inputSnapshot,
    request({ legs: [...canonical.legs].reverse() }),
    'noncanonical-route-order',
    1,
  );
});
