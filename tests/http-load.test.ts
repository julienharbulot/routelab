import assert from 'node:assert/strict';
import test from 'node:test';

import { renderServiceLatencySvg, renderServiceMarkdown } from '../src/service/load-report.ts';
import { runHttpLoad, validateServiceLoadReport } from '../src/service/load.ts';

void test('HTTP load smoke isolates the server process and omits undersampled p99', async () => {
  const report = await runHttpLoad([1], { smoke: true });
  assert.equal(report.configuration.processModel, 'isolated-load-generator-and-server-processes');
  assert.deepEqual(report.configuration.modes, ['same-thread']);
  assert.equal(report.configuration.requestsPerConcurrency, 12);
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0]?.requests, 12);
  assert.equal(report.rows[0]?.completed, 12);
  assert.equal(report.rows[0]?.typedErrors, 0);
  assert.equal(report.rows[0]?.timedOut, 0);
  assert.equal(report.rows[0]?.responseSchemaFailures, 0);
  assert.equal(report.rows[0]?.semanticMatchCount, 12);
  assert.equal(report.rows[0]?.deadlineCompletionRatePpm, 1_000_000);
  assert.equal(report.rows[0]?.successfulLatency?.p99Micros, null);
  assert.equal((report.rows[0]?.server.eventLoopDelayMaxMicros ?? 0) >= 0, true);
  assert.equal(report.rows[0]?.server.admissionAcceptedCount, 12);
  assert.equal(report.rows[0]?.server.structuredCompletionCount, 12);
  assert.deepEqual(validateServiceLoadReport(report), []);
  assert.match(renderServiceMarkdown(report), /separate processes/u);
  assert.match(renderServiceLatencySvg(report), /data-series="same-thread-p50"/u);
});

void test('HTTP load rejects unsafe or duplicate concurrency levels', async () => {
  await assert.rejects(() => runHttpLoad([], { smoke: true }), /Concurrency levels/u);
  await assert.rejects(() => runHttpLoad([0], { smoke: true }), /Concurrency levels/u);
  await assert.rejects(() => runHttpLoad([1, 1], { smoke: true }), /Concurrency levels/u);
  await assert.rejects(() => runHttpLoad([65], { smoke: true }), /Concurrency levels/u);
});

void test('retained worker comparison fails closed instead of reusing a prior report', async () => {
  await assert.rejects(
    () => runHttpLoad([1], { mode: 'worker' }),
    /same-run baseline; prior reports are never reused/u,
  );
});
