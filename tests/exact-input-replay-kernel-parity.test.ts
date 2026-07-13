import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../src/domain/index.ts';
import { replayExactInputRoute } from '../src/replay/exact-input-route/index.ts';
import {
  replayExactInputSplit,
  type ExactInputSplitReplayRequest,
} from '../src/replay/exact-input-split/index.ts';
import {
  prepareRoutingContext,
  replayPreparedExactInputSplit,
  type PreparedRoutingContext,
} from '../src/runtime/prepared-routing-context/index.ts';
import { computeCanonicalSnapshotChecksum } from '../src/serialization/canonical-snapshot/index.ts';

function pool(
  poolId: string,
  reserve0 = 100n,
  reserve1 = 100n,
): ConstantProductPool {
  return {
    poolId,
    asset0: 'A',
    reserve0,
    asset1: 'C',
    reserve1,
    feeChargedNumerator: 0n,
    feeDenominator: 1n,
  };
}

function checksummedSnapshot(
  pools: readonly ConstantProductPool[],
): LiquiditySnapshot {
  const pending = {
    snapshotId: 'kernel-parity',
    snapshotChecksum: 'pending',
    pools,
  };
  return {
    ...pending,
    snapshotChecksum: computeCanonicalSnapshotChecksum(pending),
  };
}

function prepare(snapshot: LiquiditySnapshot): PreparedRoutingContext {
  const result = prepareRoutingContext(snapshot);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected preparation to succeed.');
  return result.value;
}

function request(
  snapshot: LiquiditySnapshot,
  overrides: Partial<ExactInputSplitReplayRequest> = {},
): ExactInputSplitReplayRequest {
  return {
    snapshotId: snapshot.snapshotId,
    snapshotChecksum: snapshot.snapshotChecksum,
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
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return;
  }
  if (seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) {
    assertDeepFrozen(Reflect.get(value, key), seen);
  }
}

void test('keeps legacy route identity reads short-circuited and pool lookup lazy', () => {
  const observations: string[] = [];
  const value = {
    get snapshotId() {
      observations.push('snapshotId');
      return 'legacy-observation';
    },
    get snapshotChecksum() {
      observations.push('snapshotChecksum');
      return 'legacy-checksum';
    },
    get pools() {
      observations.push('pools');
      return [pool('only-ac')];
    },
  } as LiquiditySnapshot;
  const base = {
    snapshotId: 'legacy-observation',
    snapshotChecksum: 'legacy-checksum',
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 10n,
    hops: [{ assetIn: 'A', poolId: 'only-ac', assetOut: 'C' }],
  } as const;

  const identityFailure = replayExactInputRoute(value, {
    ...base,
    snapshotId: 'wrong',
  });
  assert.equal(identityFailure.ok, false);
  assert.deepEqual(observations, ['snapshotId']);

  observations.length = 0;
  const structuralFailure = replayExactInputRoute(value, {
    ...base,
    hops: [{ assetIn: 'A', poolId: 'only-ac', assetOut: 'B' }],
  });
  assert.equal(structuralFailure.ok, false);
  if (!structuralFailure.ok) {
    assert.equal(structuralFailure.error.code, 'route-end-mismatch');
  }
  assert.deepEqual(observations, ['snapshotId', 'snapshotChecksum']);

  observations.length = 0;
  const success = replayExactInputRoute(value, base);
  assert.equal(success.ok, true);
  assert.deepEqual(observations, ['snapshotId', 'snapshotChecksum', 'pools']);
  assertDeepFrozen(success);
});

void test('prepared and legacy split wrappers share exact success and error projections', () => {
  const value = checksummedSnapshot([
    pool('left-ac'),
    pool('right-ac', 100n, 200n),
    pool('tiny-ac', 1_000n, 1n),
  ]);
  const context = prepare(value);
  const cases: readonly ExactInputSplitReplayRequest[] = [
    request(value),
    request(value, { snapshotChecksum: 'wrong', amountIn: 0n, legs: [] }),
    request(value, {
      amountIn: 1n,
      legs: [{ allocation: 0n, route: [] }],
    }),
    request(value, { legs: [...request(value).legs].reverse() }),
    request(value, {
      amountIn: 100n,
      legs: [
        {
          allocation: 100n,
          route: [{ assetIn: 'A', poolId: 'missing', assetOut: 'C' }],
        },
      ],
    }),
    request(value, {
      amountIn: 1n,
      legs: [
        {
          allocation: 1n,
          route: [{ assetIn: 'A', poolId: 'tiny-ac', assetOut: 'C' }],
        },
      ],
    }),
  ];

  for (const replayRequest of cases) {
    const legacy = replayExactInputSplit(value, replayRequest);
    const prepared = replayPreparedExactInputSplit(context, replayRequest);
    assert.deepEqual(prepared, legacy);
    assertDeepFrozen(legacy);
    assertDeepFrozen(prepared);
  }

  const forged = Object.freeze({}) as PreparedRoutingContext;
  assert.throws(() => replayPreparedExactInputSplit(forged, request(value)), {
    name: 'TypeError',
    message: 'PreparedRoutingContext was not created by prepareRoutingContext.',
  });
});

void test('prepared replay retains its captured lookup and returns fresh frozen receipts', () => {
  const sourcePools = [pool('left-ac'), pool('right-ac', 100n, 200n)];
  const value = checksummedSnapshot(sourcePools);
  const captured = structuredClone(value);
  const context = prepare(value);
  const permutedContext = prepare({
    ...captured,
    pools: [...captured.pools].reverse(),
  });
  const replayRequest = request(captured);

  (sourcePools[0] as { poolId: string }).poolId = 'mutated-left';
  (sourcePools[1] as { reserve1: bigint }).reserve1 = 1n;
  sourcePools.reverse();

  const expected = replayExactInputSplit(captured, replayRequest);
  const first = replayPreparedExactInputSplit(context, replayRequest);
  const second = replayPreparedExactInputSplit(context, replayRequest);
  const permuted = replayPreparedExactInputSplit(permutedContext, replayRequest);
  assert.deepEqual(first, expected);
  assert.deepEqual(second, expected);
  assert.deepEqual(permuted, expected);
  assert.notEqual(first, second);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.notEqual(first.value, second.value);
  assert.notEqual(first.value.legs, second.value.legs);
  assert.notEqual(first.value.legs[0]?.receipt, second.value.legs[0]?.receipt);
  assertDeepFrozen(first);
  assertDeepFrozen(second);
});
