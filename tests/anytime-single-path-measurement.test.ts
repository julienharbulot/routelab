import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ANYTIME_SINGLE_PATH_MEASUREMENT_LIMITATIONS,
  createAnytimeSinglePathMeasurementReport,
  parseAnytimeSinglePathMeasurementInput,
} from '../src/benchmark/anytime-single-path/index.ts';

const INPUT_URL = new URL(
  '../fixtures/m4/anytime-single-path-input.v1.json',
  import.meta.url,
);

function deterministicClock(values: readonly bigint[]) {
  let index = 0;
  return {
    nowNanoseconds() {
      const value = values[index];
      if (value === undefined) throw new Error('unexpected clock access');
      index += 1;
      return value;
    },
    calls() {
      return index;
    },
  };
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) {
    assertDeepFrozen(Reflect.get(value, key), seen);
  }
}

void test('fixed versioned input produces deterministic quality separate from raw latency', async () => {
  const source = await readFile(INPUT_URL, 'utf8');
  const parsed = parseAnytimeSinglePathMeasurementInput(source);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.inputId, 'm4-anytime-single-path-quality-v1');
  assert.match(parsed.value.inputChecksum, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(parsed.value.workPoints, [0, 1, 2, 3, 4]);

  const clock = deterministicClock([10n, 15n, 20n, 27n, 30n, 41n, 50n, 63n]);
  const output = createAnytimeSinglePathMeasurementReport(
    parsed.value,
    { warmupCount: 2, sampleCount: 2 },
    clock,
    { nodeVersion: 'test-node', platform: 'test-platform', arch: 'test-arch' },
  );

  assert.equal(clock.calls(), 8);
  assert.deepEqual(
    output.report.quality.oneShot.map(({ amountOut }) => amountOut),
    ['90', '90', '90', '90', '165'],
  );
  assert.deepEqual(output.report.quality.cumulativeResume, output.report.quality.oneShot);
  for (const point of output.report.quality.oneShot) {
    assert.deepEqual(point.establishment, {
      enumeratedCandidates: 1,
      replayedCandidates: 1,
      rejectedCandidates: 0,
    });
    assert.equal(point.search.expansions, point.maxExpansions);
  }
  assert.deepEqual(output.report.latency, {
    unit: 'nanoseconds',
    input: {
      inputId: parsed.value.inputId,
      inputChecksum: parsed.value.inputChecksum,
    },
    warmupCount: 2,
    sampleCount: 2,
    alternation: 'reverse-order-each-round',
    algorithms: ['interruptible-one-shot', 'resumable-one-shot'],
    environment: {
      nodeVersion: 'test-node',
      platform: 'test-platform',
      arch: 'test-arch',
    },
    rawSamples: [
      {
        round: 0,
        order: 0,
        algorithm: 'interruptible-one-shot',
        elapsedNanoseconds: '5',
      },
      {
        round: 0,
        order: 1,
        algorithm: 'resumable-one-shot',
        elapsedNanoseconds: '7',
      },
      {
        round: 1,
        order: 0,
        algorithm: 'resumable-one-shot',
        elapsedNanoseconds: '11',
      },
      {
        round: 1,
        order: 1,
        algorithm: 'interruptible-one-shot',
        elapsedNanoseconds: '13',
      },
    ],
  });
  assert.equal(output.report.limitations, ANYTIME_SINGLE_PATH_MEASUREMENT_LIMITATIONS);
  assert.equal('latency' in output.report.quality, false);
  assert.equal('threshold' in output.report.latency, false);
  assert.equal('conclusion' in output.report.latency, false);
  assert.deepEqual(JSON.parse(output.canonicalJson), output.report);
  assertDeepFrozen(output);
});

void test('identical injected observations produce byte-identical reports', async () => {
  const source = await readFile(INPUT_URL, 'utf8');
  const parsed = parseAnytimeSinglePathMeasurementInput(source);
  if (!parsed.ok) throw new Error('expected valid fixed measurement input');
  const create = () =>
    createAnytimeSinglePathMeasurementReport(
      parsed.value,
      { warmupCount: 0, sampleCount: 1 },
      deterministicClock([100n, 103n, 200n, 205n]),
      { nodeVersion: 'node', platform: 'platform', arch: 'arch' },
    );

  assert.deepEqual(create(), create());
});

void test('input parser rejects drifted schemas, identities, exact values, and work points', async () => {
  const source = await readFile(INPUT_URL, 'utf8');
  const base = JSON.parse(source) as Record<string, unknown>;
  const invalidValues = [
    { ...base, schemaVersion: 'routelab.anytime-single-path-input.v2' },
    { ...base, workPoints: [0, 2, 1] },
    {
      ...base,
      request: { ...(base['request'] as Record<string, unknown>), amountIn: 1 },
    },
    {
      ...base,
      request: {
        ...(base['request'] as Record<string, unknown>),
        snapshotId: 'different',
      },
    },
  ];

  for (const value of invalidValues) {
    assert.deepEqual(parseAnytimeSinglePathMeasurementInput(JSON.stringify(value)), {
      ok: false,
      error: { code: 'invalid-input' },
    });
  }
});
