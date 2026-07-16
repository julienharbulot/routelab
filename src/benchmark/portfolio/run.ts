import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { captureEvidenceSource } from '../../evidence/source-identity.ts';
import {
  BENCHMARK_SAMPLES,
  BENCHMARK_WARMUPS,
  benchmarkProfileConfiguration,
  LATENCY_COMBINATIONS,
  QUALITY_MODES,
} from './config.ts';
import { loadHistoricalPortfolioCases } from './cases.ts';
import { runLatency } from './latency.ts';
import {
  aggregateQuality,
  canonicalDigest,
  compareNumerical,
  runQuality,
} from './quality.ts';
import { writeReport } from './report.ts';
import type { BenchmarkSummary } from './types.ts';

export async function runPortfolioBenchmark(root = process.cwd()): Promise<BenchmarkSummary> {
  const evidenceSource = captureEvidenceSource(root);
  const loaded = await loadHistoricalPortfolioCases(root);
  const qualityRows = runQuality(loaded.cases);
  const aggregates = aggregateQuality(qualityRows);
  const numericalComparisons = compareNumerical(qualityRows);
  const referenceBeatenRows = qualityRows.filter((value) => value.referenceBeaten);
  const latency = await runLatency(loaded.cases, root);
  const requestOrder = loaded.cases.map((value) => ({
    caseId: value.caseId,
    amountBucket: value.amountBucket,
    topology: value.topology,
    assetIn: value.request.assetIn,
    assetOut: value.request.assetOut,
    amountIn: value.request.amountIn.toString(10),
  }));
  const summary: BenchmarkSummary = Object.freeze({
    schemaVersion: 'routelab.portfolio-benchmark-summary.v2',
    evidenceSource,
    corpus: loaded.corpus,
    configuration: Object.freeze({
      maxHops: 2,
      maxRoutes: 2,
      warmupsPerLatencyLane: BENCHMARK_WARMUPS,
      samplesPerLatencyLane: BENCHMARK_SAMPLES,
      profiles: benchmarkProfileConfiguration(),
      qualityModes: QUALITY_MODES,
      latencyCombinations: LATENCY_COMBINATIONS,
      comparisonRule: 'best-observed-across-fixed-modes-including-bounded-reference',
    }),
    digests: Object.freeze({
      requestOrderSha256: canonicalDigest(requestOrder),
      qualityRowsSha256: canonicalDigest(qualityRows),
      qualityAggregatesSha256: canonicalDigest(aggregates),
      numericalComparisonsSha256: canonicalDigest(numericalComparisons),
    }),
    quality: Object.freeze({
      rowCount: qualityRows.length,
      exactReplaySuccessCount: qualityRows.filter((value) => value.exactReplayPassed).length,
      referenceBeatenCount: referenceBeatenRows.length,
      referenceBeatenRequestCount: new Set(
        referenceBeatenRows.map((value) => value.caseId),
      ).size,
      referenceBeatenByMode: Object.freeze(QUALITY_MODES.flatMap((mode) => {
        const count = referenceBeatenRows.filter((value) =>
          value.strategy === mode.strategy && value.profile === mode.profile
        ).length;
        return count === 0 ? [] : [Object.freeze({ ...mode, count })];
      })),
      aggregates,
      numericalComparisons,
    }),
    environment: latency.environment,
    latency: latency.rows,
  });
  const rawDirectory = path.join(root, 'reports', 'raw');
  await mkdir(rawDirectory, { recursive: true });
  await writeFile(path.join(rawDirectory, 'portfolio-v2-rows.json'), `${JSON.stringify({
    schemaVersion: 'routelab.portfolio-benchmark-quality-rows.v2',
    digest: summary.digests.qualityRowsSha256,
    rows: qualityRows,
  })}\n`);
  await writeReport(summary, root);
  return summary;
}
