import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../../src/domain/index.ts';
import type { DirectionalRouteHop } from '../../src/replay/exact-input-route/index.ts';
import {
  enumeratePoolDisjointRouteSets,
  type PoolDisjointRouteSetEnumerationRequest,
  type PoolDisjointRouteSetEnumerationResult,
} from '../../src/search/pool-disjoint-route-sets/index.ts';
import {
  buildDeterministicAdjacency,
  enumerateSimplePaths,
  type DeterministicAdjacencyIndex,
} from '../../src/search/simple-paths/index.ts';

interface StructuralPool {
  readonly poolId: string;
  readonly asset0: string;
  readonly asset1: string;
}

interface OraclePathPhase {
  readonly paths: readonly (readonly DirectionalRouteHop[])[];
  readonly expansions: number;
  readonly termination: 'complete' | 'work-limit';
}

interface OracleSetPhase {
  readonly candidateSets: readonly {
    readonly routes: readonly (readonly DirectionalRouteHop[])[];
  }[];
  readonly expansions: number;
  readonly termination: 'complete' | 'work-limit';
}

function hop(assetIn: string, poolId: string, assetOut: string): DirectionalRouteHop {
  return { assetIn, poolId, assetOut };
}

function compareRawUtf16(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareHop(left: DirectionalRouteHop, right: DirectionalRouteHop): number {
  return (
    compareRawUtf16(left.assetIn, right.assetIn) ||
    compareRawUtf16(left.poolId, right.poolId) ||
    compareRawUtf16(left.assetOut, right.assetOut)
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

// This is deliberately independent of buildDeterministicAdjacency. It expands
// both pool directions, groups them, and applies raw UTF-16 ordering directly.
function oracleIndex(
  pools: readonly StructuralPool[],
  snapshotId = 'oracle-route-set-snapshot',
  snapshotChecksum = 'oracle-route-set-checksum',
): DeterministicAdjacencyIndex {
  const grouped = new Map<string, DirectionalRouteHop[]>();
  for (const candidatePool of pools) {
    for (const edge of [
      hop(candidatePool.asset0, candidatePool.poolId, candidatePool.asset1),
      hop(candidatePool.asset1, candidatePool.poolId, candidatePool.asset0),
    ]) {
      const bucket = grouped.get(edge.assetIn) ?? [];
      bucket.push(edge);
      grouped.set(edge.assetIn, bucket);
    }
  }

  const buckets = [...grouped.entries()]
    .sort(([left], [right]) => compareRawUtf16(left, right))
    .map(([assetIn, edges]) => ({
      assetIn,
      edges: [...edges].sort(compareHop),
    }));
  return { snapshotId, snapshotChecksum, buckets };
}

function request(
  overrides: Partial<PoolDisjointRouteSetEnumerationRequest> = {},
): PoolDisjointRouteSetEnumerationRequest {
  return {
    snapshotId: 'oracle-route-set-snapshot',
    snapshotChecksum: 'oracle-route-set-checksum',
    assetIn: 'A',
    assetOut: 'D',
    maxHops: 3,
    maxPathExpansions: Number.MAX_SAFE_INTEGER,
    maxRoutes: 3,
    maxCandidateSetExpansions: Number.MAX_SAFE_INTEGER,
    ...overrides,
  };
}

// A recursive edge-attempt trace is used instead of the production traversal.
// Reaching the budget at an exhausted frontier is therefore naturally complete.
function oraclePathPhase(
  index: DeterministicAdjacencyIndex,
  enumerationRequest: PoolDisjointRouteSetEnumerationRequest,
): OraclePathPhase {
  const buckets = new Map(index.buckets.map((bucket) => [bucket.assetIn, bucket.edges]));
  const paths: DirectionalRouteHop[][] = [];
  let expansions = 0;

  function walk(
    asset: string,
    prefix: readonly DirectionalRouteHop[],
    visitedAssets: ReadonlySet<string>,
    visitedPools: ReadonlySet<string>,
  ): boolean {
    if (prefix.length === enumerationRequest.maxHops) return true;
    for (const edge of buckets.get(asset) ?? []) {
      if (expansions === enumerationRequest.maxPathExpansions) return false;
      expansions += 1;
      if (visitedPools.has(edge.poolId) || visitedAssets.has(edge.assetOut)) continue;

      const next = [...prefix, { ...edge }];
      if (edge.assetOut === enumerationRequest.assetOut) {
        paths.push(next);
        continue;
      }
      const nextAssets = new Set(visitedAssets);
      nextAssets.add(edge.assetOut);
      const nextPools = new Set(visitedPools);
      nextPools.add(edge.poolId);
      if (!walk(edge.assetOut, next, nextAssets, nextPools)) return false;
    }
    return true;
  }

  const complete = walk(
    enumerationRequest.assetIn,
    [],
    new Set([enumerationRequest.assetIn]),
    new Set(),
  );
  paths.sort(compareRoute);
  return {
    paths,
    expansions,
    termination: complete ? 'complete' : 'work-limit',
  };
}

// Each loop iteration is one attempted append. Compatibility affects whether
// recursion continues, never whether the attempt is charged.
function oracleSetPhase(
  paths: readonly (readonly DirectionalRouteHop[])[],
  maxRoutes: number,
  maxExpansions: number,
): OracleSetPhase {
  const candidateSets: { routes: readonly (readonly DirectionalRouteHop[])[] }[] = [];
  let expansions = 0;

  function enumerateCardinality(target: number): boolean {
    const selected: (readonly DirectionalRouteHop[])[] = [];
    const usedPools = new Set<string>();

    function appendFrom(start: number): boolean {
      for (let routeIndex = start; routeIndex < paths.length; routeIndex += 1) {
        if (expansions === maxExpansions) return false;
        expansions += 1;
        const route = paths[routeIndex];
        assert.ok(route !== undefined);
        if (route.some(({ poolId }) => usedPools.has(poolId))) continue;

        selected.push(route);
        for (const { poolId } of route) usedPools.add(poolId);
        if (selected.length === target) {
          candidateSets.push({ routes: selected.map((entry) => entry.map((edge) => ({ ...edge }))) });
        } else if (!appendFrom(routeIndex + 1)) {
          return false;
        }
        selected.pop();
        for (const { poolId } of route) usedPools.delete(poolId);
      }
      return true;
    }

    return appendFrom(0);
  }

  const maximumCardinality = Math.min(maxRoutes, paths.length);
  for (let cardinality = 1; cardinality <= maximumCardinality; cardinality += 1) {
    if (!enumerateCardinality(cardinality)) {
      return { candidateSets, expansions, termination: 'work-limit' };
    }
  }
  return { candidateSets, expansions, termination: 'complete' };
}

function oracleResult(
  index: DeterministicAdjacencyIndex,
  enumerationRequest: PoolDisjointRouteSetEnumerationRequest,
): PoolDisjointRouteSetEnumerationResult {
  const pathPhase = oraclePathPhase(index, enumerationRequest);
  const setPhase = oracleSetPhase(
    pathPhase.paths,
    enumerationRequest.maxRoutes,
    enumerationRequest.maxCandidateSetExpansions,
  );
  return {
    ok: true,
    value: {
      snapshotId: enumerationRequest.snapshotId,
      snapshotChecksum: enumerationRequest.snapshotChecksum,
      assetIn: enumerationRequest.assetIn,
      assetOut: enumerationRequest.assetOut,
      candidateSets: setPhase.candidateSets,
      search: {
        pathExpansions: pathPhase.expansions,
        enumeratedPaths: pathPhase.paths.length,
        pathTermination: pathPhase.termination,
        candidateSetExpansions: setPhase.expansions,
        enumeratedCandidateSets: setPhase.candidateSets.length,
        candidateSetTermination: setPhase.termination,
      },
    },
  };
}

function assertMatchesOracle(
  index: DeterministicAdjacencyIndex,
  enumerationRequest: PoolDisjointRouteSetEnumerationRequest,
): PoolDisjointRouteSetEnumerationResult {
  const expected = oracleResult(index, enumerationRequest);
  const actual = enumeratePoolDisjointRouteSets(index, enumerationRequest);
  assert.deepEqual(actual, expected);
  return actual;
}

function valueFrom(result: PoolDisjointRouteSetEnumerationResult) {
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail('expected a successful structural enumeration');
  return result.value;
}

function routePoolIds(result: PoolDisjointRouteSetEnumerationResult): string[][][] {
  return valueFrom(result).candidateSets.map(({ routes }) =>
    routes.map((route) => route.map(({ poolId }) => poolId)),
  );
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) assertDeepFrozen(Reflect.get(value, key), seen);
}

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length === 0) return [[]];
  const output: T[][] = [];
  for (let selectedIndex = 0; selectedIndex < values.length; selectedIndex += 1) {
    const selected = values[selectedIndex];
    assert.ok(selected !== undefined);
    const remaining = [
      ...values.slice(0, selectedIndex),
      ...values.slice(selectedIndex + 1),
    ];
    for (const suffix of permutations(remaining)) output.push([selected, ...suffix]);
  }
  return output;
}

const SIX_POOL_GRAPH: readonly StructuralPool[] = [
  { poolId: '0-ab', asset0: 'A', asset1: 'B' },
  { poolId: '1-ab', asset0: 'A', asset1: 'B' },
  { poolId: '2-ac', asset0: 'A', asset1: 'C' },
  { poolId: '3-bc', asset0: 'B', asset1: 'C' },
  { poolId: '4-bd', asset0: 'B', asset1: 'D' },
  { poolId: '5-cd', asset0: 'C', asset1: 'D' },
];

void test('derives the M0 singleton and disjoint pair structure without financial output', () => {
  const fixture = JSON.parse(
    readFileSync(new URL('../../fixtures/m0/split-beats-full-route.json', import.meta.url), 'utf8'),
  ) as {
    readonly pools: readonly StructuralPool[];
  };
  const index = oracleIndex(fixture.pools);
  const enumerationRequest = request({ assetOut: 'C', maxHops: 1, maxRoutes: 2 });
  const result = assertMatchesOracle(index, enumerationRequest);

  assert.deepEqual(routePoolIds(result), [
    [['left-ac']],
    [['right-ac']],
    [['left-ac'], ['right-ac']],
  ]);
  assert.deepEqual(valueFrom(result).search, {
    pathExpansions: 2,
    enumeratedPaths: 2,
    pathTermination: 'complete',
    candidateSetExpansions: 5,
    enumeratedCandidateSets: 3,
    candidateSetTermination: 'complete',
  });

  const forbidden = new Set([
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
    'objective',
  ]);
  const inspect = (entry: unknown): void => {
    if (typeof entry !== 'object' || entry === null) return;
    for (const key of Reflect.ownKeys(entry)) {
      if (typeof key === 'string') assert.equal(forbidden.has(key), false);
      inspect(Reflect.get(entry, key));
    }
  };
  inspect(result);
  assertDeepFrozen(result);
});

void test('matches every path and set budget including both exact final frontiers', () => {
  const index = oracleIndex(SIX_POOL_GRAPH);
  const unboundedRequest = request();
  const fullPathPhase = oraclePathPhase(index, unboundedRequest);
  assert.equal(fullPathPhase.expansions, 24);
  assert.equal(fullPathPhase.paths.length, 6);

  for (let pathBudget = 0; pathBudget <= fullPathPhase.expansions; pathBudget += 1) {
    assertMatchesOracle(index, request({ maxPathExpansions: pathBudget }));
  }

  const fullSetPhase = oracleSetPhase(
    fullPathPhase.paths,
    unboundedRequest.maxRoutes,
    Number.MAX_SAFE_INTEGER,
  );
  for (let setBudget = 0; setBudget <= fullSetPhase.expansions; setBudget += 1) {
    assertMatchesOracle(index, request({ maxCandidateSetExpansions: setBudget }));
  }

  for (const pathBudget of [7, 8, 15, 16, 23]) {
    const partialPaths = oraclePathPhase(index, request({ maxPathExpansions: pathBudget }));
    const partialSets = oracleSetPhase(
      partialPaths.paths,
      unboundedRequest.maxRoutes,
      Number.MAX_SAFE_INTEGER,
    );
    for (let setBudget = 0; setBudget <= partialSets.expansions; setBudget += 1) {
      assertMatchesOracle(
        index,
        request({
          maxPathExpansions: pathBudget,
          maxCandidateSetExpansions: setBudget,
        }),
      );
    }
  }

  const beforePathFrontier = valueFrom(
    assertMatchesOracle(index, request({ maxPathExpansions: 23 })),
  );
  const atPathFrontier = valueFrom(
    assertMatchesOracle(index, request({ maxPathExpansions: 24 })),
  );
  assert.equal(beforePathFrontier.search.pathTermination, 'work-limit');
  assert.equal(beforePathFrontier.search.enumeratedPaths, 5);
  assert.equal(atPathFrontier.search.pathTermination, 'complete');
  assert.equal(atPathFrontier.search.enumeratedPaths, 6);

  const beforeSetFrontier = valueFrom(
    assertMatchesOracle(
      index,
      request({ maxCandidateSetExpansions: fullSetPhase.expansions - 1 }),
    ),
  );
  const atSetFrontier = valueFrom(
    assertMatchesOracle(index, request({ maxCandidateSetExpansions: fullSetPhase.expansions })),
  );
  assert.equal(beforeSetFrontier.search.candidateSetTermination, 'work-limit');
  assert.equal(atSetFrontier.search.candidateSetTermination, 'complete');
});

void test('charges incompatible append attempts and never exposes a partial prefix', () => {
  const index = oracleIndex([
    { poolId: 'ab', asset0: 'A', asset1: 'B' },
    { poolId: 'shared-bd', asset0: 'B', asset1: 'D' },
    { poolId: 'ac', asset0: 'A', asset1: 'C' },
    { poolId: 'cb', asset0: 'C', asset1: 'B' },
    { poolId: 'direct-ad', asset0: 'A', asset1: 'D' },
  ]);

  for (let budget = 0; budget <= 9; budget += 1) {
    assertMatchesOracle(index, request({ maxRoutes: 2, maxCandidateSetExpansions: budget }));
  }
  const beforeConflict = valueFrom(
    assertMatchesOracle(index, request({ maxRoutes: 2, maxCandidateSetExpansions: 4 })),
  );
  const afterConflict = valueFrom(
    assertMatchesOracle(index, request({ maxRoutes: 2, maxCandidateSetExpansions: 5 })),
  );
  assert.equal(beforeConflict.candidateSets.length, 3);
  assert.equal(afterConflict.candidateSets.length, 3);
  assert.equal(afterConflict.search.candidateSetExpansions, 5);
  for (const { routes } of afterConflict.candidateSets) assert.equal(routes.length, 1);

  const complete = assertMatchesOracle(
    index,
    request({ maxRoutes: 2, maxCandidateSetExpansions: 9 }),
  );
  assert.deepEqual(routePoolIds(complete), [
    [['ab', 'shared-bd']],
    [['ac', 'cb', 'shared-bd']],
    [['direct-ad']],
    [['ab', 'shared-bd'], ['direct-ad']],
    [['ac', 'cb', 'shared-bd'], ['direct-ad']],
  ]);
});

void test('handles cycles, parallel and reverse routes, shared pools, and shared assets', () => {
  const sharedIntermediateIndex = oracleIndex([
    { poolId: 'ab-left', asset0: 'A', asset1: 'B' },
    { poolId: 'ab-right', asset0: 'A', asset1: 'B' },
    { poolId: 'bd-left', asset0: 'B', asset1: 'D' },
    { poolId: 'bd-right', asset0: 'B', asset1: 'D' },
    { poolId: 'bc-cycle', asset0: 'B', asset1: 'C' },
    { poolId: 'ca-cycle', asset0: 'C', asset1: 'A' },
  ]);
  const sharedIntermediate = assertMatchesOracle(
    sharedIntermediateIndex,
    request({ maxHops: 3, maxRoutes: 2 }),
  );
  const sharedSets = routePoolIds(sharedIntermediate);
  assert.equal(
    sharedSets.some(
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
    sharedSets.some(
      (routes) =>
        JSON.stringify(routes) ===
        JSON.stringify([
          ['ab-left', 'bd-right'],
          ['ab-right', 'bd-left'],
        ]),
    ),
    true,
  );

  const reverseSharedIndex = oracleIndex([
    { poolId: 'ab', asset0: 'A', asset1: 'B' },
    { poolId: 'shared-bc', asset0: 'B', asset1: 'C' },
    { poolId: 'cd', asset0: 'C', asset1: 'D' },
    { poolId: 'ac', asset0: 'A', asset1: 'C' },
    { poolId: 'bd', asset0: 'B', asset1: 'D' },
  ]);
  const reverseShared = assertMatchesOracle(reverseSharedIndex, request({ maxRoutes: 2 }));
  const routes = routePoolIds(reverseShared);
  const forward = ['ab', 'shared-bc', 'cd'];
  const reverse = ['ac', 'shared-bc', 'bd'];
  assert.equal(routes.some((set) => set.some((route) => route.join() === forward.join())), true);
  assert.equal(routes.some((set) => set.some((route) => route.join() === reverse.join())), true);
  assert.equal(
    routes.some(
      (set) =>
        set.some((route) => route.join() === forward.join()) &&
        set.some((route) => route.join() === reverse.join()),
    ),
    false,
  );

  for (const result of [sharedIntermediate, reverseShared]) {
    for (const { routes: candidateRoutes } of valueFrom(result).candidateSets) {
      const pools = candidateRoutes.flatMap((route) => route.map(({ poolId }) => poolId));
      assert.equal(new Set(pools).size, pools.length);
      for (const route of candidateRoutes) {
        const assets = [route[0]?.assetIn, ...route.map(({ assetOut }) => assetOut)];
        assert.equal(new Set(assets).size, assets.length);
      }
    }
  }
});

void test('maxRoutes one emits only all singleton prerequisites at every budget', () => {
  const index = oracleIndex(
    ['z-pool', 'A-pool', '\u{1f600}-pool', '\ue000-pool'].map((poolId) => ({
      poolId,
      asset0: 'A',
      asset1: 'D',
    })),
  );
  for (let budget = 0; budget <= 4; budget += 1) {
    const result = assertMatchesOracle(
      index,
      request({ maxHops: 1, maxRoutes: 1, maxCandidateSetExpansions: budget }),
    );
    const value = valueFrom(result);
    assert.equal(value.candidateSets.every(({ routes }) => routes.length === 1), true);
    assert.equal(value.search.candidateSetExpansions, budget);
    assert.equal(value.search.candidateSetTermination, budget === 4 ? 'complete' : 'work-limit');
  }
});

void test('is invariant over 120 pool permutations and raw UTF-16 set ties', () => {
  const ids = ['z-pool', 'A-pool', '\u{1f600}-pool', '\ue000-pool', 'a-pool'];
  const pools = ids.map((poolId) => ({ poolId, asset0: 'A', asset1: 'D' }));
  const allPermutations = permutations(pools);
  assert.equal(allPermutations.length, 120);

  let baseline: PoolDisjointRouteSetEnumerationResult | undefined;
  for (const poolOrder of allPermutations) {
    const index = oracleIndex(poolOrder);
    const actual = assertMatchesOracle(index, request({ maxHops: 1, maxRoutes: 2 }));
    if (baseline === undefined) baseline = actual;
    else assert.deepEqual(actual, baseline);
  }
  assert.ok(baseline !== undefined);
  assert.deepEqual(
    routePoolIds(baseline).slice(0, 5),
    [[['A-pool']], [['a-pool']], [['z-pool']], [['\u{1f600}-pool']], [['\ue000-pool']]],
  );
  const value = valueFrom(baseline);
  assert.equal(value.search.candidateSetExpansions, 20);
  assert.equal(value.search.enumeratedCandidateSets, 15);
  assert.equal(value.search.candidateSetTermination, 'complete');
});

interface ExpectedError {
  readonly code: string;
  readonly field: string;
  readonly message: string;
}

function assertFailure(
  index: DeterministicAdjacencyIndex,
  overrides: Partial<PoolDisjointRouteSetEnumerationRequest>,
  expected: ExpectedError,
): void {
  const result = enumeratePoolDisjointRouteSets(index, request(overrides));
  assert.deepEqual(result, { ok: false, error: expected });
  assert.deepEqual(Object.keys(result), ['ok', 'error']);
  assertDeepFrozen(result);
}

void test('validates every field and unsafe limit in exact first-error order', () => {
  const index = oracleIndex([
    { poolId: 'ab', asset0: 'A', asset1: 'B' },
    { poolId: 'cd', asset0: 'C', asset1: 'D' },
  ]);
  assertFailure(
    index,
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
    {
      code: 'snapshot-identity-mismatch',
      field: 'snapshotIdentity',
      message: 'request snapshotId and snapshotChecksum must match the adjacency index identity.',
    },
  );
  assertFailure(index, { assetIn: '', assetOut: '' }, {
    code: 'empty-identifier',
    field: 'assetIn',
    message: 'request.assetIn must not be empty.',
  });
  assertFailure(index, { assetOut: '' }, {
    code: 'empty-identifier',
    field: 'assetOut',
    message: 'request.assetOut must not be empty.',
  });
  assertFailure(index, { assetIn: 'A', assetOut: 'A' }, {
    code: 'same-asset-request',
    field: 'assetOut',
    message: 'request.assetIn and request.assetOut must be distinct.',
  });

  const unsafe = [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53];
  for (const maxHops of [0, ...unsafe]) {
    assertFailure(index, { maxHops }, {
      code: 'invalid-max-hops',
      field: 'maxHops',
      message: 'request.maxHops must be a positive safe integer.',
    });
  }
  for (const maxPathExpansions of unsafe) {
    assertFailure(index, { maxPathExpansions }, {
      code: 'invalid-max-path-expansions',
      field: 'maxPathExpansions',
      message: 'request.maxPathExpansions must be a nonnegative safe integer.',
    });
  }
  for (const maxRoutes of [0, ...unsafe]) {
    assertFailure(index, { maxRoutes }, {
      code: 'invalid-max-routes',
      field: 'maxRoutes',
      message: 'request.maxRoutes must be a positive safe integer.',
    });
  }
  for (const maxCandidateSetExpansions of unsafe) {
    assertFailure(index, { maxCandidateSetExpansions }, {
      code: 'invalid-max-candidate-set-expansions',
      field: 'maxCandidateSetExpansions',
      message: 'request.maxCandidateSetExpansions must be a nonnegative safe integer.',
    });
  }
  assertFailure(index, { assetIn: 'missing', assetOut: 'also-missing' }, {
    code: 'unknown-asset',
    field: 'assetIn',
    message: 'request.assetIn must exist in the adjacency index.',
  });
  assertFailure(index, { assetOut: 'missing' }, {
    code: 'unknown-asset',
    field: 'assetOut',
    message: 'request.assetOut must exist in the adjacency index.',
  });
});

void test('captures index and request fields once before mutation and reentrancy', () => {
  const reads = new Map<string, number>();
  const count = <T>(key: string, value: T): T => {
    reads.set(key, (reads.get(key) ?? 0) + 1);
    return value;
  };
  const mutable = { assetIn: 'A', poolId: 'left-ad', assetOut: 'D' };
  const edge = {
    get assetIn() {
      return count('edge.assetIn', mutable.assetIn);
    },
    get poolId() {
      return count('edge.poolId', mutable.poolId);
    },
    get assetOut() {
      return count('edge.assetOut', mutable.assetOut);
    },
  };
  const inputIndex = {
    get snapshotId() {
      return count('index.snapshotId', 'oracle-route-set-snapshot');
    },
    get snapshotChecksum() {
      return count('index.snapshotChecksum', 'oracle-route-set-checksum');
    },
    get buckets() {
      return count('index.buckets', [
        {
          get assetIn() {
            return count('bucketA.assetIn', 'A');
          },
          get edges() {
            return count('bucketA.edges', [edge]);
          },
        },
        {
          get assetIn() {
            return count('bucketD.assetIn', 'D');
          },
          get edges() {
            return count('bucketD.edges', []);
          },
        },
      ]);
    },
  } as DeterministicAdjacencyIndex;

  const stableRequest = request({ maxHops: 1, maxRoutes: 1 });
  const descriptors: PropertyDescriptorMap = {};
  for (const key of Object.keys(stableRequest) as (keyof typeof stableRequest)[]) {
    descriptors[key] = {
      enumerable: true,
      get() {
        const value = stableRequest[key];
        if (key === 'snapshotId') {
          mutable.assetIn = 'X';
          mutable.poolId = 'mutated';
          mutable.assetOut = 'Y';
        }
        if (key === 'snapshotChecksum') {
          const nestedIndex = oracleIndex([{ poolId: 'nested-ad', asset0: 'A', asset1: 'D' }]);
          const nested = enumeratePoolDisjointRouteSets(
            nestedIndex,
            request({ maxHops: 1, maxRoutes: 1 }),
          );
          assert.equal(nested.ok, true);
        }
        return count(`request.${key}`, value);
      },
    };
  }
  const inputRequest = Object.defineProperties(
    {},
    descriptors,
  ) as PoolDisjointRouteSetEnumerationRequest;
  const actual = enumeratePoolDisjointRouteSets(inputIndex, inputRequest);
  const expectedIndex = oracleIndex([{ poolId: 'left-ad', asset0: 'A', asset1: 'D' }]);
  assert.deepEqual(actual, oracleResult(expectedIndex, stableRequest));
  for (const readCount of reads.values()) assert.equal(readCount, 1);
  assert.equal(reads.size, 3 + 4 + 3 + 8);
});

void test('deep-freezes fresh non-aliasing proposals and preserves mutable callers', () => {
  const inputIndex = oracleIndex(SIX_POOL_GRAPH);
  const inputRequest = request();
  const indexBefore = structuredClone(inputIndex);
  const requestBefore = structuredClone(inputRequest);
  const first = assertMatchesOracle(inputIndex, inputRequest);
  const second = assertMatchesOracle(inputIndex, inputRequest);
  const firstValue = valueFrom(first);
  const secondValue = valueFrom(second);

  assert.deepEqual(inputIndex, indexBefore);
  assert.deepEqual(inputRequest, requestBefore);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.notEqual(firstValue, secondValue);
  assert.notEqual(firstValue.candidateSets, secondValue.candidateSets);
  assert.notEqual(
    firstValue.candidateSets[0]?.routes[0]?.[0],
    inputIndex.buckets.find(({ assetIn }) => assetIn === 'A')?.edges[0],
  );
  assert.deepEqual(Object.keys(firstValue), [
    'snapshotId',
    'snapshotChecksum',
    'assetIn',
    'assetOut',
    'candidateSets',
    'search',
  ]);
  assert.deepEqual(Object.keys(firstValue.search), [
    'pathExpansions',
    'enumeratedPaths',
    'pathTermination',
    'candidateSetExpansions',
    'enumeratedCandidateSets',
    'candidateSetTermination',
  ]);
  for (const candidateSet of firstValue.candidateSets) {
    assert.deepEqual(Object.keys(candidateSet), ['routes']);
    assert.ok(candidateSet.routes.length >= 1 && candidateSet.routes.length <= inputRequest.maxRoutes);
    for (const route of candidateSet.routes) {
      assert.ok(route.length >= 1 && route.length <= inputRequest.maxHops);
      for (const edge of route) assert.deepEqual(Object.keys(edge), ['assetIn', 'poolId', 'assetOut']);
    }
  }
  assertDeepFrozen(first);
  assertDeepFrozen(second);

  const firstBeforeMutation = structuredClone(first);
  const mutableEdges = inputIndex.buckets[0]?.edges as DirectionalRouteHop[] | undefined;
  mutableEdges?.splice(0, 1);
  (inputRequest as { maxRoutes: number }).maxRoutes = 1;
  assert.deepEqual(first, firstBeforeMutation);
});

function financialPool(poolId: string, asset0: string, asset1: string): ConstantProductPool {
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

void test('preserves existing adjacency, simple-path, fixture, and replay-case evidence', () => {
  const pools = SIX_POOL_GRAPH.map(({ poolId, asset0, asset1 }) =>
    financialPool(poolId, asset0, asset1),
  );
  const snapshot: LiquiditySnapshot = {
    snapshotId: 'oracle-route-set-snapshot',
    snapshotChecksum: 'oracle-route-set-checksum',
    pools,
  };
  const independentIndex = oracleIndex(SIX_POOL_GRAPH);
  const existingIndex = buildDeterministicAdjacency(snapshot);
  assert.deepEqual(existingIndex, independentIndex);

  const enumerationRequest = request();
  const expectedPaths = oraclePathPhase(independentIndex, enumerationRequest);
  const existingPaths = enumerateSimplePaths(existingIndex, {
    snapshotId: enumerationRequest.snapshotId,
    snapshotChecksum: enumerationRequest.snapshotChecksum,
    assetIn: enumerationRequest.assetIn,
    assetOut: enumerationRequest.assetOut,
    maxHops: enumerationRequest.maxHops,
    maxExpansions: enumerationRequest.maxPathExpansions,
  });
  assert.deepEqual(existingPaths, {
    ok: true,
    value: {
      snapshotId: enumerationRequest.snapshotId,
      snapshotChecksum: enumerationRequest.snapshotChecksum,
      assetIn: enumerationRequest.assetIn,
      assetOut: enumerationRequest.assetOut,
      paths: expectedPaths.paths,
      expansions: expectedPaths.expansions,
      termination: expectedPaths.termination,
    },
  });

  assertMatchesOracle(existingIndex, enumerationRequest);
  const fixtureHashes = new Map([
    ['no-plan.json', '05db31a8660fe3a3b71058f282f86ddd0d6d63bc929a8725a8aecccc96971ac1'],
    ['no-route.json', 'dfb4ebd1e382efcc1961101c55223dd755a39891c3760e500bbf8ab4a3faeb23'],
    ['success.json', '35f4fde18b840bbaec6862264024ef22ab2c78f303d003635add6cd0a1735e3f'],
  ]);
  for (const [filename, digest] of fixtureHashes) {
    const bytes = readFileSync(new URL(`../../fixtures/m3/router-cases/${filename}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), digest);
  }
});
