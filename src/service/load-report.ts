import type { ServiceLoadReport, ServiceLoadRow } from './load.ts';

function milliseconds(value: number | null): string {
  return value === null ? 'n/a' : (value / 1_000).toFixed(2);
}

function successful(row: ServiceLoadRow): string {
  const value = row.successfulLatency;
  return value === null
    ? 'n/a'
    : `${milliseconds(value.p50Micros)}/${milliseconds(value.p95Micros)}/${milliseconds(value.p99Micros)}`;
}

function service(row: ServiceLoadRow): string {
  const value = row.server.quoteService;
  return value === null
    ? 'n/a'
    : `${milliseconds(value.p50Micros)}/${milliseconds(value.p95Micros)}/${milliseconds(value.p99Micros)}`;
}

function errorLatency(row: ServiceLoadRow): string {
  const value = row.errorResponseLatency;
  return value === null
    ? 'n/a'
    : `${milliseconds(value.p50Micros)}/${milliseconds(value.p95Micros)}/${milliseconds(value.p99Micros)}`;
}

function counts(value: Readonly<Record<string, number>>): string {
  const entries = Object.entries(value);
  return entries.length === 0
    ? 'none'
    : entries.map(([key, count]) => `${key}:${count}`).join(', ');
}

export function renderServiceMarkdown(report: ServiceLoadReport): string {
  const rows = report.rows.map((row) =>
    `| ${row.mode} | ${row.concurrency} | ${row.requests} | ${row.completed}/${row.typedErrors}/${row.timedOut}/${row.responseSchemaFailures} | ${successful(row)} | ${errorLatency(row)} | ${row.throughputPerSecond.toFixed(1)} | ${row.exactOutputPresenceCount}/${row.fingerprintPresenceCount}/${row.semanticMatchCount} | ${row.deadlineCompletionRatePpm === null ? 'n/a' : `${(row.deadlineCompletionRatePpm / 10_000).toFixed(2)}%`} | ${service(row)} | ${(row.server.eventLoopDelayP95Micros / 1_000).toFixed(2)}/${(row.server.eventLoopDelayMaxMicros / 1_000).toFixed(2)} | ${row.server.admissionAcceptedCount}/${row.server.admissionRejectedCount}/${row.server.overloadCount} | ${row.server.maximumActiveWork}/${row.server.maximumQueuedWork} | ${counts(row.server.terminationCounts)} | ${counts(row.server.routeCountCounts)} | ${(row.server.initialRssBytes / 1_048_576).toFixed(1)}/${(row.server.peakRssBytes / 1_048_576).toFixed(1)}/${(row.server.finalRssBytes / 1_048_576).toFixed(1)} | ${(row.server.initialHeapUsedBytes / 1_048_576).toFixed(1)}/${(row.server.peakHeapUsedBytes / 1_048_576).toFixed(1)}/${(row.server.finalHeapUsedBytes / 1_048_576).toFixed(1)} |`,
  );
  const comparisonScope = report.configuration.modes.length === 1
    ? `This retained run contains ${report.configuration.modes[0]} mode only. Worker retention is not evaluated until both modes run sequentially in one invocation.`
    : `Same-thread mode retains ${report.configuration.sameThreadMaximumActiveWork} active synchronous quote; worker mode uses ${report.configuration.workerMaximumActiveWork} fixed workers.`;
  return [
    '# RouteLab isolated service performance v2',
    '',
    `The load generator and quote server run in separate processes over localhost. ${comparisonScope} Both modes retain at most ${report.configuration.maximumQueuedWork} queued quotes, with typed 503 overload responses.`,
    '',
    `Evidence source: ${report.evidenceSource.revision}; ${report.evidenceSource.pathSet.schemaVersion} (${report.evidenceSource.pathSet.paths.length} named paths); ${report.evidenceSource.digest}.`,
    '',
    '| Mode | Concurrency | Requests | Completed/typed error/timeout/schema failure | Client success p50/p95/p99 ms | Error response p50/p95/p99 ms | req/s | Exact output/fingerprint/semantic match | Deadline completion | Quote service p50/p95/p99 ms | Event-loop p95/max ms | Accepted/rejected/overload | Max active/queued | Terminations | Route counts | RSS initial/peak/final MiB | Heap initial/peak/final MiB |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...rows,
    '',
    '## Worker decision',
    '',
    `Decision: **${report.workerDecision.decision}**. ${report.workerDecision.reason}`,
    '',
    '## Method and limitations',
    '',
    'The load-generator process owns concurrency scheduling, client timeouts, end-to-end latency, response validation, and client aggregation. The server child alone owns admission, structured completion logs, quote execution, event-loop delay, and server memory metrics.',
    '',
    `Each retained row rotates all ${report.configuration.caseCount} requests in deterministic corpus order, uses ${report.configuration.warmupsPerConcurrency} warmups and ${report.configuration.requestsPerConcurrency} measured requests, ${report.configuration.strategy}/${report.configuration.effort}, a ${report.configuration.quoteDeadlineMs} ms end-to-end quote deadline, and a ${report.configuration.requestTimeoutMs} ms client timeout. Successful and error-response latency are separate; p99 is omitted below 1,000 observations. Server event-loop and memory metrics come only from the server process.`,
    '',
    'The requests are synthetic exact-input requests derived from one historical pool-reserve snapshot, not historical order flow or representative demand. This local result is not a production-capacity or statistical-significance claim. No live upstream, transaction submission, signing, custody, execution, or settlement is involved.',
    '',
    `Environment: ${report.environment.node}; ${report.environment.platform}/${report.environment.arch}; ${report.environment.cpu}; source revision ${report.evidenceSource.revision}; observed ${report.observedAt}.`,
    '',
    '![Service latency](service-latency.svg)',
    '',
  ].join('\n');
}

function scale(value: number, maximum: number, start: number, span: number): number {
  return maximum === 0 ? start : start + value / maximum * span;
}

export function renderServiceLatencySvg(report: ServiceLoadReport): string {
  const rows = report.rows.filter((value) => value.successfulLatency !== null);
  const maximumConcurrency = Math.max(...rows.map((value) => value.concurrency), 1);
  const maximumLatency = Math.max(
    ...rows.flatMap((value) => [
      value.successfulLatency?.p50Micros ?? 0,
      value.successfulLatency?.p95Micros ?? 0,
      value.successfulLatency?.p99Micros ?? 0,
    ]),
    1,
  );
  const colors = ['#2155a5', '#b55b1d', '#9b2f4a', '#287a4a', '#7b49a5', '#996515'];
  const modes = [...new Set(rows.map((value) => value.mode))];
  const definitions = modes.flatMap((mode) =>
    (['p50', 'p95', 'p99'] as const).map((name) => ({ mode, name }))
  );
  const series = definitions.map(({ mode, name }, seriesIndex) => {
    const color = colors[seriesIndex] ?? '#333';
    const points = rows.filter((row) => row.mode === mode).map((row) => {
      const value = name === 'p50'
        ? row.successfulLatency?.p50Micros ?? 0
        : name === 'p95'
          ? row.successfulLatency?.p95Micros ?? 0
          : row.successfulLatency?.p99Micros ?? 0;
      return {
        concurrency: row.concurrency,
        value,
        x: scale(row.concurrency, maximumConcurrency, 85, 570),
        y: 315 - scale(value, maximumLatency, 0, 225),
      };
    });
    return `<g data-series="${mode}-${name}" stroke="${color}" fill="none"><polyline stroke-width="3" points="${points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')}"/>${points.map((point) => `<circle data-mode="${mode}" data-concurrency="${point.concurrency}" data-latency-micros="${point.value}" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="5" fill="${color}"/>`).join('')}<text x="${90 + (seriesIndex % 3) * 175}" y="${42 + Math.floor(seriesIndex / 3) * 17}" fill="${color}" stroke="none" font-size="11">${mode} ${name}</text></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="390" viewBox="0 0 760 390" role="img" aria-labelledby="service-title service-desc"><title id="service-title">Isolated service latency by execution mode</title><desc id="service-desc">Successful end-to-end latency by client concurrency and execution mode; lower is better.</desc><rect width="760" height="390" fill="white"/><line x1="75" y1="325" x2="680" y2="325" stroke="#333"/><line x1="75" y1="75" x2="75" y2="325" stroke="#333"/><text x="315" y="370" font-size="14">Client concurrency</text><text x="18" y="270" font-size="14" transform="rotate(-90 18 270)">End-to-end latency (µs; lower is better)</text>${series}</svg>\n`;
}
