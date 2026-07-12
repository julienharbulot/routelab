import assert from 'node:assert/strict';
import test from 'node:test';

import {
  renderWalkingSkeletonStatus,
  walkingSkeletonStatus,
} from '../src/walking-skeleton.ts';

void test('reports a deterministic non-financial walking-skeleton status', () => {
  assert.deepEqual(walkingSkeletonStatus, {
    project: 'RouteLab TS',
    stage: 'repository-contract',
    mode: 'offline-deterministic',
    financialQuoting: 'deferred',
  });

  assert.equal(
    renderWalkingSkeletonStatus(),
    '{\n  "project": "RouteLab TS",\n  "stage": "repository-contract",\n  "mode": "offline-deterministic",\n  "financialQuoting": "deferred"\n}',
  );
});
