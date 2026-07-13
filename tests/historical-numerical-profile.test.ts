import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  attributeNormalizedCpuProfile,
  CANONICAL_NUMERICAL_BASELINE_PROFILE_CONFIG_PATH,
  executeFrozenObservationSchedule,
  deriveNumericalBaselineProfileRecommendation,
  normalizeCpuProfile,
  NUMERICAL_BASELINE_PROFILE_CONFIG_BYTES,
  NUMERICAL_BASELINE_PROFILE_CONFIG_SHA256,
  validateFrozenProfileConfigBytes,
  validateNormalizedCpuProfile,
  type HistoricalNumericalProfileProfiler,
} from '../src/benchmark/historical-numerical-profile/index.ts';

function hash(value: Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

void test('frozen profile config keeps its exact canonical bytes and identity', async () => {
  const bytes = await readFile(CANONICAL_NUMERICAL_BASELINE_PROFILE_CONFIG_PATH);
  assert.equal(bytes.byteLength, NUMERICAL_BASELINE_PROFILE_CONFIG_BYTES);
  assert.equal(hash(bytes), NUMERICAL_BASELINE_PROFILE_CONFIG_SHA256);
  assert.equal(bytes.at(-1), 10);
  const text = bytes.toString('utf8');
  assert.equal(`${JSON.stringify(JSON.parse(text) as unknown)}\n`, text);
  assert.doesNotThrow(() => validateFrozenProfileConfigBytes(bytes));
  const sameSizeTamper = Uint8Array.from(bytes);
  sameSizeTamper[10] = sameSizeTamper[10] === 65 ? 66 : 65;
  assert.throws(
    () => validateFrozenProfileConfigBytes(sameSizeTamper),
    (error: unknown) => (error as { code?: unknown }).code === 'config-hash-mismatch',
  );
  assert.throws(
    () => validateFrozenProfileConfigBytes(Uint8Array.from([...bytes, 10])),
    (error: unknown) => (error as { code?: unknown }).code === 'config-size-mismatch',
  );
});

void test('CPU profile normalization is lossless for protocol fields and preserves signed native positions', () => {
  const normalized = normalizeCpuProfile({
    nodes: [
      {
        id: 1,
        callFrame: {
          functionName: '(root)', scriptId: '0', url: '', lineNumber: -1, columnNumber: -1,
        },
        hitCount: 0,
        children: [2],
      },
      {
        id: 2,
        callFrame: {
          functionName: 'discover', scriptId: '7',
          url: 'file:///repo/src/search/shared-route-discovery/index.ts',
          lineNumber: 10, columnNumber: 4,
        },
        hitCount: 1,
        deoptReason: '',
        positionTicks: [{ line: 11, ticks: 1 }],
      },
    ],
    startTime: 100,
    endTime: 225,
    samples: [2],
    timeDeltas: [125],
  }, '/repo', 100, 100);
  assert.deepEqual(normalized, {
    nodes: [
      {
        id: '1',
        callFrame: {
          functionName: '(root)', scriptId: '0', url: '', lineNumber: '-1', columnNumber: '-1',
        },
        hitCount: '0',
        children: ['2'],
      },
      {
        id: '2',
        callFrame: {
          functionName: 'discover', scriptId: '7',
          url: 'src/search/shared-route-discovery/index.ts', lineNumber: '10', columnNumber: '4',
        },
        hitCount: '1',
        deoptReason: '',
        positionTicks: [{ line: '11', ticks: '1' }],
      },
    ],
    startTime: '100',
    endTime: '225',
    samples: ['2'],
    timeDeltas: ['125'],
  });
});

void test('CPU profile normalization rejects paths outside the repository and incomplete samples', () => {
  const rootNode = {
    id: 1,
    callFrame: {
      functionName: '(root)', scriptId: '0', url: 'file:///elsewhere/root.js',
      lineNumber: -1, columnNumber: -1,
    },
  };
  assert.throws(
    () => normalizeCpuProfile({
      nodes: [rootNode], startTime: 0, endTime: 1, samples: [1], timeDeltas: [1],
    }, '/repo', 10, 10),
    (error: unknown) => (error as { code?: unknown }).code === 'unsafe-profile-path',
  );
  assert.throws(
    () => normalizeCpuProfile({
      nodes: [{ ...rootNode, extra: true }], startTime: 0, endTime: 1,
      samples: [1], timeDeltas: [1],
    }, '/elsewhere', 10, 10),
    (error: unknown) => (error as { code?: unknown }).code === 'invalid-cpu-profile',
  );
  assert.throws(
    () => normalizeCpuProfile({
      nodes: [{
        ...rootNode,
        callFrame: { ...rootNode.callFrame, url: '', lineNumber: -0 },
      }],
      startTime: 0, endTime: 1, samples: [1], timeDeltas: [1],
    }, '/repo', 10, 10),
    (error: unknown) => (error as { code?: unknown }).code === 'invalid-cpu-profile',
  );
  assert.throws(
    () => normalizeCpuProfile({
      nodes: [{
        ...rootNode,
        callFrame: { ...rootNode.callFrame, url: '' },
        children: [2],
      }],
      startTime: 0, endTime: 1, samples: [1], timeDeltas: [1],
    }, '/repo', 10, 10),
    (error: unknown) => (error as { code?: unknown }).code === 'invalid-cpu-profile',
  );
  assert.throws(
    () => validateNormalizedCpuProfile({
      nodes: [{
        id: '1',
        callFrame: {
          functionName: '(root)', scriptId: '0', url: '', lineNumber: '-0', columnNumber: '-1',
        },
      }],
      startTime: '0', endTime: '1', samples: ['1'], timeDeltas: ['1'],
    }, 10, 10),
    (error: unknown) => (error as { code?: unknown }).code === 'unsafe-profile-path',
  );
  assert.throws(
    () => validateNormalizedCpuProfile({
      nodes: [{
        id: '9007199254740992',
        callFrame: {
          functionName: '(root)', scriptId: '0', url: '', lineNumber: '-1', columnNumber: '-1',
        },
      }],
      startTime: '0', endTime: '1', samples: ['9007199254740992'], timeDeltas: ['1'],
    }, 10, 10),
    (error: unknown) => (error as { code?: unknown }).code === 'invalid-artifact-shape',
  );
  assert.throws(
    () => normalizeCpuProfile({ nodes: [rootNode], startTime: 0, endTime: 1 }, '/repo', 10, 10),
    (error: unknown) => (error as { code?: unknown }).code === 'invalid-cpu-profile',
  );
});

void test('leaf attribution retains explicit runtime-root membership and decision needs all three leaders', async () => {
  const frame = (functionName: string, url: string) => ({
    functionName, scriptId: '1', url, lineNumber: '0', columnNumber: '0',
  });
  const profile = validateNormalizedCpuProfile({
    nodes: [
      { id: '1', callFrame: frame('(root)', ''), children: ['2', '4'] },
      {
        id: '2',
        callFrame: frame(
          'routeExactInputSplitNumericalAnytime',
          'src/router/numerical-exact-input-split/index.ts',
        ),
        children: ['3'],
      },
      { id: '3', callFrame: frame('discover', 'src/search/shared-route-discovery/index.ts') },
      { id: '4', callFrame: frame('discover', 'src/search/shared-route-discovery/index.ts') },
    ],
    startTime: '0', endTime: '12', samples: ['3', '4'], timeDeltas: ['5', '7'],
  }, 10, 10);
  const config = JSON.parse(await readFile(
    CANONICAL_NUMERICAL_BASELINE_PROFILE_CONFIG_PATH,
    'utf8',
  )) as unknown;
  assert.deepEqual(attributeNormalizedCpuProfile(profile, config), {
    membership: [true, false],
    categories: ['candidate-set-discovery', 'candidate-set-discovery'],
  });
  assert.equal(deriveNumericalBaselineProfileRecommendation(
    ['candidate-set-discovery', 'candidate-set-discovery', 'candidate-set-discovery'],
    1,
  ), 'design-one-sound-candidate-set-pruning-experiment');
  assert.equal(deriveNumericalBaselineProfileRecommendation(
    ['candidate-set-discovery', null, 'candidate-set-discovery'],
    1,
  ), 'decline-sound-pruning-selection-from-this-profile');
  assert.equal(deriveNumericalBaselineProfileRecommendation(
    ['candidate-set-discovery', 'candidate-set-discovery', 'candidate-set-discovery'],
    0,
  ), 'decline-sound-pruning-selection-from-this-profile');
});

void test('injected scheduler executes exact phase counts, orders, and post-stop validation', async () => {
  const events: string[] = [];
  let clockValue = 0n;
  let stopCount = 0;
  const profiler: HistoricalNumericalProfileProfiler = {
    connect(): void { events.push('connect'); },
    enable(): Promise<void> { events.push('enable'); return Promise.resolve(); },
    setSamplingInterval(value: number): Promise<void> {
      events.push(`interval:${value}`);
      return Promise.resolve();
    },
    start(): Promise<void> { events.push('start'); return Promise.resolve(); },
    stop(): Promise<unknown> {
      events.push(`stop:${stopCount}`);
      stopCount += 1;
      return Promise.resolve({ profile: stopCount });
    },
    disable(): Promise<void> { events.push('disable'); return Promise.resolve(); },
    disconnect(): void { events.push('disconnect'); },
  };
  const result = await executeFrozenObservationSchedule(
    ['a', 'b'],
    (cell) => {
      events.push(`prepare:${cell}`);
      return () => { events.push(`run:${cell}`); return cell; };
    },
    (actual, expected) => { events.push(`validate:${expected}`); assert.equal(actual, expected); },
    {
      now: () => {
        events.push('clock');
        const value = clockValue;
        clockValue += 5n;
        return value;
      },
    },
    profiler,
  );
  assert.equal(result.totalCallCount, 22);
  assert.equal(result.timingSamples.length, 10);
  assert.deepEqual(result.timingSamples.map((sample) => sample.cohortIndex), [
    0, 1, 1, 0, 0, 1, 1, 0, 0, 1,
  ]);
  assert.equal(result.timingSamples.every((sample) => sample.elapsedNanoseconds === '5'), true);
  assert.deepEqual(result.cpuSweeps.map((sweep) => [sweep.sweepOrder, sweep.callCount]), [
    ['forward', 2], ['reverse', 2], ['forward', 2],
  ]);
  assert.deepEqual(events.filter((event) => event === 'start' || event.startsWith('stop:')), [
    'start', 'stop:0', 'start', 'stop:1', 'start', 'stop:2',
  ]);
  for (let profileIndex = 0; profileIndex < 3; profileIndex += 1) {
    const stop = events.indexOf(`stop:${profileIndex}`);
    assert.equal(events[stop + 1]?.startsWith('validate:'), true);
  }
  assert.deepEqual(events.slice(-2), ['disable', 'disconnect']);
  const firstClock = events.indexOf('clock');
  assert.deepEqual(events.slice(firstClock - 1, firstClock + 4), [
    'prepare:a', 'clock', 'run:a', 'clock', 'validate:a',
  ]);
  for (const start of events.map((event, index) => event === 'start' ? index : -1).filter((index) => index >= 0)) {
    assert.equal(events[start - 1]?.startsWith('prepare:'), true);
  }
});

void test('injected scheduler preserves the first profiler failure through cleanup', async () => {
  const profiler: HistoricalNumericalProfileProfiler = {
    connect(): void {},
    enable(): Promise<void> { return Promise.resolve(); },
    setSamplingInterval(): Promise<void> { return Promise.resolve(); },
    start(): Promise<void> { return Promise.reject(new Error('start')); },
    stop(): Promise<unknown> { return Promise.reject(new Error('stop')); },
    disable(): Promise<void> { return Promise.reject(new Error('disable')); },
    disconnect(): void { throw new Error('disconnect'); },
  };
  await assert.rejects(
    executeFrozenObservationSchedule(
      [1],
      (value) => () => value,
      (actual, expected) => { assert.equal(actual, expected); },
      { now: (() => { let value = 0n; return () => value++; })() },
      profiler,
    ),
    (error: unknown) => (error as { code?: unknown }).code === 'profiler-start-failed',
  );
});

void test('injected scheduler surfaces cleanup failure when no earlier failure exists', async () => {
  const profiler: HistoricalNumericalProfileProfiler = {
    connect(): void {},
    enable(): Promise<void> { return Promise.resolve(); },
    setSamplingInterval(): Promise<void> { return Promise.resolve(); },
    start(): Promise<void> { return Promise.resolve(); },
    stop(): Promise<unknown> {
      return Promise.resolve({ nodes: [], startTime: 0, endTime: 0, samples: [], timeDeltas: [] });
    },
    disable(): Promise<void> { return Promise.reject(new Error('disable')); },
    disconnect(): void {},
  };
  await assert.rejects(
    executeFrozenObservationSchedule(
      [1],
      (value) => () => value,
      (actual, expected) => { assert.equal(actual, expected); },
      { now: (() => { let value = 0n; return () => value++; })() },
      profiler,
    ),
    (error: unknown) => (error as { code?: unknown }).code === 'profiler-disable-failed',
  );
});
