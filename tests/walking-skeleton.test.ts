import assert from 'node:assert/strict';
import test from 'node:test';

import {
  renderWalkingSkeletonStatus,
  walkingSkeletonStatus,
} from '../src/walking-skeleton.ts';

void test('reports deterministic exact-pool capability status', () => {
  assert.deepEqual(walkingSkeletonStatus, {
    project: 'RouteLab TS',
    stage: 'exact-pool-kernel',
    mode: 'offline-deterministic',
    financialQuoting: 'exact-constant-product',
  });

  assert.equal(
    renderWalkingSkeletonStatus(),
    '{\n  "project": "RouteLab TS",\n  "stage": "exact-pool-kernel",\n  "mode": "offline-deterministic",\n  "financialQuoting": "exact-constant-product"\n}',
  );
});
