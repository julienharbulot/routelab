import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  BenchmarkSummary,
  LatencyDistribution,
  NumericalComparison,
  QualityAggregate,
} from './types.ts';

function mode(value: { readonly strategy: string; readonly profile: string }): string {
  return value.strategy === 'best-single' || value.strategy === 'large-budget-comparison'
    ? value.strategy
    : `${value.strategy}/${value.profile}`;
}

function percent(value: number | null): string {
  return value === null ? 'n/a' : `${(value / 10_000).toFixed(2)}%`;
}

function qualityTable(values: readonly QualityAggregate[]): string {
  const rows = values.map((value) =>
    `| ${value.dimension}:${value.group} | ${mode(value)} | ${value.requestCount} | ${value.quoteCount}/${value.noRouteCount} | ${value.exactReplaySuccessCount} | ${value.exactLargeBudgetEqualityCount} | ${value.regretP50Ppm ?? 'n/a'}/${value.regretP90Ppm ?? 'n/a'}/${value.regretP95Ppm ?? 'n/a'}/${value.worstRegretPpm ?? 'n/a'} | ${percent(value.withinExactRatePpm)}/${percent(value.within1BpsRatePpm)}/${percent(value.within10BpsRatePpm)}/${percent(value.within100BpsRatePpm)} | ${percent(value.bestSingleImprovementRatePpm)}/${percent(value.splitSelectedRatePpm)}/${percent(value.splitImprovementRatePpm)} | ${value.medianImprovementPpm ?? 'n/a'}/${value.maximumImprovementPpm ?? 'n/a'} | ${counterSummary(value)} | ${value.authorizationRejectionCount} | ${value.numericalProposalAttemptedCount}/${value.numericalProposalConvergedCount}/${value.numericalProposalFailedCount} | ${value.allProposalsConvergedRequestCount}/${value.numericalRequestCount} | ${value.exactNumericalImprovementSelectedCount} | ${value.largeBudgetBeatenCount} |`,
  );
  return [
    '| Scope | Mode | Requests | Quote/no-route | Fresh replay | = large budget | Regret p50/p90/p95/worst (ppm) | Within exact/1/10/100 bps | Improve/split/split-improve | Improvement median/max (ppm) | Counter p50/p95 | Auth rejects | Proposals attempted/converged/failed | All converged/numerical requests | Exact numerical improvements | Large budget beaten |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|',
    ...rows,
  ].join('\n');
}

function counterSummary(value: QualityAggregate): string {
  return Object.entries(value.counterPercentiles).map(([name, counters]) =>
    `${name}:${counters.p50 ?? 'n/a'}/${counters.p95 ?? 'n/a'}`
  ).join(', ');
}

function numericalTable(values: readonly NumericalComparison[]): string {
  return [
    '| Scope | Effort | Requests | Beats/ties/loses greedy | Positive improvement median/max (ppm) |',
    '|---|---:|---:|---:|---:|',
    ...values.map((value) =>
      `| ${value.dimension}:${value.group} | ${value.profile} | ${value.requestCount} | ${value.beatsGreedy}/${value.tiesGreedy}/${value.losesGreedy} | ${value.medianPositiveImprovementPpm ?? 'n/a'}/${value.maximumPositiveImprovementPpm ?? 'n/a'} |`
    ),
  ].join('\n');
}

function latencyDistribution(value: LatencyDistribution | null): string {
  if (value === null) return 'n/a';
  return `${value.samples}; ${value.p50Micros}/${value.p95Micros}/${value.p99Micros ?? 'n/a'}; ${value.minMicros}/${value.maxMicros}`;
}

function latencyTable(summary: BenchmarkSummary): string {
  return [
    '| Mode | Warmups | Samples | Quote samples; p50/p95/p99 µs; min/max | No-route samples; p50/p95/p99 µs; min/max | Calls/s |',
    '|---|---:|---:|---:|---:|---:|',
    ...summary.latency.map((value) =>
      `| ${mode(value)} | ${value.warmups} | ${value.samples} | ${latencyDistribution(value.quote)} | ${latencyDistribution(value.noRoute)} | ${value.throughputPerSecond.toFixed(1)} |`
    ),
  ].join('\n');
}

function overall(
  summary: BenchmarkSummary,
  strategy: QualityAggregate['strategy'],
  profile: QualityAggregate['profile'],
): QualityAggregate {
  const value = summary.quality.aggregates.find((candidate) =>
    candidate.dimension === 'overall'
    && candidate.strategy === strategy
    && candidate.profile === profile
  );
  if (value === undefined) throw new Error(`Missing overall aggregate for ${strategy}/${profile}.`);
  return value;
}

export function renderMarkdown(summary: BenchmarkSummary): string {
  const fastComparison = summary.quality.numericalComparisons.find((value) =>
    value.dimension === 'overall' && value.profile === 'fast'
  );
  const largeBudgetNote = summary.quality.largeBudgetBeatenCount === 0
    ? 'No fixed public mode beat the large-budget comparison.'
    : `${summary.quality.largeBudgetBeatenCount} fixed-mode results across ${summary.quality.largeBudgetBeatenRequestCount} requests beat the large-budget comparison. The 128-part comparison allocation grid and public effort grids are not nested, so a larger grid does not prove dominance; regret therefore uses the best exact result observed across every declared fixed mode.`;
  return [
    '# RouteLab historical-snapshot-derived benchmark v2',
    '',
    `All ${summary.corpus.requestCount} requests are synthetic exact-input requests derived from one historical pool-reserve snapshot: 132 ordered asset pairs across three deterministic reserve-fraction buckets. They are not historical orders, equal-value trades, or representative demand.`,
    '',
    `Every one of the ${summary.quality.exactReplaySuccessCount} returned mode/request plans passed a fresh exact replay. ${largeBudgetNote}`,
    '',
    `Evidence source: ${summary.evidenceSource.revision}; ${summary.evidenceSource.pathSet.schemaVersion} (${summary.evidenceSource.pathSet.paths.length} named paths); ${summary.evidenceSource.digest}.`,
    '',
    fastComparison === undefined
      ? 'No fast numerical/greedy comparison was available.'
      : `At fast effort, numerical split beat/tied/lost greedy split on ${fastComparison.beatsGreedy}/${fastComparison.tiesGreedy}/${fastComparison.losesGreedy} requests.`,
    '',
    '## Deterministic quality',
    '',
    'Regret uses integer parts per million (ppm) against the best observed exact output across all declared fixed modes. Equality with the large-budget comparison is reported separately. Displayed bps are derived as ppm / 100. Lower regret is better. Improvement ppm is relative to best-single output, which makes results comparable across token decimal domains; median and maximum improvement cover requests that improved.',
    '',
    qualityTable(summary.quality.aggregates.filter((value) => value.dimension === 'overall')),
    '',
    '## Numerical versus greedy',
    '',
    numericalTable(summary.quality.numericalComparisons.filter((value) => value.dimension === 'overall')),
    '',
    '## In-process latency',
    '',
    latencyTable(summary),
    '',
    'Fast effort is measured for all strategies, with balanced effort also measured for greedy and numerical split. Deterministic quality covers every effort. The corpus is connected with diameter two, so it contains no expected no-route request and the no-route latency distributions are explicitly `n/a`.',
    '',
    '![Deterministic quality by effort](quality-by-effort.svg)',
    '',
    '![Historical-snapshot-derived regret distribution](historical-regret-distribution.svg)',
    '',
    '## Method and limitations',
    '',
    `The corpus is ${summary.corpus.corpusId} (${summary.corpus.corpusDigest}), bound to snapshot ${summary.corpus.snapshotId} / ${summary.corpus.snapshotChecksum}. Every request uses maxHops=2 and maxRoutes=2. Quality is deterministic; timing uses process.hrtime.bigint(), ${summary.configuration.warmupsPerLatencyLane} warmups and ${summary.configuration.samplesPerLatencyLane} measured calls per lane with deterministic rotation through the full corpus. Raw quality rows and latency observations are ignored by Git.`,
    '',
    'The large-budget mode uses one frozen, larger bounded profile with the same route restrictions. It is a practical comparison, not a global optimum. The benchmark does not measure live acquisition, gas, transaction submission, execution, or settlement, and it does not support statistical-significance claims.',
    '',
    `Canonical digests: request order ${summary.digests.requestOrderSha256}; quality rows ${summary.digests.qualityRowsSha256}; aggregates ${summary.digests.qualityAggregatesSha256}; numerical comparisons ${summary.digests.numericalComparisonsSha256}.`,
    '',
    `Environment: ${summary.environment.node}; ${summary.environment.platform}/${summary.environment.arch}; ${summary.environment.cpu}; source revision ${summary.evidenceSource.revision}; observed ${summary.environment.observedAt}.`,
    '',
  ].join('\n');
}

function scale(value: number, maximum: number, start: number, span: number): number {
  return maximum === 0 ? start : start + value / maximum * span;
}

export function renderQualityByEffortSvg(summary: BenchmarkSummary): string {
  const series = (['greedy-split', 'numerical-split'] as const).map((strategy) => ({
    strategy,
    points: (['fast', 'balanced', 'thorough'] as const).map((profile) => {
      const value = overall(summary, strategy, profile);
      return { profile, regret: value.regretP95Ppm ?? 0 };
    }),
  }));
  const all = series.flatMap((value) => value.points);
  const maxRegret = Math.max(...all.map((value) => value.regret), 1);
  const colors = ['#2356a8', '#c14924'];
  const rendered = series.map((value, seriesIndex) => {
    const points = value.points.map((point, index) => {
      const x = 170 + index * 230;
      const y = 310 - scale(point.regret, maxRegret, 0, 225);
      return { ...point, x, y };
    });
    return `<g data-series="${value.strategy}" fill="none" stroke="${colors[seriesIndex]}"><polyline stroke-width="3" points="${points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')}"/>${points.map((point) => `<circle data-profile="${point.profile}" data-regret-ppm="${point.regret}" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="5" fill="${colors[seriesIndex]}"/>`).join('')}<text x="${seriesIndex === 0 ? 100 : 330}" y="50" fill="${colors[seriesIndex]}" stroke="none" font-size="14">${value.strategy}</text></g>`;
  }).join('');
  const labels = ['fast', 'balanced', 'thorough'].map((profile, index) =>
    `<text x="${145 + index * 230}" y="350" font-size="12">${profile}</text>`
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="390" viewBox="0 0 760 390" role="img" aria-labelledby="quality-title quality-desc"><title id="quality-title">Deterministic quality by effort</title><desc id="quality-desc">Greedy and numerical split p95 regret across the categorical fast, balanced, and thorough effort profiles. Lower regret is better.</desc><rect width="760" height="390" fill="white"/><line x1="75" y1="320" x2="690" y2="320" stroke="#333"/><line x1="75" y1="75" x2="75" y2="320" stroke="#333"/>${labels}<text x="305" y="380" font-size="14">Effort profile (categorical)</text><text x="18" y="270" font-size="14" transform="rotate(-90 18 270)">p95 regret (ppm; lower is better)</text>${rendered}</svg>\n`;
}

export function renderRegretDistributionSvg(summary: BenchmarkSummary): string {
  const overallValues = summary.quality.aggregates.filter((value) => value.dimension === 'overall');
  const thresholds = [
    { label: 'exact', key: 'withinExactRatePpm' as const, x: 110 },
    { label: '1 bps', key: 'within1BpsRatePpm' as const, x: 270 },
    { label: '10 bps', key: 'within10BpsRatePpm' as const, x: 430 },
    { label: '100 bps', key: 'within100BpsRatePpm' as const, x: 590 },
  ];
  const colors = ['#1b4f9c', '#2d7d46', '#c16a16', '#8d3d9c', '#16858d', '#b33b53', '#666', '#111'];
  const rendered = overallValues.map((value, index) => {
    const points = thresholds.map((threshold) => {
      const rate = value[threshold.key] ?? 0;
      return { ...threshold, rate, y: 315 - rate / 1_000_000 * 230 };
    });
    return `<g data-series="${mode(value)}" fill="none" stroke="${colors[index]}"><polyline points="${points.map((point) => `${point.x},${point.y.toFixed(1)}`).join(' ')}"/>${points.map((point) => `<circle data-threshold="${point.label}" data-rate-ppm="${point.rate}" cx="${point.x}" cy="${point.y.toFixed(1)}" r="3" fill="${colors[index]}"/>`).join('')}<text x="${90 + (index % 4) * 165}" y="${42 + Math.floor(index / 4) * 18}" fill="${colors[index]}" stroke="none" font-size="11">${mode(value)}</text></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="390" viewBox="0 0 760 390" role="img" aria-labelledby="distribution-title distribution-desc"><title id="distribution-title">Historical-snapshot-derived regret distribution</title><desc id="distribution-desc">Share of requests within exact, 1, 10, and 100 basis points of the best observed fixed-mode output. Higher is better.</desc><rect width="760" height="390" fill="white"/><line x1="75" y1="325" x2="690" y2="325" stroke="#333"/><line x1="75" y1="75" x2="75" y2="325" stroke="#333"/><text x="18" y="275" font-size="14" transform="rotate(-90 18 275)">Share of quoted requests (higher is better)</text>${thresholds.map((value) => `<text x="${value.x - 18}" y="355" font-size="12">${value.label}</text>`).join('')}${rendered}</svg>\n`;
}

export async function writeReport(summary: BenchmarkSummary, root = process.cwd()): Promise<void> {
  const directory = path.join(root, 'reports');
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(directory, 'portfolio-v2-summary.json'),
      `${JSON.stringify(summary, null, 2)}\n`,
    ),
    writeFile(path.join(directory, 'portfolio-v2.md'), renderMarkdown(summary)),
    writeFile(path.join(directory, 'quality-by-effort.svg'), renderQualityByEffortSvg(summary)),
    writeFile(
      path.join(directory, 'historical-regret-distribution.svg'),
      renderRegretDistributionSvg(summary),
    ),
  ]);
}

export function overallMetric(
  summary: BenchmarkSummary,
  strategy: QualityAggregate['strategy'],
  profile: QualityAggregate['profile'],
): QualityAggregate {
  return overall(summary, strategy, profile);
}
