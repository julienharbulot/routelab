import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANONICAL_SNAPSHOT_SCHEMA_VERSION,
  computeCanonicalSnapshotChecksum,
  serializeCanonicalSnapshotContent,
  verifyCanonicalSnapshotChecksum,
} from '../src/serialization/canonical-snapshot/index.ts';
import { parseLiquiditySnapshot, type LiquiditySnapshot } from '../src/domain/index.ts';

interface PoolInput {
  readonly poolId: string;
  readonly asset0: string;
  readonly reserve0: string;
  readonly asset1: string;
  readonly reserve1: string;
  readonly feeChargedNumerator: string;
  readonly feeDenominator: string;
}

function parseSnapshot(
  pools: readonly PoolInput[],
  snapshotId = 'snapshot-id',
  snapshotChecksum = 'supplied-checksum',
): LiquiditySnapshot {
  const result = parseLiquiditySnapshot({ snapshotId, snapshotChecksum, pools });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('test input must be a valid liquidity snapshot');
  return result.value;
}

function permutations<T>(values: readonly T[]): readonly (readonly T[])[] {
  if (values.length === 0) return [[]];

  const result: T[][] = [];
  for (const [index, value] of values.entries()) {
    const remainder = [...values.slice(0, index), ...values.slice(index + 1)];
    for (const permutation of permutations(remainder)) {
      result.push([value, ...permutation]);
    }
  }
  return result;
}

const POOL_A: PoolInput = {
  poolId: 'pool-a',
  asset0: 'asset-a',
  reserve0: '123',
  asset1: 'asset-b',
  reserve1: '456',
  feeChargedNumerator: '3',
  feeDenominator: '1000',
};

const POOL_B: PoolInput = {
  poolId: 'pool-b',
  asset0: 'asset-b',
  reserve0: '789',
  asset1: 'asset-c',
  reserve1: '987',
  feeChargedNumerator: '1',
  feeDenominator: '500',
};

void test('serializes the exact v1 shape and reconstructs exact values through the parser', () => {
  const snapshot = parseSnapshot([POOL_B, POOL_A]);

  const canonical = serializeCanonicalSnapshotContent(snapshot);

  assert.equal(CANONICAL_SNAPSHOT_SCHEMA_VERSION, 'routelab.snapshot.v1');
  assert.equal(
    canonical,
    '{"schemaVersion":"routelab.snapshot.v1","pools":[{"poolId":"pool-a","asset0":"asset-a","reserve0":"123","asset1":"asset-b","reserve1":"456","feeChargedNumerator":"3","feeDenominator":"1000"},{"poolId":"pool-b","asset0":"asset-b","reserve0":"789","asset1":"asset-c","reserve1":"987","feeChargedNumerator":"1","feeDenominator":"500"}]}',
  );

  const decoded = JSON.parse(canonical) as { schemaVersion: unknown; pools: unknown };
  assert.equal(decoded.schemaVersion, CANONICAL_SNAPSHOT_SCHEMA_VERSION);
  const reconstructed = parseLiquiditySnapshot({
    snapshotId: snapshot.snapshotId,
    snapshotChecksum: snapshot.snapshotChecksum,
    pools: decoded.pools,
  });
  assert.equal(reconstructed.ok, true);
  if (!reconstructed.ok) return;
  assert.equal(serializeCanonicalSnapshotContent(reconstructed.value), canonical);
  assert.equal(reconstructed.value.pools[0]?.reserve0, 123n);
  assert.equal(reconstructed.value.pools[1]?.reserve1, 987n);
});

void test('sorts raw pool IDs and makes every pool permutation byte/hash identical', () => {
  const rawOrderPools: readonly PoolInput[] = [
    { ...POOL_A, poolId: '\uE000' },
    { ...POOL_B, poolId: '\u{1F600}' },
    {
      ...POOL_A,
      poolId: 'Z',
      asset0: 'asset-z',
      asset1: 'asset-y',
    },
  ];
  const originalOrder = rawOrderPools.map(({ poolId }) => poolId);
  const serializations = new Set<string>();
  const checksums = new Set<string>();

  for (const permutation of permutations(rawOrderPools)) {
    const snapshot = parseSnapshot(permutation);
    serializations.add(serializeCanonicalSnapshotContent(snapshot));
    checksums.add(computeCanonicalSnapshotChecksum(snapshot));
  }

  assert.equal(serializations.size, 1);
  assert.equal(checksums.size, 1);
  const canonical = [...serializations][0] as string;
  assert.ok(canonical.indexOf('"poolId":"Z"') < canonical.indexOf('"poolId":"\u{1F600}"'));
  assert.ok(canonical.indexOf('"poolId":"\u{1F600}"') < canonical.indexOf('"poolId":"\uE000"'));
  assert.deepEqual(
    rawOrderPools.map(({ poolId }) => poolId),
    originalOrder,
  );
});

void test('preserves huge exact strings and distinct unreduced fee encodings', () => {
  const huge = '90071992547409931234567890123456789012345678901234567890';
  const basePool: PoolInput = {
    ...POOL_A,
    reserve0: huge,
    reserve1: `${huge}1`,
    feeChargedNumerator: '2',
    feeDenominator: '1000',
  };
  const equivalentRatio: PoolInput = {
    ...basePool,
    feeChargedNumerator: '1',
    feeDenominator: '500',
  };
  const first = parseSnapshot([basePool]);
  const second = parseSnapshot([equivalentRatio]);

  assert.match(serializeCanonicalSnapshotContent(first), new RegExp(`"reserve0":"${huge}"`));
  assert.notEqual(serializeCanonicalSnapshotContent(first), serializeCanonicalSnapshotContent(second));
  assert.notEqual(computeCanonicalSnapshotChecksum(first), computeCanonicalSnapshotChecksum(second));
});

void test('uses JSON escaping deterministically, including a lone surrogate', () => {
  const snapshot = parseSnapshot([
    {
      ...POOL_A,
      poolId: 'pool"\\\n\uD800',
      asset0: 'asset\tzero',
      asset1: 'asset-one',
    },
  ]);

  const canonical = serializeCanonicalSnapshotContent(snapshot);

  assert.equal(
    canonical,
    '{"schemaVersion":"routelab.snapshot.v1","pools":[{"poolId":"pool\\"\\\\\\n\\ud800","asset0":"asset\\tzero","reserve0":"123","asset1":"asset-one","reserve1":"456","feeChargedNumerator":"3","feeDenominator":"1000"}]}',
  );
  assert.equal(serializeCanonicalSnapshotContent(snapshot), canonical);
  assert.equal(computeCanonicalSnapshotChecksum(snapshot), computeCanonicalSnapshotChecksum(snapshot));
});

void test('serializes an empty pool collection canonically', () => {
  const snapshot = parseSnapshot([]);

  assert.equal(
    serializeCanonicalSnapshotContent(snapshot),
    '{"schemaVersion":"routelab.snapshot.v1","pools":[]}',
  );
  assert.match(computeCanonicalSnapshotChecksum(snapshot), /^sha256:[0-9a-f]{64}$/u);
});

void test('excludes snapshot identity and unrelated aliases from bytes and checksums', () => {
  const first = parseSnapshot([POOL_A], 'snapshot-one', 'checksum-one');
  const second = parseSnapshot([POOL_A], 'snapshot-two', 'checksum-two');
  const aliased = {
    ...second,
    observedAt: '2099-01-01T00:00:00Z',
    trace: { selected: true },
    pools: second.pools.map((pool) => ({ ...pool, cachedPrice: 42 })),
  } as LiquiditySnapshot;

  assert.equal(serializeCanonicalSnapshotContent(first), serializeCanonicalSnapshotContent(second));
  assert.equal(computeCanonicalSnapshotChecksum(first), computeCanonicalSnapshotChecksum(second));
  assert.equal(serializeCanonicalSnapshotContent(second), serializeCanonicalSnapshotContent(aliased));
  assert.equal(computeCanonicalSnapshotChecksum(second), computeCanonicalSnapshotChecksum(aliased));
});

void test('changes bytes and hashes when any financial field changes', () => {
  const baseline = parseSnapshot([POOL_A]);
  const changes: readonly PoolInput[] = [
    { ...POOL_A, poolId: 'pool-c' },
    { ...POOL_A, asset0: 'asset-x' },
    { ...POOL_A, reserve0: '124' },
    { ...POOL_A, asset1: 'asset-y' },
    { ...POOL_A, reserve1: '457' },
    { ...POOL_A, feeChargedNumerator: '4' },
    { ...POOL_A, feeDenominator: '1001' },
  ];

  for (const changedPool of changes) {
    const changed = parseSnapshot([changedPool]);
    assert.notEqual(serializeCanonicalSnapshotContent(changed), serializeCanonicalSnapshotContent(baseline));
    assert.notEqual(computeCanonicalSnapshotChecksum(changed), computeCanonicalSnapshotChecksum(baseline));
  }
});

void test('returns frozen typed verification results without mutating the snapshot', () => {
  const initial = parseSnapshot([POOL_B, POOL_A], 'snapshot', 'placeholder');
  const checksum = computeCanonicalSnapshotChecksum(initial);
  const matching = parseSnapshot([POOL_B, POOL_A], 'snapshot', checksum);
  const matchingBefore = serializeCanonicalSnapshotContent(matching);

  const success = verifyCanonicalSnapshotChecksum(matching);

  assert.deepEqual(success, { ok: true, checksum });
  assert.equal(Object.isFrozen(success), true);
  assert.equal(serializeCanonicalSnapshotContent(matching), matchingBefore);
  assert.equal(matching.snapshotChecksum, checksum);

  const mismatch = verifyCanonicalSnapshotChecksum(initial);
  assert.deepEqual(mismatch, {
    ok: false,
    error: {
      code: 'snapshot-checksum-mismatch',
      expected: checksum,
      actual: 'placeholder',
    },
  });
  assert.equal(Object.isFrozen(mismatch), true);
  if (mismatch.ok) return;
  assert.equal(Object.isFrozen(mismatch.error), true);
  assert.equal(initial.snapshotChecksum, 'placeholder');
  assert.deepEqual(initial.pools, matching.pools);
});

void test('uses exact case-sensitive checksum equality and fresh repeatable hashes', () => {
  const snapshot = parseSnapshot([POOL_A]);
  const first = computeCanonicalSnapshotChecksum(snapshot);

  for (let repetition = 0; repetition < 10; repetition += 1) {
    assert.equal(computeCanonicalSnapshotChecksum(snapshot), first);
  }
  assert.match(first, /^sha256:[0-9a-f]{64}$/u);

  const uppercase = parseSnapshot(
    [POOL_A],
    snapshot.snapshotId,
    first.replace(/[a-f]/gu, (character) => character.toUpperCase()),
  );
  const verification = verifyCanonicalSnapshotChecksum(uppercase);
  assert.equal(verification.ok, false);
  if (!verification.ok) assert.equal(verification.error.actual, uppercase.snapshotChecksum);
});
