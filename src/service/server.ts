import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { parseLiquiditySnapshot } from '../domain/index.ts';
import { prepareSnapshot, quote, serializeQuote } from '../index.ts';
import { parseServiceQuote } from './parse.ts';
import { SERVICE_POLICY } from './policy.ts';
import type {
  QuoteHttpService,
  ServiceError,
  ServiceLogger,
  ServiceSnapshot,
} from './types.ts';

interface BodyResult {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: ServiceError;
}

function serviceError(status: number, code: string, message: string, field?: string): ServiceError {
  return Object.freeze(field === undefined
    ? { status, code, message }
    : { status, code, message, field });
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
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
  if (declared !== undefined && (!/^(?:0|[1-9][0-9]*)$/u.test(declared) || Number(declared) > SERVICE_POLICY.bodyBytes)) {
    request.resume();
    return Promise.resolve({
      ok: false,
      error: serviceError(413, 'body-too-large', `Request body exceeds ${SERVICE_POLICY.bodyBytes} bytes.`),
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
          error: serviceError(413, 'body-too-large', `Request body exceeds ${SERVICE_POLICY.bodyBytes} bytes.`),
        });
        return;
      }
      try {
        finish({ ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown });
      } catch {
        finish({ ok: false, error: serviceError(400, 'malformed-json', 'Request body is not valid JSON.') });
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
  if (!parsed.ok || !prepared.ok) throw new Error('Service snapshot failed exact startup preparation.');
  return Object.freeze({
    snapshotId: parsed.value.snapshotId,
    snapshotChecksum: parsed.value.snapshotChecksum,
    poolCount: parsed.value.pools.length,
    assetIds: Object.freeze(new Set(parsed.value.pools.flatMap(({ asset0, asset1 }) => [asset0, asset1]))),
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

export function createQuoteHttpService(
  inputs: readonly unknown[],
  logger: ServiceLogger = (line) => process.stdout.write(`${line}\n`),
): QuoteHttpService {
  const snapshots = inputs.map(prepareServiceSnapshot);
  const snapshotMap = new Map(snapshots.map((snapshot) => [snapshot.snapshotId, snapshot]));
  if (snapshotMap.size !== snapshots.length) throw new Error('Service snapshot IDs must be unique.');
  let nextRequest = 0;
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const started = process.hrtime.bigint();
    nextRequest += 1;
    const requestId = `rl-${nextRequest.toString(10).padStart(8, '0')}`;
    let status = 500;
    try {
      if ((request.url?.length ?? 0) > SERVICE_POLICY.urlLength) {
        status = 414;
        writeJson(response, status, errorBody(requestId, serviceError(status, 'url-too-long', 'Request URL is too long.')));
        return;
      }
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (request.method === 'GET' && pathname === '/health') {
        status = 200;
        writeJson(response, status, { requestId, status: 'ok', snapshotCount: snapshots.length });
        return;
      }
      if (request.method === 'GET' && pathname === '/v1/snapshots') {
        status = 200;
        writeJson(response, status, {
          requestId,
          snapshots: snapshots.map(({ snapshotId, snapshotChecksum, poolCount }) => ({
            snapshotId,
            snapshotChecksum,
            poolCount,
          })),
        });
        return;
      }
      if (pathname !== '/v1/quote') {
        status = 404;
        writeJson(response, status, errorBody(requestId, serviceError(status, 'not-found', 'Endpoint not found.')));
        return;
      }
      if (request.method !== 'POST') {
        status = 405;
        response.setHeader('allow', 'POST');
        writeJson(response, status, errorBody(requestId, serviceError(status, 'method-not-allowed', 'Use POST for /v1/quote.')));
        return;
      }
      const body = await readBody(request);
      if (!body.ok) {
        const error = body.error ?? serviceError(400, 'request-read-failed', 'Request body could not be read.');
        status = error.status;
        writeJson(response, status, errorBody(requestId, error));
        return;
      }
      const parsed = parseServiceQuote(body.value);
      if (!parsed.ok) {
        status = parsed.error.status;
        writeJson(response, status, errorBody(requestId, parsed.error));
        return;
      }
      const snapshot = snapshotMap.get(parsed.value.request.snapshotId);
      if (snapshot === undefined) {
        status = 404;
        writeJson(response, status, errorBody(requestId, serviceError(status, 'unknown-snapshot', 'Snapshot is not loaded.', 'snapshotId')));
        return;
      }
      if (!snapshot.assetIds.has(parsed.value.request.assetIn)) {
        status = 404;
        writeJson(response, status, errorBody(requestId, serviceError(status, 'unknown-asset', 'Input asset is not in the snapshot.', 'assetIn')));
        return;
      }
      if (!snapshot.assetIds.has(parsed.value.request.assetOut)) {
        status = 404;
        writeJson(response, status, errorBody(requestId, serviceError(status, 'unknown-asset', 'Output asset is not in the snapshot.', 'assetOut')));
        return;
      }
      const result = quote(snapshot.context, parsed.value.request, parsed.value.options);
      if (!result.ok) {
        const error = quoteError(result);
        status = error.status;
        writeJson(response, status, errorBody(requestId, error));
        return;
      }
      status = 200;
      writeJson(response, status, { requestId, ...serializeQuote(result.value) });
    } catch {
      status = 500;
      if (!response.headersSent) {
        writeJson(response, status, errorBody(requestId, serviceError(status, 'internal-error', 'The quote service failed.')));
      } else if (!response.writableEnded) {
        response.end();
      }
    } finally {
      const elapsedMicros = Number((process.hrtime.bigint() - started) / 1_000n);
      logger(JSON.stringify({ requestId, method: request.method, path: request.url, status, elapsedMicros }));
    }
  };
  const server = createServer((request, response) => {
    void handle(request, response);
  });
  return Object.freeze({
    server,
    snapshots: Object.freeze(snapshots.map(({ snapshotId, snapshotChecksum, poolCount }) => Object.freeze({
      snapshotId,
      snapshotChecksum,
      poolCount,
    }))),
  });
}

export async function closeQuoteHttpService(service: QuoteHttpService): Promise<void> {
  const closed = new Promise<void>((resolve, reject) => {
    service.server.close((error) => error === undefined ? resolve() : reject(error));
  });
  service.server.closeIdleConnections();
  await closed;
}
