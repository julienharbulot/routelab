import assert from 'node:assert/strict';
import test from 'node:test';

import { parseLiquiditySnapshot } from '../src/domain/index.ts';
import type { DirectionalRouteHop } from '../src/replay/exact-input-route/index.ts';
import {
  createPreparedSimplePathFrontier,
  expandPreparedSimplePathFrontier,
  hasPreparedSimplePathExpansion,
  materializePreparedSimplePaths,
  prepareRoutingContext,
  resolvePreparedPathShadowPriceRoute,
} from '../src/runtime/prepared-routing-context/index.ts';
import {
  advanceServiceRouteDiscoveryFrontier,
  appendServiceRouteDiscoveryPath,
  closeServiceRouteDiscoveryPathInput,
  createServiceRouteDiscoveryFrontier,
  hasServiceRouteDiscoveryStep,
  serviceRouteDiscoveryIsComplete,
} from '../src/search/service-route-discovery/index.ts';
import { computeCanonicalSnapshotChecksum } from '../src/serialization/canonical-snapshot/index.ts';

function hop(assetIn: string, poolId: string, assetOut: string): DirectionalRouteHop {
  return { assetIn, poolId, assetOut };
}

function route(poolId: string): DirectionalRouteHop[] {
  return [hop('A', poolId, 'C')];
}

function preparedTwoHopContext() {
  const pools = [
    {
      poolId: 'pool-ab',
      asset0: 'A',
      reserve0: '100',
      asset1: 'B',
      reserve1: '100',
      feeChargedNumerator: '0',
      feeDenominator: '1',
    },
    {
      poolId: 'pool-bc',
      asset0: 'B',
      reserve0: '100',
      asset1: 'C',
      reserve1: '100',
      feeChargedNumerator: '0',
      feeDenominator: '1',
    },
  ];
  const provisional = parseLiquiditySnapshot({
    snapshotId: 'snapshot-two-hop',
    snapshotChecksum: `sha256:${'0'.repeat(64)}`,
    pools,
  });
  assert.equal(provisional.ok, true);
  if (!provisional.ok) throw new Error('Expected provisional snapshot.');
  const parsed = parseLiquiditySnapshot({
    snapshotId: provisional.value.snapshotId,
    snapshotChecksum: computeCanonicalSnapshotChecksum(provisional.value),
    pools,
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error('Expected valid snapshot.');
  const prepared = prepareRoutingContext(parsed.value);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) throw new Error('Expected prepared snapshot.');
  return prepared.value;
}

function candidateKeys(
  candidates: readonly (readonly (readonly DirectionalRouteHop[])[])[],
): readonly string[] {
  return candidates.map((routes) => routes.map((path) => path[0]?.poolId).join(','));
}

void test('one prepared edge expansion returns at most its newly emitted canonical path', () => {
  const frontier = createPreparedSimplePathFrontier(preparedTwoHopContext(), {
    assetIn: 'A',
    assetOut: 'C',
    maxHops: 4,
  });
  const emissions: Array<readonly DirectionalRouteHop[]> = [];
  let expansions = 0;
  while (hasPreparedSimplePathExpansion(frontier)) {
    const emitted = expandPreparedSimplePathFrontier(frontier);
    expansions += 1;
    if (emitted !== undefined) emissions.push(emitted);
  }
  assert.equal(expansions, 3);
  assert.deepEqual(emissions, [
    [
      hop('A', 'pool-ab', 'B'),
      hop('B', 'pool-bc', 'C'),
    ],
  ]);
  assert.equal(Object.isFrozen(emissions[0]), true);
  assert.deepEqual(materializePreparedSimplePaths(frontier), emissions);
});

void test('resolves exactly one bounded prepared financial route per service action', () => {
  const context = preparedTwoHopContext();
  const route = [
    hop('A', 'pool-ab', 'B'),
    hop('B', 'pool-bc', 'C'),
  ];
  const resolved = resolvePreparedPathShadowPriceRoute(context, route);
  assert.deepEqual(resolved, {
    ok: true,
    value: [
      {
        reserveIn: 100n,
        reserveOut: 100n,
        feeChargedNumerator: 0n,
        feeDenominator: 1n,
      },
      {
        reserveIn: 100n,
        reserveOut: 100n,
        feeChargedNumerator: 0n,
        feeDenominator: 1n,
      },
    ],
  });
  assert.equal(resolved.ok && Object.isFrozen(resolved.value), true);
  assert.deepEqual(
    resolvePreparedPathShadowPriceRoute(context, [
      ...route,
      hop('C', 'three', 'D'),
      hop('D', 'four', 'E'),
      hop('E', 'five', 'F'),
    ]),
    { ok: false },
  );
  assert.deepEqual(
    resolvePreparedPathShadowPriceRoute(context, [hop('A', 'pool-bc', 'C')]),
    { ok: false },
  );
});

void test('emits the first two-route set in exactly two fine primitive steps', () => {
  const frontier = createServiceRouteDiscoveryFrontier(4, 4);
  appendServiceRouteDiscoveryPath(frontier, route('a-pool'));
  assert.equal(hasServiceRouteDiscoveryStep(frontier), false);
  appendServiceRouteDiscoveryPath(frontier, route('b-pool'));
  assert.equal(hasServiceRouteDiscoveryStep(frontier), true);
  assert.deepEqual(advanceServiceRouteDiscoveryFrontier(frontier), { emitted: false });
  const second = advanceServiceRouteDiscoveryFrontier(frontier);
  assert.equal(second.emitted, true);
  if (!second.emitted) return;
  assert.deepEqual(candidateKeys([second.candidateSet.routes]), ['a-pool,b-pool']);
  assert.equal(Object.isFrozen(second.candidateSet), true);
  assert.equal(Object.isFrozen(second.candidateSet.routes), true);
});

void test('resumes an append-only anchored prefix without rediscovery or reordering', () => {
  const frontier = createServiceRouteDiscoveryFrontier(3, 4);
  appendServiceRouteDiscoveryPath(frontier, route('a-pool'));
  appendServiceRouteDiscoveryPath(frontier, route('b-pool'));

  const emitted: Array<readonly (readonly DirectionalRouteHop[])[]> = [];
  while (hasServiceRouteDiscoveryStep(frontier)) {
    const step = advanceServiceRouteDiscoveryFrontier(frontier);
    if (step.emitted) emitted.push(step.candidateSet.routes);
  }
  assert.deepEqual(candidateKeys(emitted), ['a-pool,b-pool']);
  assert.equal(serviceRouteDiscoveryIsComplete(frontier), false);

  appendServiceRouteDiscoveryPath(frontier, route('c-pool'));
  let guard = 0;
  while (hasServiceRouteDiscoveryStep(frontier)) {
    guard += 1;
    assert.ok(guard < 100);
    const step = advanceServiceRouteDiscoveryFrontier(frontier);
    if (step.emitted) emitted.push(step.candidateSet.routes);
  }
  closeServiceRouteDiscoveryPathInput(frontier);
  assert.equal(serviceRouteDiscoveryIsComplete(frontier), true);
  assert.deepEqual(candidateKeys(emitted), [
    'a-pool,b-pool',
    'a-pool,c-pool',
    'b-pool,c-pool',
    'a-pool,b-pool,c-pool',
  ]);
});

void test('performs one compatibility trial at a time and omits pool-overlapping sets', () => {
  const frontier = createServiceRouteDiscoveryFrontier(3, 4);
  appendServiceRouteDiscoveryPath(frontier, [
    hop('A', 'other', 'B'),
    hop('B', 'shared', 'C'),
  ]);
  appendServiceRouteDiscoveryPath(frontier, [hop('A', 'shared', 'C')]);
  appendServiceRouteDiscoveryPath(frontier, [hop('A', 'third', 'C')]);
  closeServiceRouteDiscoveryPathInput(frontier);
  const emitted: Array<readonly (readonly DirectionalRouteHop[])[]> = [];
  let steps = 0;
  while (hasServiceRouteDiscoveryStep(frontier)) {
    steps += 1;
    assert.ok(steps < 100);
    const step = advanceServiceRouteDiscoveryFrontier(frontier);
    if (step.emitted) emitted.push(step.candidateSet.routes);
  }
  assert.equal(serviceRouteDiscoveryIsComplete(frontier), true);
  assert.deepEqual(
    emitted.map((set) => set.map((path) => path[0]?.poolId).join(',')),
    ['other,third', 'shared,third'],
  );
});

void test('captures appended paths and rejects noncanonical, cyclic, or late input', () => {
  const frontier = createServiceRouteDiscoveryFrontier(4, 4);
  const source = route('a-pool');
  appendServiceRouteDiscoveryPath(frontier, source);
  source[0] = hop('A', 'mutated', 'C');
  appendServiceRouteDiscoveryPath(frontier, route('b-pool'));
  assert.throws(
    () => appendServiceRouteDiscoveryPath(frontier, route('a-again')),
    /strict canonical order/u,
  );
  const cyclic = [hop('A', 'x', 'B'), hop('B', 'y', 'A')];
  assert.throws(
    () => appendServiceRouteDiscoveryPath(frontier, cyclic),
    /bounded simple route/u,
  );
  closeServiceRouteDiscoveryPathInput(frontier);
  assert.throws(
    () => appendServiceRouteDiscoveryPath(frontier, route('z-pool')),
    /input is closed/u,
  );

  assert.deepEqual(advanceServiceRouteDiscoveryFrontier(frontier), { emitted: false });
  const emitted = advanceServiceRouteDiscoveryFrontier(frontier);
  assert.equal(emitted.emitted, true);
  if (emitted.emitted) {
    assert.deepEqual(candidateKeys([emitted.candidateSet.routes]), ['a-pool,b-pool']);
  }
});

void test('rejects invalid service route-shape ceilings and empty paths', () => {
  assert.throws(() => createServiceRouteDiscoveryFrontier(1, 4), /maxRoutes/u);
  assert.throws(() => createServiceRouteDiscoveryFrontier(4, 5), /maxHops/u);
  const frontier = createServiceRouteDiscoveryFrontier(4, 4);
  assert.throws(() => appendServiceRouteDiscoveryPath(frontier, []), /hop bound/u);
});
