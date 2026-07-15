import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { replayExactInputSplit } from '../../replay/exact-input-split/index.ts';
import {
  BENCHMARK_SAMPLES,
  BENCHMARK_WARMUPS,
  benchmarkProfileConfiguration,
  LATENCY_COMBINATIONS,
} from './config.ts';
import { loadPortfolioCases } from './cases.ts';
import { aggregateQuality, compareNumerical, runQuality } from './quality.ts';
import type { BenchmarkReport, HttpLoadRow, PortfolioCase, QualityRow } from './types.ts';

const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const SIGNED_DECIMAL = /^(?:0|-?[1-9][0-9]*)$/u;

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function verifyReplay(input: PortfolioCase, row: QualityRow, issues: string[]): void {
  if (!DECIMAL.test(row.amountIn) || row.amountIn !== input.request.amountIn.toString(10)) {
    issues.push(`${row.caseId}/${row.strategy}/${row.profile}: noncanonical or mismatched input.`);
  }
  if (row.outcome === 'no-route') {
    if (row.amountOut !== null || row.routes.length !== 0) {
      issues.push(`${row.caseId}/${row.strategy}/${row.profile}: malformed no-route row.`);
    }
    return;
  }
  if (row.amountOut === null || !DECIMAL.test(row.amountOut)) {
    issues.push(`${row.caseId}/${row.strategy}/${row.profile}: noncanonical output.`);
    return;
  }
  if (
    row.improvementOverBestSingle !== null &&
    !SIGNED_DECIMAL.test(row.improvementOverBestSingle)
  ) {
    issues.push(`${row.caseId}/${row.strategy}/${row.profile}: invalid improvement.`);
  }
  let allocation = 0n;
  for (const route of row.routes) {
    if (!DECIMAL.test(route.allocation) || !DECIMAL.test(route.amountOut)) {
      issues.push(`${row.caseId}/${row.strategy}/${row.profile}: noncanonical route exact value.`);
      return;
    }
    allocation += BigInt(route.allocation);
  }
  if (allocation !== input.request.amountIn) {
    issues.push(`${row.caseId}/${row.strategy}/${row.profile}: allocations do not sum to input.`);
    return;
  }
  const replay = replayExactInputSplit(input.snapshot, {
    snapshotId: input.snapshot.snapshotId,
    snapshotChecksum: input.snapshot.snapshotChecksum,
    assetIn: input.request.assetIn,
    assetOut: input.request.assetOut,
    amountIn: input.request.amountIn,
    legs: row.routes.map((route) => ({
      allocation: BigInt(route.allocation),
      route: route.hops,
    })),
  });
  if (!replay.ok || replay.value.amountOut.toString(10) !== row.amountOut) {
    issues.push(`${row.caseId}/${row.strategy}/${row.profile}: fresh exact replay failed.`);
    return;
  }
  if (replay.value.legs.some((leg, index) =>
    leg.receipt.amountOut.toString(10) !== row.routes[index]?.amountOut
  )) {
    issues.push(`${row.caseId}/${row.strategy}/${row.profile}: route output mismatch.`);
  }
}

export async function verifyPortfolioBenchmark(root = process.cwd()): Promise<readonly string[]> {
  const issues: string[] = [];
  const reportPath = path.join(root, 'reports', 'portfolio-v1.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as BenchmarkReport;
  const cases = await loadPortfolioCases(root);
  if (report.schemaVersion !== 'routelab.portfolio-benchmark.v1') issues.push('Unexpected schema.');
  if (report.caseSetId !== 'portfolio-v1') issues.push('Unexpected case set.');
  if (report.configuration.caseCount !== cases.length) issues.push('Case count mismatch.');
  if (report.configuration.warmups !== BENCHMARK_WARMUPS) issues.push('Warmup count mismatch.');
  if (report.configuration.samples !== BENCHMARK_SAMPLES) issues.push('Sample count mismatch.');
  if (!same(report.configuration.profiles, benchmarkProfileConfiguration())) {
    issues.push('Profile configuration mismatch.');
  }
  if (!same(report.configuration.latencyCombinations, LATENCY_COMBINATIONS)) {
    issues.push('Latency combination mismatch.');
  }
  for (const input of cases) {
    const metadata = report.cases.find(({ caseId }) => caseId === input.caseId);
    if (
      metadata === undefined ||
      metadata.snapshotId !== input.snapshot.snapshotId ||
      metadata.snapshotChecksum !== input.snapshot.snapshotChecksum ||
      metadata.assetIn !== input.request.assetIn ||
      metadata.assetOut !== input.request.assetOut ||
      metadata.amountIn !== input.request.amountIn.toString(10) ||
      metadata.maxHops !== input.request.maxHops ||
      metadata.maxRoutes !== input.request.maxRoutes ||
      metadata.purpose !== input.purpose ||
      metadata.expectedOutcome !== input.expectedOutcome
    ) {
      issues.push(`${input.caseId}: case metadata mismatch.`);
    }
  }
  const expectedRows = cases.length * 10;
  if (report.quality.length !== expectedRows) issues.push('Quality row count mismatch.');
  for (const row of report.quality) {
    const input = cases.find(({ caseId }) => caseId === row.caseId);
    if (input === undefined) issues.push(`${row.caseId}: unknown quality case.`);
    else verifyReplay(input, row, issues);
  }
  if (!same(report.aggregates, aggregateQuality(report.quality))) {
    issues.push('Quality aggregates do not reconcile.');
  }
  if (!same(report.numericalComparisons, compareNumerical(report.quality))) {
    issues.push('Numerical comparisons do not reconcile.');
  }
  const regenerated = runQuality(cases);
  if (!same(report.quality, regenerated)) {
    issues.push('Deterministic quality rows or semantic fingerprints changed.');
  }
  for (const expected of LATENCY_COMBINATIONS) {
    const row = report.latency.find((value) =>
      value.strategy === expected.strategy && value.profile === expected.profile
    );
    if (
      row === undefined ||
      row.samples < 100 ||
      row.warmups < 10 ||
      row.successful + row.expectedNoRoute !== row.samples
    ) {
      issues.push(`${expected.strategy}/${expected.profile}: insufficient latency evidence.`);
    }
  }
  if (report.latency.length !== LATENCY_COMBINATIONS.length) {
    issues.push('Latency row count mismatch.');
  }
  try {
    const trackedRaw = execFileSync('git', ['ls-files', 'reports/raw', 'reports/tmp'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    if (trackedRaw.length !== 0) issues.push('Raw benchmark observations are tracked.');
  } catch {
    issues.push('Could not inspect tracked raw benchmark observations.');
  }
  for (const file of ['portfolio-v1.json', 'portfolio-v1.md', 'quality-vs-budget.svg']) {
    const fileStat = await stat(path.join(root, 'reports', file));
    if (fileStat.size >= 1_000_000) issues.push(`${file}: committed result exceeds 1 MB.`);
  }
  try {
    const load = JSON.parse(await readFile(path.join(root, 'reports', 'load-v1.json'), 'utf8')) as {
      readonly configuration?: { readonly requestsPerConcurrency?: number };
      readonly rows?: readonly HttpLoadRow[];
    };
    if (
      load.configuration?.requestsPerConcurrency === undefined ||
      load.configuration.requestsPerConcurrency < 100 ||
      load.rows === undefined ||
      !same(load.rows.map(({ concurrency }) => concurrency), [1, 4, 16])
    ) {
      issues.push('HTTP load configuration mismatch.');
    } else {
      for (const row of load.rows) {
        if (
          row.requests < 100 ||
          row.completed + row.failed + row.timedOut !== row.requests ||
          row.completed < 100 ||
          row.p99Micros === null ||
          row.throughputPerSecond <= 0 ||
          row.eventLoopDelayMaxMicros < 0 ||
          row.peakRssBytes < row.initialRssBytes
        ) {
          issues.push(`HTTP load evidence is invalid at concurrency ${row.concurrency}.`);
        }
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      issues.push('Could not verify HTTP load evidence.');
    }
  }
  return Object.freeze(issues);
}
