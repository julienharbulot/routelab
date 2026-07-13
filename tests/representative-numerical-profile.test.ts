import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  createRepresentativeNumericalProfile,
  deriveRepresentativeProfileRecommendation,
  executeRepresentativeObservationSchedule,
  normalizeRepresentativeCpuProfile,
  REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_BYTES,
  REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_PATH,
  REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_SHA256,
  validateRepresentativeProfileConfigBytes,
  type RepresentativeProfileProfiler,
} from '../src/benchmark/representative-numerical-profile/index.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

void test('final profile config retains exact independently reviewed bytes', async () => {
  const bytes = Uint8Array.from(await readFile(path.join(ROOT, REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_PATH)));
  assert.equal(bytes.byteLength, REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_BYTES);
  const config = validateRepresentativeProfileConfigBytes(bytes);
  assert.equal(config['schemaVersion'], 'routelab.numerical-representative-profile-config.v1');
  assert.equal(config['profileConfigId'], 'm7b-core12-supported-regime-numerical-preacceleration-profile-v1');
  assert.equal(REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_SHA256,
    'sha256:b2ac31c4781471872110bbd2546e8681cee3a3301477db34b3931f06a8648734');
});

void test('four-case scheduler preserves exact phases, counts, and one profiler session', async () => {
  const events: string[] = [];
  let clock = 0n;
  const profiler: RepresentativeProfileProfiler = {
    connect() { events.push('connect'); },
    enable() { events.push('enable'); return Promise.resolve(); },
    setSamplingInterval(value) { events.push(`interval:${value}`); return Promise.resolve(); },
    start() { events.push('start'); return Promise.resolve(); },
    stop() { events.push('stop'); return Promise.resolve({ profile: true }); },
    disable() { events.push('disable'); return Promise.resolve(); },
    disconnect() { events.push('disconnect'); },
  };
  const caseIds = [
    'historical-anchor', 'synthetic-dual-spanning-tree',
    'synthetic-reserve-compressed-1e12', 'synthetic-reserve-amplified-1e60',
  ] as const;
  const calls: number[] = [];
  const result = await executeRepresentativeObservationSchedule(
    caseIds.map((caseId, value) => ({ caseId, cells: [value] })),
    (cell) => () => { calls.push(cell); return cell; },
    (value, cell) => assert.equal(value, cell),
    { now: () => { const value = clock; clock += 1n; return value; } },
    profiler,
  );
  assert.equal(result.totalCallCount, 44);
  assert.equal(result.timingSamples.length, 20);
  assert.equal(result.cpuSweeps.length, 12);
  assert.equal(calls.length, 44);
  assert.deepEqual(events.slice(0, 3), ['connect', 'enable', 'interval:1000']);
  assert.equal(events.filter((event) => event === 'start').length, 12);
  assert.equal(events.filter((event) => event === 'stop').length, 12);
  assert.deepEqual(events.slice(-2), ['disable', 'disconnect']);
  assert.deepEqual(result.cpuSweeps.map(({ caseId, sweepOrder }) => [caseId, sweepOrder]),
    caseIds.flatMap((caseId) => [['forward', 'reverse', 'forward'].map((sweepOrder) => [caseId, sweepOrder])]).flat());
});

void test('scheduler preserves profiler start failure and still cleans up once', async () => {
  const events: string[] = [];
  const profiler: RepresentativeProfileProfiler = {
    connect() { events.push('connect'); },
    enable() { events.push('enable'); return Promise.resolve(); },
    setSamplingInterval() { events.push('interval'); return Promise.resolve(); },
    start() { events.push('start'); return Promise.reject(new Error('forced')); },
    stop() { events.push('stop'); return Promise.resolve({}); },
    disable() { events.push('disable'); return Promise.resolve(); },
    disconnect() { events.push('disconnect'); },
  };
  await assert.rejects(
    executeRepresentativeObservationSchedule(
      [
        { caseId: 'historical-anchor', cells: [0] },
        { caseId: 'synthetic-dual-spanning-tree', cells: [1] },
        { caseId: 'synthetic-reserve-compressed-1e12', cells: [2] },
        { caseId: 'synthetic-reserve-amplified-1e60', cells: [3] },
      ],
      (cell) => () => cell,
      (value, cell) => assert.equal(value, cell),
      { now: () => 1n },
      profiler,
    ),
    (error: unknown) => typeof error === 'object' && error !== null
      && (error as { code?: unknown }).code === 'profiler-start-failed',
  );
  assert.deepEqual(events.slice(-2), ['disable', 'disconnect']);
  assert.equal(events.filter((event) => event === 'start').length, 1);
  assert.equal(events.includes('stop'), false);
});

void test('profile normalization attributes all samples and rejects a second root', async () => {
  const config = validateRepresentativeProfileConfigBytes(
    Uint8Array.from(await readFile(path.join(ROOT, REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_PATH))),
  );
  const frame = (functionName: string, url: string) => ({
    functionName, scriptId: '1', url, lineNumber: 0, columnNumber: 0,
  });
  const raw = {
    nodes: [
      { id: 1, callFrame: frame('(root)', ''), children: [2] },
      { id: 2, callFrame: frame('expandSharedCandidateSetFrontier',
        pathToFileURL(path.join(ROOT, 'src/search/shared-route-discovery/index.ts')).href) },
    ],
    startTime: 1, endTime: 2, samples: [2], timeDeltas: [1],
  };
  const normalized = normalizeRepresentativeCpuProfile(raw, ROOT, config);
  assert.equal(normalized.nodes[1]?.callFrame.url, 'src/search/shared-route-discovery/index.ts');
  assert.throws(() => normalizeRepresentativeCpuProfile({
    ...raw,
    nodes: [...raw.nodes, { id: 3, callFrame: frame('orphan', '') }],
  }, ROOT, config), /invalid-cpu-profile/u);
});

void test('decision requires twelve positive strict candidate-set leaders and positive work in every case', () => {
  assert.equal(deriveRepresentativeProfileRecommendation(
    Array.from({ length: 12 }, () => 'candidate-set-discovery'),
    Array.from({ length: 12 }, () => '1'), [1, 1, 1, 1], true,
  ), 'design-one-sound-candidate-set-pruning-experiment');
  assert.equal(deriveRepresentativeProfileRecommendation(
    [...Array.from({ length: 11 }, () => 'candidate-set-discovery'), 'path-discovery'],
    Array.from({ length: 12 }, () => '1'), [1, 1, 1, 1], true,
  ), 'decline-sound-pruning-selection-from-this-supported-regime-suite');
  assert.equal(deriveRepresentativeProfileRecommendation(
    Array.from({ length: 12 }, () => 'candidate-set-discovery'),
    Array.from({ length: 12 }, () => '1'), [1, 0, 1, 1], true,
  ), 'decline-sound-pruning-selection-from-this-supported-regime-suite');
});

void test('environment mismatch stops before any numerical call or profiler connection', { timeout: 20_000 }, async () => {
  let calls = 0;
  let connects = 0;
  const result = await createRepresentativeNumericalProfile({
    repositoryRoot: ROOT,
    evidenceRevision: 'fd9cadc5f9783dda0052b02d8c6316a8f47bc8e2',
    readFile: async (filePath) => Uint8Array.from(await readFile(path.join(ROOT, filePath))),
    environment: {
      nodeVersion: 'wrong', v8Version: 'wrong', uvVersion: 'wrong',
      profilerApi: 'node:inspector/promises', samplingIntervalMicroseconds: 1000,
      platform: 'test', arch: 'test', endianness: 'LE', osType: 'test', osRelease: 'test',
      cpuModel: 'test', cpuSpeedMHz: 1, logicalCpuCount: 1, availableParallelism: 1,
      totalMemoryBytes: '1', execArgv: [], nodeOptionsState: 'unset', mainThread: true,
    },
    route() { calls += 1; throw new Error('must not route'); },
    profiler: {
      connect() { connects += 1; }, enable: () => Promise.resolve(),
      setSamplingInterval: () => Promise.resolve(), start: () => Promise.resolve(),
      stop: () => Promise.resolve({}), disable: () => Promise.resolve(), disconnect() {},
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('Expected environment mismatch.');
  assert.equal(result.error.code, 'environment-mismatch');
  assert.equal(calls, 0);
  assert.equal(connects, 0);
});
