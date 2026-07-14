import assert from 'node:assert/strict';
import test from 'node:test';

import type { LiquiditySnapshot } from '../src/domain/index.ts';
import {
  SERVICE_ROUTING_POLICY_V1,
  SERVICE_ROUTING_POLICY_V1_ID,
  advancePreparedServiceDirectRoute,
  createPreparedServiceDirectRouteCursor,
  hasPreparedServiceDirectRoute,
  isPreparedServiceRoutingContext,
  prepareServiceRoutingContext,
  preparedServiceRoutingClock,
  preparedServiceRoutingContextHasAsset,
  preparedServiceRoutingIdentity,
  type PrepareServiceRoutingContextResult,
  type ServiceRoutingPolicy,
} from '../src/runtime/prepared-service-routing-context/index.ts';
import { computeCanonicalSnapshotChecksum } from '../src/serialization/canonical-snapshot/index.ts';

interface PoolInput {
  readonly poolId: string;
  readonly asset0: string;
  readonly reserve0: bigint;
  readonly asset1: string;
  readonly reserve1: bigint;
  readonly feeChargedNumerator: bigint;
  readonly feeDenominator: bigint;
}

const encoder = new TextEncoder();

function rawSnapshot(snapshotId: string, pools: readonly PoolInput[]): Uint8Array {
  const provisional: LiquiditySnapshot = Object.freeze({
    snapshotId,
    snapshotChecksum: `sha256:${'0'.repeat(64)}`,
    pools: Object.freeze(
      pools.map((pool) =>
        Object.freeze({
          poolId: pool.poolId,
          asset0: pool.asset0,
          reserve0: pool.reserve0,
          asset1: pool.asset1,
          reserve1: pool.reserve1,
          feeChargedNumerator: pool.feeChargedNumerator,
          feeDenominator: pool.feeDenominator,
        }),
      ),
    ),
  });
  const snapshotChecksum = computeCanonicalSnapshotChecksum(provisional);
  return encoder.encode(
    JSON.stringify({
      snapshotId,
      snapshotChecksum,
      pools: pools.map((pool) => ({
        poolId: pool.poolId,
        asset0: pool.asset0,
        reserve0: pool.reserve0.toString(10),
        asset1: pool.asset1,
        reserve1: pool.reserve1.toString(10),
        feeChargedNumerator: pool.feeChargedNumerator.toString(10),
        feeDenominator: pool.feeDenominator.toString(10),
      })),
    }),
  );
}

function pool(
  poolId: string,
  asset0: string,
  asset1: string,
  reserve0 = 1_000n,
  reserve1 = 1_000n,
): PoolInput {
  return Object.freeze({
    poolId,
    asset0,
    reserve0,
    asset1,
    reserve1,
    feeChargedNumerator: 0n,
    feeDenominator: 1n,
  });
}

function assertFailure(
  result: PrepareServiceRoutingContextResult,
  status: Exclude<PrepareServiceRoutingContextResult, { readonly ok: true }>['status'],
  code: string,
): void {
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, status);
  assert.equal(result.error.code, code);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.error), true);
}

void test('freezes the complete authenticated service-policy-v1 ceiling set', () => {
  assert.equal(SERVICE_ROUTING_POLICY_V1.policyId, SERVICE_ROUTING_POLICY_V1_ID);
  assert.equal(SERVICE_ROUTING_POLICY_V1.maxRawPublicationBytes, 1_048_576);
  assert.equal(SERVICE_ROUTING_POLICY_V1.maxPools, 512);
  assert.equal(SERVICE_ROUTING_POLICY_V1.maxDirectRoutesPerPair, 256);
  assert.equal(SERVICE_ROUTING_POLICY_V1.maxHops, 4);
  assert.equal(SERVICE_ROUTING_POLICY_V1.maxRoutes, 4);
  assert.equal(SERVICE_ROUTING_POLICY_V1.numericalOuterUpdates, 64);
  assert.equal(SERVICE_ROUTING_POLICY_V1.numericalInnerShareUpdates, 64);
  assert.equal(SERVICE_ROUTING_POLICY_V1.numericalConvergenceTolerance, 2 ** -40);
  assert.equal(SERVICE_ROUTING_POLICY_V1.maxNumericalShareMicrosteps, 68_640);
  assert.equal(SERVICE_ROUTING_POLICY_V1.maxAggregateTransitions, 100_000);
  assert.equal(Object.isFrozen(SERVICE_ROUTING_POLICY_V1), true);

  const copiedPolicy = { ...SERVICE_ROUTING_POLICY_V1 } as ServiceRoutingPolicy;
  assertFailure(
    prepareServiceRoutingContext(rawSnapshot('snapshot-empty', []), copiedPolicy, () => 0n),
    'invalid-policy',
    'invalid-service-policy',
  );
});

void test('publishes one opaque capability and captures the clock without invoking it', () => {
  let clockCalls = 0;
  const clock = (): bigint => {
    clockCalls += 1;
    return 1n;
  };
  const result = prepareServiceRoutingContext(
    rawSnapshot('snapshot-ab', [pool('pool-ab', 'A', 'B')]),
    SERVICE_ROUTING_POLICY_V1,
    clock,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(clockCalls, 0);
  assert.equal(isPreparedServiceRoutingContext(result.value), true);
  assert.equal(isPreparedServiceRoutingContext(Object.freeze({})), false);
  assert.equal(Object.isFrozen(result.value), true);
  assert.deepEqual(preparedServiceRoutingIdentity(result.value), {
    snapshotId: 'snapshot-ab',
    snapshotChecksum: preparedServiceRoutingIdentity(result.value)?.snapshotChecksum,
    policyId: SERVICE_ROUTING_POLICY_V1_ID,
  });
  assert.equal(preparedServiceRoutingContextHasAsset(result.value, 'A'), true);
  assert.equal(preparedServiceRoutingContextHasAsset(result.value, 'missing'), false);
  const capturedClock = preparedServiceRoutingClock(result.value);
  assert.equal(capturedClock, clock);
  assert.equal(capturedClock?.(), 1n);
  assert.equal(clockCalls, 1);
});

void test('uses a fresh nested pair cursor in canonical raw-UTF-16 route order', () => {
  const bytes = rawSnapshot('snapshot-pairs', [
    pool('z-pool', 'a', 'bc'),
    pool('a-pool', 'a', 'bc'),
    pool('collision-pool', 'ab', 'c'),
  ]);
  const result = prepareServiceRoutingContext(
    bytes,
    SERVICE_ROUTING_POLICY_V1,
    () => 0n,
  );
  bytes.fill(0);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const first = createPreparedServiceDirectRouteCursor(result.value, 'a', 'bc');
  const second = createPreparedServiceDirectRouteCursor(result.value, 'a', 'bc');
  const collision = createPreparedServiceDirectRouteCursor(result.value, 'ab', 'c');
  assert.equal(hasPreparedServiceDirectRoute(result.value, first), true);
  assert.equal(advancePreparedServiceDirectRoute(result.value, first)?.[0]?.poolId, 'a-pool');
  assert.equal(advancePreparedServiceDirectRoute(result.value, first)?.[0]?.poolId, 'z-pool');
  assert.equal(hasPreparedServiceDirectRoute(result.value, first), false);
  assert.equal(advancePreparedServiceDirectRoute(result.value, first), undefined);
  assert.equal(advancePreparedServiceDirectRoute(result.value, second)?.[0]?.poolId, 'a-pool');
  assert.equal(
    advancePreparedServiceDirectRoute(result.value, collision)?.[0]?.poolId,
    'collision-pool',
  );
});

void test('checks raw byte, UTF-8, duplicate, closed-shape, and pool-count limits first', () => {
  const overBytes = new Uint8Array(
    SERVICE_ROUTING_POLICY_V1.maxRawPublicationBytes + 1,
  );
  assertFailure(
    prepareServiceRoutingContext(overBytes, SERVICE_ROUTING_POLICY_V1, () => 0n),
    'invalid-publication',
    'raw-publication-byte-limit',
  );
  assertFailure(
    prepareServiceRoutingContext(
      Uint8Array.of(0xc3, 0x28),
      SERVICE_ROUTING_POLICY_V1,
      () => 0n,
    ),
    'invalid-publication',
    'invalid-utf8',
  );
  const checksum = `sha256:${'0'.repeat(64)}`;
  assertFailure(
    prepareServiceRoutingContext(
      encoder.encode(
        `{"snapshotId":"a","snapshotId":"b","snapshotChecksum":"${checksum}","pools":[]}`,
      ),
      SERVICE_ROUTING_POLICY_V1,
      () => 0n,
    ),
    'invalid-publication',
    'duplicate-member',
  );
  assertFailure(
    prepareServiceRoutingContext(
      encoder.encode(
        `{"snapshotId":"a","snapshotChecksum":"${checksum}","pools":[],"extra":true}`,
      ),
      SERVICE_ROUTING_POLICY_V1,
      () => 0n,
    ),
    'invalid-publication',
    'unknown-member',
  );
  const tooManyEmptyPools = Array.from({ length: 513 }, () => '{}').join(',');
  const poolLimit = prepareServiceRoutingContext(
    encoder.encode(
      `{"snapshotId":"a","snapshotChecksum":"${checksum}","pools":[${tooManyEmptyPools}]}`,
    ),
    SERVICE_ROUTING_POLICY_V1,
    () => 0n,
  );
  assertFailure(poolLimit, 'invalid-publication', 'publication-limit');
  if (!poolLimit.ok && poolLimit.status === 'invalid-publication') {
    assert.equal(poolLimit.error.limit, 'maxPools');
  }
});

void test('rejects BOM, pool duplicates, and excess depth during closed preflight', () => {
  const checksum = `sha256:${'0'.repeat(64)}`;
  const validPoolMembers =
    '"poolId":"pool-ab","asset0":"A","reserve0":"1",' +
    '"asset1":"B","reserve1":"1","feeChargedNumerator":"0",' +
    '"feeDenominator":"1"';
  const root = (poolJson: string): string =>
    `{"snapshotId":"snapshot-preflight","snapshotChecksum":"${checksum}",` +
    `"pools":[${poolJson}]}`;

  const withBom = new Uint8Array([
    0xef,
    0xbb,
    0xbf,
    ...rawSnapshot('snapshot-bom', []),
  ]);
  assertFailure(
    prepareServiceRoutingContext(withBom, SERVICE_ROUTING_POLICY_V1, () => 0n),
    'invalid-publication',
    'invalid-json',
  );
  assertFailure(
    prepareServiceRoutingContext(
      encoder.encode(root(`{${validPoolMembers},"poolId":"duplicate"}`)),
      SERVICE_ROUTING_POLICY_V1,
      () => 0n,
    ),
    'invalid-publication',
    'duplicate-member',
  );
  assertFailure(
    prepareServiceRoutingContext(
      encoder.encode(root(`{"poolId":{"nested":{}},${validPoolMembers}}`)),
      SERVICE_ROUTING_POLICY_V1,
      () => 0n,
    ),
    'invalid-publication',
    'container-depth-limit',
  );
});

void test('accepts the exact raw-byte ceiling and rejects one byte more before JSON work', () => {
  const base = rawSnapshot('snapshot-byte-boundary', []);
  const exact = new Uint8Array(SERVICE_ROUTING_POLICY_V1.maxRawPublicationBytes);
  exact.set(base);
  exact.fill(0x20, base.length);
  const accepted = prepareServiceRoutingContext(
    exact,
    SERVICE_ROUTING_POLICY_V1,
    () => 0n,
  );
  assert.equal(accepted.ok, true);

  const over = new Uint8Array(exact.length + 1);
  over.set(exact);
  over[over.length - 1] = 0x20;
  assertFailure(
    prepareServiceRoutingContext(over, SERVICE_ROUTING_POLICY_V1, () => 0n),
    'invalid-publication',
    'raw-publication-byte-limit',
  );
});

void test('uses intrinsic typed-array bounds and copy operations for raw publication', () => {
  const acceptedBytes = rawSnapshot('snapshot-intrinsic-copy', []);
  Object.defineProperties(acceptedBytes, {
    byteLength: {
      get(): number {
        return 0;
      },
    },
    slice: {
      value(): never {
        throw new Error('caller slice must not run');
      },
    },
  });
  const accepted = prepareServiceRoutingContext(
    acceptedBytes,
    SERVICE_ROUTING_POLICY_V1,
    () => 0n,
  );
  assert.equal(accepted.ok, true);

  const oversized = new Uint8Array(
    SERVICE_ROUTING_POLICY_V1.maxRawPublicationBytes + 1,
  );
  Object.defineProperties(oversized, {
    byteLength: {
      get(): number {
        return 0;
      },
    },
    slice: {
      value(): Uint8Array {
        return rawSnapshot('snapshot-forged-slice', []);
      },
    },
  });
  assertFailure(
    prepareServiceRoutingContext(oversized, SERVICE_ROUTING_POLICY_V1, () => 0n),
    'invalid-publication',
    'raw-publication-byte-limit',
  );
});

void test('rejects decimal length before exact parsing and enforces the independent bit ceiling', () => {
  const checksum = `sha256:${'0'.repeat(64)}`;
  const rawWithReserve = (reserve: string): Uint8Array =>
    encoder.encode(
      JSON.stringify({
        snapshotId: 'snapshot-exact-limit',
        snapshotChecksum: checksum,
        pools: [
          {
            poolId: 'pool-ab',
            asset0: 'A',
            reserve0: reserve,
            asset1: 'B',
            reserve1: '1',
            feeChargedNumerator: '0',
            feeDenominator: '1',
          },
        ],
      }),
    );
  assertFailure(
    prepareServiceRoutingContext(
      rawWithReserve('1'.repeat(79)),
      SERVICE_ROUTING_POLICY_V1,
      () => 0n,
    ),
    'invalid-publication',
    'publication-limit',
  );
  assertFailure(
    prepareServiceRoutingContext(
      rawWithReserve((1n << 256n).toString(10)),
      SERVICE_ROUTING_POLICY_V1,
      () => 0n,
    ),
    'invalid-publication',
    'exact-value-bit-limit',
  );
});

void test('rejects malformed/control/oversized identifiers without normalization', () => {
  const cases = ['\ud800', '\u0000', '\u001f', '\u007f', 'A'.repeat(129), '界'.repeat(86)];
  for (const snapshotId of cases) {
    assertFailure(
      prepareServiceRoutingContext(
        rawSnapshot(snapshotId, []),
        SERVICE_ROUTING_POLICY_V1,
        () => 0n,
      ),
      'invalid-publication',
      'invalid-identifier',
    );
  }
  const acceptedIds = [' A ', 'é', 'e\u0301', '😀'.repeat(64), '\u0080'];
  for (const snapshotId of acceptedIds) {
    const result = prepareServiceRoutingContext(
      rawSnapshot(snapshotId, []),
      SERVICE_ROUTING_POLICY_V1,
      () => 0n,
    );
    assert.equal(result.ok, true, snapshotId);
  }
});

void test('reports identifier limits only when their corresponding ceiling is exceeded', () => {
  const invalid = prepareServiceRoutingContext(
    rawSnapshot('', []),
    SERVICE_ROUTING_POLICY_V1,
    () => 0n,
  );
  assertFailure(invalid, 'invalid-publication', 'invalid-identifier');
  if (!invalid.ok && invalid.status === 'invalid-publication') {
    assert.equal(invalid.error.limit, undefined);
  }

  const tooLong = prepareServiceRoutingContext(
    rawSnapshot('A'.repeat(129), []),
    SERVICE_ROUTING_POLICY_V1,
    () => 0n,
  );
  assertFailure(tooLong, 'invalid-publication', 'invalid-identifier');
  if (!tooLong.ok && tooLong.status === 'invalid-publication') {
    assert.equal(tooLong.error.limit, 'maxIdentifierCodeUnits');
  }
});

void test('authenticates checksum before constructing service lookup indexes', () => {
  const repeated = Array.from({ length: 257 }, (_, index) => ({
    poolId: `pool-${index.toString().padStart(3, '0')}`,
    asset0: 'A',
    reserve0: '1000',
    asset1: 'B',
    reserve1: '1000',
    feeChargedNumerator: '0',
    feeDenominator: '1',
  }));
  const result = prepareServiceRoutingContext(
    encoder.encode(
      JSON.stringify({
        snapshotId: 'snapshot-checksum-first',
        snapshotChecksum: `sha256:${'0'.repeat(64)}`,
        pools: repeated,
      }),
    ),
    SERVICE_ROUTING_POLICY_V1,
    () => 0n,
  );
  assertFailure(result, 'invalid-publication', 'snapshot-checksum-mismatch');
});

void test('rejects the 257th prepared direct route for one ordered pair', () => {
  const repeated = Array.from({ length: 257 }, (_, index) =>
    pool(`pool-${index.toString().padStart(3, '0')}`, 'A', 'B'),
  );
  assertFailure(
    prepareServiceRoutingContext(
      rawSnapshot('snapshot-direct-limit', repeated),
      SERVICE_ROUTING_POLICY_V1,
      () => 0n,
    ),
    'invalid-publication',
    'direct-route-limit',
  );
});

void test('rejects invalid setup dependencies before reading publication bytes', () => {
  const hostile = new Proxy(new Uint8Array(), {
    get() {
      throw new Error('raw bytes must not be read');
    },
  });
  assertFailure(
    prepareServiceRoutingContext(
      hostile,
      SERVICE_ROUTING_POLICY_V1,
      undefined as unknown as () => unknown,
    ),
    'invalid-dependency',
    'invalid-clock-dependency',
  );
});
