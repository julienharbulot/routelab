import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { replayExactInputSplit } from '../../replay/exact-input-split/index.ts';
import {
  BENCHMARK_SAMPLES,
  BENCHMARK_WARMUPS,
  benchmarkProfileConfiguration,
  LATENCY_COMBINATIONS,
  QUALITY_MODES,
} from './config.ts';
import { loadHistoricalPortfolioCases } from './cases.ts';
import {
  aggregateQuality,
  canonicalDigest,
  compareNumerical,
  runQuality,
} from './quality.ts';
import {
  renderMarkdown,
  renderQualityVsWorkSvg,
  renderRegretDistributionSvg,
} from './report.ts';
import type { BenchmarkSummary, PortfolioCase, QualityRow } from './types.ts';

const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const COMMITTED_FILES = [
  'portfolio-v2.md',
  'portfolio-v2-summary.json',
  'quality-vs-work.svg',
  'historical-regret-distribution.svg',
] as const;

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function verifyReplay(input: PortfolioCase, row: QualityRow, issues: string[]): void {
  const label = `${row.caseId}/${row.strategy}/${row.profile}`;
  if (!DECIMAL.test(row.amountIn) || row.amountIn !== input.request.amountIn.toString(10)) {
    issues.push(`${label}: noncanonical or mismatched input.`);
  }
  if (row.outcome === 'no-route') {
    if (
      row.amountOut !== null
      || row.routes.length !== 0
      || row.exactReplayPassed
      || row.planFingerprint !== null
    ) {
      issues.push(`${label}: malformed no-route row.`);
    }
    return;
  }
  if (row.amountOut === null || !DECIMAL.test(row.amountOut)) {
    issues.push(`${label}: noncanonical output.`);
    return;
  }
  let allocation = 0n;
  for (const route of row.routes) {
    if (!DECIMAL.test(route.allocation) || !DECIMAL.test(route.amountOut)) {
      issues.push(`${label}: noncanonical route exact value.`);
      return;
    }
    allocation += BigInt(route.allocation);
  }
  if (allocation !== input.request.amountIn) {
    issues.push(`${label}: allocations do not sum exactly to the input.`);
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
    issues.push(`${label}: fresh exact replay failed.`);
    return;
  }
  if (!row.exactReplayPassed) issues.push(`${label}: replay success flag is false.`);
  if (replay.value.legs.some((leg, index) =>
    leg.receipt.amountOut.toString(10) !== row.routes[index]?.amountOut
  )) {
    issues.push(`${label}: route output differs from fresh replay.`);
  }
}

function verifyComparisonRule(rows: readonly QualityRow[], issues: string[]): void {
  for (const caseId of new Set(rows.map((value) => value.caseId))) {
    const selected = rows.filter((value) => value.caseId === caseId);
    if (selected.length !== QUALITY_MODES.length) {
      issues.push(`${caseId}: fixed-mode row count mismatch.`);
      continue;
    }
    const quoted = selected.filter((value) => value.amountOut !== null);
    const maximum = quoted.reduce<bigint | null>((current, value) => {
      const output = BigInt(value.amountOut as string);
      return current === null || output > current ? output : current;
    }, null);
    const reference = selected.find((value) =>
      value.strategy === 'bounded-reference' && value.profile === 'reference'
    );
    const referenceOutput = reference?.amountOut ?? null;
    for (const row of selected) {
      if (row.comparisonAmountOut !== maximum?.toString(10)) {
        issues.push(`${caseId}: comparison output is not the best observed fixed-mode result.`);
        break;
      }
      if (row.referenceAmountOut !== referenceOutput) {
        issues.push(`${caseId}: bounded reference output does not reconcile.`);
        break;
      }
      if (row.amountOut !== null) {
        const output = BigInt(row.amountOut);
        if (row.exactReferenceEquality !== (row.amountOut === referenceOutput)) {
          issues.push(`${caseId}: reference equality flag does not reconcile.`);
          break;
        }
        if (row.referenceBeaten !== (
          referenceOutput !== null && output > BigInt(referenceOutput)
        )) {
          issues.push(`${caseId}: reference-beaten flag does not reconcile.`);
          break;
        }
      }
    }
  }
}

async function readText(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8');
}

function occurrenceCount(value: string, pattern: RegExp): number {
  return [...value.matchAll(pattern)].length;
}

export async function verifyPortfolioBenchmark(root = process.cwd()): Promise<readonly string[]> {
  const issues: string[] = [];
  let summary: BenchmarkSummary;
  try {
    summary = JSON.parse(await readText(
      path.join(root, 'reports', 'portfolio-v2-summary.json'),
    )) as BenchmarkSummary;
  } catch {
    return Object.freeze(['Could not read reports/portfolio-v2-summary.json.']);
  }
  const loaded = await loadHistoricalPortfolioCases(root);
  if (summary.schemaVersion !== 'routelab.portfolio-benchmark-summary.v2') {
    issues.push('Unexpected benchmark summary schema.');
  }
  if (!same(summary.corpus, loaded.corpus)) issues.push('Corpus identity or counts changed.');
  if (
    summary.configuration.maxHops !== 2
    || summary.configuration.maxRoutes !== 2
  ) issues.push('Route restrictions changed.');
  if (summary.configuration.warmupsPerLatencyLane !== BENCHMARK_WARMUPS) {
    issues.push('Latency warmup configuration changed.');
  }
  if (summary.configuration.samplesPerLatencyLane !== BENCHMARK_SAMPLES) {
    issues.push('Latency sample configuration changed.');
  }
  if (!same(summary.configuration.profiles, benchmarkProfileConfiguration())) {
    issues.push('Effort/reference profiles changed.');
  }
  if (!same(summary.configuration.qualityModes, QUALITY_MODES)) {
    issues.push('Quality mode list changed.');
  }
  if (!same(summary.configuration.latencyCombinations, LATENCY_COMBINATIONS)) {
    issues.push('Latency combination list changed.');
  }
  if (
    summary.configuration.comparisonRule
    !== 'best-observed-across-fixed-modes-including-bounded-reference'
  ) issues.push('Comparison rule changed.');

  const requestOrder = loaded.cases.map((value) => ({
    caseId: value.caseId,
    amountBucket: value.amountBucket,
    topology: value.topology,
    assetIn: value.request.assetIn,
    assetOut: value.request.assetOut,
    amountIn: value.request.amountIn.toString(10),
  }));
  if (summary.digests.requestOrderSha256 !== canonicalDigest(requestOrder)) {
    issues.push('Request ordering digest changed.');
  }

  const regenerated = runQuality(loaded.cases);
  if (regenerated.length !== loaded.cases.length * QUALITY_MODES.length) {
    issues.push('Quality row count does not cover every request/mode combination.');
  }
  const casesById = new Map(loaded.cases.map((value) => [value.caseId, value]));
  for (const row of regenerated) {
    const input = casesById.get(row.caseId);
    if (input === undefined) issues.push(`${row.caseId}: unknown quality request.`);
    else verifyReplay(input, row, issues);
  }
  verifyComparisonRule(regenerated, issues);
  const aggregates = aggregateQuality(regenerated);
  const numericalComparisons = compareNumerical(regenerated);
  if (summary.digests.qualityRowsSha256 !== canonicalDigest(regenerated)) {
    issues.push('Deterministic quality row digest changed.');
  }
  if (
    summary.digests.qualityAggregatesSha256 !== canonicalDigest(aggregates)
    || !same(summary.quality.aggregates, aggregates)
  ) issues.push('Quality aggregates do not reconcile.');
  if (
    summary.digests.numericalComparisonsSha256 !== canonicalDigest(numericalComparisons)
    || !same(summary.quality.numericalComparisons, numericalComparisons)
  ) issues.push('Numerical/greedy comparisons do not reconcile.');
  if (summary.quality.rowCount !== regenerated.length) issues.push('Quality row count mismatch.');
  if (
    summary.quality.exactReplaySuccessCount
    !== regenerated.filter((value) => value.exactReplayPassed).length
  ) issues.push('Fresh replay success count mismatch.');
  if (
    summary.quality.referenceBeatenCount
    !== regenerated.filter((value) => value.referenceBeaten).length
  ) issues.push('Reference-beaten count mismatch.');
  const referenceBeatenRows = regenerated.filter((value) => value.referenceBeaten);
  if (
    summary.quality.referenceBeatenRequestCount
    !== new Set(referenceBeatenRows.map((value) => value.caseId)).size
  ) issues.push('Reference-beaten request count mismatch.');
  const referenceBeatenByMode = QUALITY_MODES.flatMap((mode) => {
    const count = referenceBeatenRows.filter((value) =>
      value.strategy === mode.strategy && value.profile === mode.profile
    ).length;
    return count === 0 ? [] : [{ ...mode, count }];
  });
  if (!same(summary.quality.referenceBeatenByMode, referenceBeatenByMode)) {
    issues.push('Reference-beaten mode investigation does not reconcile.');
  }

  for (const expected of LATENCY_COMBINATIONS) {
    const row = summary.latency.find((value) =>
      value.strategy === expected.strategy && value.profile === expected.profile
    );
    if (
      row === undefined
      || row.samples < 1_000
      || row.warmups < 50
      || row.quoteCount + row.noRouteCount !== row.samples
      || (row.quoteCount > 0 && row.quote?.samples !== row.quoteCount)
      || (row.noRouteCount > 0 && row.noRoute?.samples !== row.noRouteCount)
      || (row.quoteCount >= 1_000 && row.quote?.p99Micros === null)
      || (row.noRouteCount >= 1_000 && row.noRoute?.p99Micros === null)
    ) issues.push(`${expected.strategy}/${expected.profile}: insufficient latency evidence.`);
  }
  if (summary.latency.length !== LATENCY_COMBINATIONS.length) {
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

  const reports = path.join(root, 'reports');
  for (const file of COMMITTED_FILES) {
    try {
      const fileStat = await stat(path.join(reports, file));
      if (fileStat.size >= 250 * 1_024) {
        issues.push(`${file}: committed result is not below 250 KiB.`);
      }
    } catch {
      issues.push(`${file}: committed result is missing.`);
    }
  }
  try {
    const summaryText = await readText(path.join(reports, 'portfolio-v2-summary.json'));
    const markdown = await readText(path.join(reports, 'portfolio-v2.md'));
    const qualitySvg = await readText(path.join(reports, 'quality-vs-work.svg'));
    const distributionSvg = await readText(
      path.join(reports, 'historical-regret-distribution.svg'),
    );
    if (summaryText !== `${JSON.stringify(summary, null, 2)}\n`) {
      issues.push('Summary JSON is not in deterministic canonical presentation form.');
    }
    if (markdown !== renderMarkdown(summary)) issues.push('Markdown rendering changed.');
    if (qualitySvg !== renderQualityVsWorkSvg(summary)) {
      issues.push('Quality-versus-work SVG rendering changed.');
    }
    if (distributionSvg !== renderRegretDistributionSvg(summary)) {
      issues.push('Regret-distribution SVG rendering changed.');
    }
    if (
      !qualitySvg.includes('<title id="quality-title">Deterministic quality versus work</title>')
      || !qualitySvg.includes('Deterministic work (p50 counters)')
      || !qualitySvg.includes('p95 regret (ppm; lower is better)')
      || occurrenceCount(qualitySvg, /data-profile="(?:fast|balanced|thorough)"/gu) !== 6
      || !qualitySvg.includes('data-series="greedy-split"')
      || !qualitySvg.includes('data-series="numerical-split"')
    ) issues.push('Quality-versus-work chart title, axes, or input series mismatch.');
    for (const strategy of ['greedy-split', 'numerical-split'] as const) {
      for (const profile of ['fast', 'balanced', 'thorough'] as const) {
        const aggregate = summary.quality.aggregates.find((value) =>
          value.dimension === 'overall'
          && value.strategy === strategy
          && value.profile === profile
        );
        if (
          aggregate === undefined
          || !qualitySvg.includes(
            `data-profile="${profile}" data-work="${aggregate.workP50 ?? 0}" data-regret-ppm="${aggregate.regretP95Ppm ?? 0}"`,
          )
        ) issues.push(`${strategy}/${profile}: quality chart input point mismatch.`);
      }
    }
    const plottedRegret = summary.quality.aggregates.filter((value) =>
      value.dimension === 'overall'
      && (value.strategy === 'greedy-split' || value.strategy === 'numerical-split')
    ).map((value) => value.regretP95Ppm ?? 0);
    if (new Set(plottedRegret).size < 2) {
      issues.push('Quality-versus-work chart uses a degenerate quality metric.');
    }
    if (
      !distributionSvg.includes(
        '<title id="distribution-title">Historical-snapshot-derived regret distribution</title>',
      )
      || !distributionSvg.includes('Share of quoted requests (higher is better)')
      || occurrenceCount(distributionSvg, /data-threshold="(?:exact|1 bps|10 bps|100 bps)"/gu)
        !== QUALITY_MODES.length * 4
    ) issues.push('Regret-distribution chart title, axes, or input series mismatch.');
  } catch {
    issues.push('Could not compare deterministic report renderings.');
  }
  return Object.freeze(issues);
}
