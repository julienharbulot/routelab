import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../src/domain/index.ts';
import {
  enumeratePoolDisjointRouteSets,
  type PoolDisjointRouteSetEnumerationErrorCode,
  type PoolDisjointRouteSetEnumerationErrorField,
  type PoolDisjointRouteSetEnumerationRequest,
  type PoolDisjointRouteSetEnumerationResult,
} from '../src/search/pool-disjoint-route-sets/index.ts';
import {
  buildDeterministicAdjacency,
  type DeterministicAdjacencyIndex,
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

function snapshot(pools: readonly ConstantProductPool[]): LiquiditySnapshot {
  return {
    snapshotId: 'route-set-snapshot',
    snapshotChecksum: 'route-set-checksum',
    pools,
  };
}

function index(pools: readonly ConstantProductPool[]): DeterministicAdjacencyIndex {
  return buildDeterministicAdjacency(snapshot(pools));
}

function request(
  overrides: Partial<PoolDisjointRouteSetEnumerationRequest> = {},
): PoolDisjointRouteSetEnumerationRequest {
  return {
    snapshotId: 'route-set-snapshot',
    snapshotChecksum: 'route-set-checksum',
    assetIn: 'A',
    assetOut: 'D',
    maxHops: 3,
    maxPathExpansions: 100,
    maxRoutes: 2,
    maxCandidateSetExpansions: 100,
    ...overrides,
  };
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) {
    assertDeepFrozen(Reflect.get(value, key), seen);
  }
}

function valueFrom(result: PoolDisjointRouteSetEnumerationResult) {
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('expected successful route-set enumeration');
  return result.value;
}

function routePoolIds(result: PoolDisjointRouteSetEnumerationResult): string[][][] {
  return valueFrom(result).candidateSets.map(({ routes }) =>
    routes.map((route) => route.map(({ poolId }) => poolId)),
  );
}

function permutations<T>(values: readonly T[]): readonly (readonly T[])[] {
  if (values.length === 0) return [[]];
  const result: T[][] = [];
  for (const [selectedIndex, selected] of values.entries()) {
    const remaining = [
      ...values.slice(0, selectedIndex),
      ...values.slice(selectedIndex + 1),
    ];
    for (const suffix of permutations(remaining)) result.push([selected, ...suffix]);
  }
  return result;
}

const M0_SPLIT_POOLS = [
  pool('left-ac', 'A', 'C'),
  pool('right-ac', 'A', 'C'),
];

void test('enumerates the M0 structural singletons and pool-disjoint pair only', () => {
  const result = enumeratePoolDisjointRouteSets(
    index(M0_SPLIT_POOLS),
    request({ assetOut: 'C', maxHops: 1 }),
  );

  assert.deepEqual(result, {
    ok: true,
    value: {
      snapshotId: 'route-set-snapshot',
      snapshotChecksum: 'route-set-checksum',
      assetIn: 'A',
      assetOut: 'C',
      candidateSets: [
        {
          routes: [
            [{ assetIn: 'A', poolId: 'left-ac', assetOut: 'C' }],
          ],
        },
        {
          routes: [
            [{ assetIn: 'A', poolId: 'right-ac', assetOut: 'C' }],
          ],
        },
        {
          routes: [
            [{ assetIn: 'A', poolId: 'left-ac', assetOut: 'C' }],
            [{ assetIn: 'A', poolId: 'right-ac', assetOut: 'C' }],
          ],
        },
      ],
      search: {
        pathExpansions: 2,
        enumeratedPaths: 2,
        pathTermination: 'complete',
        candidateSetExpansions: 5,
        enumeratedCandidateSets: 3,
        candidateSetTermination: 'complete',
      },
    },
  });
  assertDeepFrozen(result);
});

void test('charges every attempted append and exposes no partial candidate set', () => {
  const expectedSetCounts = [0, 1, 2, 2, 3, 3];
  for (let cap = 0; cap <= 5; cap += 1) {
    const result = enumeratePoolDisjointRouteSets(
      index(M0_SPLIT_POOLS),
      request({
        assetOut: 'C',
        maxHops: 1,
        maxCandidateSetExpansions: cap,
      }),
    );
    const value = valueFrom(result);
    assert.equal(value.search.candidateSetExpansions, cap);
    assert.equal(value.search.enumeratedCandidateSets, expectedSetCounts[cap]);
    assert.equal(value.candidateSets.length, expectedSetCounts[cap]);
    assert.equal(
      value.search.candidateSetTermination,
      cap === 5 ? 'complete' : 'work-limit',
    );
    assert.equal(
      value.candidateSets.every(({ routes }) => routes.length === 1 || routes.length === 2),
      true,
    );
  }

  const singletonOnly = enumeratePoolDisjointRouteSets(
    index(M0_SPLIT_POOLS),
    request({
      assetOut: 'C',
      maxHops: 1,
      maxRoutes: 1,
      maxCandidateSetExpansions: 2,
    }),
  );
  const singletonValue = valueFrom(singletonOnly);
  assert.equal(singletonValue.search.candidateSetTermination, 'complete');
  assert.equal(singletonValue.search.candidateSetExpansions, 2);
  assert.equal(singletonValue.candidateSets.length, 2);
});

void test('charges incompatible attempts and emits only pairwise pool-disjoint sets', () => {
  const conflictPools = [
    pool('ab', 'A', 'B'),
    pool('shared-bd', 'B', 'D'),
    pool('ac', 'A', 'C'),
    pool('cb', 'C', 'B'),
    pool('direct-ad', 'A', 'D'),
  ];
  const complete = enumeratePoolDisjointRouteSets(
    index(conflictPools),
    request({ maxCandidateSetExpansions: 9 }),
  );
  const value = valueFrom(complete);
  assert.deepEqual(routePoolIds(complete), [
    [['ab', 'shared-bd']],
    [['ac', 'cb', 'shared-bd']],
    [['direct-ad']],
    [['ab', 'shared-bd'], ['direct-ad']],
    [['ac', 'cb', 'shared-bd'], ['direct-ad']],
  ]);
  assert.deepEqual(value.search, {
    pathExpansions: 13,
    enumeratedPaths: 3,
    pathTermination: 'complete',
    candidateSetExpansions: 9,
    enumeratedCandidateSets: 5,
    candidateSetTermination: 'complete',
  });
  for (const { routes } of value.candidateSets) {
    const poolIds = routes.flatMap((route) => route.map(({ poolId }) => poolId));
    assert.equal(new Set(poolIds).size, poolIds.length);
  }

  const afterIncompatible = enumeratePoolDisjointRouteSets(
    index(conflictPools),
    request({ maxCandidateSetExpansions: 5 }),
  );
  const boundedValue = valueFrom(afterIncompatible);
  assert.equal(boundedValue.search.candidateSetExpansions, 5);
  assert.equal(boundedValue.search.enumeratedCandidateSets, 3);
  assert.equal(boundedValue.search.candidateSetTermination, 'work-limit');
});

void test('allows shared intermediate assets when every pool ID is distinct', () => {
  const result = enumeratePoolDisjointRouteSets(
    index([
      pool('ab-left', 'A', 'B'),
      pool('ab-right', 'A', 'B'),
      pool('bd-left', 'B', 'D'),
      pool('bd-right', 'B', 'D'),
    ]),
    request({ maxHops: 2 }),
  );
  const sets = routePoolIds(result);
  assert.equal(
    sets.some(
      (routes) =>
        JSON.stringify(routes) ===
        JSON.stringify([
          ['ab-left', 'bd-left'],
          ['ab-right', 'bd-right'],
        ]),
    ),
    true,
  );
  assert.equal(
    sets.some(
      (routes) =>
        JSON.stringify(routes) ===
        JSON.stringify([
          ['ab-left', 'bd-right'],
          ['ab-right', 'bd-left'],
        ]),
    ),
    true,
  );
});

void test('rejects cross-route pool reuse even when the shared pool directions differ', () => {
  const result = enumeratePoolDisjointRouteSets(
    index([
      pool('ab', 'A', 'B'),
      pool('shared-bc', 'B', 'C'),
      pool('cd', 'C', 'D'),
      pool('ac', 'A', 'C'),
      pool('bd', 'B', 'D'),
    ]),
    request(),
  );
  const sets = routePoolIds(result);
  const forward = ['ab', 'shared-bc', 'cd'];
  const reverse = ['ac', 'shared-bc', 'bd'];
  assert.equal(sets.some((routes) => routes.some((route) => route.join() === forward.join())), true);
  assert.equal(sets.some((routes) => routes.some((route) => route.join() === reverse.join())), true);
  assert.equal(
    sets.some(
      (routes) =>
        routes.some((route) => route.join() === forward.join()) &&
        routes.some((route) => route.join() === reverse.join()),
    ),
    false,
  );
});

void test('retains partial path-phase truth separately from set-phase completion', () => {
  const graphPools = [
    pool('ab', 'A', 'B'),
    pool('ac', 'A', 'C'),
    pool('bc', 'B', 'C'),
    pool('bd', 'B', 'D'),
    pool('cd', 'C', 'D'),
    pool('ef', 'E', 'F'),
  ];
  const beforePath = enumeratePoolDisjointRouteSets(
    index(graphPools),
    request({ maxPathExpansions: 5 }),
  );
  assert.deepEqual(valueFrom(beforePath).search, {
    pathExpansions: 5,
    enumeratedPaths: 0,
    pathTermination: 'work-limit',
    candidateSetExpansions: 0,
    enumeratedCandidateSets: 0,
    candidateSetTermination: 'complete',
  });

  const onePath = enumeratePoolDisjointRouteSets(
    index(graphPools),
    request({ maxPathExpansions: 6 }),
  );
  const onePathValue = valueFrom(onePath);
  assert.deepEqual(onePathValue.search, {
    pathExpansions: 6,
    enumeratedPaths: 1,
    pathTermination: 'work-limit',
    candidateSetExpansions: 1,
    enumeratedCandidateSets: 1,
    candidateSetTermination: 'complete',
  });
  assert.deepEqual(routePoolIds(onePath), [[['ab', 'bc', 'cd']]]);
});

void test('returns successful complete empty structural results for disconnected assets', () => {
  const result = enumeratePoolDisjointRouteSets(
    index([
      pool('component-ab', 'A', 'B'),
      pool('component-cd', 'C', 'D'),
    ]),
    request({ maxHops: 2 }),
  );
  const value = valueFrom(result);
  assert.deepEqual(value.candidateSets, []);
  assert.equal(value.search.enumeratedPaths, 0);
  assert.equal(value.search.pathTermination, 'complete');
  assert.equal(value.search.candidateSetExpansions, 0);
  assert.equal(value.search.candidateSetTermination, 'complete');
  assertDeepFrozen(result);
});

function assertFailure(
  overrides: Partial<PoolDisjointRouteSetEnumerationRequest>,
  code: PoolDisjointRouteSetEnumerationErrorCode,
  field: PoolDisjointRouteSetEnumerationErrorField,
): void {
  const result = enumeratePoolDisjointRouteSets(
    index([pool('ab', 'A', 'B'), pool('cd', 'C', 'D')]),
    request(overrides),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, code);
  assert.equal(result.error.field, field);
  assert.notEqual(result.error.message.length, 0);
  assert.deepEqual(Object.keys(result.error), ['code', 'field', 'message']);
  assertDeepFrozen(result);
}

void test('validates every structural field in the frozen first-error order', () => {
  assertFailure(
    {
      snapshotId: 'wrong',
      snapshotChecksum: 'wrong',
      assetIn: '',
      assetOut: '',
      maxHops: 0,
      maxPathExpansions: -1,
      maxRoutes: 0,
      maxCandidateSetExpansions: -1,
    },
    'snapshot-identity-mismatch',
    'snapshotIdentity',
  );
  assertFailure({ assetIn: '', assetOut: '' }, 'empty-identifier', 'assetIn');
  assertFailure({ assetOut: '' }, 'empty-identifier', 'assetOut');
  assertFailure({ assetIn: 'A', assetOut: 'A' }, 'same-asset-request', 'assetOut');

  const invalidLimits = [
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    2 ** 53,
  ];
  for (const maxHops of [0, ...invalidLimits]) {
    assertFailure({ maxHops }, 'invalid-max-hops', 'maxHops');
  }
  for (const maxPathExpansions of invalidLimits) {
    assertFailure(
      { maxPathExpansions },
      'invalid-max-path-expansions',
      'maxPathExpansions',
    );
  }
  for (const maxRoutes of [0, ...invalidLimits]) {
    assertFailure({ maxRoutes }, 'invalid-max-routes', 'maxRoutes');
  }
  for (const maxCandidateSetExpansions of invalidLimits) {
    assertFailure(
      { maxCandidateSetExpansions },
      'invalid-max-candidate-set-expansions',
      'maxCandidateSetExpansions',
    );
  }
  assertFailure(
    { assetIn: 'unknown', assetOut: 'also-unknown' },
    'unknown-asset',
    'assetIn',
  );
  assertFailure({ assetOut: 'unknown' }, 'unknown-asset', 'assetOut');
});

void test('captures every index and request field once before caller drift', () => {
  const fieldReads = new Map<string, number>();
  const read = <T>(key: string, value: T): T => {
    fieldReads.set(key, (fieldReads.get(key) ?? 0) + 1);
    return value;
  };
  const mutableEdge = {
    assetIn: 'A',
    poolId: 'left-ac',
    assetOut: 'C',
  };
  const edge = {
    get assetIn() {
      return read('edge.assetIn', mutableEdge.assetIn);
    },
    get poolId() {
      return read('edge.poolId', mutableEdge.poolId);
    },
    get assetOut() {
      return read('edge.assetOut', mutableEdge.assetOut);
    },
  };
  const bucket = {
    get assetIn() {
      return read('bucket.assetIn', 'A');
    },
    get edges() {
      return read('bucket.edges', [edge]);
    },
  };
  const driftingIndex = {
    get snapshotId() {
      return read('index.snapshotId', 'route-set-snapshot');
    },
    get snapshotChecksum() {
      return read('index.snapshotChecksum', 'route-set-checksum');
    },
    get buckets() {
      return read('index.buckets', [bucket, { assetIn: 'C', edges: [] }]);
    },
  } as DeterministicAdjacencyIndex;
  const stableRequest = request({ assetOut: 'C', maxHops: 1, maxRoutes: 1 });
  const driftingRequest = Object.fromEntries(
    Object.keys(stableRequest).map((key) => [
      key,
      {
        enumerable: true,
        get() {
          const value = stableRequest[key as keyof typeof stableRequest];
          if (key === 'snapshotId') {
            mutableEdge.assetIn = 'X';
            mutableEdge.poolId = 'mutated';
            mutableEdge.assetOut = 'Y';
          }
          return read(`request.${key}`, value);
        },
      },
    ]),
  );
  const requestWithGetters = Object.defineProperties(
    {},
    driftingRequest,
  ) as PoolDisjointRouteSetEnumerationRequest;

  const actual = enumeratePoolDisjointRouteSets(driftingIndex, requestWithGetters);
  const expected = enumeratePoolDisjointRouteSets(
    {
      snapshotId: 'route-set-snapshot',
      snapshotChecksum: 'route-set-checksum',
      buckets: [
        {
          assetIn: 'A',
          edges: [{ assetIn: 'A', poolId: 'left-ac', assetOut: 'C' }],
        },
        { assetIn: 'C', edges: [] },
      ],
    },
    stableRequest,
  );
  assert.deepEqual(actual, expected);
  for (const count of fieldReads.values()) assert.equal(count, 1);
  assert.equal(fieldReads.size, 3 + 2 + 3 + 8);
});

void test('is permutation invariant and follows raw UTF-16 route/set order', () => {
  const poolIds = ['z-pool', 'A-pool', '\u{1f600}-pool', '\ue000-pool'];
  const pools = poolIds.map((poolId) => pool(poolId, 'A', 'C'));
  const results = permutations(pools).map((order) =>
    enumeratePoolDisjointRouteSets(
      index(order),
      request({ assetOut: 'C', maxHops: 1 }),
    ),
  );
  for (const result of results) assert.deepEqual(result, results[0]);
  const first = results[0];
  assert.ok(first !== undefined);
  assert.deepEqual(routePoolIds(first), [
    [['A-pool']],
    [['z-pool']],
    [['\u{1f600}-pool']],
    [['\ue000-pool']],
    [['A-pool'], ['z-pool']],
    [['A-pool'], ['\u{1f600}-pool']],
    [['A-pool'], ['\ue000-pool']],
    [['z-pool'], ['\u{1f600}-pool']],
    [['z-pool'], ['\ue000-pool']],
    [['\u{1f600}-pool'], ['\ue000-pool']],
  ]);
  const value = valueFrom(first);
  assert.equal(value.search.candidateSetExpansions, 14);
  assert.equal(value.search.enumeratedCandidateSets, 10);
  assert.equal(value.search.candidateSetTermination, 'complete');
});

void test('deep-freezes fresh proposals without caller aliases or financial fields', () => {
  const inputIndex = index(M0_SPLIT_POOLS);
  const inputRequest = request({ assetOut: 'C', maxHops: 1 });
  const indexBefore = structuredClone(inputIndex);
  const requestBefore = structuredClone(inputRequest);
  const result = enumeratePoolDisjointRouteSets(inputIndex, inputRequest);
  const repeated = enumeratePoolDisjointRouteSets(inputIndex, inputRequest);
  const value = valueFrom(result);

  assert.deepEqual(result, repeated);
  assert.deepEqual(inputIndex, indexBefore);
  assert.deepEqual(inputRequest, requestBefore);
  assert.notEqual(
    value.candidateSets[0]?.routes[0]?.[0],
    inputIndex.buckets.find(({ assetIn }) => assetIn === 'A')?.edges[0],
  );
  assert.deepEqual(Object.keys(value), [
    'snapshotId',
    'snapshotChecksum',
    'assetIn',
    'assetOut',
    'candidateSets',
    'search',
  ]);
  assert.deepEqual(Object.keys(value.search), [
    'pathExpansions',
    'enumeratedPaths',
    'pathTermination',
    'candidateSetExpansions',
    'enumeratedCandidateSets',
    'candidateSetTermination',
  ]);
  const forbiddenFields = new Set([
    'amountIn',
    'amountOut',
    'allocation',
    'receipt',
    'replay',
    'incumbent',
    'plan',
    'hash',
    'timing',
    'deadline',
  ]);
  const inspectKeys = (entry: unknown): void => {
    if (typeof entry !== 'object' || entry === null) return;
    for (const key of Reflect.ownKeys(entry)) {
      if (typeof key === 'string') assert.equal(forbiddenFields.has(key), false);
      inspectKeys(Reflect.get(entry, key));
    }
  };
  inspectKeys(result);
  assertDeepFrozen(result);
});
