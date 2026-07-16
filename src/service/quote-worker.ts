import { parentPort, workerData } from 'node:worker_threads';

import { prepareSnapshot, quote, serializeQuote } from '../index.ts';
import { parseServiceQuote } from './parse.ts';

interface WorkerInitialization {
  readonly schemaVersion: 'routelab.worker-initialization.v1';
  readonly snapshots: readonly unknown[];
}

interface WorkerQuoteRequest {
  readonly schemaVersion: 'routelab.worker-quote-request.v1';
  readonly requestId: number;
  readonly snapshotId: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: string;
  readonly strategy: string;
  readonly effort: string;
  readonly maxHops?: number;
  readonly maxRoutes?: number;
  readonly deadlineMs?: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function initialization(value: unknown): WorkerInitialization | undefined {
  const input = record(value);
  if (
    input?.['schemaVersion'] !== 'routelab.worker-initialization.v1'
    || !Array.isArray(input['snapshots'])
    || input['snapshots'].length === 0
  ) return undefined;
  return value as WorkerInitialization;
}

function workerRequest(value: unknown): WorkerQuoteRequest | undefined {
  const input = record(value);
  if (
    input?.['schemaVersion'] !== 'routelab.worker-quote-request.v1'
    || !Number.isSafeInteger(input['requestId'])
    || typeof input['snapshotId'] !== 'string'
    || typeof input['assetIn'] !== 'string'
    || typeof input['assetOut'] !== 'string'
    || typeof input['amountIn'] !== 'string'
    || typeof input['strategy'] !== 'string'
    || typeof input['effort'] !== 'string'
  ) return undefined;
  return value as WorkerQuoteRequest;
}

function errorResponse(
  requestId: number,
  code: string,
  message: string,
  field?: string,
): unknown {
  return {
    schemaVersion: 'routelab.worker-quote-response.v1',
    requestId,
    ok: false,
    error: field === undefined ? { code, message } : { code, message, field },
  };
}

const initializationValue = initialization(workerData);
if (initializationValue === undefined || parentPort === null) {
  throw new Error('Worker initialization message is invalid.');
}
const port = parentPort;
const contexts = new Map<string, ReturnType<typeof prepareSnapshot> & { readonly ok: true }>();
for (const snapshot of initializationValue.snapshots) {
  const prepared = prepareSnapshot(snapshot);
  if (!prepared.ok || contexts.has(prepared.value.snapshotId)) {
    throw new Error('Worker snapshot initialization failed.');
  }
  contexts.set(prepared.value.snapshotId, prepared);
}
port.postMessage({
  schemaVersion: 'routelab.worker-ready.v1',
  snapshotCount: contexts.size,
});

port.on('message', (message: unknown) => {
  const request = workerRequest(message);
  if (request === undefined) {
    port.postMessage(errorResponse(-1, 'worker-protocol-error', 'Worker request is invalid.'));
    return;
  }
  const parsed = parseServiceQuote({
    snapshotId: request.snapshotId,
    assetIn: request.assetIn,
    assetOut: request.assetOut,
    amountIn: request.amountIn,
    strategy: request.strategy,
    effort: request.effort,
    ...(request.maxHops === undefined ? {} : { maxHops: request.maxHops }),
    ...(request.maxRoutes === undefined ? {} : { maxRoutes: request.maxRoutes }),
    ...(request.deadlineMs === undefined ? {} : { deadlineMs: request.deadlineMs }),
  });
  if (!parsed.ok) {
    port.postMessage(errorResponse(
      request.requestId,
      parsed.error.code,
      parsed.error.message,
      parsed.error.field,
    ));
    return;
  }
  const context = contexts.get(parsed.value.request.snapshotId);
  if (context === undefined) {
    port.postMessage(errorResponse(
      request.requestId,
      'snapshot-mismatch',
      'Worker snapshot is not loaded.',
    ));
    return;
  }
  const result = quote(context.value, parsed.value.request, parsed.value.options);
  if (!result.ok) {
    port.postMessage(errorResponse(
      request.requestId,
      result.error.code,
      result.error.message,
      'field' in result.error ? result.error.field : undefined,
    ));
    return;
  }
  port.postMessage({
    schemaVersion: 'routelab.worker-quote-response.v1',
    requestId: request.requestId,
    ok: true,
    quote: serializeQuote(result.value),
  });
});
