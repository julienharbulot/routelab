import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../../src/domain/index.ts';
import {
  prepareRoutingContext,
  type PreparedRoutingContext,
} from '../../src/runtime/prepared-routing-context/index.ts';
import { discoverSharedRoutes } from '../../src/search/shared-route-discovery/index.ts';

interface Hop {
  readonly assetIn: string;
  readonly poolId: string;
  readonly assetOut: string;
}

interface DiscoveryRequest {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly maxHops: number;
  readonly maxPathExpansions: number;
  readonly maxRoutes: number;
  readonly maxCandidateSetExpansions: number;
}

interface PathPhase {
  readonly paths: readonly (readonly Hop[])[];
  readonly expansions: number;
  readonly termination: 'complete' | 'work-limit';
}

interface SetPhase {
  readonly candidateSets: readonly { readonly routes: readonly (readonly Hop[])[] }[];
  readonly expansions: number;
  readonly termination: 'complete' | 'work-limit';
}

function compareRawUtf16(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareHop(left: Hop, right: Hop): number {
  return (
    compareRawUtf16(left.assetIn, right.assetIn) ||
    compareRawUtf16(left.poolId, right.poolId) ||
    compareRawUtf16(left.assetOut, right.assetOut)
  );
}

function compareRoute(left: readonly Hop[], right: readonly Hop[]): number {
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

function compareIndexVectors(left: readonly number[], right: readonly number[]): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function pool(
  poolId: string,
  asset0: string,
  asset1: string,
  reserve0 = 1_000n,
  reserve1 = 2_000n,
): ConstantProductPool {
  return {
    poolId,
    asset0,
    reserve0,
    asset1,
    reserve1,
    feeChargedNumerator: 3n,
    feeDenominator: 1_000n,
  };
}

// This is intentionally local. It neither imports nor calls the production
// canonical serializer or checksum computation.
function independentCanonicalContent(snapshot: LiquiditySnapshot): string {
  const pools = [...snapshot.pools]
    .sort((left, right) => compareRawUtf16(left.poolId, right.poolId))
    .map((candidatePool) => ({
      poolId: candidatePool.poolId,
      asset0: candidatePool.asset0,
      reserve0: candidatePool.reserve0.toString(10),
      asset1: candidatePool.asset1,
      reserve1: candidatePool.reserve1.toString(10),
      feeChargedNumerator: candidatePool.feeChargedNumerator.toString(10),
      feeDenominator: candidatePool.feeDenominator.toString(10),
    }));
  return JSON.stringify({ schemaVersion: 'routelab.snapshot.v1', pools });
}

function independentChecksum(snapshot: LiquiditySnapshot): string {
  const digest = createHash('sha256')
    .update(independentCanonicalContent(snapshot), 'utf8')
    .digest('hex');
  return `sha256:${digest}`;
}

function checksummedSnapshot(
  pools: readonly ConstantProductPool[],
  snapshotId = 'prepared-oracle-snapshot',
): LiquiditySnapshot {
  const pending: LiquiditySnapshot = { snapshotId, snapshotChecksum: 'pending', pools };
  return { ...pending, snapshotChecksum: independentChecksum(pending) };
}

function prepare(snapshot: LiquiditySnapshot): PreparedRoutingContext {
  const result = prepareRoutingContext(snapshot);
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail('independently checksummed snapshot did not prepare');
  return result.value;
}

function request(
  snapshot: LiquiditySnapshot,
  overrides: Partial<DiscoveryRequest> = {},
): DiscoveryRequest {
  return {
    snapshotId: snapshot.snapshotId,
    snapshotChecksum: snapshot.snapshotChecksum,
    assetIn: 'A',
    assetOut: 'D',
    maxHops: 3,
    maxPathExpansions: Number.MAX_SAFE_INTEGER,
    maxRoutes: 3,
    maxCandidateSetExpansions: Number.MAX_SAFE_INTEGER,
    ...overrides,
  };
}

function directedEdges(pools: readonly ConstantProductPool[]): Hop[] {
  return pools.flatMap((candidatePool) => [
    {
      assetIn: candidatePool.asset0,
      poolId: candidatePool.poolId,
      assetOut: candidatePool.asset1,
    },
    {
      assetIn: candidatePool.asset1,
      poolId: candidatePool.poolId,
      assetOut: candidatePool.asset0,
    },
  ]);
}

function isSimpleRoute(
  sequence: readonly Hop[],
  assetIn: string,
  assetOut: string,
): boolean {
  const first = sequence[0];
  if (first === undefined || first.assetIn !== assetIn) return false;
  const assets = new Set([assetIn]);
  const pools = new Set<string>();
  let expectedAsset = assetIn;
  for (const edge of sequence) {
    if (edge.assetIn !== expectedAsset) return false;
    if (assets.has(edge.assetOut) || pools.has(edge.poolId)) return false;
    assets.add(edge.assetOut);
    pools.add(edge.poolId);
    expectedAsset = edge.assetOut;
  }
  return expectedAsset === assetOut;
}

// This deliberately slow reference generates Cartesian directed-edge sequences
// and filters afterward; it does not follow an adjacency traversal.
function exhaustiveSimpleRoutes(
  pools: readonly ConstantProductPool[],
  assetIn: string,
  assetOut: string,
  maxHops: number,
): Hop[][] {
  const edges = directedEdges(pools);
  const routes: Hop[][] = [];

  function generate(prefix: readonly Hop[]): void {
    if (prefix.length > 0 && isSimpleRoute(prefix, assetIn, assetOut)) {
      routes.push(prefix.map((edge) => ({ ...edge })));
    }
    if (prefix.length === maxHops) return;
    for (const edge of edges) generate([...prefix, edge]);
  }

  generate([]);
  routes.sort(compareRoute);
  return routes;
}

function orderedOutgoing(pools: readonly ConstantProductPool[]): ReadonlyMap<string, Hop[]> {
  const outgoing = new Map<string, Hop[]>();
  for (const edge of directedEdges(pools)) {
    const edges = outgoing.get(edge.assetIn) ?? [];
    edges.push(edge);
    outgoing.set(edge.assetIn, edges);
  }
  for (const edges of outgoing.values()) edges.sort(compareHop);
  return outgoing;
}

// The capped reference is a small recursive edge-attempt ledger. A cap reached
// on an already exhausted frontier remains complete because no unit is pending.
function pathFrontierPhase(
  pools: readonly ConstantProductPool[],
  discoveryRequest: DiscoveryRequest,
): PathPhase {
  const outgoing = orderedOutgoing(pools);
  const paths: Hop[][] = [];
  let expansions = 0;
  let stopped = false;

  function visit(
    asset: string,
    prefix: readonly Hop[],
    visitedAssets: ReadonlySet<string>,
    visitedPools: ReadonlySet<string>,
  ): boolean {
    if (prefix.length === discoveryRequest.maxHops) return true;
    for (const edge of outgoing.get(asset) ?? []) {
      if (expansions === discoveryRequest.maxPathExpansions) {
        stopped = true;
        return false;
      }
      expansions += 1;
      if (visitedAssets.has(edge.assetOut) || visitedPools.has(edge.poolId)) continue;
      const next = [...prefix, { ...edge }];
      if (edge.assetOut === discoveryRequest.assetOut) {
        paths.push(next);
        continue;
      }
      const nextAssets = new Set(visitedAssets);
      nextAssets.add(edge.assetOut);
      const nextPools = new Set(visitedPools);
      nextPools.add(edge.poolId);
      if (!visit(edge.assetOut, next, nextAssets, nextPools)) return false;
    }
    return true;
  }

  visit(
    discoveryRequest.assetIn,
    [],
    new Set([discoveryRequest.assetIn]),
    new Set(),
  );
  paths.sort(compareRoute);
  return {
    paths,
    expansions,
    termination: stopped ? 'work-limit' : 'complete',
  };
}

function routesArePoolDisjoint(routes: readonly (readonly Hop[])[]): boolean {
  const used = new Set<string>();
  for (const route of routes) {
    for (const { poolId } of route) {
      if (used.has(poolId)) return false;
      used.add(poolId);
    }
  }
  return true;
}

// Complete structural sets come from bitmasks, independently of the capped
// combination-frontier reference below.
function exhaustiveBitmaskSets(
  paths: readonly (readonly Hop[])[],
  maxRoutes: number,
): { readonly routes: readonly (readonly Hop[])[] }[] {
  assert.ok(paths.length < 31);
  const selectedIndexes: number[][] = [];
  const upperMask = 2 ** paths.length;
  for (let mask = 0; mask < upperMask; mask += 1) {
    const indexes: number[] = [];
    for (let index = 0; index < paths.length; index += 1) {
      if ((mask & (2 ** index)) !== 0) indexes.push(index);
    }
    if (indexes.length < 2 || indexes.length > maxRoutes) continue;
    const routes = indexes.map((index) => paths[index]).filter((route) => route !== undefined);
    if (routes.length === indexes.length && routesArePoolDisjoint(routes)) {
      selectedIndexes.push(indexes);
    }
  }
  selectedIndexes.sort((left, right) =>
    left.length - right.length || compareIndexVectors(left, right),
  );
  return selectedIndexes.map((indexes) => ({
    routes: indexes.map((index) => {
      const route = paths[index];
      assert.ok(route !== undefined);
      return route.map((edge) => ({ ...edge }));
    }),
  }));
}

// Each recursive loop iteration attempts one route append and therefore consumes
// exactly one candidate-set expansion, including incompatible append attempts.
function setFrontierPhase(
  paths: readonly (readonly Hop[])[],
  maxRoutes: number,
  maxExpansions: number,
): SetPhase {
  const candidateSets: { routes: Hop[][] }[] = [];
  let expansions = 0;
  let stopped = false;

  function enumerateCardinality(target: number): boolean {
    const selected: (readonly Hop[])[] = [];
    const usedPools = new Set<string>();

    function appendFrom(start: number): boolean {
      for (let routeIndex = start; routeIndex < paths.length; routeIndex += 1) {
        if (expansions === maxExpansions) {
          stopped = true;
          return false;
        }
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
  for (let cardinality = 2; cardinality <= maximumCardinality; cardinality += 1) {
    if (!enumerateCardinality(cardinality)) break;
  }
  return {
    candidateSets,
    expansions,
    termination: stopped ? 'work-limit' : 'complete',
  };
}

function oracleValue(
  snapshot: LiquiditySnapshot,
  discoveryRequest: DiscoveryRequest,
) {
  const pathPhase = pathFrontierPhase(snapshot.pools, discoveryRequest);
  const setPhase = setFrontierPhase(
    pathPhase.paths,
    discoveryRequest.maxRoutes,
    discoveryRequest.maxCandidateSetExpansions,
  );
  return {
    snapshotId: discoveryRequest.snapshotId,
    snapshotChecksum: discoveryRequest.snapshotChecksum,
    assetIn: discoveryRequest.assetIn,
    assetOut: discoveryRequest.assetOut,
    paths: pathPhase.paths,
    candidateSets: setPhase.candidateSets,
    search: {
      pathExpansions: pathPhase.expansions,
      enumeratedPaths: pathPhase.paths.length,
      pathTermination: pathPhase.termination,
      candidateSetExpansions: setPhase.expansions,
      enumeratedCandidateSets: setPhase.candidateSets.length,
      candidateSetTermination: setPhase.termination,
    },
  };
}

function assertMatchesOracle(
  context: PreparedRoutingContext,
  snapshot: LiquiditySnapshot,
  discoveryRequest: DiscoveryRequest,
) {
  const actual = discoverSharedRoutes(context, discoveryRequest);
  assert.deepEqual(actual, { ok: true, value: oracleValue(snapshot, discoveryRequest) });
  assertDeepFrozen(actual);
  assert.equal(actual.ok, true);
  if (!actual.ok) assert.fail('valid oracle discovery request failed');
  return actual.value;
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
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += 1) {
    const selected = values[index];
    assert.ok(selected !== undefined);
    const rest = [...values.slice(0, index), ...values.slice(index + 1)];
    for (const suffix of permutations(rest)) result.push([selected, ...suffix]);
  }
  return result;
}

const CYCLIC_GRAPH = [
  pool('0-ab', 'A', 'B'),
  pool('1-bd', 'B', 'D'),
  pool('2-ac', 'A', 'C'),
  pool('3-cd', 'C', 'D'),
  pool('4-bc', 'B', 'C'),
  pool('5-ad', 'A', 'D'),
] as const;

void test('independently hashes canonical pool-id-ordered content before preparation', () => {
  const input = checksummedSnapshot([...CYCLIC_GRAPH].reverse(), 'checksum-boundary');
  const expectedContent = independentCanonicalContent(input);
  const expectedChecksum = `sha256:${createHash('sha256')
    .update(expectedContent, 'utf8')
    .digest('hex')}`;
  assert.equal(input.snapshotChecksum, expectedChecksum);

  const success = prepareRoutingContext(input);
  assert.equal(success.ok, true);
  if (!success.ok) assert.fail('matching independent checksum was rejected');
  assert.equal(Object.isFrozen(success.value), true);
  assert.deepEqual(Reflect.ownKeys(success.value), []);
  assertDeepFrozen(success);

  const mismatch = prepareRoutingContext({
    ...input,
    snapshotChecksum: 'sha256:declared-mismatch',
  });
  assert.deepEqual(mismatch, {
    ok: false,
    error: {
      code: 'snapshot-checksum-mismatch',
      expected: expectedChecksum,
      actual: 'sha256:declared-mismatch',
    },
  });
  assert.equal('value' in mismatch, false);
  assertDeepFrozen(mismatch);
});

void test('owns captured pool data and the source array after preparation', () => {
  const mutablePools = CYCLIC_GRAPH.map((candidatePool) => ({ ...candidatePool }));
  const mutableSnapshot = {
    ...checksummedSnapshot(mutablePools, 'mutation-capture'),
  };
  const original = checksummedSnapshot(
    mutablePools.map((candidatePool) => ({ ...candidatePool })),
    mutableSnapshot.snapshotId,
  );
  const context = prepare(mutableSnapshot);

  const firstPool = mutablePools[0];
  assert.ok(firstPool !== undefined);
  firstPool.poolId = 'mutated-pool';
  firstPool.asset0 = 'mutated-asset';
  firstPool.reserve0 = 999_999n;
  mutablePools.reverse();
  mutablePools.splice(1, 2, pool('replacement', 'Q', 'R'));
  mutableSnapshot.snapshotId = 'mutated-snapshot';
  mutableSnapshot.snapshotChecksum = 'sha256:mutated';

  const discoveryRequest = request(original);
  const value = assertMatchesOracle(context, original, discoveryRequest);
  assert.deepEqual(
    value.paths,
    exhaustiveSimpleRoutes(original.pools, 'A', 'D', discoveryRequest.maxHops),
  );
});

void test('shares one canonical frozen path list with cardinality-two-or-more sets', () => {
  const snapshot = checksummedSnapshot(CYCLIC_GRAPH, 'shared-list');
  const context = prepare(snapshot);
  const discoveryRequest = request(snapshot);
  const value = assertMatchesOracle(context, snapshot, discoveryRequest);
  const exhaustivePaths = exhaustiveSimpleRoutes(
    snapshot.pools,
    discoveryRequest.assetIn,
    discoveryRequest.assetOut,
    discoveryRequest.maxHops,
  );
  assert.deepEqual(value.paths, exhaustivePaths);
  assert.deepEqual(
    value.candidateSets,
    exhaustiveBitmaskSets(exhaustivePaths, discoveryRequest.maxRoutes),
  );
  assert.ok(value.candidateSets.length > 0);
  assert.equal(value.candidateSets.every(({ routes }) => routes.length >= 2), true);
  for (const { routes } of value.candidateSets) {
    assert.equal(routesArePoolDisjoint(routes), true);
    for (const route of routes) {
      assert.equal(value.paths.some((sharedRoute) => sharedRoute === route), true);
    }
  }
  assertDeepFrozen(value);
});

void test('matches independent path and set ledgers at every zero, partial, and final cap', () => {
  const snapshot = checksummedSnapshot(CYCLIC_GRAPH, 'all-caps');
  const context = prepare(snapshot);
  const baseRequest = request(snapshot);
  const fullPath = pathFrontierPhase(snapshot.pools, baseRequest);
  assert.deepEqual(
    fullPath.paths,
    exhaustiveSimpleRoutes(snapshot.pools, 'A', 'D', baseRequest.maxHops),
  );

  for (let pathCap = 0; pathCap <= fullPath.expansions + 1; pathCap += 1) {
    const cappedPathRequest = request(snapshot, { maxPathExpansions: pathCap });
    const cappedPaths = pathFrontierPhase(snapshot.pools, cappedPathRequest);
    for (const maxRoutes of [1, 2, 3]) {
      const fullSets = setFrontierPhase(
        cappedPaths.paths,
        maxRoutes,
        Number.MAX_SAFE_INTEGER,
      );
      assert.deepEqual(
        fullSets.candidateSets,
        exhaustiveBitmaskSets(cappedPaths.paths, maxRoutes),
      );
      for (let setCap = 0; setCap <= fullSets.expansions + 1; setCap += 1) {
        assertMatchesOracle(
          context,
          snapshot,
          request(snapshot, {
            maxPathExpansions: pathCap,
            maxRoutes,
            maxCandidateSetExpansions: setCap,
          }),
        );
      }
    }
  }

  const zeroPath = assertMatchesOracle(
    context,
    snapshot,
    request(snapshot, { maxPathExpansions: 0 }),
  );
  assert.deepEqual(zeroPath.paths, []);
  assert.equal(zeroPath.search.pathTermination, 'work-limit');
  assert.equal(zeroPath.search.candidateSetExpansions, 0);
  assert.equal(zeroPath.search.candidateSetTermination, 'complete');

  const noSingleton = assertMatchesOracle(
    context,
    snapshot,
    request(snapshot, { maxRoutes: 1, maxCandidateSetExpansions: 0 }),
  );
  assert.deepEqual(noSingleton.candidateSets, []);
  assert.equal(noSingleton.search.candidateSetExpansions, 0);
  assert.equal(noSingleton.search.candidateSetTermination, 'complete');
});

void test('is pool-order invariant, raw-UTF-16 ordered, and symmetric by request direction', () => {
  const canonical = checksummedSnapshot(CYCLIC_GRAPH, 'permutation-direction');
  const forwardRequest = request(canonical);
  const expectedForward = oracleValue(canonical, forwardRequest);
  const allOrders = permutations(CYCLIC_GRAPH);
  assert.equal(allOrders.length, 720);

  for (const pools of allOrders) {
    const permuted = checksummedSnapshot(pools, canonical.snapshotId);
    assert.equal(permuted.snapshotChecksum, canonical.snapshotChecksum);
    assert.deepEqual(
      discoverSharedRoutes(prepare(permuted), request(permuted)),
      { ok: true, value: expectedForward },
    );
  }

  const reverseRequest = request(canonical, { assetIn: 'D', assetOut: 'A' });
  const reverse = assertMatchesOracle(prepare(canonical), canonical, reverseRequest);
  assert.deepEqual(
    reverse.paths,
    exhaustiveSimpleRoutes(canonical.pools, 'D', 'A', reverseRequest.maxHops),
  );

  const longSuffix = 'identifier'.repeat(512);
  const astral = `\u{10000}-${longSuffix}`;
  const privateUse = `\uE000-${longSuffix}`;
  const source = `source-${longSuffix}`;
  const target = `target-${longSuffix}`;
  const large = checksummedSnapshot([
    pool(privateUse, source, target),
    pool(astral, source, target),
  ], 'large-raw-identifiers');
  const largeRequest = request(large, {
    assetIn: source,
    assetOut: target,
    maxHops: 1,
    maxRoutes: 2,
  });
  const largeValue = assertMatchesOracle(prepare(large), large, largeRequest);
  assert.deepEqual(largeValue.paths.map((route) => route[0]?.poolId), [astral, privateUse]);
  assert.equal(astral < privateUse, true);
});

void test('exhausts tiny graph, cap, hop, direction, and max-route combinations', () => {
  const possiblePools = [
    pool('ab', 'A', 'B'),
    pool('bd', 'B', 'D'),
    pool('ac', 'A', 'C'),
    pool('cd', 'C', 'D'),
  ] as const;
  let checked = 0;

  for (let mask = 1; mask < 2 ** possiblePools.length; mask += 1) {
    const pools = possiblePools.filter((_, index) => (mask & (2 ** index)) !== 0);
    const knownAssets = new Set(pools.flatMap(({ asset0, asset1 }) => [asset0, asset1]));
    if (!knownAssets.has('A') || !knownAssets.has('D')) continue;
    const snapshot = checksummedSnapshot(pools, `tiny-${mask}`);
    const context = prepare(snapshot);

    for (const [assetIn, assetOut] of [['A', 'D'], ['D', 'A']] as const) {
      for (const maxHops of [1, 2, 3]) {
        const uncappedRequest = request(snapshot, { assetIn, assetOut, maxHops });
        const fullPath = pathFrontierPhase(pools, uncappedRequest);
        assert.deepEqual(
          fullPath.paths,
          exhaustiveSimpleRoutes(pools, assetIn, assetOut, maxHops),
        );
        for (let pathCap = 0; pathCap <= fullPath.expansions + 1; pathCap += 1) {
          const cappedPaths = pathFrontierPhase(
            pools,
            request(snapshot, { assetIn, assetOut, maxHops, maxPathExpansions: pathCap }),
          );
          for (const maxRoutes of [1, 2, 3]) {
            const fullSets = setFrontierPhase(
              cappedPaths.paths,
              maxRoutes,
              Number.MAX_SAFE_INTEGER,
            );
            for (let setCap = 0; setCap <= fullSets.expansions + 1; setCap += 1) {
              assertMatchesOracle(
                context,
                snapshot,
                request(snapshot, {
                  assetIn,
                  assetOut,
                  maxHops,
                  maxPathExpansions: pathCap,
                  maxRoutes,
                  maxCandidateSetExpansions: setCap,
                }),
              );
              checked += 1;
            }
          }
        }
      }
    }
  }
  assert.ok(checked > 1_000);
});
