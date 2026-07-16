import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';

import { parseLiquiditySnapshot } from '../domain/index.ts';
import { prepareSnapshot, quote, serializeQuote } from '../index.ts';
import { parseServiceQuote } from './parse.ts';
import { SERVICE_POLICY } from './policy.ts';
import type {
  ParsedServiceQuote,
  QuoteHttpService,
  ServiceError,
  ServiceLatencyDistribution,
  ServiceLogger,
  ServiceMetrics,
  ServiceQuoteExecutor,
  ServiceSnapshot,
} from './types.ts';

interface BodyResult {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: ServiceError;
}

interface Completion {
  status: number;
  errorCode: string | null;
  termination: string | null;
  routeCount: number | null;
  queueWaitMicros: number;
  quoteServiceMicros: number;
}

interface QuoteJob {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly requestId: string;
  readonly parsed: ParsedServiceQuote;
  readonly snapshot: ServiceSnapshot;
  readonly enqueuedAt: bigint;
  resolve: (value: Completion) => void;
  state: 'active' | 'queued' | 'running' | 'done';
  aborted: boolean;
}

interface MutableMetrics {
  initialRssBytes: number;
  peakRssBytes: number;
  initialHeapUsedBytes: number;
  peakHeapUsedBytes: number;
  admissionAcceptedCount: number;
  admissionRejectedCount: number;
  overloadCount: number;
  maximumActiveWork: number;
  maximumQueuedWork: number;
  structuredCompletionCount: number;
  terminationCounts: Record<string, number>;
  routeCountCounts: Record<string, number>;
  queueWaitMicros: number[];
  quoteServiceMicros: number[];
}

function serviceError(status: number, code: string, message: string, field?: string): ServiceError {
  return Object.freeze(field === undefined
    ? { status, code, message }
    : { status, code, message, field });
}

function writeJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  if (response.destroyed || response.writableEnded) return;
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(body);
}

function errorBody(requestId: string, error: ServiceError): unknown {
  return {
    requestId,
    error: {
      code: error.code,
      message: error.message,
      ...(error.field === undefined ? {} : { field: error.field }),
    },
  };
}

function readBody(request: IncomingMessage): Promise<BodyResult> {
  const declared = request.headers['content-length'];
  if (
    declared !== undefined
    && (!/^(?:0|[1-9][0-9]*)$/u.test(declared)
      || Number(declared) > SERVICE_POLICY.bodyBytes)
  ) {
    request.resume();
    return Promise.resolve({
      ok: false,
      error: serviceError(
        413,
        'body-too-large',
        `Request body exceeds ${SERVICE_POLICY.bodyBytes} bytes.`,
      ),
    });
  }
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (result: BodyResult): void => {
      if (settled) return;
      settled = true;
      resolve(Object.freeze(result));
    };
    request.on('data', (chunk: Buffer | string) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      bytes += buffer.byteLength;
      if (bytes <= SERVICE_POLICY.bodyBytes) chunks.push(buffer);
    });
    request.on('end', () => {
      if (bytes > SERVICE_POLICY.bodyBytes) {
        finish({
          ok: false,
          error: serviceError(
            413,
            'body-too-large',
            `Request body exceeds ${SERVICE_POLICY.bodyBytes} bytes.`,
          ),
        });
        return;
      }
      try {
        finish({
          ok: true,
          value: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
        });
      } catch {
        finish({
          ok: false,
          error: serviceError(400, 'malformed-json', 'Request body is not valid JSON.'),
        });
      }
    });
    request.on('aborted', () => finish({
      ok: false,
      error: serviceError(400, 'request-aborted', 'Request body was aborted.'),
    }));
    request.on('error', () => finish({
      ok: false,
      error: serviceError(400, 'request-read-failed', 'Request body could not be read.'),
    }));
  });
}

function prepareServiceSnapshot(input: unknown): ServiceSnapshot {
  const parsed = parseLiquiditySnapshot(input);
  const prepared = prepareSnapshot(input);
  if (!parsed.ok || !prepared.ok) {
    throw new Error('Service snapshot failed exact startup preparation.');
  }
  return Object.freeze({
    snapshotId: parsed.value.snapshotId,
    snapshotChecksum: parsed.value.snapshotChecksum,
    poolCount: parsed.value.pools.length,
    assetIds: Object.freeze(new Set(
      parsed.value.pools.flatMap(({ asset0, asset1 }) => [asset0, asset1]),
    )),
    context: prepared.value,
  });
}

function quoteError(error: ReturnType<typeof quote> & { readonly ok: false }): ServiceError {
  const status = error.error.code === 'snapshot-mismatch' || error.error.code === 'no-route'
    ? 404
    : error.error.code === 'deadline-before-plan'
      ? 408
      : error.error.code === 'invalid-request'
        ? 400
        : 500;
  return serviceError(
    status,
    error.error.code,
    error.error.message,
    'field' in error.error ? error.error.field : undefined,
  );
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function latency(values: readonly number[]): ServiceLatencyDistribution | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return Object.freeze({
    samples: sorted.length,
    p50Micros: Math.round(percentile(sorted, 0.50)),
    p95Micros: Math.round(percentile(sorted, 0.95)),
    p99Micros: sorted.length >= 1_000 ? Math.round(percentile(sorted, 0.99)) : null,
    maxMicros: Math.round(sorted.at(-1) ?? 0),
  });
}

function freshMetrics(): MutableMetrics {
  const memory = process.memoryUsage();
  return {
    initialRssBytes: memory.rss,
    peakRssBytes: memory.rss,
    initialHeapUsedBytes: memory.heapUsed,
    peakHeapUsedBytes: memory.heapUsed,
    admissionAcceptedCount: 0,
    admissionRejectedCount: 0,
    overloadCount: 0,
    maximumActiveWork: 0,
    maximumQueuedWork: 0,
    structuredCompletionCount: 0,
    terminationCounts: {},
    routeCountCounts: {},
    queueWaitMicros: [],
    quoteServiceMicros: [],
  };
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

export function createQuoteHttpService(
  inputs: readonly unknown[],
  logger: ServiceLogger = (line) => process.stdout.write(`${line}\n`),
  suppliedExecutor?: ServiceQuoteExecutor,
): QuoteHttpService {
  const snapshots = inputs.map(prepareServiceSnapshot);
  const snapshotMap = new Map(snapshots.map((snapshot) => [snapshot.snapshotId, snapshot]));
  if (snapshotMap.size !== snapshots.length) {
    throw new Error('Service snapshot IDs must be unique.');
  }
  const executor: ServiceQuoteExecutor = suppliedExecutor ?? Object.freeze({
    maximumActiveWork: SERVICE_POLICY.maxActiveWork,
    maximumQueuedWork: SERVICE_POLICY.maxQueuedWork,
    execute: (
      snapshot: ServiceSnapshot,
      parsed: ParsedServiceQuote,
      options: ParsedServiceQuote['options'],
    ) => {
      const result = quote(snapshot.context, parsed.request, options);
      return Promise.resolve(result.ok
        ? Object.freeze({ ok: true as const, value: serializeQuote(result.value) })
        : Object.freeze({ ok: false as const, error: quoteError(result) }));
    },
    close: () => Promise.resolve(),
  });
  const eventLoop = monitorEventLoopDelay({ resolution: 10 });
  eventLoop.enable();
  let metrics = freshMetrics();
  let nextRequest = 0;
  let activeWork = 0;
  const queue: QuoteJob[] = [];

  const sampleMemory = (): void => {
    const memory = process.memoryUsage();
    metrics.peakRssBytes = Math.max(metrics.peakRssBytes, memory.rss);
    metrics.peakHeapUsedBytes = Math.max(metrics.peakHeapUsedBytes, memory.heapUsed);
  };
  const memoryTimer = setInterval(sampleMemory, 10);
  memoryTimer.unref();

  const execute = (job: QuoteJob): void => {
    setImmediate(() => {
      void (async () => {
      if (job.aborted) {
        job.state = 'done';
        activeWork -= 1;
        job.resolve({
          status: 499,
          errorCode: 'client-aborted',
          termination: null,
          routeCount: null,
          queueWaitMicros: Number((process.hrtime.bigint() - job.enqueuedAt) / 1_000n),
          quoteServiceMicros: 0,
        });
        startNext();
        return;
      }
      job.state = 'running';
      const quoteStarted = process.hrtime.bigint();
      const queueWaitNanoseconds = quoteStarted - job.enqueuedAt;
      const queueWaitMicros = Number(queueWaitNanoseconds / 1_000n);
      metrics.queueWaitMicros.push(queueWaitMicros);
      const requestedDeadline = job.parsed.options.deadlineMs;
      let deadlineMs: number | undefined;
      if (requestedDeadline !== undefined) {
        const remaining = BigInt(requestedDeadline) * 1_000_000n - queueWaitNanoseconds;
        deadlineMs = remaining >= 1_000_000n ? Number(remaining / 1_000_000n) : undefined;
        if (deadlineMs === undefined) {
          const error = serviceError(
            408,
            'deadline-before-plan',
            'The end-to-end quote deadline expired while waiting for service capacity.',
          );
          writeJson(job.response, error.status, errorBody(job.requestId, error));
          job.state = 'done';
          activeWork -= 1;
          job.resolve({
            status: error.status,
            errorCode: error.code,
            termination: null,
            routeCount: null,
            queueWaitMicros,
            quoteServiceMicros: 0,
          });
          startNext();
          return;
        }
      }

      sampleMemory();
      let result;
      try {
        result = await executor.execute(job.snapshot, job.parsed, {
          ...job.parsed.options,
          ...(deadlineMs === undefined ? {} : { deadlineMs }),
        });
      } catch {
        result = Object.freeze({
          ok: false as const,
          error: serviceError(500, 'worker-failure', 'Quote execution failed closed.'),
        });
      }
      const quoteServiceMicros = Number((process.hrtime.bigint() - quoteStarted) / 1_000n);
      metrics.quoteServiceMicros.push(quoteServiceMicros);
      sampleMemory();
      let completion: Completion;
      if (!result.ok) {
        const error = result.error;
        writeJson(job.response, error.status, errorBody(job.requestId, error));
        completion = {
          status: error.status,
          errorCode: error.code,
          termination: null,
          routeCount: null,
          queueWaitMicros,
          quoteServiceMicros,
        };
      } else {
        writeJson(job.response, 200, { requestId: job.requestId, ...result.value });
        increment(metrics.terminationCounts, result.value.termination);
        increment(metrics.routeCountCounts, result.value.routes.length.toString(10));
        completion = {
          status: 200,
          errorCode: null,
          termination: result.value.termination,
          routeCount: result.value.routes.length,
          queueWaitMicros,
          quoteServiceMicros,
        };
      }
      job.state = 'done';
      activeWork -= 1;
      job.resolve(completion);
      startNext();
      })();
    });
  };

  const startNext = (): void => {
    while (activeWork < executor.maximumActiveWork) {
      const next = queue.shift();
      if (next === undefined) return;
      if (next.aborted) continue;
      next.state = 'active';
      activeWork += 1;
      metrics.maximumActiveWork = Math.max(metrics.maximumActiveWork, activeWork);
      execute(next);
    }
  };

  const schedule = (
    request: IncomingMessage,
    response: ServerResponse,
    requestId: string,
    parsed: ParsedServiceQuote,
    snapshot: ServiceSnapshot,
  ): Promise<Completion> => new Promise((resolve) => {
    const job: QuoteJob = {
      request,
      response,
      requestId,
      parsed,
      snapshot,
      enqueuedAt: process.hrtime.bigint(),
      resolve,
      state: activeWork < executor.maximumActiveWork ? 'active' : 'queued',
      aborted: request.aborted,
    };
    const abort = (): void => {
      if (job.state === 'done') return;
      job.aborted = true;
      if (job.state !== 'queued') return;
      const index = queue.indexOf(job);
      if (index !== -1) queue.splice(index, 1);
      job.state = 'done';
      resolve({
        status: 499,
        errorCode: 'client-aborted',
        termination: null,
        routeCount: null,
        queueWaitMicros: Number((process.hrtime.bigint() - job.enqueuedAt) / 1_000n),
        quoteServiceMicros: 0,
      });
    };
    request.once('aborted', abort);
    request.socket.once('close', abort);
    response.once('close', () => {
      if (!response.writableFinished) abort();
    });
    if (job.aborted) {
      job.state = 'done';
      resolve({
        status: 499,
        errorCode: 'client-aborted',
        termination: null,
        routeCount: null,
        queueWaitMicros: 0,
        quoteServiceMicros: 0,
      });
      return;
    }
    if (job.state === 'active') {
      metrics.admissionAcceptedCount += 1;
      activeWork += 1;
      metrics.maximumActiveWork = Math.max(metrics.maximumActiveWork, activeWork);
      execute(job);
      return;
    }
    if (queue.length >= executor.maximumQueuedWork) {
      metrics.admissionRejectedCount += 1;
      metrics.overloadCount += 1;
      job.state = 'done';
      const error = serviceError(503, 'overloaded', 'Quote service capacity is full; retry later.');
      writeJson(response, error.status, errorBody(requestId, error), {
        'retry-after': SERVICE_POLICY.overloadRetryAfterSeconds.toString(10),
      });
      resolve({
        status: error.status,
        errorCode: error.code,
        termination: null,
        routeCount: null,
        queueWaitMicros: 0,
        quoteServiceMicros: 0,
      });
      return;
    }
    metrics.admissionAcceptedCount += 1;
    queue.push(job);
    metrics.maximumQueuedWork = Math.max(metrics.maximumQueuedWork, queue.length);
  });

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const started = process.hrtime.bigint();
    nextRequest += 1;
    const requestId = `rl-${nextRequest.toString(10).padStart(8, '0')}`;
    let snapshotId: string | null = null;
    let strategy: string | null = null;
    let effort: string | null = null;
    let completion: Completion = {
      status: 500,
      errorCode: 'internal-error',
      termination: null,
      routeCount: null,
      queueWaitMicros: 0,
      quoteServiceMicros: 0,
    };
    try {
      if ((request.url?.length ?? 0) > SERVICE_POLICY.urlLength) {
        const error = serviceError(414, 'url-too-long', 'Request URL is too long.');
        writeJson(response, error.status, errorBody(requestId, error));
        completion = { ...completion, status: error.status, errorCode: error.code };
        return;
      }
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (request.method === 'GET' && pathname === '/health') {
        writeJson(response, 200, { requestId, status: 'ok', snapshotCount: snapshots.length });
        completion = { ...completion, status: 200, errorCode: null };
        return;
      }
      if (request.method === 'GET' && pathname === '/v1/snapshots') {
        writeJson(response, 200, {
          requestId,
          snapshots: snapshots.map(({ snapshotId: id, snapshotChecksum, poolCount }) => ({
            snapshotId: id,
            snapshotChecksum,
            poolCount,
          })),
        });
        completion = { ...completion, status: 200, errorCode: null };
        return;
      }
      if (pathname !== '/v1/quote') {
        const error = serviceError(404, 'not-found', 'Endpoint not found.');
        writeJson(response, error.status, errorBody(requestId, error));
        completion = { ...completion, status: error.status, errorCode: error.code };
        return;
      }
      if (request.method !== 'POST') {
        const error = serviceError(405, 'method-not-allowed', 'Use POST for /v1/quote.');
        response.setHeader('allow', 'POST');
        writeJson(response, error.status, errorBody(requestId, error));
        completion = { ...completion, status: error.status, errorCode: error.code };
        return;
      }
      const body = await readBody(request);
      if (!body.ok) {
        const error = body.error
          ?? serviceError(400, 'request-read-failed', 'Request body could not be read.');
        writeJson(response, error.status, errorBody(requestId, error));
        completion = { ...completion, status: error.status, errorCode: error.code };
        return;
      }
      const parsed = parseServiceQuote(body.value);
      if (!parsed.ok) {
        writeJson(response, parsed.error.status, errorBody(requestId, parsed.error));
        completion = {
          ...completion,
          status: parsed.error.status,
          errorCode: parsed.error.code,
        };
        return;
      }
      snapshotId = parsed.value.request.snapshotId;
      strategy = parsed.value.options.strategy ?? 'greedy-split';
      effort = parsed.value.options.effort ?? 'balanced';
      const snapshot = snapshotMap.get(snapshotId);
      if (snapshot === undefined) {
        const error = serviceError(
          404,
          'unknown-snapshot',
          'Snapshot is not loaded.',
          'snapshotId',
        );
        writeJson(response, error.status, errorBody(requestId, error));
        completion = { ...completion, status: error.status, errorCode: error.code };
        return;
      }
      if (!snapshot.assetIds.has(parsed.value.request.assetIn)) {
        const error = serviceError(
          404,
          'unknown-asset',
          'Input asset is not in the snapshot.',
          'assetIn',
        );
        writeJson(response, error.status, errorBody(requestId, error));
        completion = { ...completion, status: error.status, errorCode: error.code };
        return;
      }
      if (!snapshot.assetIds.has(parsed.value.request.assetOut)) {
        const error = serviceError(
          404,
          'unknown-asset',
          'Output asset is not in the snapshot.',
          'assetOut',
        );
        writeJson(response, error.status, errorBody(requestId, error));
        completion = { ...completion, status: error.status, errorCode: error.code };
        return;
      }
      completion = await schedule(request, response, requestId, parsed.value, snapshot);
    } catch {
      const error = serviceError(500, 'internal-error', 'The quote service failed.');
      if (!response.headersSent) writeJson(response, error.status, errorBody(requestId, error));
      else if (!response.writableEnded) response.end();
      completion = { ...completion, status: error.status, errorCode: error.code };
    } finally {
      sampleMemory();
      metrics.structuredCompletionCount += 1;
      const totalElapsedMicros = Number((process.hrtime.bigint() - started) / 1_000n);
      logger(JSON.stringify({
        requestId,
        snapshotId,
        strategy,
        effort,
        status: completion.status,
        errorCode: completion.errorCode,
        termination: completion.termination,
        routeCount: completion.routeCount,
        totalElapsedMicros,
        queueWaitMicros: completion.queueWaitMicros,
        quoteServiceMicros: completion.quoteServiceMicros,
      }));
    }
  };

  const server = createServer((request, response) => {
    void handle(request, response);
  });
  server.once('close', () => {
    clearInterval(memoryTimer);
    eventLoop.disable();
  });

  const resetMetrics = (): void => {
    sampleMemory();
    metrics = freshMetrics();
    eventLoop.reset();
  };
  const readMetrics = (): ServiceMetrics => {
    sampleMemory();
    const finalMemory = process.memoryUsage();
    return Object.freeze({
      initialRssBytes: metrics.initialRssBytes,
      peakRssBytes: metrics.peakRssBytes,
      finalRssBytes: finalMemory.rss,
      initialHeapUsedBytes: metrics.initialHeapUsedBytes,
      peakHeapUsedBytes: metrics.peakHeapUsedBytes,
      finalHeapUsedBytes: finalMemory.heapUsed,
      admissionAcceptedCount: metrics.admissionAcceptedCount,
      admissionRejectedCount: metrics.admissionRejectedCount,
      overloadCount: metrics.overloadCount,
      maximumActiveWork: metrics.maximumActiveWork,
      maximumQueuedWork: metrics.maximumQueuedWork,
      structuredCompletionCount: metrics.structuredCompletionCount,
      terminationCounts: Object.freeze({ ...metrics.terminationCounts }),
      routeCountCounts: Object.freeze({ ...metrics.routeCountCounts }),
      queueWait: latency(metrics.queueWaitMicros),
      quoteService: latency(metrics.quoteServiceMicros),
      eventLoopDelayP95Micros: Math.round(eventLoop.percentile(95) / 1_000),
      eventLoopDelayMaxMicros: Math.round(eventLoop.max / 1_000),
    });
  };

  return Object.freeze({
    server,
    snapshots: Object.freeze(snapshots.map(({
      snapshotId,
      snapshotChecksum,
      poolCount,
    }) => Object.freeze({ snapshotId, snapshotChecksum, poolCount }))),
    resetMetrics,
    readMetrics,
    closeExecution: executor.close,
  });
}

export async function closeQuoteHttpService(service: QuoteHttpService): Promise<void> {
  const closed = new Promise<void>((resolve, reject) => {
    service.server.close((error) => error === undefined ? resolve() : reject(error));
  });
  service.server.closeIdleConnections();
  await closed;
  await service.closeExecution();
}
