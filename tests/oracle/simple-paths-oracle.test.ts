import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../../src/domain/index.ts';
import type { DirectionalRouteHop } from '../../src/replay/exact-input-route/index.ts';
import {
  buildDeterministicAdjacency,
  enumerateSimplePaths,
} from '../../src/search/simple-paths/index.ts';

interface OracleEnumerationRequest {
  snapshotId: string;
  snapshotChecksum: string;
  assetIn: string;
  assetOut: string;
  maxHops: number;
  maxExpansions: number;
}

interface ExpectedFailure {
  readonly code: string;
  readonly field: string;
}

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

function snapshot(
  pools: readonly ConstantProductPool[],
  snapshotId = 'oracle-snapshot',
  snapshotChecksum = 'oracle-checksum',
): LiquiditySnapshot {
  return { snapshotId, snapshotChecksum, pools };
}

function hop(assetIn: string, poolId: string, assetOut: string): DirectionalRouteHop {
  return { assetIn, poolId, assetOut };
}

function compareRaw(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareHop(left: DirectionalRouteHop, right: DirectionalRouteHop): number {
  return (
    compareRaw(left.assetIn, right.assetIn) ||
    compareRaw(left.poolId, right.poolId) ||
    compareRaw(left.assetOut, right.assetOut)
  );
}

function compareRoute(
  left: readonly DirectionalRouteHop[],
  right: readonly DirectionalRouteHop[],
): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const leftHop = left[index];
    const rightHop = right[index];
    assert.ok(leftHop !== undefined && rightHop !== undefined);
    const comparison = compareHop(leftHop, rightHop);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

function directedEdges(input: LiquiditySnapshot): DirectionalRouteHop[] {
  const edges: DirectionalRouteHop[] = [];
  for (const candidatePool of input.pools) {
    edges.push(hop(candidatePool.asset0, candidatePool.poolId, candidatePool.asset1));
    edges.push(hop(candidatePool.asset1, candidatePool.poolId, candidatePool.asset0));
  }
  return edges;
}

function isSimpleCandidate(
  path: readonly DirectionalRouteHop[],
  assetIn: string,
  assetOut: string,
): boolean {
  const first = path[0];
  if (first === undefined || first.assetIn !== assetIn) return false;

  const visitedAssets = new Set<string>([assetIn]);
  const visitedPools = new Set<string>();
  let expectedAssetIn = assetIn;

  for (const candidateHop of path) {
    if (candidateHop.assetIn !== expectedAssetIn) return false;
    if (visitedPools.has(candidateHop.poolId)) return false;
    if (visitedAssets.has(candidateHop.assetOut)) return false;
    visitedPools.add(candidateHop.poolId);
    visitedAssets.add(candidateHop.assetOut);
    expectedAssetIn = candidateHop.assetOut;
  }

  return expectedAssetIn === assetOut;
}

// This deliberately slow oracle generates every directed-edge sequence before
// filtering it. It neither follows adjacency nor reproduces production DFS.
function exhaustiveSimplePaths(
  input: LiquiditySnapshot,
  assetIn: string,
  assetOut: string,
  maxHops: number,
): DirectionalRouteHop[][] {
  const edges = directedEdges(input);
  const paths: DirectionalRouteHop[][] = [];

  function generate(prefix: readonly DirectionalRouteHop[]): void {
    if (prefix.length > 0 && isSimpleCandidate(prefix, assetIn, assetOut)) {
      paths.push(prefix.map((candidateHop) => ({ ...candidateHop })));
    }
    if (prefix.length === maxHops) return;

    for (const candidateEdge of edges) {
      generate([...prefix, candidateEdge]);
    }
  }

  generate([]);
  paths.sort(compareRoute);
  return paths;
}

function sixPoolSnapshot(pools?: readonly ConstantProductPool[]): LiquiditySnapshot {
  return snapshot(
    pools ?? [
      pool('0-ab', 'A', 'B'),
      pool('1-ab', 'A', 'B'),
      pool('2-ac', 'A', 'C'),
      pool('3-bc', 'B', 'C'),
      pool('4-bd', 'B', 'D'),
      pool('5-cd', 'C', 'D'),
    ],
  );
}

function request(
  overrides: Partial<OracleEnumerationRequest> = {},
): OracleEnumerationRequest {
  return {
    snapshotId: 'oracle-snapshot',
    snapshotChecksum: 'oracle-checksum',
    assetIn: 'A',
    assetOut: 'D',
    maxHops: 3,
    maxExpansions: Number.MAX_SAFE_INTEGER,
    ...overrides,
  };
}

function successfulValue(
  index: ReturnType<typeof buildDeterministicAdjacency>,
  enumerationRequest: OracleEnumerationRequest,
) {
  const result = enumerateSimplePaths(index, enumerationRequest);
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail('Unexpected enumeration failure.');
  return { result, value: result.value };
}

function assertFailure(
  index: ReturnType<typeof buildDeterministicAdjacency>,
  enumerationRequest: OracleEnumerationRequest,
  expected: ExpectedFailure,
): void {
  const result = enumerateSimplePaths(index, enumerationRequest);
  assert.equal(result.ok, false);
  if (result.ok) assert.fail('Expected enumeration to fail.');
  assert.equal(result.error.code, expected.code);
  assert.equal(result.error.field, expected.field);
  assert.ok(result.error.message.length > 0);
  assert.ok(Object.isFrozen(result.error));
  assert.ok(Object.isFrozen(result));
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length === 0) return [[]];
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += 1) {
    const selected = items[index];
    assert.ok(selected !== undefined);
    const remaining = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const suffix of permutations(remaining)) output.push([selected, ...suffix]);
  }
  return output;
}

const expectedSixPoolPaths = [
  [hop('A', '0-ab', 'B'), hop('B', '3-bc', 'C'), hop('C', '5-cd', 'D')],
  [hop('A', '0-ab', 'B'), hop('B', '4-bd', 'D')],
  [hop('A', '1-ab', 'B'), hop('B', '3-bc', 'C'), hop('C', '5-cd', 'D')],
  [hop('A', '1-ab', 'B'), hop('B', '4-bd', 'D')],
  [hop('A', '2-ac', 'C'), hop('C', '3-bc', 'B'), hop('B', '4-bd', 'D')],
  [hop('A', '2-ac', 'C'), hop('C', '5-cd', 'D')],
] as const;

void test('matches an exhaustive sequence oracle on a parallel cyclic graph', () => {
  const input = sixPoolSnapshot();
  const index = buildDeterministicAdjacency(input);
  const expected = exhaustiveSimplePaths(input, 'A', 'D', 3);
  assert.deepEqual(expected, expectedSixPoolPaths);

  const { value } = successfulValue(index, request());
  assert.deepEqual(value.paths, expected);
  assert.equal(value.expansions, 24);
  assert.equal(value.termination, 'complete');

  for (const path of value.paths) {
    assert.equal(path.at(-1)?.assetOut, 'D');
    assert.ok(path.length <= 3);
    assert.equal(new Set(path.map((candidateHop) => candidateHop.poolId)).size, path.length);
    const assets = [path[0]?.assetIn, ...path.map((candidateHop) => candidateHop.assetOut)];
    assert.equal(new Set(assets).size, assets.length);
  }
});

void test('uses the hand-derived recursive pre-order expansion checkpoints', () => {
  const index = buildDeterministicAdjacency(sixPoolSnapshot());
  const checkpoints = [
    { budget: 0, expansions: 0, pathCount: 0, termination: 'work-limit' },
    { budget: 1, expansions: 1, pathCount: 0, termination: 'work-limit' },
    { budget: 7, expansions: 7, pathCount: 1, termination: 'work-limit' },
    { budget: 8, expansions: 8, pathCount: 2, termination: 'work-limit' },
    { budget: 23, expansions: 23, pathCount: 5, termination: 'work-limit' },
    { budget: 24, expansions: 24, pathCount: 6, termination: 'complete' },
  ] as const;

  // The canonical trace reaches D at charges 7, 8, 15, 16, 23, and 24.
  // All intervening charges examine reverse/cyclic edges that are rejected.
  for (const checkpoint of checkpoints) {
    const { value } = successfulValue(
      index,
      request({ maxExpansions: checkpoint.budget }),
    );
    assert.equal(value.expansions, checkpoint.expansions);
    assert.equal(value.termination, checkpoint.termination);
    assert.deepEqual(value.paths, expectedSixPoolPaths.slice(0, checkpoint.pathCount));
    for (const path of value.paths) assert.equal(path.at(-1)?.assetOut, 'D');
  }
});

void test('charges exact complete counters at each hop bound', () => {
  const input = sixPoolSnapshot();
  const index = buildDeterministicAdjacency(input);
  const cases = [
    { maxHops: 1, expansions: 3, paths: 0 },
    { maxHops: 2, expansions: 14, paths: 3 },
    { maxHops: 3, expansions: 24, paths: 6 },
  ] as const;

  for (const bounded of cases) {
    const expected = exhaustiveSimplePaths(input, 'A', 'D', bounded.maxHops);
    const { value } = successfulValue(index, request({ maxHops: bounded.maxHops }));
    assert.equal(expected.length, bounded.paths);
    assert.deepEqual(value.paths, expected);
    assert.equal(value.expansions, bounded.expansions);
    assert.equal(value.termination, 'complete');
  }
});

void test('is invariant across all 720 six-pool input permutations', () => {
  const canonicalSnapshot = sixPoolSnapshot();
  const canonicalIndex = buildDeterministicAdjacency(canonicalSnapshot);
  const expectedPaths = exhaustiveSimplePaths(canonicalSnapshot, 'A', 'D', 3);
  const allPermutations = permutations(canonicalSnapshot.pools);
  assert.equal(allPermutations.length, 720);

  for (const poolOrder of allPermutations) {
    const permutedIndex = buildDeterministicAdjacency(sixPoolSnapshot(poolOrder));
    assert.deepEqual(permutedIndex, canonicalIndex);
    const { value } = successfulValue(permutedIndex, request());
    assert.deepEqual(value.paths, expectedPaths);
    assert.equal(value.expansions, 24);
    assert.equal(value.termination, 'complete');
  }
});

void test('reproduces the M0 two-hop and disconnected structural cases', () => {
  const twoHop = snapshot([
    pool('direct-ac', 'A', 'C'),
    pool('hop-ab', 'A', 'B'),
    pool('hop-bc', 'B', 'C'),
  ]);
  const twoHopExpected = [
    [hop('A', 'direct-ac', 'C')],
    [hop('A', 'hop-ab', 'B'), hop('B', 'hop-bc', 'C')],
  ];
  const twoHopResult = successfulValue(
    buildDeterministicAdjacency(twoHop),
    request({ assetOut: 'C', maxHops: 2 }),
  ).value;
  assert.deepEqual(exhaustiveSimplePaths(twoHop, 'A', 'C', 2), twoHopExpected);
  assert.deepEqual(twoHopResult.paths, twoHopExpected);
  assert.equal(twoHopResult.expansions, 4);
  assert.equal(twoHopResult.termination, 'complete');

  const disconnected = snapshot([
    pool('component-ab', 'A', 'B'),
    pool('component-cd', 'C', 'D'),
  ]);
  const disconnectedResult = successfulValue(
    buildDeterministicAdjacency(disconnected),
    request({ maxHops: 4 }),
  ).value;
  assert.deepEqual(exhaustiveSimplePaths(disconnected, 'A', 'D', 4), []);
  assert.deepEqual(disconnectedResult.paths, []);
  assert.equal(disconnectedResult.expansions, 2);
  assert.equal(disconnectedResult.termination, 'complete');
});

void test('uses raw case-sensitive UTF-16 order for buckets, edges, and paths', () => {
  const rawOrder = ['Z', 'a', '😀', '\uE000'];
  const star = snapshot(rawOrder.map((identifier) => pool(identifier, 'hub', identifier)));
  const starIndex = buildDeterministicAdjacency(star);
  assert.deepEqual(
    starIndex.buckets.map((bucket) => bucket.assetIn),
    ['Z', 'a', 'hub', '😀', '\uE000'],
  );
  const hubBucket = starIndex.buckets.find((bucket) => bucket.assetIn === 'hub');
  assert.ok(hubBucket !== undefined);
  assert.deepEqual(
    hubBucket.edges.map((edge) => edge.poolId),
    rawOrder,
  );

  const parallel = snapshot(rawOrder.map((identifier) => pool(identifier, 'hub', 'target')));
  const parallelResult = successfulValue(
    buildDeterministicAdjacency(parallel),
    request({ assetIn: 'hub', assetOut: 'target', maxHops: 1 }),
  ).value;
  assert.deepEqual(
    parallelResult.paths.map((path) => path[0]?.poolId),
    rawOrder,
  );
  assert.equal(parallelResult.expansions, 4);
});

void test('validates requests in the frozen first-error order and field taxonomy', () => {
  const index = buildDeterministicAdjacency(sixPoolSnapshot());
  assertFailure(
    index,
    request({
      snapshotId: 'wrong',
      assetIn: '',
      assetOut: '',
      maxHops: 0,
      maxExpansions: -1,
    }),
    { code: 'snapshot-identity-mismatch', field: 'snapshotIdentity' },
  );
  assertFailure(index, request({ assetIn: '', assetOut: '', maxHops: 0 }), {
    code: 'empty-identifier',
    field: 'assetIn',
  });
  assertFailure(index, request({ assetOut: '', maxHops: 0 }), {
    code: 'empty-identifier',
    field: 'assetOut',
  });
  assertFailure(index, request({ assetOut: 'A', maxHops: 0 }), {
    code: 'same-asset-request',
    field: 'assetOut',
  });
  assertFailure(index, request({ assetIn: 'unknown-in', assetOut: 'unknown-out', maxHops: 0 }), {
    code: 'invalid-max-hops',
    field: 'maxHops',
  });
  assertFailure(
    index,
    request({ assetIn: 'unknown-in', assetOut: 'unknown-out', maxExpansions: -1 }),
    { code: 'invalid-max-expansions', field: 'maxExpansions' },
  );
  assertFailure(index, request({ assetIn: 'unknown-in', assetOut: 'unknown-out' }), {
    code: 'unknown-asset',
    field: 'assetIn',
  });
  assertFailure(index, request({ assetOut: 'unknown-out' }), {
    code: 'unknown-asset',
    field: 'assetOut',
  });
});

void test('rejects every unsafe structural limit with frozen typed errors', () => {
  const index = buildDeterministicAdjacency(sixPoolSnapshot());
  const invalidMaxHops = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53];
  for (const maxHops of invalidMaxHops) {
    assertFailure(index, request({ maxHops }), {
      code: 'invalid-max-hops',
      field: 'maxHops',
    });
  }

  const invalidMaxExpansions = [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53];
  for (const maxExpansions of invalidMaxExpansions) {
    assertFailure(index, request({ maxExpansions }), {
      code: 'invalid-max-expansions',
      field: 'maxExpansions',
    });
  }
});

void test('deep-freezes copied indexes and successful results without caller aliases', () => {
  const mutablePools = [
    { ...pool('0-ab', 'A', 'B') },
    { ...pool('4-bd', 'B', 'D') },
  ];
  const mutableSnapshot = {
    snapshotId: 'oracle-snapshot',
    snapshotChecksum: 'oracle-checksum',
    pools: mutablePools,
  };
  const beforeSnapshot = {
    ...mutableSnapshot,
    pools: mutableSnapshot.pools.map((candidatePool) => ({ ...candidatePool })),
  };
  const index = buildDeterministicAdjacency(mutableSnapshot);
  const beforeIndex = structuredClone(index);

  assert.deepEqual(mutableSnapshot, beforeSnapshot);
  assert.ok(Object.isFrozen(index));
  assert.ok(Object.isFrozen(index.buckets));
  for (const bucket of index.buckets) {
    assert.ok(Object.isFrozen(bucket));
    assert.ok(Object.isFrozen(bucket.edges));
    for (const edge of bucket.edges) assert.ok(Object.isFrozen(edge));
  }

  mutablePools[0]!.poolId = 'mutated';
  mutablePools[0]!.asset0 = 'mutated-asset';
  mutablePools.reverse();
  mutableSnapshot.snapshotId = 'mutated-snapshot';
  assert.deepEqual(index, beforeIndex);

  const mutableRequest = request({ maxHops: 2 });
  const { result, value } = successfulValue(index, mutableRequest);
  const beforeValue = structuredClone(value);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(value));
  assert.ok(Object.isFrozen(value.paths));
  for (const path of value.paths) {
    assert.ok(Object.isFrozen(path));
    for (const pathHop of path) assert.ok(Object.isFrozen(pathHop));
  }
  mutableRequest.assetIn = 'mutated-request';
  mutableRequest.maxHops = 1;
  assert.deepEqual(value, beforeValue);
});

void test('returns identical semantic values on repeated deterministic calls', () => {
  const input = sixPoolSnapshot();
  const beforeSnapshot = structuredClone(input);
  const firstIndex = buildDeterministicAdjacency(input);
  const secondIndex = buildDeterministicAdjacency(input);
  assert.deepEqual(firstIndex, secondIndex);

  const enumerationRequest = request({ maxExpansions: 16 });
  const beforeRequest = { ...enumerationRequest };
  const first = enumerateSimplePaths(firstIndex, enumerationRequest);
  const second = enumerateSimplePaths(secondIndex, enumerationRequest);
  assert.deepEqual(first, second);
  assert.deepEqual(input, beforeSnapshot);
  assert.deepEqual(enumerationRequest, beforeRequest);
});
