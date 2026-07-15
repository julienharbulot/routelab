import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  BenchmarkReport,
  LatencyRow,
  QualityAggregate,
} from './types.ts';

function qualityTable(values: readonly QualityAggregate[]): string {
  const rows = values.map((value) =>
    `| ${value.strategy} | ${value.profile} | ${value.medianRegretBps ?? 'n/a'} | ${value.worstRegretBps ?? 'n/a'} | ${value.splitImprovementCount} | ${value.totalWork} | ${value.authorizationRejections} (${value.authorizationRejectionRate.toFixed(3)}) |`
  );
  return [
    '| Strategy | Profile | Median regret (bps) | Worst regret (bps) | Improved splits | Work | Rejections (rate/quote) |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...rows,
  ].join('\n');
}

function latencyTable(values: readonly LatencyRow[]): string {
  const rows = values.map((value) =>
    `| ${value.strategy} | ${value.profile} | ${value.samples} | ${value.p50Micros} | ${value.p95Micros} | ${value.p99Micros} | ${value.throughputPerSecond.toFixed(1)} |`
  );
  return [
    '| Strategy | Profile | Samples | p50 µs | p95 µs | p99 µs | calls/s |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...rows,
  ].join('\n');
}

function conclusion(report: BenchmarkReport): string {
  const comparison = report.numericalComparisons.find(({ profile }) => profile === 'fast');
  const numerical = comparison === undefined
    ? 'No fast numerical comparison was available.'
    : `At fast effort, numerical split beat/tied/lost greedy split in ${comparison.beatsGreedy}/${comparison.tiesGreedy}/${comparison.losesGreedy} quoted cases.`;
  return `On this retained ${report.configuration.caseCount}-case set, every published success passed fresh exact replay. ${numerical} The reference is a longer-budget result over the same bounded candidate restrictions, not a global optimum.`;
}

export function renderMarkdown(report: BenchmarkReport): string {
  return [
    '# RouteLab portfolio benchmark v1',
    '',
    conclusion(report),
    '',
    '## Deterministic quality',
    '',
    qualityTable(report.aggregates),
    '',
    '## In-process latency',
    '',
    latencyTable(report.latency),
    '',
    '## HTTP load',
    '',
    '| Service profile | Concurrency | Requests | p50 | p95 | p99 | Throughput |',
    '|---|---:|---:|---:|---:|---:|---:|',
    '| Added in PORT-005 | n/a | n/a | n/a | n/a | n/a | n/a |',
    '',
    '![Quality versus budget](quality-vs-budget.svg)',
    '',
    '## Limitations',
    '',
    '- The case set is curated and is not representative market demand.',
    '- Snapshots are immutable offline inputs; the benchmark does not measure live acquisition or execution.',
    '- Latency is a local observation on one machine. The synchronous router blocks its calling thread.',
    '- Regret is measured against the bounded numerical reference and does not establish global optimality.',
    '',
    '## Methodology',
    '',
    `Quality covers ${report.configuration.caseCount} named cases and uses deterministic work caps only. Exact values remain decimal strings in the JSON report. Latency uses process.hrtime.bigint(), ${report.configuration.warmups} warmups, and ${report.configuration.samples} measured calls per reported combination while rotating cases. Raw observations are ignored by Git.`,
    '',
    `Environment: ${report.environment.node}; ${report.environment.platform}/${report.environment.arch}; ${report.environment.cpu}; revision ${report.environment.commit}; observed ${report.environment.observedAt}.`,
    '',
  ].join('\n');
}

function point(value: number, minimum: number, maximum: number, start: number, span: number): number {
  if (minimum === maximum) return start + span / 2;
  return start + ((value - minimum) / (maximum - minimum)) * span;
}

export function renderSvg(report: BenchmarkReport): string {
  const plotted = report.latency.map((latency) => {
    const quality = report.aggregates.find((value) =>
      value.strategy === latency.strategy && value.profile === latency.profile
    );
    return {
      strategy: latency.strategy,
      x: latency.p50Micros,
      y: quality?.medianRegretBps ?? 0,
    };
  });
  const xs = plotted.map(({ x }) => x);
  const ys = plotted.map(({ y }) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const colors = ['#2864dc', '#159447', '#d06421'];
  const points = plotted.map((value, index) => {
    const x = point(value.x, minX, maxX, 90, 600);
    const y = 300 - point(value.y, minY, maxY, 0, 220);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="${colors[index]}"/><text x="${(x + 10).toFixed(1)}" y="${(y + 4).toFixed(1)}" font-size="13">${value.strategy}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="380" viewBox="0 0 760 380" role="img" aria-labelledby="title desc"><title id="title">Quality versus in-process latency</title><desc id="desc">Fast-profile median latency and median regret for three routing strategies.</desc><rect width="760" height="380" fill="white"/><line x1="80" y1="310" x2="710" y2="310" stroke="#333"/><line x1="80" y1="70" x2="80" y2="310" stroke="#333"/><text x="300" y="355" font-size="14">median elapsed microseconds (fast profile)</text><text x="18" y="230" font-size="14" transform="rotate(-90 18 230)">median regret (bps; lower is better)</text>${points}<text x="90" y="35" font-size="18" font-weight="600">RouteLab portfolio-v1</text></svg>\n`;
}

export async function writeReport(report: BenchmarkReport, root = process.cwd()): Promise<void> {
  const directory = path.join(root, 'reports');
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(path.join(directory, 'portfolio-v1.json'), `${JSON.stringify(report, null, 2)}\n`),
    writeFile(path.join(directory, 'portfolio-v1.md'), renderMarkdown(report)),
    writeFile(path.join(directory, 'quality-vs-budget.svg'), renderSvg(report)),
  ]);
}
