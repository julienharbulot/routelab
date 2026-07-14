import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import type { DirectionalRouteHop } from '../../src/replay/exact-input-route/index.ts';
import {
  SERVICE_ROUTING_POLICY_V1,
  advancePreparedServiceDirectRoute,
  createPreparedServiceDirectRouteCursor,
  hasPreparedServiceDirectRoute,
  prepareServiceRoutingContext,
  preparedServiceRoutingIdentity,
  type PreparedServiceRoutingContext,
  type PrepareServiceRoutingContextResult,
  type ServicePublicationError,
} from '../../src/runtime/prepared-service-routing-context/index.ts';

interface WirePool {
  readonly poolId: string;
  readonly asset0: string;
  readonly reserve0: string;
  readonly asset1: string;
  readonly reserve1: string;
  readonly feeChargedNumerator: string;
  readonly feeDenominator: string;
}

const encoder = new TextEncoder();
const syntacticallyValidChecksum = `sha256:${'0'.repeat(64)}`;

function compareRawUtf16(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function pool(
  poolId: string,
  asset0: string,
  asset1: string,
  reserve0 = '1000',
  reserve1 = '1000',
): WirePool {
  return {
    poolId,
    asset0,
    reserve0,
    asset1,
    reserve1,
    feeChargedNumerator: '0',
    feeDenominator: '1',
  };
}

// This local encoder is deliberately independent of the production snapshot
// serializer and checksum helper. Snapshot identity is excluded by contract.
function independentChecksum(pools: readonly WirePool[]): string {
  const canonicalPools = [...pools]
    .sort((left, right) => compareRawUtf16(left.poolId, right.poolId))
    .map((candidate) => ({
      poolId: candidate.poolId,
      asset0: candidate.asset0,
      reserve0: candidate.reserve0,
      asset1: candidate.asset1,
      reserve1: candidate.reserve1,
      feeChargedNumerator: candidate.feeChargedNumerator,
      feeDenominator: candidate.feeDenominator,
    }));
  const content = JSON.stringify({
    schemaVersion: 'routelab.snapshot.v1',
    pools: canonicalPools,
  });
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

function rawSnapshot(
  snapshotId: string,
  pools: readonly WirePool[],
  checksum = independentChecksum(pools),
): Uint8Array {
  return encoder.encode(
    JSON.stringify({ snapshotId, snapshotChecksum: checksum, pools }),
  );
}

function publicationError(
  result: PrepareServiceRoutingContextResult,
  code: ServicePublicationError['code'],
): ServicePublicationError {
  if (result.ok || result.status !== 'invalid-publication') {
    assert.fail(`expected invalid-publication/${code}`);
  }
  assert.equal(result.error.code, code);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.error), true);
  return result.error;
}

function prepare(bytes: Uint8Array): PreparedServiceRoutingContext {
  const result = prepareServiceRoutingContext(
    bytes,
    SERVICE_ROUTING_POLICY_V1,
    () => 0n,
  );
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail('independently encoded snapshot did not publish');
  return result.value;
}

function drainDirectPoolIds(
  context: PreparedServiceRoutingContext,
  assetIn: string,
  assetOut: string,
): readonly string[] {
  const cursor = createPreparedServiceDirectRouteCursor(context, assetIn, assetOut);
  const poolIds: string[] = [];
  while (hasPreparedServiceDirectRoute(context, cursor)) {
    const route = advancePreparedServiceDirectRoute(context, cursor);
    assert.ok(route !== undefined);
    assert.equal(route.length, 1);
    assert.equal(Object.isFrozen(route), true);
    assert.equal(Object.isFrozen(route[0]), true);
    poolIds.push(route[0]?.poolId ?? 'missing');
  }
  assert.equal(advancePreparedServiceDirectRoute(context, cursor), undefined);
  return poolIds;
}

void test('authenticates independently encoded bytes and owns fresh nested pair cursors', () => {
  const pairPools = [
    pool('\ue000', 'a', 'bc'),
    pool('z-pool', 'a', 'bc'),
    pool('collision-pool', 'ab', 'c'),
    pool('😀', 'a', 'bc'),
    pool('A-pool', 'a', 'bc'),
  ];
  const expectedChecksum = independentChecksum(pairPools);
  const bytes = rawSnapshot('snapshot-pair-oracle', pairPools);
  const context = prepare(bytes);
  bytes.fill(0);

  assert.deepEqual(preparedServiceRoutingIdentity(context), {
    snapshotId: 'snapshot-pair-oracle',
    snapshotChecksum: expectedChecksum,
    policyId: 'service-policy-v1',
  });
  const expectedPairOrder = ['A-pool', 'z-pool', '😀', '\ue000'];
  assert.deepEqual(drainDirectPoolIds(context, 'a', 'bc'), expectedPairOrder);
  assert.deepEqual(drainDirectPoolIds(context, 'a', 'bc'), expectedPairOrder);
  assert.deepEqual(drainDirectPoolIds(context, 'ab', 'c'), ['collision-pool']);
  assert.deepEqual(drainDirectPoolIds(context, 'abc', ''), []);

  const other = prepare(rawSnapshot('snapshot-other-context', pairPools));
  const foreignCursor = createPreparedServiceDirectRouteCursor(context, 'a', 'bc');
  assert.equal(hasPreparedServiceDirectRoute(other, foreignCursor), false);
  assert.throws(
    () => advancePreparedServiceDirectRoute(other, foreignCursor),
    /does not belong/u,
  );
});

void test('applies byte, UTF-8, JSON, duplicate, and pool-count boundaries in order', () => {
  const oversizedInvalidUtf8 = new Uint8Array(
    SERVICE_ROUTING_POLICY_V1.maxRawPublicationBytes + 1,
  );
  oversizedInvalidUtf8.fill(0xff);
  const byteError = publicationError(
    prepareServiceRoutingContext(
      oversizedInvalidUtf8,
      SERVICE_ROUTING_POLICY_V1,
      () => 0n,
    ),
    'raw-publication-byte-limit',
  );
  assert.equal(byteError.limit, 'maxRawPublicationBytes');

  publicationError(
    prepareServiceRoutingContext(
      Uint8Array.of(0xc3, 0x28),
      SERVICE_ROUTING_POLICY_V1,
      () => 0n,
    ),
    'invalid-utf8',
  );

  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...rawSnapshot('bom', [])]);
  publicationError(
    prepareServiceRoutingContext(bom, SERVICE_ROUTING_POLICY_V1, () => 0n),
    'invalid-json',
  );

  const escapedDuplicateRoot = encoder.encode(
    `{"snapshotId":"first","snapshot\\u0049d":"second",` +
      `"snapshotChecksum":"not-a-checksum","pools":[]}`,
  );
  const duplicateRoot = publicationError(
    prepareServiceRoutingContext(
      escapedDuplicateRoot,
      SERVICE_ROUTING_POLICY_V1,
      () => 0n,
    ),
    'duplicate-member',
  );
  assert.equal(duplicateRoot.path, '$.snapshotId');

  const emptyPools = Array.from({ length: 513 }, () => '{}').join(',');
  const poolCount = publicationError(
    prepareServiceRoutingContext(
      encoder.encode(
        `{"snapshotId":"count-first","snapshotChecksum":"${syntacticallyValidChecksum}",` +
          `"pools":[${emptyPools}]}`,
      ),
      SERVICE_ROUTING_POLICY_V1,
      () => 0n,
    ),
    'publication-limit',
  );
  assert.equal(poolCount.path, '$.pools');
  assert.equal(poolCount.limit, 'maxPools');
});

void test('accepts the exact raw byte ceiling and rejects the next byte', () => {
  const base = rawSnapshot('byte-boundary', []);
  const exact = new Uint8Array(SERVICE_ROUTING_POLICY_V1.maxRawPublicationBytes);
  exact.set(base);
  exact.fill(0x20, base.length);
  assert.equal(
    prepareServiceRoutingContext(exact, SERVICE_ROUTING_POLICY_V1, () => 0n).ok,
    true,
  );

  const over = new Uint8Array(exact.length + 1);
  over.set(exact);
  over[over.length - 1] = 0x20;
  publicationError(
    prepareServiceRoutingContext(over, SERVICE_ROUTING_POLICY_V1, () => 0n),
    'raw-publication-byte-limit',
  );
});

void test('preflights escaped pool duplicates, closed shapes, member types, and depth', () => {
  const validMembers =
    '"poolId":"pool-ab","asset0":"A","reserve0":"1",' +
    '"asset1":"B","reserve1":"1","feeChargedNumerator":"0",' +
    '"feeDenominator":"1"';
  const root = (poolJson: string): Uint8Array =>
    encoder.encode(
      `{"snapshotId":"shape","snapshotChecksum":"${syntacticallyValidChecksum}",` +
        `"pools":[${poolJson}]}`,
    );

  const duplicate = publicationError(
    prepareServiceRoutingContext(
      root(`{${validMembers},"pool\\u0049d":"duplicate"}`),
      SERVICE_ROUTING_POLICY_V1,
      () => 0n,
    ),
    'duplicate-member',
  );
  assert.equal(duplicate.path, '$.pools[0].poolId');

  publicationError(
    prepareServiceRoutingContext(
      root(`{${validMembers},"extra":"closed"}`),
      SERVICE_ROUTING_POLICY_V1,
      () => 0n,
    ),
    'unknown-member',
  );
  publicationError(
    prepareServiceRoutingContext(
      root(`{"poolId":"pool-ab"}`),
      SERVICE_ROUTING_POLICY_V1,
      () => 0n,
    ),
    'missing-member',
  );
  publicationError(
    prepareServiceRoutingContext(
      root(`{${validMembers.replace('"reserve0":"1"', '"reserve0":1')}}`),
      SERVICE_ROUTING_POLICY_V1,
      () => 0n,
    ),
    'invalid-member-type',
  );
  const nested = publicationError(
    prepareServiceRoutingContext(
      root(`{"poolId":{"nested":{}},${validMembers}}`),
      SERVICE_ROUTING_POLICY_V1,
      () => 0n,
    ),
    'container-depth-limit',
  );
  assert.equal(nested.limit, 'maxContainerDepth');
});

void test('enforces well-formed Unicode, control, code-unit, and UTF-8 limits', () => {
  const accepted = [
    'A'.repeat(128),
    '😀'.repeat(64),
    '界'.repeat(85),
    ' A ',
    'é',
    'e\u0301',
    '\u0080',
  ];
  for (const snapshotId of accepted) {
    assert.equal(
      prepareServiceRoutingContext(
        rawSnapshot(snapshotId, []),
        SERVICE_ROUTING_POLICY_V1,
        () => 0n,
      ).ok,
      true,
      JSON.stringify(snapshotId),
    );
  }

  const rejected: ReadonlyArray<readonly [string, string | undefined]> = [
    ['', undefined],
    ['\ud800', undefined],
    ['\u0000', undefined],
    ['\u001f', undefined],
    ['\u007f', undefined],
    ['A'.repeat(129), 'maxIdentifierCodeUnits'],
    ['😀'.repeat(65), 'maxIdentifierCodeUnits'],
    ['界'.repeat(86), 'maxIdentifierUtf8Bytes'],
  ];
  for (const [snapshotId, limit] of rejected) {
    const error = publicationError(
      prepareServiceRoutingContext(
        rawSnapshot(snapshotId, []),
        SERVICE_ROUTING_POLICY_V1,
        () => 0n,
      ),
      'invalid-identifier',
    );
    assert.equal(error.path, '$.snapshotId');
    assert.equal(error.limit, limit, JSON.stringify(snapshotId));
  }
});

void test('separates decimal grammar and digit limits from the exact bit ceiling', () => {
  const rawWithReserve = (
    reserve0: string | number,
    checksum = syntacticallyValidChecksum,
  ): Uint8Array =>
    encoder.encode(
      JSON.stringify({
        snapshotId: 'exact-boundary',
        snapshotChecksum: checksum,
        pools: [
          {
            ...pool('pool-ab', 'A', 'B'),
            reserve0,
          },
        ],
      }),
    );

  for (const invalid of ['00', '+1', '-1', '1.0', '1e2', '']) {
    publicationError(
      prepareServiceRoutingContext(
        rawWithReserve(invalid),
        SERVICE_ROUTING_POLICY_V1,
        () => 0n,
      ),
      'invalid-exact-decimal',
    );
  }
  publicationError(
    prepareServiceRoutingContext(
      rawWithReserve(1),
      SERVICE_ROUTING_POLICY_V1,
      () => 0n,
    ),
    'invalid-member-type',
  );
  const digits = publicationError(
    prepareServiceRoutingContext(
      rawWithReserve('1'.repeat(79)),
      SERVICE_ROUTING_POLICY_V1,
      () => 0n,
    ),
    'publication-limit',
  );
  assert.equal(digits.limit, 'maxExactDecimalDigits');

  const max256 = ((1n << 256n) - 1n).toString(10);
  const maxPool = { ...pool('pool-ab', 'A', 'B'), reserve0: max256 };
  assert.equal(
    prepareServiceRoutingContext(
      rawSnapshot('exact-256', [maxPool]),
      SERVICE_ROUTING_POLICY_V1,
      () => 0n,
    ).ok,
    true,
  );

  const bitError = publicationError(
    prepareServiceRoutingContext(
      rawWithReserve((1n << 256n).toString(10)),
      SERVICE_ROUTING_POLICY_V1,
      () => 0n,
    ),
    'exact-value-bit-limit',
  );
  assert.equal(bitError.limit, 'maxExactValueBits');
});

void test('checks checksum syntax, accepted validation, authentication, then pair ceilings', () => {
  publicationError(
    prepareServiceRoutingContext(
      rawSnapshot('checksum-syntax', [], `sha256:${'A'.repeat(64)}`),
      SERVICE_ROUTING_POLICY_V1,
      () => 0n,
    ),
    'invalid-snapshot-checksum',
  );

  const invalidDomain = [
    {
      ...pool('pool-invalid-fee', 'A', 'B'),
      feeDenominator: '0',
    },
  ];
  const domainError = publicationError(
    prepareServiceRoutingContext(
      rawSnapshot('domain-before-checksum', invalidDomain, syntacticallyValidChecksum),
      SERVICE_ROUTING_POLICY_V1,
      () => 0n,
    ),
    'snapshot-validation-failed',
  );
  assert.equal(domainError.cause, 'invalid-fee-denominator');

  const repeated = Array.from({ length: 257 }, (_, index) =>
    pool(`pool-${index.toString().padStart(3, '0')}`, 'A', 'B'),
  );
  publicationError(
    prepareServiceRoutingContext(
      rawSnapshot('checksum-before-index', repeated, syntacticallyValidChecksum),
      SERVICE_ROUTING_POLICY_V1,
      () => 0n,
    ),
    'snapshot-checksum-mismatch',
  );
  const pairLimit = publicationError(
    prepareServiceRoutingContext(
      rawSnapshot('pair-limit', repeated),
      SERVICE_ROUTING_POLICY_V1,
      () => 0n,
    ),
    'direct-route-limit',
  );
  assert.equal(pairLimit.limit, 'maxDirectRoutesPerPair');
});

void test('does not retain or mutate caller routes returned from the nested index', () => {
  const bytes = rawSnapshot('ownership', [pool('owned-pool', 'A', 'B')]);
  const context = prepare(bytes);
  const cursor = createPreparedServiceDirectRouteCursor(context, 'A', 'B');
  bytes.fill(0xff);
  const first = advancePreparedServiceDirectRoute(context, cursor);
  assert.deepEqual(first, [
    { assetIn: 'A', poolId: 'owned-pool', assetOut: 'B' },
  ] satisfies readonly DirectionalRouteHop[]);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first?.[0]), true);
  assert.throws(() => {
    (first as DirectionalRouteHop[])[0] = {
      assetIn: 'mutated',
      poolId: 'mutated',
      assetOut: 'mutated',
    };
  }, TypeError);
  assert.deepEqual(drainDirectPoolIds(context, 'A', 'B'), ['owned-pool']);
});
