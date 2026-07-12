import assert from 'node:assert/strict';
import test from 'node:test';

import { parseLiquiditySnapshot } from '../../src/domain/index.ts';

function validInput(): Record<string, unknown> {
  return {
    snapshotId: 'snapshot-1',
    snapshotChecksum: 'checksum-1',
    pools: [
      {
        poolId: 'pool-ab',
        asset0: 'asset-a',
        reserve0: '1000000',
        asset1: 'asset-b',
        reserve1: '2000000',
        feeChargedNumerator: '3',
        feeDenominator: '1000',
      },
    ],
  };
}

void test('parses huge exact values into a runtime-frozen defensive copy', () => {
  const input = validInput();
  const inputPools = input['pools'] as Record<string, unknown>[];
  const inputPool = inputPools[0] as Record<string, unknown>;
  const huge = '900719925474099312345678901234567890';
  inputPool['reserve0'] = huge;

  const result = parseLiquiditySnapshot(input);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, {
    snapshotId: 'snapshot-1',
    snapshotChecksum: 'checksum-1',
    pools: [
      {
        poolId: 'pool-ab',
        asset0: 'asset-a',
        reserve0: 900719925474099312345678901234567890n,
        asset1: 'asset-b',
        reserve1: 2000000n,
        feeChargedNumerator: 3n,
        feeDenominator: 1000n,
      },
    ],
  });
  assert.notEqual(result.value, input);
  assert.notEqual(result.value.pools, inputPools);
  assert.notEqual(result.value.pools[0], inputPool);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.pools), true);
  assert.equal(Object.isFrozen(result.value.pools[0]), true);

  inputPool['reserve0'] = '1';
  inputPools.push({});
  assert.equal(result.value.pools[0]?.reserve0, BigInt(huge));
  assert.equal(result.value.pools.length, 1);
});

void test('accepts zero fee and an empty pool collection', () => {
  const input = validInput();
  const pools = input['pools'] as Record<string, unknown>[];
  const pool = pools[0] as Record<string, unknown>;
  pool['feeChargedNumerator'] = '0';

  const zeroFee = parseLiquiditySnapshot(input);
  assert.equal(zeroFee.ok, true);
  if (zeroFee.ok) assert.equal(zeroFee.value.pools[0]?.feeChargedNumerator, 0n);

  input['pools'] = [];
  const empty = parseLiquiditySnapshot(input);
  assert.equal(empty.ok, true);
  if (empty.ok) assert.deepEqual(empty.value.pools, []);
});

void test('rejects every noncanonical exact-string spelling and numeric values', () => {
  const invalidValues: readonly unknown[] = [
    '',
    '00',
    '01',
    '+1',
    '-1',
    ' 1',
    '1 ',
    '1.0',
    '1e3',
    '1_000',
    1,
    1n,
  ];

  for (const value of invalidValues) {
    const input = validInput();
    const pools = input['pools'] as Record<string, unknown>[];
    const pool = pools[0] as Record<string, unknown>;
    pool['reserve0'] = value;
    const result = parseLiquiditySnapshot(input);
    assert.equal(result.ok, false, `expected ${String(value)} to be rejected`);
    if (result.ok) continue;
    assert.deepEqual(
      result.errors.map(({ code, path }) => ({ code, path })),
      [
        {
          code: typeof value === 'string' ? 'invalid-exact-string' : 'invalid-type',
          path: '$.pools[0].reserve0',
        },
      ],
    );
  }
});

void test('reports reserve, asset, fee, and later duplicate-pool errors', () => {
  const input = validInput();
  input['pools'] = [
    {
      poolId: 'duplicate',
      asset0: 'same',
      reserve0: '0',
      asset1: 'same',
      reserve1: '0',
      feeChargedNumerator: '10',
      feeDenominator: '0',
    },
    {
      poolId: 'duplicate',
      asset0: 'asset-c',
      reserve0: '1',
      asset1: 'asset-d',
      reserve1: '1',
      feeChargedNumerator: '1000',
      feeDenominator: '1000',
    },
  ];

  const result = parseLiquiditySnapshot(input);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(
    result.errors.map(({ code, path }) => ({ code, path })),
    [
      { code: 'nonpositive-reserve', path: '$.pools[0].reserve0' },
      { code: 'nonpositive-reserve', path: '$.pools[0].reserve1' },
      { code: 'invalid-fee-denominator', path: '$.pools[0].feeDenominator' },
      { code: 'duplicate-pool-assets', path: '$.pools[0].asset1' },
      {
        code: 'invalid-fee-charged-numerator',
        path: '$.pools[0].feeChargedNumerator',
      },
      { code: 'duplicate-pool-id', path: '$.pools[1].poolId' },
      {
        code: 'invalid-fee-charged-numerator',
        path: '$.pools[1].feeChargedNumerator',
      },
    ],
  );
  assert.equal('value' in result, false);
});

void test('reports deterministic schema, unknown-field, and cross-field order', () => {
  const input = {
    snapshotChecksum: '',
    pools: [
      {
        asset0: '',
        reserve0: '01',
        asset1: '',
        reserve1: 1,
        feeChargedNumerator: '-1',
        feeDenominator: '0',
        zeta: true,
        alpha: true,
      },
      null,
    ],
    zebra: true,
    aardvark: true,
  };

  const result = parseLiquiditySnapshot(input);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(
    result.errors.map(({ code, path }) => ({ code, path })),
    [
      { code: 'missing-field', path: '$.snapshotId' },
      { code: 'empty-identifier', path: '$.snapshotChecksum' },
      { code: 'missing-field', path: '$.pools[0].poolId' },
      { code: 'empty-identifier', path: '$.pools[0].asset0' },
      { code: 'invalid-exact-string', path: '$.pools[0].reserve0' },
      { code: 'empty-identifier', path: '$.pools[0].asset1' },
      { code: 'invalid-type', path: '$.pools[0].reserve1' },
      {
        code: 'invalid-exact-string',
        path: '$.pools[0].feeChargedNumerator',
      },
      {
        code: 'invalid-fee-denominator',
        path: '$.pools[0].feeDenominator',
      },
      { code: 'unknown-field', path: '$.pools[0].alpha' },
      { code: 'unknown-field', path: '$.pools[0].zeta' },
      { code: 'invalid-type', path: '$.pools[1]' },
      { code: 'unknown-field', path: '$.aardvark' },
      { code: 'unknown-field', path: '$.zebra' },
    ],
  );
  assert.deepEqual(parseLiquiditySnapshot(input), result);
  assert.equal(Object.isFrozen(result.errors), true);
  assert.equal(result.errors.every((validationError) => Object.isFrozen(validationError)), true);
});

void test('does not traverse structurally invalid containers', () => {
  const invalidRoots: readonly unknown[] = [null, [], 'snapshot', 1, true];
  for (const input of invalidRoots) {
    const result = parseLiquiditySnapshot(input);
    assert.deepEqual(result, {
      ok: false,
      errors: [{ code: 'invalid-type', path: '$', message: 'Snapshot must be an object.' }],
    });
  }

  const result = parseLiquiditySnapshot({
    snapshotId: 'snapshot',
    snapshotChecksum: 'checksum',
    pools: { 0: { poolId: '' } },
  });
  assert.deepEqual(result, {
    ok: false,
    errors: [{ code: 'invalid-type', path: '$.pools', message: 'pools must be an array.' }],
  });
});

void test('distinguishes missing fields, wrong primitive types, and empty identifiers', () => {
  const result = parseLiquiditySnapshot({
    snapshotId: 1,
    pools: [
      {
        poolId: '',
        asset0: null,
        reserve0: '1',
        asset1: 'asset-b',
        reserve1: '1',
        feeChargedNumerator: '0',
      },
    ],
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(
    result.errors.map(({ code, path }) => ({ code, path })),
    [
      { code: 'invalid-type', path: '$.snapshotId' },
      { code: 'missing-field', path: '$.snapshotChecksum' },
      { code: 'empty-identifier', path: '$.pools[0].poolId' },
      { code: 'invalid-type', path: '$.pools[0].asset0' },
      { code: 'missing-field', path: '$.pools[0].feeDenominator' },
    ],
  );
});

void test('preserves caller-owned input on validation failure', () => {
  const input = validInput();
  const pools = input['pools'] as Record<string, unknown>[];
  const pool = pools[0] as Record<string, unknown>;
  pool['reserve0'] = '0';
  pool['extra'] = 'untouched';
  const before = structuredClone(input);

  const result = parseLiquiditySnapshot(input);

  assert.equal(result.ok, false);
  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(pools), false);
  assert.equal(Object.isFrozen(pool), false);
});
