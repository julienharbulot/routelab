import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { quote } from '../../index.ts';
import {
  BENCHMARK_SAMPLES,
  BENCHMARK_WARMUPS,
  LATENCY_COMBINATIONS,
} from './config.ts';
import type {
  BenchmarkEnvironment,
  LatencyDistribution,
  LatencyRow,
  PortfolioCase,
} from './types.ts';

interface RawLatencyObservation {
  readonly strategy: string;
  readonly profile: string;
  readonly caseId: string;
  readonly elapsedNanoseconds: string;
  readonly outcome: 'quote' | 'no-route';
}

function environment(root: string): BenchmarkEnvironment {
  let commit = 'unavailable';
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // A source archive can be benchmarked without Git metadata.
  }
  return Object.freeze({
    observedAt: new Date().toISOString(),
    node: process.version,
    platform: os.platform(),
    arch: os.arch(),
    cpu: os.cpus()[0]?.model ?? 'unavailable',
    commit,
  });
}

function percentile(sorted: readonly number[], fraction: number): number {
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? 0;
}

function distribution(durations: readonly number[]): LatencyDistribution | null {
  if (durations.length === 0) return null;
  const sorted = [...durations].sort((left, right) => left - right);
  return Object.freeze({
    samples: sorted.length,
    p50Micros: Math.round(percentile(sorted, 0.50)),
    p95Micros: Math.round(percentile(sorted, 0.95)),
    p99Micros: sorted.length >= 1_000 ? Math.round(percentile(sorted, 0.99)) : null,
    minMicros: Math.round(sorted[0] ?? 0),
    maxMicros: Math.round(sorted.at(-1) ?? 0),
  });
}

function invoke(
  input: PortfolioCase,
  strategy: (typeof LATENCY_COMBINATIONS)[number]['strategy'],
  profile: (typeof LATENCY_COMBINATIONS)[number]['profile'],
): { readonly elapsed: bigint; readonly outcome: 'quote' | 'no-route' } {
  const started = process.hrtime.bigint();
  const result = quote(input.context, input.request, { strategy, effort: profile });
  const elapsed = process.hrtime.bigint() - started;
  const outcome = result.ok ? 'quote' : result.error.code === 'no-route' ? 'no-route' : undefined;
  if (outcome === undefined || outcome !== input.expectedOutcome) {
    throw new Error(`Latency invocation failed for ${input.caseId} (${strategy}/${profile}).`);
  }
  return Object.freeze({ elapsed, outcome });
}

export async function runLatency(
  cases: readonly PortfolioCase[],
  root = process.cwd(),
  warmups = BENCHMARK_WARMUPS,
  samples = BENCHMARK_SAMPLES,
): Promise<{
  readonly environment: BenchmarkEnvironment;
  readonly rows: readonly LatencyRow[];
}> {
  if (cases.length === 0) throw new Error('Latency benchmark requires at least one request.');
  const observations: RawLatencyObservation[] = [];
  const rows: LatencyRow[] = [];
  for (const { strategy, profile } of LATENCY_COMBINATIONS) {
    for (let index = 0; index < warmups; index += 1) {
      invoke(cases[index % cases.length] as PortfolioCase, strategy, profile);
    }
    const quoteDurations: number[] = [];
    const noRouteDurations: number[] = [];
    const laneStarted = process.hrtime.bigint();
    for (let index = 0; index < samples; index += 1) {
      const input = cases[index % cases.length] as PortfolioCase;
      const result = invoke(input, strategy, profile);
      const elapsedMicros = Number(result.elapsed) / 1_000;
      if (result.outcome === 'quote') quoteDurations.push(elapsedMicros);
      else noRouteDurations.push(elapsedMicros);
      observations.push(Object.freeze({
        strategy,
        profile,
        caseId: input.caseId,
        elapsedNanoseconds: result.elapsed.toString(10),
        outcome: result.outcome,
      }));
    }
    const laneElapsed = process.hrtime.bigint() - laneStarted;
    rows.push(Object.freeze({
      strategy,
      profile,
      warmups,
      samples,
      quoteCount: quoteDurations.length,
      noRouteCount: noRouteDurations.length,
      quote: distribution(quoteDurations),
      noRoute: distribution(noRouteDurations),
      throughputPerSecond:
        Number((BigInt(samples) * 1_000_000_000_000n) / laneElapsed) / 1_000,
    }));
  }
  const benchmarkEnvironment = environment(root);
  const rawDirectory = path.join(root, 'reports', 'raw');
  await mkdir(rawDirectory, { recursive: true });
  await writeFile(path.join(rawDirectory, 'portfolio-v2-latency.json'), `${JSON.stringify({
    schemaVersion: 'routelab.portfolio-benchmark-latency.v2',
    environment: benchmarkEnvironment,
    observations,
  }, null, 2)}\n`);
  return Object.freeze({
    environment: benchmarkEnvironment,
    rows: Object.freeze(rows),
  });
}
