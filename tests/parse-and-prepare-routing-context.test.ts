import assert from 'node:assert/strict';
import test from 'node:test';

import type { LiquiditySnapshot } from '../src/domain/index.ts';
import {
  parseAndPrepareRoutingContext,
  type ParseAndPrepareRoutingContextResult,
} from '../src/runtime/prepared-routing-context/index.ts';
import { discoverSharedRoutes } from '../src/search/shared-route-discovery/index.ts';
import { computeCanonicalSnapshotChecksum } from '../src/serialization/canonical-snapshot/index.ts';

const SNAPSHOT_ID = 'raw-snapshot';
const CANONICAL_CHECKSUM =
  'sha256:03e11b3c4e7c98c0aebc2ac0e39240fe33bc778e41e5cadf32752495c0606b5f';

interface RawSnapshotInput {
  snapshotId: string;
  snapshotChecksum: string;
  pools: Record<string, unknown>[];
}

interface ExpectedValidationError {
  readonly code: string;
  readonly path: string;
}

function validRawInput(): RawSnapshotInput {
  return {
    snapshotId: SNAPSHOT_ID,
    snapshotChecksum: CANONICAL_CHECKSUM,
    pools: [
      {
        poolId: 'pool-ab',
        asset0: 'A',
        reserve0: '1000',
        asset1: 'B',
        reserve1: '2000',
        feeChargedNumerator: '3',
        feeDenominator: '1000',
      },
    ],
  };
}

function firstPool(input: RawSnapshotInput): Record<string, unknown> {
  const pool = input.pools[0];
  if (pool === undefined) throw new Error('Expected the valid raw fixture to contain a pool.');
  return pool;
}

function assertDomainFailure(
  result: ParseAndPrepareRoutingContextResult,
  expected: readonly ExpectedValidationError[],
): void {
  assert.equal(result.ok, false);
  if (result.ok || !('errors' in result)) {
    assert.fail('Expected a domain-validation failure.');
  }
  assert.deepEqual(
    result.errors.map(({ code, path }) => ({ code, path })),
    expected,
  );
  assert.equal('value' in result, false);
  assert.equal('error' in result, false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.errors), true);
  assert.equal(result.errors.every(Object.isFrozen), true);
}

void test('pins the independent canonical fixture and returns an opaque usable context', () => {
  const expectedSnapshot: LiquiditySnapshot = {
    snapshotId: SNAPSHOT_ID,
    snapshotChecksum: CANONICAL_CHECKSUM,
    pools: [
      {
        poolId: 'pool-ab',
        asset0: 'A',
        reserve0: 1_000n,
        asset1: 'B',
        reserve1: 2_000n,
        feeChargedNumerator: 3n,
        feeDenominator: 1_000n,
      },
    ],
  };
  assert.equal(computeCanonicalSnapshotChecksum(expectedSnapshot), CANONICAL_CHECKSUM);

  const input = validRawInput();
  const before = structuredClone(input);
  const result = parseAndPrepareRoutingContext(input);

  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(input.pools), false);
  assert.equal(Object.isFrozen(firstPool(input)), false);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.value), true);
  assert.deepEqual(Reflect.ownKeys(result.value), []);

  input.snapshotId = 'changed';
  input.snapshotChecksum = 'changed';
  firstPool(input)['poolId'] = 'changed';
  input.pools.splice(0, input.pools.length);

  const discovery = discoverSharedRoutes(result.value, {
    snapshotId: SNAPSHOT_ID,
    snapshotChecksum: CANONICAL_CHECKSUM,
    assetIn: 'A',
    assetOut: 'B',
    maxHops: 1,
    maxPathExpansions: 10,
    maxRoutes: 1,
    maxCandidateSetExpansions: 10,
  });
  assert.equal(discovery.ok, true);
  if (!discovery.ok) return;
  assert.deepEqual(discovery.value.paths, [
    [{ assetIn: 'A', poolId: 'pool-ab', assetOut: 'B' }],
  ]);
});

void test('rejects malformed pool domains with exact deterministic paths and codes', () => {
  const cases: readonly {
    readonly name: string;
    readonly mutate: (input: RawSnapshotInput) => void;
    readonly expected: readonly ExpectedValidationError[];
  }[] = [
    {
      name: 'duplicate pool ID',
      mutate: (input) => {
        input.pools.push({
          poolId: 'pool-ab',
          asset0: 'C',
          reserve0: '3000',
          asset1: 'D',
          reserve1: '4000',
          feeChargedNumerator: '1',
          feeDenominator: '1000',
        });
      },
      expected: [{ code: 'duplicate-pool-id', path: '$.pools[1].poolId' }],
    },
    {
      name: 'same-asset pool',
      mutate: (input) => {
        firstPool(input)['asset1'] = 'A';
      },
      expected: [{ code: 'duplicate-pool-assets', path: '$.pools[0].asset1' }],
    },
    {
      name: 'fee numerator equal to denominator',
      mutate: (input) => {
        firstPool(input)['feeChargedNumerator'] = '1000';
      },
      expected: [
        {
          code: 'invalid-fee-charged-numerator',
          path: '$.pools[0].feeChargedNumerator',
        },
      ],
    },
    {
      name: 'zero fee denominator',
      mutate: (input) => {
        firstPool(input)['feeChargedNumerator'] = '0';
        firstPool(input)['feeDenominator'] = '0';
      },
      expected: [
        {
          code: 'invalid-fee-denominator',
          path: '$.pools[0].feeDenominator',
        },
        {
          code: 'invalid-fee-charged-numerator',
          path: '$.pools[0].feeChargedNumerator',
        },
      ],
    },
    {
      name: 'zero reserves',
      mutate: (input) => {
        firstPool(input)['reserve0'] = '0';
        firstPool(input)['reserve1'] = '0';
      },
      expected: [
        { code: 'nonpositive-reserve', path: '$.pools[0].reserve0' },
        { code: 'nonpositive-reserve', path: '$.pools[0].reserve1' },
      ],
    },
    {
      name: 'wrong exact runtime types',
      mutate: (input) => {
        firstPool(input)['reserve0'] = 1_000n;
        firstPool(input)['reserve1'] = 2_000;
        firstPool(input)['feeChargedNumerator'] = 3n;
        firstPool(input)['feeDenominator'] = 1_000;
      },
      expected: [
        { code: 'invalid-type', path: '$.pools[0].reserve0' },
        { code: 'invalid-type', path: '$.pools[0].reserve1' },
        { code: 'invalid-type', path: '$.pools[0].feeChargedNumerator' },
        { code: 'invalid-type', path: '$.pools[0].feeDenominator' },
      ],
    },
  ];

  for (const { name, mutate, expected } of cases) {
    const input = validRawInput();
    mutate(input);
    assertDomainFailure(parseAndPrepareRoutingContext(input), expected);
    assert.equal(Object.isFrozen(input), false, name);
    assert.equal(Object.isFrozen(input.pools), false, name);
  }
});

void test('gives malformed domain data precedence over a bad declared checksum', () => {
  const input = validRawInput();
  input.snapshotChecksum = 'sha256:not-the-canonical-checksum';
  firstPool(input)['reserve0'] = '0';

  assertDomainFailure(parseAndPrepareRoutingContext(input), [
    { code: 'nonpositive-reserve', path: '$.pools[0].reserve0' },
  ]);
});

void test('returns the existing frozen checksum failure after domain validation succeeds', () => {
  const input = validRawInput();
  const actual = 'sha256:not-the-canonical-checksum';
  input.snapshotChecksum = actual;

  const result = parseAndPrepareRoutingContext(input);

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: 'snapshot-checksum-mismatch',
      expected: CANONICAL_CHECKSUM,
      actual,
    },
  });
  assert.equal(result.ok, false);
  assert.equal('value' in result, false);
  assert.equal('errors' in result, false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal('error' in result && Object.isFrozen(result.error), true);
});
