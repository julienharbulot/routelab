import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { makeDeadlineLoadRow, type Observation } from '../src/service/load-client.ts';
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

void test('compare mode uses one invocation and never reads a prior report as baseline', async () => {
  const report = await runHttpLoad([1], { smoke: true, mode: 'compare' });
  assert.deepEqual(report.configuration.modes, ['same-thread', 'worker']);
  assert.deepEqual(report.comparisonIdentity?.sameThread, report.comparisonIdentity?.worker);
  assert.equal(report.rows.length, 2);
  assert.equal(report.rows.every((value) => value.semanticMatchCount === 12), true);
  const source = await readFile('src/service/load.ts', 'utf8');
  assert.doesNotMatch(source, /readFile\s*\(/u);
});

void test('deadline outcomes classify separately and reconcile exact validation', () => {
  const classifications: Observation['deadlineClassification'][] = [
    'complete-exact-quote',
    'validated-deadline-incumbent',
    'deadline-before-plan',
    'overload',
    'client-timeout',
    'schema-or-internal-failure',
  ];
  const observations = classifications.map((classification, sequence): Observation => ({
    sequence,
    concurrency: 16,
    caseId: 'fixture',
    elapsedNanoseconds: ((sequence + 1) * 1_000_000).toString(10),
    outcome: classification === 'client-timeout'
      ? 'timed-out'
      : classification === 'complete-exact-quote'
          || classification === 'validated-deadline-incumbent'
        ? 'completed'
        : classification === 'schema-or-internal-failure'
          ? 'schema-failure'
          : 'typed-error',
    status: classification === 'overload' ? 503 : classification === 'deadline-before-plan' ? 408 : 200,
    errorCode: classification === 'overload'
      ? 'overloaded'
      : classification === 'deadline-before-plan'
        ? 'deadline-before-plan'
        : null,
    retryAfterPresent: classification === 'overload',
    exactOutputPresent: classification === 'complete-exact-quote'
      || classification === 'validated-deadline-incumbent',
    fingerprintPresent: classification === 'complete-exact-quote'
      || classification === 'validated-deadline-incumbent',
    exactValidationPassed: classification === 'complete-exact-quote'
      || classification === 'validated-deadline-incumbent',
    semanticMatch: false,
    termination: classification === 'validated-deadline-incumbent'
      ? 'deadline'
      : classification === 'complete-exact-quote' ? 'complete' : null,
    deadlineClassification: classification,
  }));
  const server = {
    initialRssBytes: 1,
    peakRssBytes: 1,
    finalRssBytes: 1,
    initialHeapUsedBytes: 1,
    peakHeapUsedBytes: 1,
    finalHeapUsedBytes: 1,
    admissionAcceptedCount: 5,
    admissionRejectedCount: 1,
    overloadCount: 1,
    maximumActiveWork: 4,
    maximumQueuedWork: 1,
    structuredCompletionCount: 6,
    terminationCounts: {},
    routeCountCounts: {},
    queueWait: null,
    quoteService: null,
    eventLoopDelayP95Micros: 0,
    eventLoopDelayMaxMicros: 0,
  };
  const row = makeDeadlineLoadRow(25, observations.length, observations, server);
  assert.deepEqual(Object.values(row.classifications), [1, 1, 1, 1, 1, 1]);
  assert.equal(row.exactValidationCount, 2);
  assert.equal(row.completeQuoteLatency?.samples, 1);
  assert.equal(row.deadlineIncumbentLatency?.samples, 1);
});
