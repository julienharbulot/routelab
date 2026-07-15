import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadPortfolioCases } from '../src/benchmark/portfolio/cases.ts';
import {
  BENCHMARK_SAMPLES,
  BENCHMARK_WARMUPS,
  benchmarkProfileConfiguration,
  LATENCY_COMBINATIONS,
  REFERENCE_PROFILE,
} from '../src/benchmark/portfolio/config.ts';
import { runLatency } from '../src/benchmark/portfolio/latency.ts';
import { aggregateQuality, compareNumerical, runQuality } from '../src/benchmark/portfolio/quality.ts';
import { renderMarkdown, renderSvg } from '../src/benchmark/portfolio/report.ts';
import type { BenchmarkReport } from '../src/benchmark/portfolio/types.ts';

void test('portfolio-v1 contains 24 named, bounded, purpose-labelled cases', async () => {
  const cases = await loadPortfolioCases();
  assert.equal(cases.length, 24);
  assert.equal(new Set(cases.map(({ caseId }) => caseId)).size, cases.length);
  assert.equal(cases.every(({ purpose }) => purpose.length > 10), true);
  assert.equal(cases.every(({ request }) =>
    request.amountIn > 0n &&
    (request.maxHops ?? 0) <= 2 &&
    (request.maxRoutes ?? 0) <= 2
  ), true);
  assert.equal(cases.filter(({ caseId }) => caseId.startsWith('historical-')).length, 6);
  assert.equal(cases.filter(({ expectedOutcome }) => expectedOutcome === 'no-route').length, 1);
});

void test('public and reference benchmark profiles are frozen and reference has larger caps', () => {
  const profiles = benchmarkProfileConfiguration() as Record<string, {
    readonly greedyParts: number;
    readonly workCaps: { readonly maxNumericalIterations: number };
  }>;
  assert.deepEqual(Object.keys(profiles), ['fast', 'balanced', 'thorough', 'reference']);
  const thorough = profiles['thorough'];
  assert.notEqual(thorough, undefined);
  if (thorough === undefined) throw new Error('Missing thorough profile.');
  assert.equal(REFERENCE_PROFILE.greedyParts > thorough.greedyParts, true);
  assert.equal(
    REFERENCE_PROFILE.workCaps.maxNumericalIterations >
      thorough.workCaps.maxNumericalIterations,
    true,
  );
  assert.equal(BENCHMARK_WARMUPS >= 10, true);
  assert.equal(BENCHMARK_SAMPLES >= 100, true);
});

void test('quality lane is deterministic, replayable, and reconciles aggregates', async () => {
  const cases = await loadPortfolioCases();
  const selected = cases.filter(({ caseId }) =>
    caseId === 'split-standard' || caseId === 'no-route'
  );
  const first = runQuality(selected);
  const second = runQuality(selected);
  assert.deepEqual(first, second);
  assert.equal(first.length, selected.length * 10);
  assert.equal(first.filter(({ outcome }) => outcome === 'no-route').length, 10);
  assert.equal(first.filter((row) =>
    row.caseId === 'split-standard' &&
    row.outcome === 'quote' &&
    row.routes.reduce((sum, route) => sum + BigInt(route.allocation), 0n) === 100n
  ).length, 10);
  assert.equal(aggregateQuality(first).length, 10);
  assert.equal(compareNumerical(first).every((value) =>
    value.beatsGreedy + value.tiesGreedy + value.losesGreedy === 1
  ), true);
});

void test('latency lane rotates cases and preserves raw observations outside tracked reports', async () => {
  const cases = await loadPortfolioCases();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'routelab-benchmark-'));
  const result = await runLatency(cases.slice(0, 2), directory, 1, 4);
  assert.equal(result.rows.length, LATENCY_COMBINATIONS.length);
  assert.equal(result.rows.every(({ samples, successful }) => samples === 4 && successful === 4), true);
  const raw = JSON.parse(await readFile(
    path.join(directory, 'reports/raw/portfolio-v1-observations.json'),
    'utf8',
  )) as { readonly observations?: readonly unknown[] };
  assert.equal(raw.observations?.length, LATENCY_COMBINATIONS.length * 4);
});

void test('concise Markdown and SVG state scope and valid sample counts', () => {
  const aggregates = [{
    strategy: 'best-single' as const,
    profile: 'fast' as const,
    quoteCount: 1,
    noRouteCount: 0,
    medianRegretBps: 0,
    worstRegretBps: 0,
    splitImprovementCount: 0,
    authorizationRejections: 0,
    authorizationRejectionRate: 0,
    totalWork: 1,
  }];
  const latency = [{
    strategy: 'best-single' as const,
    profile: 'fast' as const,
    warmups: 10,
    samples: 100,
    successful: 100,
    expectedNoRoute: 0,
    p50Micros: 10,
    p95Micros: 20,
    p99Micros: 30,
    minMicros: 5,
    maxMicros: 40,
    throughputPerSecond: 100,
  }];
  const report = {
    schemaVersion: 'routelab.portfolio-benchmark.v1',
    caseSetId: 'portfolio-v1',
    configuration: {
      caseCount: 1,
      warmups: 10,
      samples: 100,
      profiles: benchmarkProfileConfiguration(),
      latencyCombinations: [{ strategy: 'best-single', profile: 'fast' }],
    },
    environment: {
      observedAt: '2026-07-15T00:00:00.000Z',
      node: 'v24', platform: 'linux', arch: 'x64', cpu: 'fixture', commit: 'fixture',
    },
    cases: [], quality: [], aggregates, numericalComparisons: [], latency,
  } satisfies BenchmarkReport;
  assert.match(renderMarkdown(report), /not a global optimum/u);
  assert.match(renderMarkdown(report), /\| 100 \| 10 \| 20 \| 30 \|/u);
  assert.match(renderSvg(report), /^<svg/u);
});
