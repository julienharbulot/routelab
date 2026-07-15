import {
  BENCHMARK_CASE_SET_ID,
  BENCHMARK_SAMPLES,
  BENCHMARK_WARMUPS,
  benchmarkProfileConfiguration,
  LATENCY_COMBINATIONS,
} from './config.ts';
import { loadPortfolioCases } from './cases.ts';
import { runLatency } from './latency.ts';
import { aggregateQuality, compareNumerical, runQuality } from './quality.ts';
import { writeReport } from './report.ts';
import type { BenchmarkReport } from './types.ts';

export async function runPortfolioBenchmark(root = process.cwd()): Promise<BenchmarkReport> {
  const cases = await loadPortfolioCases(root);
  const quality = runQuality(cases);
  const latency = await runLatency(cases, root);
  const report: BenchmarkReport = Object.freeze({
    schemaVersion: 'routelab.portfolio-benchmark.v1',
    caseSetId: BENCHMARK_CASE_SET_ID,
    configuration: Object.freeze({
      caseCount: cases.length,
      warmups: BENCHMARK_WARMUPS,
      samples: BENCHMARK_SAMPLES,
      profiles: benchmarkProfileConfiguration(),
      latencyCombinations: LATENCY_COMBINATIONS,
    }),
    environment: latency.environment,
    cases: Object.freeze(cases.map((value) => Object.freeze({
      caseId: value.caseId,
      purpose: value.purpose,
      snapshotId: value.snapshot.snapshotId,
      snapshotChecksum: value.snapshot.snapshotChecksum,
      assetIn: value.request.assetIn,
      assetOut: value.request.assetOut,
      amountIn: value.request.amountIn.toString(10),
      maxHops: value.request.maxHops ?? 3,
      maxRoutes: value.request.maxRoutes ?? 3,
      expectedOutcome: value.expectedOutcome,
    }))),
    quality,
    aggregates: aggregateQuality(quality),
    numericalComparisons: compareNumerical(quality),
    latency: latency.rows,
  });
  await writeReport(report, root);
  return report;
}
