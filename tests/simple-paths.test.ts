import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../src/domain/index.ts';
import {
  buildDeterministicAdjacency,
  enumerateSimplePaths,
  type DeterministicAdjacencyIndex,
  type SimplePathEnumerationErrorCode,
  type SimplePathEnumerationErrorField,
  type SimplePathEnumerationRequest,
} from '../src/search/simple-paths/index.ts';

function pool(poolId: string, asset0: string, asset1: string): ConstantProductPool {
  return {
    poolId,
    asset0,
    reserve0: 1_000n,
    asset1,
    reserve1: 1_000n,
    feeChargedNumerator: 0n,
    feeDenominator: 1n,
  };
}

function snapshot(pools: ConstantProductPool[]): LiquiditySnapshot {
  return {
    snapshotId: 'graph',
    snapshotChecksum: 'graph-checksum',
    pools,
  };
}

const GRAPH_POOLS = [
  pool('ab', 'A', 'B'),
  pool('ac', 'A', 'C'),
  pool('bc', 'B', 'C'),
  pool('bd', 'B', 'D'),
  pool('cd', 'C', 'D'),
  pool('ef', 'E', 'F'),
];

function graphIndex(): DeterministicAdjacencyIndex {
  return buildDeterministicAdjacency(snapshot([...GRAPH_POOLS]));
}

function request(
  overrides: Partial<SimplePathEnumerationRequest> = {},
): SimplePathEnumerationRequest {
  return {
    snapshotId: 'graph',
    snapshotChecksum: 'graph-checksum',
    assetIn: 'A',
    assetOut: 'D',
    maxHops: 3,
    maxExpansions: 100,
    ...overrides,
  };
}

function assertFailure(
  overrides: Partial<SimplePathEnumerationRequest>,
  code: SimplePathEnumerationErrorCode,
  field: SimplePathEnumerationErrorField,
): void {
  const result = enumerateSimplePaths(graphIndex(), request(overrides));

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, code);
  assert.equal(result.error.field, field);
  assert.notEqual(result.error.message.length, 0);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.error), true);
  assert.equal('value' in result, false);
}

void test('builds canonical deeply frozen adjacency independent of pool order and aliases', () => {
  const mutablePools = [
    pool('\u{1f600}-pool', '\u{1f600}', '\ue000'),
    pool('z-pool', 'a', 'A'),
    pool('a-pool', 'a', 'Z'),
    pool('A-pool', 'a', 'A'),
  ];
  const first = buildDeterministicAdjacency(snapshot(mutablePools));
  const second = buildDeterministicAdjacency(snapshot([...mutablePools].reverse()));

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.buckets.map((bucket) => bucket.assetIn),
    ['A', 'Z', 'a', '\u{1f600}', '\ue000'],
  );
  assert.deepEqual(first.buckets.find((bucket) => bucket.assetIn === 'a')?.edges, [
    { assetIn: 'a', poolId: 'A-pool', assetOut: 'A' },
    { assetIn: 'a', poolId: 'a-pool', assetOut: 'Z' },
    { assetIn: 'a', poolId: 'z-pool', assetOut: 'A' },
  ]);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.buckets), true);
  assert.equal(first.buckets.every((bucket) => Object.isFrozen(bucket)), true);
  assert.equal(first.buckets.every((bucket) => Object.isFrozen(bucket.edges)), true);
  assert.equal(first.buckets.every((bucket) => bucket.edges.every(Object.isFrozen)), true);
  assert.notEqual(first.buckets[0]?.edges[0], mutablePools[1]);

  mutablePools[0] = pool('changed', 'X', 'Y');
  assert.deepEqual(first, second);
});

void test('enumerates canonical simple paths with exact complete expansion count', () => {
  const index = graphIndex();
  const indexBefore = structuredClone(index);
  const inputRequest = request();
  const requestBefore = structuredClone(inputRequest);

  const result = enumerateSimplePaths(index, inputRequest);

  assert.deepEqual(result, {
    ok: true,
    value: {
      snapshotId: 'graph',
      snapshotChecksum: 'graph-checksum',
      assetIn: 'A',
      assetOut: 'D',
      paths: [
        [
          { assetIn: 'A', poolId: 'ab', assetOut: 'B' },
          { assetIn: 'B', poolId: 'bc', assetOut: 'C' },
          { assetIn: 'C', poolId: 'cd', assetOut: 'D' },
        ],
        [
          { assetIn: 'A', poolId: 'ab', assetOut: 'B' },
          { assetIn: 'B', poolId: 'bd', assetOut: 'D' },
        ],
        [
          { assetIn: 'A', poolId: 'ac', assetOut: 'C' },
          { assetIn: 'C', poolId: 'bc', assetOut: 'B' },
          { assetIn: 'B', poolId: 'bd', assetOut: 'D' },
        ],
        [
          { assetIn: 'A', poolId: 'ac', assetOut: 'C' },
          { assetIn: 'C', poolId: 'cd', assetOut: 'D' },
        ],
      ],
      expansions: 14,
      termination: 'complete',
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.paths), true);
  assert.equal(result.value.paths.every((path) => Object.isFrozen(path)), true);
  assert.equal(
    result.value.paths.every((path) => path.every((edge) => Object.isFrozen(edge))),
    true,
  );
  assert.notEqual(result.value.paths[0]?.[0], index.buckets[0]?.edges[0]);
  assert.deepEqual(index, indexBefore);
  assert.deepEqual(inputRequest, requestBefore);
});

void test('honors hop bounds without examining outgoing edges at the boundary', () => {
  const result = enumerateSimplePaths(graphIndex(), request({ maxHops: 2 }));

  assert.deepEqual(result, {
    ok: true,
    value: {
      snapshotId: 'graph',
      snapshotChecksum: 'graph-checksum',
      assetIn: 'A',
      assetOut: 'D',
      paths: [
        [
          { assetIn: 'A', poolId: 'ab', assetOut: 'B' },
          { assetIn: 'B', poolId: 'bd', assetOut: 'D' },
        ],
        [
          { assetIn: 'A', poolId: 'ac', assetOut: 'C' },
          { assetIn: 'C', poolId: 'cd', assetOut: 'D' },
        ],
      ],
      expansions: 8,
      termination: 'complete',
    },
  });
});

void test('stops globally at deterministic expansion checkpoints without partial paths', () => {
  const beforeTarget = enumerateSimplePaths(graphIndex(), request({ maxExpansions: 5 }));
  const atTarget = enumerateSimplePaths(graphIndex(), request({ maxExpansions: 6 }));
  const repeatedAtTarget = enumerateSimplePaths(graphIndex(), request({ maxExpansions: 6 }));
  const exactlyComplete = enumerateSimplePaths(graphIndex(), request({ maxExpansions: 14 }));
  const zero = enumerateSimplePaths(graphIndex(), request({ maxExpansions: 0 }));

  assert.deepEqual(beforeTarget, {
    ok: true,
    value: {
      snapshotId: 'graph',
      snapshotChecksum: 'graph-checksum',
      assetIn: 'A',
      assetOut: 'D',
      paths: [],
      expansions: 5,
      termination: 'work-limit',
    },
  });
  assert.equal(atTarget.ok, true);
  if (!atTarget.ok) return;
  assert.equal(atTarget.value.expansions, 6);
  assert.equal(atTarget.value.termination, 'work-limit');
  assert.deepEqual(atTarget.value.paths, [
    [
      { assetIn: 'A', poolId: 'ab', assetOut: 'B' },
      { assetIn: 'B', poolId: 'bc', assetOut: 'C' },
      { assetIn: 'C', poolId: 'cd', assetOut: 'D' },
    ],
  ]);
  assert.deepEqual(atTarget, repeatedAtTarget);
  assert.equal(exactlyComplete.ok, true);
  if (!exactlyComplete.ok) return;
  assert.equal(exactlyComplete.value.expansions, 14);
  assert.equal(exactlyComplete.value.termination, 'complete');
  assert.equal(exactlyComplete.value.paths.length, 4);
  assert.equal(zero.ok, true);
  if (!zero.ok) return;
  assert.equal(zero.value.expansions, 0);
  assert.equal(zero.value.termination, 'work-limit');
  assert.deepEqual(zero.value.paths, []);
});

void test('returns a complete empty result for disconnected known assets', () => {
  const result = enumerateSimplePaths(
    graphIndex(),
    request({ assetOut: 'E', maxHops: 4, maxExpansions: 100 }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.paths, []);
  assert.equal(result.value.termination, 'complete');
  assert.equal(result.value.expansions, 28);
});

void test('validates requests in the frozen first-error order', () => {
  assertFailure(
    {
      snapshotId: 'wrong',
      snapshotChecksum: 'wrong',
      assetIn: '',
      assetOut: '',
      maxHops: 0,
      maxExpansions: -1,
    },
    'snapshot-identity-mismatch',
    'snapshotIdentity',
  );
  assertFailure(
    { snapshotChecksum: 'wrong', assetIn: '', maxHops: 0 },
    'snapshot-identity-mismatch',
    'snapshotIdentity',
  );
  assertFailure({ assetIn: '', assetOut: '', maxHops: 0 }, 'empty-identifier', 'assetIn');
  assertFailure({ assetOut: '', maxHops: 0 }, 'empty-identifier', 'assetOut');
  assertFailure({ assetOut: 'A', maxHops: 0 }, 'same-asset-request', 'assetOut');

  for (const maxHops of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
    assertFailure({ maxHops }, 'invalid-max-hops', 'maxHops');
  }
  for (const maxExpansions of [
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    2 ** 53,
  ]) {
    assertFailure({ maxExpansions }, 'invalid-max-expansions', 'maxExpansions');
  }
  assertFailure({ assetIn: 'unknown', assetOut: 'also-unknown' }, 'unknown-asset', 'assetIn');
  assertFailure({ assetOut: 'unknown' }, 'unknown-asset', 'assetOut');
});

void test('handles parallel pools canonically while rejecting cyclic asset reuse', () => {
  const parallelIndex = buildDeterministicAdjacency(
    snapshot([
      pool('z-direct', 'A', 'D'),
      pool('a-direct', 'A', 'D'),
      pool('ab', 'A', 'B'),
      pool('ab-second', 'A', 'B'),
      pool('bd', 'B', 'D'),
      pool('bc', 'B', 'C'),
      pool('ca', 'C', 'A'),
    ]),
  );
  const result = enumerateSimplePaths(parallelIndex, request());

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.value.paths.map((path) => path.map((edge) => edge.poolId)),
    [
      ['a-direct'],
      ['ab', 'bd'],
      ['ab-second', 'bd'],
      ['ca', 'bc', 'bd'],
      ['z-direct'],
    ],
  );
  for (const path of result.value.paths) {
    const assets = [path[0]?.assetIn, ...path.map((edge) => edge.assetOut)];
    assert.equal(new Set(assets).size, assets.length);
    assert.equal(new Set(path.map((edge) => edge.poolId)).size, path.length);
  }
});
