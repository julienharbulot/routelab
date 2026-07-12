import assert from 'node:assert/strict';
import test from 'node:test';

import {
  renderWalkingSkeletonStatus,
  walkingSkeletonStatus,
} from '../src/walking-skeleton.ts';

void test('reports deterministic bounded-router capability status', () => {
  assert.deepEqual(walkingSkeletonStatus, {
    project: 'RouteLab TS',
    stage: 'bounded-single-path-router',
    mode: 'offline-deterministic',
    financialQuoting: 'exact-constant-product',
    routeReplay: 'exact-explicit-simple-route',
    pathEnumeration: 'deterministic-bounded-simple-paths',
    singlePathRouting: 'exact-bounded',
    canonicalSnapshotChecksum: 'sha256-v1-available-unenforced',
    canonicalRouterRun: 'sha256-v1-in-memory-writer',
    canonicalRouterRunReader: 'exact-replay-verified-in-memory',
  });

  assert.equal(
    renderWalkingSkeletonStatus(),
    '{\n  "project": "RouteLab TS",\n  "stage": "bounded-single-path-router",\n  "mode": "offline-deterministic",\n  "financialQuoting": "exact-constant-product",\n  "routeReplay": "exact-explicit-simple-route",\n  "pathEnumeration": "deterministic-bounded-simple-paths",\n  "singlePathRouting": "exact-bounded",\n  "canonicalSnapshotChecksum": "sha256-v1-available-unenforced",\n  "canonicalRouterRun": "sha256-v1-in-memory-writer",\n  "canonicalRouterRunReader": "exact-replay-verified-in-memory"\n}',
  );
});
