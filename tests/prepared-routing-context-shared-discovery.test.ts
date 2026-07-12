import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../src/domain/index.ts';
import {
  prepareRoutingContext,
  type PreparedRoutingContext,
} from '../src/runtime/prepared-routing-context/index.ts';
import { discoverSharedRoutes } from '../src/search/shared-route-discovery/index.ts';
import { computeCanonicalSnapshotChecksum } from '../src/serialization/canonical-snapshot/index.ts';

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

function checksummedSnapshot(
  pools: readonly ConstantProductPool[],
  snapshotId = 'prepared-graph',
): LiquiditySnapshot {
  const unchecksummed: LiquiditySnapshot = {
    snapshotId,
    snapshotChecksum: 'pending',
    pools,
  };
  return {
    ...unchecksummed,
    snapshotChecksum: computeCanonicalSnapshotChecksum(unchecksummed),
  };
}

const GRAPH_POOLS = [
  pool('ad', 'A', 'D'),
  pool('ax', 'A', 'X'),
  pool('xd', 'X', 'D'),
  pool('ay', 'A', 'Y'),
  pool('yd', 'Y', 'D'),
];

function prepare(snapshot = checksummedSnapshot(GRAPH_POOLS)): PreparedRoutingContext {
  const result = prepareRoutingContext(snapshot);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected prepared context creation to succeed.');
  return result.value;
}

function request(snapshot: LiquiditySnapshot, overrides: Record<string, unknown> = {}) {
  return {
    snapshotId: snapshot.snapshotId,
    snapshotChecksum: snapshot.snapshotChecksum,
    assetIn: 'A',
    assetOut: 'D',
    maxHops: 2,
    maxPathExpansions: 100,
    maxRoutes: 2,
    maxCandidateSetExpansions: 100,
    ...overrides,
  };
}

const EXPECTED_PATHS = [
  [{ assetIn: 'A', poolId: 'ad', assetOut: 'D' }],
  [
    { assetIn: 'A', poolId: 'ax', assetOut: 'X' },
    { assetIn: 'X', poolId: 'xd', assetOut: 'D' },
  ],
  [
    { assetIn: 'A', poolId: 'ay', assetOut: 'Y' },
    { assetIn: 'Y', poolId: 'yd', assetOut: 'D' },
  ],
];

void test('verifies the canonical checksum and returns an opaque frozen handle', () => {
  const snapshot = checksummedSnapshot(GRAPH_POOLS);
  const success = prepareRoutingContext(snapshot);
  assert.equal(success.ok, true);
  if (!success.ok) return;
  assert.equal(Object.isFrozen(success), true);
  assert.equal(Object.isFrozen(success.value), true);
  assert.deepEqual(Reflect.ownKeys(success.value), []);

  const failure = prepareRoutingContext({
    ...snapshot,
    snapshotChecksum: 'sha256:not-the-canonical-checksum',
  });
  assert.deepEqual(failure, {
    ok: false,
    error: {
      code: 'snapshot-checksum-mismatch',
      expected: snapshot.snapshotChecksum,
      actual: 'sha256:not-the-canonical-checksum',
    },
  });
  assert.equal(Object.isFrozen(failure), true);
  assert.equal(Object.isFrozen(failure.error), true);
  assert.equal('value' in failure, false);
});

void test('captures caller fields once and retains no caller-owned snapshot or pool alias', () => {
  const canonical = checksummedSnapshot(GRAPH_POOLS);
  const reads = new Map<string, number>();
  const read = <T>(name: string, value: T): T => {
    reads.set(name, (reads.get(name) ?? 0) + 1);
    return value;
  };
  const mutablePool = { ...GRAPH_POOLS[0] };
  const getterPool = Object.fromEntries(
    Object.keys(mutablePool).map((field) => [
      field,
      {
        enumerable: true,
        get: () => read(`pool.${field}`, mutablePool[field as keyof typeof mutablePool]),
      },
    ]),
  );
  const sourcePools: ConstantProductPool[] = [
    Object.defineProperties({}, getterPool) as ConstantProductPool,
    ...GRAPH_POOLS.slice(1),
  ];
  const source = Object.defineProperties({}, {
    snapshotId: {
      enumerable: true,
      get: () => read('snapshotId', canonical.snapshotId),
    },
    snapshotChecksum: {
      enumerable: true,
      get: () => read('snapshotChecksum', canonical.snapshotChecksum),
    },
    pools: { enumerable: true, get: () => read('pools', sourcePools) },
  }) as LiquiditySnapshot;

  const context = prepare(source);
  assert.equal(reads.get('snapshotId'), 1);
  assert.equal(reads.get('snapshotChecksum'), 1);
  assert.equal(reads.get('pools'), 1);
  for (const field of Object.keys(mutablePool)) {
    assert.equal(reads.get(`pool.${field}`), 1);
  }

  mutablePool.poolId = 'changed';
  mutablePool.asset0 = 'changed';
  sourcePools.splice(0, sourcePools.length, pool('zz', 'Q', 'R'));
  const result = discoverSharedRoutes(context, request(canonical));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.paths, EXPECTED_PATHS);
});

void test('discovers canonical paths once and derives only cardinality-two split sets from them', () => {
  const snapshot = checksummedSnapshot(GRAPH_POOLS);
  const result = discoverSharedRoutes(prepare(snapshot), request(snapshot));
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.value.paths, EXPECTED_PATHS);
  assert.deepEqual(result.value.search, {
    pathExpansions: 7,
    enumeratedPaths: 3,
    pathTermination: 'complete',
    candidateSetExpansions: 6,
    enumeratedCandidateSets: 3,
    candidateSetTermination: 'complete',
  });
  assert.deepEqual(
    result.value.candidateSets.map(({ routes }) =>
      routes.map((route) => route.map(({ poolId }) => poolId)),
    ),
    [
      [['ad'], ['ax', 'xd']],
      [['ad'], ['ay', 'yd']],
      [['ax', 'xd'], ['ay', 'yd']],
    ],
  );
  assert.equal(result.value.candidateSets.every(({ routes }) => routes.length >= 2), true);
  assert.equal(result.value.candidateSets[0]?.routes[0], result.value.paths[0]);
  assert.equal(result.value.candidateSets[0]?.routes[1], result.value.paths[1]);
  assert.equal(result.value.candidateSets[2]?.routes[1], result.value.paths[2]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.paths), true);
  assert.equal(result.value.paths.every(Object.isFrozen), true);
  assert.equal(result.value.paths.flat().every(Object.isFrozen), true);
  assert.equal(Object.isFrozen(result.value.candidateSets), true);
  assert.equal(result.value.candidateSets.every(Object.isFrozen), true);

  for (const path of result.value.paths) {
    const assets = [path[0]?.assetIn, ...path.map(({ assetOut }) => assetOut)];
    assert.equal(new Set(assets).size, assets.length);
    assert.equal(new Set(path.map(({ poolId }) => poolId)).size, path.length);
  }
});

void test('keeps path and candidate-set work caps separate at zero and partial limits', () => {
  const snapshot = checksummedSnapshot(GRAPH_POOLS);
  const context = prepare(snapshot);
  const zeroPaths = discoverSharedRoutes(
    context,
    request(snapshot, { maxPathExpansions: 0 }),
  );
  assert.deepEqual(zeroPaths, {
    ok: true,
    value: {
      snapshotId: snapshot.snapshotId,
      snapshotChecksum: snapshot.snapshotChecksum,
      assetIn: 'A',
      assetOut: 'D',
      paths: [],
      candidateSets: [],
      search: {
        pathExpansions: 0,
        enumeratedPaths: 0,
        pathTermination: 'work-limit',
        candidateSetExpansions: 0,
        enumeratedCandidateSets: 0,
        candidateSetTermination: 'complete',
      },
    },
  });

  const zeroSets = discoverSharedRoutes(
    context,
    request(snapshot, { maxCandidateSetExpansions: 0 }),
  );
  assert.equal(zeroSets.ok, true);
  if (!zeroSets.ok) return;
  assert.deepEqual(zeroSets.value.paths, EXPECTED_PATHS);
  assert.deepEqual(zeroSets.value.candidateSets, []);
  assert.equal(zeroSets.value.search.pathExpansions, 7);
  assert.equal(zeroSets.value.search.candidateSetExpansions, 0);
  assert.equal(zeroSets.value.search.candidateSetTermination, 'work-limit');

  const partialSets = discoverSharedRoutes(
    context,
    request(snapshot, { maxCandidateSetExpansions: 2 }),
  );
  assert.equal(partialSets.ok, true);
  if (!partialSets.ok) return;
  assert.deepEqual(partialSets.value.candidateSets, [
    { routes: [EXPECTED_PATHS[0], EXPECTED_PATHS[1]] },
  ]);
  assert.equal(partialSets.value.search.pathExpansions, 7);
  assert.equal(partialSets.value.search.candidateSetExpansions, 2);
  assert.equal(partialSets.value.search.candidateSetTermination, 'work-limit');
});

void test('is canonical under pool permutations and raw UTF-16 request direction', () => {
  const forwardSnapshot = checksummedSnapshot(GRAPH_POOLS);
  const permutedSnapshot = checksummedSnapshot([...GRAPH_POOLS].reverse());
  const forward = discoverSharedRoutes(prepare(forwardSnapshot), request(forwardSnapshot));
  const permuted = discoverSharedRoutes(prepare(permutedSnapshot), request(permutedSnapshot));
  assert.deepEqual(permuted, forward);

  const reverse = discoverSharedRoutes(
    prepare(forwardSnapshot),
    request(forwardSnapshot, { assetIn: 'D', assetOut: 'A' }),
  );
  assert.equal(reverse.ok, true);
  if (!reverse.ok) return;
  assert.deepEqual(reverse.value.paths, [
    [{ assetIn: 'D', poolId: 'ad', assetOut: 'A' }],
    [
      { assetIn: 'D', poolId: 'xd', assetOut: 'X' },
      { assetIn: 'X', poolId: 'ax', assetOut: 'A' },
    ],
    [
      { assetIn: 'D', poolId: 'yd', assetOut: 'Y' },
      { assetIn: 'Y', poolId: 'ay', assetOut: 'A' },
    ],
  ]);
});
