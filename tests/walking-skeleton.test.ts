import assert from 'node:assert/strict';
import test from 'node:test';

import {
  renderWalkingSkeletonStatus,
  walkingSkeletonStatus,
} from '../src/walking-skeleton.ts';

void test('reports deterministic exact-replay capability status', () => {
  assert.deepEqual(walkingSkeletonStatus, {
    project: 'RouteLab TS',
    stage: 'exact-replay-kernel',
    mode: 'offline-deterministic',
    financialQuoting: 'exact-constant-product',
    routeReplay: 'exact-explicit-simple-route',
  });

  assert.equal(
    renderWalkingSkeletonStatus(),
    '{\n  "project": "RouteLab TS",\n  "stage": "exact-replay-kernel",\n  "mode": "offline-deterministic",\n  "financialQuoting": "exact-constant-product",\n  "routeReplay": "exact-explicit-simple-route"\n}',
  );
});
