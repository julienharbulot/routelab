import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { DirectionalRouteHop } from '../../src/replay/exact-input-route/index.ts';
import {
  createPreparedSimplePathFrontier,
  expandPreparedSimplePathFrontier,
  hasPreparedSimplePathExpansion,
} from '../../src/runtime/prepared-routing-context/index.ts';
import {
  SERVICE_ROUTING_POLICY_V1,
  prepareServiceRoutingContext,
  preparedServiceRoutingBaseContext,
} from '../../src/runtime/prepared-service-routing-context/index.ts';
import {
  advanceServiceRouteDiscoveryFrontier,
  appendServiceRouteDiscoveryPath,
  closeServiceRouteDiscoveryPathInput,
  createServiceRouteDiscoveryFrontier,
  hasServiceRouteDiscoveryStep,
  serviceRouteDiscoveryIsComplete,
  type ServiceRouteDiscoveryFrontier,
} from '../../src/search/service-route-discovery/index.ts';

interface StructuralPool {
  readonly poolId: string;
  readonly asset0: string;
  readonly asset1: string;
}

interface WirePool extends StructuralPool {
  readonly reserve0: string;
  readonly reserve1: string;
  readonly feeChargedNumerator: string;
  readonly feeDenominator: string;
}

type Interleaving = 'append-all' | 'drain-prefix' | 'mid-frame';

const encoder = new TextEncoder();

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

function hop(
  assetIn: string,
  poolId: string,
  assetOut: string,
): DirectionalRouteHop {
  return { assetIn, poolId, assetOut };
}

function wirePool(candidate: StructuralPool): WirePool {
  return {
    ...candidate,
    reserve0: '1000',
    reserve1: '1000',
    feeChargedNumerator: '0',
    feeDenominator: '1',
  };
}

// These publication helpers reproduce the accepted canonical content directly;
// they do not call the production serializer, parser, or checksum helper.
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
  pools: readonly StructuralPool[],
): Uint8Array {
  const wirePools = pools.map(wirePool);
  return encoder.encode(
    JSON.stringify({
      snapshotId,
      snapshotChecksum: independentChecksum(wirePools),
      pools: wirePools,
    }),
  );
}

function directedEdges(pools: readonly StructuralPool[]): DirectionalRouteHop[] {
  return pools.flatMap((candidate) => [
    hop(candidate.asset0, candidate.poolId, candidate.asset1),
    hop(candidate.asset1, candidate.poolId, candidate.asset0),
  ]);
}

function isSimpleRoute(
  sequence: readonly DirectionalRouteHop[],
  assetIn: string,
  assetOut: string,
): boolean {
  if (sequence[0]?.assetIn !== assetIn) return false;
  const usedAssets = new Set([assetIn]);
  const usedPools = new Set<string>();
  let current = assetIn;
  for (const edge of sequence) {
    if (
      edge.assetIn !== current ||
      usedPools.has(edge.poolId) ||
      usedAssets.has(edge.assetOut)
    ) {
      return false;
    }
    usedPools.add(edge.poolId);
    usedAssets.add(edge.assetOut);
    current = edge.assetOut;
  }
  return current === assetOut;
}

// This intentionally slow oracle generates Cartesian directed-edge sequences and
// filters them afterward. It shares no adjacency/DFS operation with production.
function exhaustiveCanonicalPaths(
  pools: readonly StructuralPool[],
  assetIn: string,
  assetOut: string,
  maxHops: number,
): DirectionalRouteHop[][] {
  const edges = directedEdges(pools);
  const paths: DirectionalRouteHop[][] = [];

  function generate(prefix: readonly DirectionalRouteHop[]): void {
    if (prefix.length > 0 && isSimpleRoute(prefix, assetIn, assetOut)) {
      paths.push(prefix.map((edge) => ({ ...edge })));
    }
    if (prefix.length === maxHops) return;
    for (const edge of edges) generate([...prefix, edge]);
  }

  generate([]);
  paths.sort(compareRoute);
  return paths;
}

function routesArePoolDisjoint(
  routes: readonly (readonly DirectionalRouteHop[])[],
): boolean {
  const used = new Set<string>();
  for (const route of routes) {
    for (const edge of route) {
      if (used.has(edge.poolId)) return false;
      used.add(edge.poolId);
    }
  }
  return true;
}

function chooseIndexes(
  upperExclusive: number,
  count: number,
): readonly (readonly number[])[] {
  const output: number[][] = [];
  const selected: number[] = [];
  function choose(start: number): void {
    if (selected.length === count) {
      output.push([...selected]);
      return;
    }
    for (let index = start; index < upperExclusive; index += 1) {
      selected.push(index);
      choose(index + 1);
      selected.pop();
    }
  }
  choose(0);
  return output;
}

// The growing contract anchors every set at the newest path, then enumerates
// cardinality and prior index vectors canonically. This oracle materializes those
// finite combinations instead of simulating production frames.
function exhaustiveAnchoredSets(
  paths: readonly (readonly DirectionalRouteHop[])[],
  maxRoutes: number,
): readonly (readonly (readonly DirectionalRouteHop[])[])[] {
  const sets: Array<readonly (readonly DirectionalRouteHop[])[]> = [];
  for (let anchor = 1; anchor < paths.length; anchor += 1) {
    const anchorPath = paths[anchor];
    assert.ok(anchorPath !== undefined);
    const maximum = Math.min(maxRoutes, anchor + 1);
    for (let cardinality = 2; cardinality <= maximum; cardinality += 1) {
      for (const prefix of chooseIndexes(anchor, cardinality - 1)) {
        const routes = [
          ...prefix.map((index) => {
            const route = paths[index];
            assert.ok(route !== undefined);
            return route;
          }),
          anchorPath,
        ];
        if (routesArePoolDisjoint(routes)) {
          sets.push(routes.map((route) => route.map((edge) => ({ ...edge }))));
        }
      }
    }
  }
  return sets;
}

function captureRoutes(
  routes: readonly (readonly DirectionalRouteHop[])[],
): DirectionalRouteHop[][] {
  return routes.map((route) => route.map((edge) => ({ ...edge })));
}

function advanceAndCapture(
  frontier: ServiceRouteDiscoveryFrontier,
  emitted: DirectionalRouteHop[][][],
): void {
  const step = advanceServiceRouteDiscoveryFrontier(frontier);
  if (step.emitted) emitted.push(captureRoutes(step.candidateSet.routes));
}

function drain(
  frontier: ServiceRouteDiscoveryFrontier,
  emitted: DirectionalRouteHop[][][],
): void {
  let guard = 0;
  while (hasServiceRouteDiscoveryStep(frontier)) {
    guard += 1;
    assert.ok(guard < 10_000, 'fine frontier failed to make bounded progress');
    advanceAndCapture(frontier, emitted);
  }
}

function runInterleaving(
  paths: readonly (readonly DirectionalRouteHop[])[],
  maxRoutes: number,
  interleaving: Interleaving,
): DirectionalRouteHop[][][] {
  const frontier = createServiceRouteDiscoveryFrontier(maxRoutes, 4);
  const emitted: DirectionalRouteHop[][][] = [];

  if (interleaving === 'append-all') {
    for (const path of paths) appendServiceRouteDiscoveryPath(frontier, path);
  } else if (interleaving === 'drain-prefix') {
    for (const path of paths) {
      appendServiceRouteDiscoveryPath(frontier, path);
      drain(frontier, emitted);
    }
  } else {
    for (let pathIndex = 0; pathIndex < paths.length; pathIndex += 1) {
      const path = paths[pathIndex];
      assert.ok(path !== undefined);
      appendServiceRouteDiscoveryPath(frontier, path);
      // After path 1, exactly one selection transition remains live while path 2
      // is appended. Later quotas vary the active frame depth.
      const quota = pathIndex === 1 ? 1 : pathIndex % 3;
      for (
        let step = 0;
        step < quota && hasServiceRouteDiscoveryStep(frontier);
        step += 1
      ) {
        advanceAndCapture(frontier, emitted);
      }
    }
  }

  closeServiceRouteDiscoveryPathInput(frontier);
  drain(frontier, emitted);
  assert.equal(serviceRouteDiscoveryIsComplete(frontier), true);
  return emitted;
}

// Restricted-growth strings enumerate every set partition exactly once. Mapping
// each block to one shared pool exercises all equivalence-class conflict patterns.
function setPartitions(size: number): readonly (readonly number[])[] {
  if (size === 0) return [[]];
  const partitions: number[][] = [];
  const labels = [0];
  function extend(maximumLabel: number): void {
    if (labels.length === size) {
      partitions.push([...labels]);
      return;
    }
    for (let label = 0; label <= maximumLabel + 1; label += 1) {
      labels.push(label);
      extend(Math.max(maximumLabel, label));
      labels.pop();
    }
  }
  extend(0);
  return partitions;
}

function partitionPaths(labels: readonly number[]): DirectionalRouteHop[][] {
  return labels.map((label, index) => {
    const suffix = index.toString().padStart(2, '0');
    const middle = `M${suffix}`;
    return [
      hop('A', `key-${suffix}`, middle),
      hop(middle, `shared-${label}`, 'Z'),
    ];
  });
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return;
  }
  if (seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) {
    assertDeepFrozen(Reflect.get(value, key), seen);
  }
}

void test('matches exhaustive anchored sets for every partition through six paths', () => {
  const interleavings: readonly Interleaving[] = [
    'append-all',
    'drain-prefix',
    'mid-frame',
  ];
  let cases = 0;
  for (let pathCount = 0; pathCount <= 6; pathCount += 1) {
    for (const labels of setPartitions(pathCount)) {
      const paths = partitionPaths(labels);
      for (let maxRoutes = 2; maxRoutes <= 4; maxRoutes += 1) {
        const expected = exhaustiveAnchoredSets(paths, maxRoutes);
        for (const interleaving of interleavings) {
          const actual = runInterleaving(paths, maxRoutes, interleaving);
          assert.deepEqual(
            actual,
            expected,
            `paths=${pathCount} partition=${labels.join('')} maxRoutes=${maxRoutes} ${interleaving}`,
          );
          cases += 1;
        }
      }
    }
  }
  assert.equal(cases, 2_511);
});

void test('handles non-transitive pool conflicts under every append interleaving', () => {
  const paths = [
    [hop('A', 'key-0', 'X0'), hop('X0', 'pool-01', 'Z')],
    [
      hop('A', 'key-1', 'X1'),
      hop('X1', 'pool-01', 'Y1'),
      hop('Y1', 'pool-12', 'Z'),
    ],
    [hop('A', 'key-2', 'X2'), hop('X2', 'pool-12', 'Z')],
    [hop('A', 'key-3', 'X3'), hop('X3', 'pool-3', 'Z')],
  ];
  for (let maxRoutes = 2; maxRoutes <= 4; maxRoutes += 1) {
    const expected = exhaustiveAnchoredSets(paths, maxRoutes);
    for (const interleaving of [
      'append-all',
      'drain-prefix',
      'mid-frame',
    ] as const) {
      assert.deepEqual(runInterleaving(paths, maxRoutes, interleaving), expected);
    }
  }
});

void test('matches independently materialized canonical paths on a branching graph', () => {
  const pools: StructuralPool[] = [
    { poolId: 'm-direct', asset0: 'A', asset1: 'D' },
    { poolId: 'a-ab', asset0: 'A', asset1: 'B' },
    { poolId: 'c-ac', asset0: 'A', asset1: 'C' },
    { poolId: 'i-ae', asset0: 'A', asset1: 'E' },
    { poolId: 'b-bd', asset0: 'B', asset1: 'D' },
    { poolId: 'e-bc', asset0: 'B', asset1: 'C' },
    { poolId: 'h-be', asset0: 'B', asset1: 'E' },
    { poolId: 'd-cd', asset0: 'C', asset1: 'D' },
    { poolId: 'f-ce', asset0: 'C', asset1: 'E' },
    { poolId: 'g-ed', asset0: 'E', asset1: 'D' },
  ];
  const expectedPaths = exhaustiveCanonicalPaths(pools, 'A', 'D', 4);
  assert.ok(expectedPaths.length > 8);

  for (const publicationOrder of [pools, [...pools].reverse()]) {
    const prepared = prepareServiceRoutingContext(
      rawSnapshot('branching-oracle', publicationOrder),
      SERVICE_ROUTING_POLICY_V1,
      () => 0n,
    );
    assert.equal(prepared.ok, true);
    if (!prepared.ok) assert.fail('branching snapshot did not publish');
    const frontier = createPreparedSimplePathFrontier(
      preparedServiceRoutingBaseContext(prepared.value),
      { assetIn: 'A', assetOut: 'D', maxHops: 4 },
    );
    const emitted: Array<readonly DirectionalRouteHop[]> = [];
    while (hasPreparedSimplePathExpansion(frontier)) {
      const path = expandPreparedSimplePathFrontier(frontier);
      if (path !== undefined) {
        assertDeepFrozen(path);
        emitted.push(path);
      }
    }
    assert.deepEqual(emitted, expectedPaths);

    const expectedSets = exhaustiveAnchoredSets(expectedPaths, 4);
    assert.deepEqual(runInterleaving(emitted, 4, 'mid-frame'), expectedSets);
  }
});

void test('captures caller paths and returns fresh deeply frozen candidate sets', () => {
  const first = [hop('A', 'a-pool', 'Z')];
  const second = [hop('A', 'b-pool', 'Z')];
  const frontier = createServiceRouteDiscoveryFrontier(4, 4);
  appendServiceRouteDiscoveryPath(frontier, first);
  first[0] = hop('mutated', 'mutated', 'mutated');
  appendServiceRouteDiscoveryPath(frontier, second);
  second[0] = hop('mutated', 'mutated', 'mutated');
  closeServiceRouteDiscoveryPathInput(frontier);

  let candidate: unknown;
  while (hasServiceRouteDiscoveryStep(frontier)) {
    const step = advanceServiceRouteDiscoveryFrontier(frontier);
    if (step.emitted) candidate = step.candidateSet;
  }
  assert.deepEqual(candidate, {
    routes: [
      [{ assetIn: 'A', poolId: 'a-pool', assetOut: 'Z' }],
      [{ assetIn: 'A', poolId: 'b-pool', assetOut: 'Z' }],
    ],
  });
  assertDeepFrozen(candidate);

  const fresh = runInterleaving(
    [
      [hop('A', 'a-pool', 'Z')],
      [hop('A', 'b-pool', 'Z')],
    ],
    4,
    'append-all',
  );
  assert.deepEqual(fresh, [
    [
      [{ assetIn: 'A', poolId: 'a-pool', assetOut: 'Z' }],
      [{ assetIn: 'A', poolId: 'b-pool', assetOut: 'Z' }],
    ],
  ]);
  assert.notEqual(candidate, fresh[0]);
});

void test('keeps growing discovery free of whole-prefix materialization helpers', () => {
  const source = readFileSync(
    new URL('../../src/search/service-route-discovery/index.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /\.sort\s*\(/u);
  assert.doesNotMatch(source, /\.filter\s*\(/u);
  assert.doesNotMatch(source, /materializePreparedSimplePaths/u);
  assert.doesNotMatch(source, /enumeratePoolDisjointRouteSets/u);
});
