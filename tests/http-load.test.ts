import assert from 'node:assert/strict';
import test from 'node:test';

import { runHttpLoad } from '../src/service/load.ts';

void test('HTTP load smoke starts the actual service and omits undersampled p99', async () => {
  const report = await runHttpLoad([1], { smoke: true });
  assert.equal(report.configuration.sameThread, true);
  assert.equal(report.configuration.requestsPerConcurrency, 12);
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0]?.requests, 12);
  assert.equal(report.rows[0]?.completed, 12);
  assert.equal(report.rows[0]?.failed, 0);
  assert.equal(report.rows[0]?.timedOut, 0);
  assert.equal(report.rows[0]?.p99Micros, null);
  assert.equal((report.rows[0]?.eventLoopDelayMaxMicros ?? 0) >= 0, true);
});

void test('HTTP load rejects unsafe or duplicate concurrency levels', async () => {
  await assert.rejects(() => runHttpLoad([], { smoke: true }), /Concurrency levels/u);
  await assert.rejects(() => runHttpLoad([0], { smoke: true }), /Concurrency levels/u);
  await assert.rejects(() => runHttpLoad([1, 1], { smoke: true }), /Concurrency levels/u);
  await assert.rejects(() => runHttpLoad([65], { smoke: true }), /Concurrency levels/u);
});
