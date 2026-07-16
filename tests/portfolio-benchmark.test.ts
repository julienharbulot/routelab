import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadHistoricalPortfolioCases } from '../src/benchmark/portfolio/cases.ts';
import {
  BENCHMARK_SAMPLES,
  BENCHMARK_WARMUPS,
  benchmarkProfileConfiguration,
  LATENCY_COMBINATIONS,
  QUALITY_MODES,
  LARGE_BUDGET_PROFILE,
} from '../src/benchmark/portfolio/config.ts';
import { runLatency } from '../src/benchmark/portfolio/latency.ts';
import {
  aggregateQuality,
  BENCHMARK_COUNTERS,
  canonicalDigest,
  compareNumerical,
  runQuality,
} from '../src/benchmark/portfolio/quality.ts';
import {
  renderMarkdown,
  renderQualityByEffortSvg,
  renderRegretDistributionSvg,
} from '../src/benchmark/portfolio/report.ts';
import type { BenchmarkSummary } from '../src/benchmark/portfolio/types.ts';

void test('portfolio-v2 uses the complete verified historical-snapshot-derived corpus', async () => {
  const loaded = await loadHistoricalPortfolioCases();
  assert.equal(loaded.cases.length, 396);
  assert.equal(loaded.corpus.requestCount, 396);
  assert.equal(loaded.corpus.schemaVersion, 'routelab.generated-benchmark-corpus.v2');
  assert.equal(new Set(loaded.cases.map(({ caseId }) => caseId)).size, 396);
  assert.deepEqual(
    loaded.cases.reduce<Record<string, number>>((counts, value) => {
      counts[value.amountBucket] = (counts[value.amountBucket] ?? 0) + 1;
      return counts;
    }, {}),
    {
      'max-reserve-1-in-100000': 132,
      'max-reserve-1-in-10000': 132,
      'max-reserve-1-in-1000': 132,
    },
  );
  assert.equal(loaded.cases.every(({ request }) =>
    request.amountIn > 0n && request.maxHops === 2 && request.maxRoutes === 2
  ), true);
  assert.equal(loaded.cases.every(({ expectedOutcome }) => expectedOutcome === 'quote'), true);
});

void test('public and large-budget profiles are frozen with sufficient latency samples', () => {
  const profiles = benchmarkProfileConfiguration() as Record<string, {
    readonly greedyParts: number;
    readonly workCaps: { readonly maxNumericalIterations: number };
  }>;
  assert.deepEqual(Object.keys(profiles), ['fast', 'balanced', 'thorough', 'large-budget']);
  const thorough = profiles['thorough'];
  assert.notEqual(thorough, undefined);
  if (thorough === undefined) throw new Error('Missing thorough profile.');
  assert.equal(LARGE_BUDGET_PROFILE.greedyParts > thorough.greedyParts, true);
  assert.equal(
    LARGE_BUDGET_PROFILE.workCaps.maxNumericalIterations
      > thorough.workCaps.maxNumericalIterations,
    true,
  );
  assert.equal(QUALITY_MODES.length, 8);
  assert.equal(BENCHMARK_WARMUPS >= 50, true);
  assert.equal(BENCHMARK_SAMPLES >= 1_000, true);
});

void test('quality rows are deterministic and reconcile across every required grouping', async () => {
  const loaded = await loadHistoricalPortfolioCases();
  const selected = [loaded.cases[0], loaded.cases[17]].filter((value) => value !== undefined);
  const first = runQuality(selected);
  const second = runQuality(selected);
  assert.deepEqual(first, second);
  assert.equal(first.length, selected.length * QUALITY_MODES.length);
  assert.equal(first.every((row) =>
    row.outcome === 'quote'
    && row.exactReplayPassed
    && row.routes.reduce((sum, route) => sum + BigInt(route.allocation), 0n)
      === selected.find((value) => value.caseId === row.caseId)?.request.amountIn
  ), true);
  const aggregates = aggregateQuality(first);
  assert.equal(aggregates.length, QUALITY_MODES.length * 6);
  assert.equal(aggregates.every((value) =>
    Object.keys(value.counterPercentiles).join(',') === BENCHMARK_COUNTERS.join(',')
    && value.numericalProposalAttemptedCount
      === value.numericalProposalConvergedCount + value.numericalProposalFailedCount
    && value.allProposalsConvergedRequestCount <= value.numericalRequestCount
  ), true);
  assert.equal(compareNumerical(first).length, 3 * 6);
  assert.equal(canonicalDigest(first), canonicalDigest(second));
});

void test('latency rotates corpus requests and keeps raw observations outside reports', async () => {
  const loaded = await loadHistoricalPortfolioCases();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'routelab-benchmark-'));
  const result = await runLatency(loaded.cases.slice(0, 2), directory, 1, 4);
  assert.equal(result.rows.length, LATENCY_COMBINATIONS.length);
  assert.equal(result.rows.every(({ samples, quoteCount, quote }) =>
    samples === 4 && quoteCount === 4 && quote?.p99Micros === null
  ), true);
  const raw = JSON.parse(await readFile(
    path.join(directory, 'reports/raw/portfolio-v2-latency.json'),
    'utf8',
  )) as { readonly observations?: readonly unknown[] };
  assert.equal(raw.observations?.length, LATENCY_COMBINATIONS.length * 4);
});

void test('Markdown and both SVGs state the evidence scope and axis semantics', async () => {
  const loaded = await loadHistoricalPortfolioCases();
  const rows = runQuality(loaded.cases.slice(0, 1));
  const aggregates = aggregateQuality(rows);
  const numericalComparisons = compareNumerical(rows);
  const summary = {
    schemaVersion: 'routelab.portfolio-benchmark-summary.v2',
    evidenceSource: {
      schemaVersion: 'routelab.evidence-source.v1',
      revision: '0123456789abcdef0123456789abcdef01234567',
      pathSet: {
        schemaVersion: 'routelab.evidence-source-paths.v1',
        paths: ['src/index.ts'],
      },
      digest: `sha256:${'0'.repeat(64)}`,
    },
    corpus: loaded.corpus,
    configuration: {
      maxHops: 2,
      maxRoutes: 2,
      warmupsPerLatencyLane: BENCHMARK_WARMUPS,
      samplesPerLatencyLane: BENCHMARK_SAMPLES,
      profiles: benchmarkProfileConfiguration(),
      qualityModes: QUALITY_MODES,
      latencyCombinations: LATENCY_COMBINATIONS,
      comparisonRule: 'best-observed-exact-output-across-all-fixed-modes',
    },
    digests: {
      requestOrderSha256: canonicalDigest([]),
      qualityRowsSha256: canonicalDigest(rows),
      qualityAggregatesSha256: canonicalDigest(aggregates),
      numericalComparisonsSha256: canonicalDigest(numericalComparisons),
    },
    quality: {
      rowCount: rows.length,
      exactReplaySuccessCount: rows.length,
      largeBudgetBeatenCount: rows.filter((value) => value.largeBudgetBeaten).length,
      largeBudgetBeatenRequestCount: new Set(
        rows.filter((value) => value.largeBudgetBeaten).map((value) => value.caseId),
      ).size,
      largeBudgetBeatenByMode: [],
      aggregates,
      numericalComparisons,
    },
    environment: {
      observedAt: '2026-07-16T00:00:00.000Z',
      node: 'v24',
      platform: 'linux',
      arch: 'x64',
      cpu: 'fixture',
      commit: 'fixture',
    },
    latency: LATENCY_COMBINATIONS.map(({ strategy, profile }) => ({
      strategy,
      profile,
      warmups: 50,
      samples: 1_000,
      quoteCount: 1_000,
      noRouteCount: 0,
      quote: {
        samples: 1_000,
        p50Micros: 10,
        p95Micros: 20,
        p99Micros: 30,
        minMicros: 5,
        maxMicros: 40,
      },
      noRoute: null,
      throughputPerSecond: 100,
    })),
  } satisfies BenchmarkSummary;
  assert.match(renderMarkdown(summary), /not historical orders/u);
  assert.match(renderMarkdown(summary), /fresh exact replay/u);
  assert.doesNotMatch(renderMarkdown(summary), /amountBucket:|topology:/u);
  assert.doesNotMatch(
    `${renderMarkdown(summary)}\n${renderQualityByEffortSvg(summary)}`,
    /bounded-reference|quality versus work|Work p50\/p95|Additional work|data-work=/u,
  );
  assert.match(renderQualityByEffortSvg(summary), /Effort profile \(categorical\)/u);
  assert.match(renderQualityByEffortSvg(summary), /lower is better/u);
  assert.match(renderRegretDistributionSvg(summary), /higher is better/u);
});
