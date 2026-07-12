import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../src/domain/index.ts';
import {
  replayExactInputRoute,
  type DirectionalRouteHop,
  type ExactInputRouteReplayErrorCode,
  type ExactInputRouteReplayRequest,
} from '../src/replay/exact-input-route/index.ts';

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

function twoHopSnapshot(): LiquiditySnapshot {
  return {
    snapshotId: 'snapshot-1',
    snapshotChecksum: 'checksum-1',
    pools: [
      pool('direct-ac', 'A', 1_000n, 'C', 1_000n),
      pool('hop-ab', 'A', 1_000n, 'B', 2_000n),
      pool('hop-bc', 'B', 2_000n, 'C', 2_000n),
      pool('untouched-de', 'D', 500n, 'E', 800n),
    ],
  };
}

function twoHopRequest(
  overrides: Partial<ExactInputRouteReplayRequest> = {},
): ExactInputRouteReplayRequest {
  return {
    snapshotId: 'snapshot-1',
    snapshotChecksum: 'checksum-1',
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 100n,
    hops: [
      { assetIn: 'A', poolId: 'hop-ab', assetOut: 'B' },
      { assetIn: 'B', poolId: 'hop-bc', assetOut: 'C' },
    ],
    ...overrides,
  };
}

function assertFailure(
  snapshot: LiquiditySnapshot,
  request: ExactInputRouteReplayRequest,
  code: ExactInputRouteReplayErrorCode,
  hopIndex: number | null,
  causeCode: 'negative-input' | 'unknown-asset-in' | 'zero-output-ineligible' | null = null,
): void {
  const result = replayExactInputRoute(snapshot, request);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, code);
  assert.equal(result.error.hopIndex, hopIndex);
  assert.equal(result.error.causeCode, causeCode);
  assert.equal(typeof result.error.message, 'string');
  assert.notEqual(result.error.message.length, 0);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.error), true);
  assert.equal('value' in result, false);
}

void test('replays the exact two-hop fixture and returns a complete frozen receipt', () => {
  const snapshot = twoHopSnapshot();
  const request = twoHopRequest();
  const snapshotBefore = structuredClone(snapshot);
  const requestBefore = structuredClone(request);

  const result = replayExactInputRoute(snapshot, request);

  assert.deepEqual(result, {
    ok: true,
    value: {
      snapshotId: 'snapshot-1',
      snapshotChecksum: 'checksum-1',
      assetIn: 'A',
      assetOut: 'C',
      amountIn: 100n,
      amountOut: 165n,
      hops: [
        {
          poolId: 'hop-ab',
          assetIn: 'A',
          assetOut: 'B',
          amountIn: 100n,
          amountOut: 181n,
          reserveInBefore: 1_000n,
          reserveOutBefore: 2_000n,
          reserveInAfter: 1_100n,
          reserveOutAfter: 1_819n,
        },
        {
          poolId: 'hop-bc',
          assetIn: 'B',
          assetOut: 'C',
          amountIn: 181n,
          amountOut: 165n,
          reserveInBefore: 2_000n,
          reserveOutBefore: 2_000n,
          reserveInAfter: 2_181n,
          reserveOutAfter: 1_835n,
        },
      ],
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.hops), true);
  assert.equal(result.value.hops.every((receipt) => Object.isFrozen(receipt)), true);
  assert.notEqual(result.value.hops, request.hops);
  assert.deepEqual(snapshot, snapshotBefore);
  assert.deepEqual(request, requestBefore);
});

void test('supports reverse directions and exact values far above the safe-integer range', () => {
  const scale = 10n ** 60n;
  const snapshot: LiquiditySnapshot = {
    snapshotId: 'huge',
    snapshotChecksum: 'huge-checksum',
    pools: [
      pool('ba', 'A', scale, 'B', scale),
      pool('cb', 'B', scale, 'C', scale),
    ],
  };
  const request: ExactInputRouteReplayRequest = {
    snapshotId: 'huge',
    snapshotChecksum: 'huge-checksum',
    assetIn: 'C',
    assetOut: 'A',
    amountIn: scale,
    hops: [
      { assetIn: 'C', poolId: 'cb', assetOut: 'B' },
      { assetIn: 'B', poolId: 'ba', assetOut: 'A' },
    ],
  };

  const first = replayExactInputRoute(snapshot, request);
  const second = replayExactInputRoute(snapshot, request);

  assert.deepEqual(first, second);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.value.hops[0]?.amountIn, scale);
  assert.equal(first.value.hops[0]?.amountOut, scale / 2n);
  assert.equal(first.value.hops[1]?.amountIn, scale / 2n);
  assert.equal(first.value.amountOut, scale / 3n);
  assert.equal(first.value.hops[0]?.reserveInAfter, 2n * scale);
  assert.equal(first.value.hops[1]?.reserveOutAfter, scale - scale / 3n);
});

void test('applies request-level validation precedence before route validation', () => {
  const snapshot = twoHopSnapshot();

  assertFailure(
    snapshot,
    twoHopRequest({
      snapshotChecksum: 'wrong',
      assetIn: '',
      amountIn: 0n,
      hops: [],
    }),
    'snapshot-identity-mismatch',
    null,
  );
  assertFailure(
    snapshot,
    twoHopRequest({ snapshotId: 'wrong' }),
    'snapshot-identity-mismatch',
    null,
  );
  assertFailure(
    snapshot,
    twoHopRequest({ snapshotId: '' }),
    'snapshot-identity-mismatch',
    null,
  );
  assertFailure(
    snapshot,
    twoHopRequest({ snapshotChecksum: '' }),
    'snapshot-identity-mismatch',
    null,
  );
  assertFailure(
    snapshot,
    twoHopRequest({ assetIn: '', amountIn: 0n }),
    'empty-identifier',
    null,
  );
  assertFailure(
    snapshot,
    twoHopRequest({ assetOut: '', amountIn: 0n }),
    'empty-identifier',
    null,
  );
  assertFailure(
    snapshot,
    twoHopRequest({ amountIn: 0n, assetOut: 'A', hops: [] }),
    'nonpositive-input',
    null,
  );
  assertFailure(snapshot, twoHopRequest({ amountIn: -1n }), 'nonpositive-input', null);
  assertFailure(
    snapshot,
    twoHopRequest({ assetOut: 'A', hops: [] }),
    'same-asset-request',
    null,
  );
  assertFailure(snapshot, twoHopRequest({ hops: [] }), 'empty-route', null);
});

void test('checks hop structure in index and field precedence order', () => {
  const snapshot = twoHopSnapshot();
  const cases: readonly [
    readonly DirectionalRouteHop[],
    ExactInputRouteReplayErrorCode,
    number,
  ][] = [
    [[{ assetIn: '', poolId: '', assetOut: '' }], 'empty-identifier', 0],
    [[{ assetIn: 'A', poolId: '', assetOut: '' }], 'empty-identifier', 0],
    [[{ assetIn: 'A', poolId: 'hop-ab', assetOut: '' }], 'empty-identifier', 0],
    [[{ assetIn: 'B', poolId: 'missing', assetOut: 'C' }], 'route-start-mismatch', 0],
    [
      [
        { assetIn: 'A', poolId: 'hop-ab', assetOut: 'B' },
        { assetIn: 'X', poolId: 'hop-bc', assetOut: 'C' },
      ],
      'noncontiguous-route',
      1,
    ],
    [
      [
        { assetIn: 'A', poolId: 'hop-ab', assetOut: 'B' },
        { assetIn: 'B', poolId: 'hop-ab', assetOut: 'C' },
      ],
      'duplicate-pool',
      1,
    ],
    [
      [
        { assetIn: 'A', poolId: 'hop-ab', assetOut: 'B' },
        { assetIn: 'B', poolId: 'hop-bc', assetOut: 'A' },
      ],
      'duplicate-asset',
      1,
    ],
    [[{ assetIn: 'A', poolId: 'hop-ab', assetOut: 'B' }], 'route-end-mismatch', 0],
    [[{ assetIn: 'A', poolId: 'missing', assetOut: 'B' }], 'route-end-mismatch', 0],
  ];

  for (const [hops, code, index] of cases) {
    assertFailure(snapshot, twoHopRequest({ hops }), code, index);
  }
});

void test('validates all pool references and directions before beginning execution', () => {
  const snapshot = twoHopSnapshot();

  assertFailure(
    snapshot,
    twoHopRequest({
      hops: [
        { assetIn: 'A', poolId: 'missing', assetOut: 'B' },
        { assetIn: 'B', poolId: 'also-missing', assetOut: 'C' },
      ],
    }),
    'unknown-pool',
    0,
  );
  assertFailure(
    snapshot,
    twoHopRequest({
      assetOut: 'B',
      hops: [{ assetIn: 'A', poolId: 'direct-ac', assetOut: 'B' }],
    }),
    'pool-direction-mismatch',
    0,
  );

  const transitionWouldFail = pool('tiny-ab', 'A', 1_000n, 'B', 1n);
  const directionFailsLater = pool('wrong-bc', 'B', 1_000n, 'D', 1_000n);
  const validationSnapshot: LiquiditySnapshot = {
    snapshotId: 'validation-order',
    snapshotChecksum: 'validation-order-checksum',
    pools: [transitionWouldFail, directionFailsLater],
  };
  assertFailure(
    validationSnapshot,
    {
      snapshotId: 'validation-order',
      snapshotChecksum: 'validation-order-checksum',
      assetIn: 'A',
      assetOut: 'C',
      amountIn: 1n,
      hops: [
        { assetIn: 'A', poolId: 'tiny-ab', assetOut: 'B' },
        { assetIn: 'B', poolId: 'wrong-bc', assetOut: 'C' },
      ],
    },
    'pool-direction-mismatch',
    1,
  );
});

void test('maps a hop rejection to one frozen atomic replay failure', () => {
  const firstPool = pool('first-ab', 'A', 1_000n, 'B', 2_000n);
  const tinyPool = pool('tiny-output', 'B', 1_000n, 'C', 1n);
  const snapshot: LiquiditySnapshot = {
    snapshotId: 'tiny',
    snapshotChecksum: 'tiny-checksum',
    pools: [firstPool, tinyPool],
  };
  const request: ExactInputRouteReplayRequest = {
    snapshotId: 'tiny',
    snapshotChecksum: 'tiny-checksum',
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 1n,
    hops: [
      { assetIn: 'A', poolId: 'first-ab', assetOut: 'B' },
      { assetIn: 'B', poolId: 'tiny-output', assetOut: 'C' },
    ],
  };
  const snapshotBefore = structuredClone(snapshot);
  const requestBefore = structuredClone(request);

  const first = replayExactInputRoute(snapshot, request);
  const second = replayExactInputRoute(snapshot, request);

  assert.deepEqual(first, second);
  assertFailure(
    snapshot,
    request,
    'hop-transition-failed',
    1,
    'zero-output-ineligible',
  );
  assert.deepEqual(snapshot, snapshotBefore);
  assert.deepEqual(request, requestBefore);
  assert.deepEqual(firstPool, snapshot.pools[0]);
  assert.deepEqual(tinyPool, snapshot.pools[1]);
});
