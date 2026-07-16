import { Worker } from 'node:worker_threads';

import type { QuoteOptions } from '../index.ts';
import { SERVICE_POLICY } from './policy.ts';
import { parseSerializedQuote } from './serialized-quote.ts';
import type {
  ParsedServiceQuote,
  ServiceError,
  ServiceExecutionResult,
  ServiceQuoteExecutor,
  ServiceSnapshot,
} from './types.ts';

interface WorkerSlot {
  readonly worker: Worker;
  busy: boolean;
  pending: {
    readonly requestId: number;
    readonly expected: {
      readonly snapshotId: string;
      readonly snapshotChecksum: string;
      readonly assetIn: string;
      readonly assetOut: string;
      readonly amountIn: string;
    };
    readonly resolve: (value: ServiceExecutionResult) => void;
  } | null;
}

interface WorkerResponse {
  readonly requestId: number;
  readonly ok: boolean;
    readonly quote?: unknown;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly field?: string;
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function response(value: unknown): WorkerResponse | undefined {
  const input = record(value);
  if (
    input?.['schemaVersion'] !== 'routelab.worker-quote-response.v1'
    || !Number.isSafeInteger(input['requestId'])
    || typeof input['ok'] !== 'boolean'
  ) return undefined;
  if (input['ok']) {
    if (input['quote'] === undefined) return undefined;
  } else {
    const error = record(input['error']);
    if (typeof error?.['code'] !== 'string' || typeof error['message'] !== 'string') {
      return undefined;
    }
  }
  return value as WorkerResponse;
}

function workerError(message: string): ServiceExecutionResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ status: 500, code: 'worker-failure', message }),
  });
}

function status(code: string): number {
  if (code === 'snapshot-mismatch' || code === 'no-route') return 404;
  if (code === 'deadline-before-plan') return 408;
  if (code === 'invalid-request') return 400;
  return 500;
}

function executionError(value: WorkerResponse['error']): ServiceExecutionResult {
  if (value === undefined) return workerError('Worker returned no typed error.');
  const error: ServiceError = value.field === undefined
    ? { status: status(value.code), code: value.code, message: value.message }
    : { status: status(value.code), code: value.code, message: value.message, field: value.field };
  return Object.freeze({ ok: false, error: Object.freeze(error) });
}

async function startWorker(inputs: readonly unknown[]): Promise<Worker> {
  const workerModule = import.meta.url.endsWith('.ts') ? './quote-worker.ts' : './quote-worker.js';
  const worker = new Worker(new URL(workerModule, import.meta.url), {
    workerData: {
      schemaVersion: 'routelab.worker-initialization.v1',
      snapshots: inputs,
    },
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error('Quote worker did not initialize within 10 seconds.'));
    }, 10_000);
    const onMessage = (message: unknown): void => {
      const input = record(message);
      if (
        input?.['schemaVersion'] !== 'routelab.worker-ready.v1'
        || input['snapshotCount'] !== inputs.length
      ) return;
      clearTimeout(timer);
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      clearTimeout(timer);
      cleanup();
      reject(error);
    };
    const onExit = (code: number): void => {
      clearTimeout(timer);
      cleanup();
      reject(new Error(`Quote worker exited during initialization (${code}).`));
    };
    const cleanup = (): void => {
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };
    worker.on('message', onMessage);
    worker.once('error', onError);
    worker.once('exit', onExit);
  });
  return worker;
}

export async function createWorkerQuoteExecutor(
  inputs: readonly unknown[],
  workerCount: number = SERVICE_POLICY.workerCount,
): Promise<ServiceQuoteExecutor> {
  if (!Number.isSafeInteger(workerCount) || workerCount < 1 || workerCount > 16) {
    throw new Error('Worker count must be an integer from 1 through 16.');
  }
  const workers: Worker[] = [];
  try {
    for (let index = 0; index < workerCount; index += 1) {
      workers.push(await startWorker(inputs));
    }
  } catch (error) {
    await Promise.all(workers.map(async (worker) => worker.terminate()));
    throw error;
  }
  const slots: WorkerSlot[] = workers.map((worker) => ({ worker, busy: false, pending: null }));
  let nextRequest = 0;
  let closed = false;
  let failed = false;

  const failClosed = (slot: WorkerSlot, message: string): void => {
    if (closed) return;
    failed = true;
    const pending = slot.pending;
    slot.pending = null;
    slot.busy = false;
    pending?.resolve(workerError(message));
  };
  for (const slot of slots) {
    slot.worker.on('error', (error: Error) => {
      failClosed(slot, `Quote worker failed: ${error.message}`);
    });
    slot.worker.on('exit', (code) => {
      if (!closed) failClosed(slot, `Quote worker exited unexpectedly (${code}).`);
    });
    slot.worker.on('message', (message: unknown) => {
      const parsed = response(message);
      const pending = slot.pending;
      if (pending === null) return;
      if (parsed === undefined || parsed.requestId !== pending.requestId) {
        failClosed(slot, 'Quote worker returned an invalid response.');
        return;
      }
      const quote = parsed.ok ? parseSerializedQuote(parsed.quote) : undefined;
      if (parsed.ok && (
        quote === undefined
        || quote.snapshotId !== pending.expected.snapshotId
        || quote.snapshotChecksum !== pending.expected.snapshotChecksum
        || quote.assetIn !== pending.expected.assetIn
        || quote.assetOut !== pending.expected.assetOut
        || quote.amountIn !== pending.expected.amountIn
      )) {
        failClosed(slot, 'Quote worker returned a malformed or mismatched quote.');
        return;
      }
      slot.pending = null;
      slot.busy = false;
      pending.resolve(parsed.ok && quote !== undefined
        ? Object.freeze({ ok: true, value: quote })
        : executionError(parsed.error));
    });
  }

  return Object.freeze({
    maximumActiveWork: workerCount,
    maximumQueuedWork: SERVICE_POLICY.maxQueuedWork,
    execute: async (
      snapshot: ServiceSnapshot,
      parsed: ParsedServiceQuote,
      options: QuoteOptions,
    ): Promise<ServiceExecutionResult> => {
      if (closed || failed) return workerError('Worker pool is unavailable and failed closed.');
      const slot = slots.find((value) => !value.busy);
      if (slot === undefined) return workerError('Worker pool admission invariant failed.');
      nextRequest += 1;
      const requestId = nextRequest;
      slot.busy = true;
      return new Promise((resolve) => {
        slot.pending = {
          requestId,
          expected: {
            snapshotId: parsed.request.snapshotId,
            snapshotChecksum: snapshot.snapshotChecksum,
            assetIn: parsed.request.assetIn,
            assetOut: parsed.request.assetOut,
            amountIn: parsed.request.amountIn.toString(10),
          },
          resolve,
        };
        try {
          slot.worker.postMessage({
            schemaVersion: 'routelab.worker-quote-request.v1',
            requestId,
            snapshotId: parsed.request.snapshotId,
            assetIn: parsed.request.assetIn,
            assetOut: parsed.request.assetOut,
            amountIn: parsed.request.amountIn.toString(10),
            strategy: options.strategy ?? 'greedy-split',
            effort: options.effort ?? 'balanced',
            ...(parsed.request.maxHops === undefined
              ? {}
              : { maxHops: parsed.request.maxHops }),
            ...(parsed.request.maxRoutes === undefined
              ? {}
              : { maxRoutes: parsed.request.maxRoutes }),
            ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
          });
        } catch {
          slot.pending = null;
          slot.busy = false;
          failed = true;
          resolve(workerError('Worker request dispatch failed and the pool closed to new work.'));
        }
      });
    },
    close: async () => {
      if (closed) return;
      closed = true;
      for (const slot of slots) {
        slot.pending?.resolve(workerError('Worker pool closed before quote completion.'));
        slot.pending = null;
      }
      await Promise.all(slots.map(async ({ worker }) => worker.terminate()));
    },
  });
}
