import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { parseLiquiditySnapshot, type LiquiditySnapshot } from '../src/domain/index.ts';
import { prepareSnapshot, quote, serializeQuote } from '../src/index.ts';
import { computeCanonicalSnapshotChecksum } from '../src/serialization/canonical-snapshot/index.ts';
import {
  closeQuoteHttpService,
  createQuoteHttpService,
  SERVICE_POLICY,
  startQuoteServiceProcess,
  type QuoteHttpService,
  type ServiceQuoteExecutor,
} from '../src/service/index.ts';
import { parseServiceQuote } from '../src/service/parse.ts';
import { createWorkerQuoteExecutor } from '../src/service/worker-pool.ts';
import { parseSerializedQuote } from '../src/service/serialized-quote.ts';
import type { ServiceExecutionResult, ServiceSnapshot } from '../src/service/types.ts';

function wireSnapshot(): unknown {
  const pending: LiquiditySnapshot = {
    snapshotId: 'http-fixture',
    snapshotChecksum: 'pending',
    pools: [
      {
        poolId: 'left', asset0: 'A', reserve0: 100n, asset1: 'B', reserve1: 100n,
        feeChargedNumerator: 0n, feeDenominator: 1n,
      },
      {
        poolId: 'right', asset0: 'A', reserve0: 100n, asset1: 'B', reserve1: 100n,
        feeChargedNumerator: 0n, feeDenominator: 1n,
      },
    ],
  };
  return {
    snapshotId: pending.snapshotId,
    snapshotChecksum: computeCanonicalSnapshotChecksum(pending),
    pools: pending.pools.map((pool) => ({
      ...pool,
      reserve0: pool.reserve0.toString(10),
      reserve1: pool.reserve1.toString(10),
      feeChargedNumerator: pool.feeChargedNumerator.toString(10),
      feeDenominator: pool.feeDenominator.toString(10),
    })),
  };
}

async function start(executor?: ServiceQuoteExecutor): Promise<{
  readonly service: QuoteHttpService;
  readonly base: string;
  readonly logs: string[];
}> {
  const logs: string[] = [];
  const service = createQuoteHttpService([wireSnapshot()], (line) => logs.push(line), executor);
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  const address = service.server.address() as AddressInfo;
  return { service, base: `http://127.0.0.1:${address.port}`, logs };
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

function controlledExecutor(maximumQueuedWork = 1): {
  readonly executor: ServiceQuoteExecutor;
  readonly calls: () => number;
  readonly pending: () => number;
  readonly releaseOne: () => void;
} {
  let calls = 0;
  const releases: (() => void)[] = [];
  return {
    executor: {
      maximumActiveWork: 1,
      maximumQueuedWork,
      execute: (snapshot, parsed, options) => new Promise<ServiceExecutionResult>((resolve) => {
        calls += 1;
        releases.push(() => {
          const result = quote(snapshot.context, parsed.request, options);
          if (!result.ok) throw new Error(`Controlled quote failed: ${result.error.code}.`);
          resolve(Object.freeze({ ok: true, value: serializeQuote(result.value) }));
        });
      }),
      close: () => Promise.resolve(),
    },
    calls: () => calls,
    pending: () => releases.length,
    releaseOne: () => {
      const release = releases.shift();
      if (release === undefined) throw new Error('No controlled quote is pending.');
      release();
    },
  };
}

function preparedFixture(): { readonly snapshot: ServiceSnapshot; readonly raw: unknown } {
  const raw = wireSnapshot();
  const parsed = parseLiquiditySnapshot(raw);
  const prepared = prepareSnapshot(raw);
  if (!parsed.ok || !prepared.ok) throw new Error('Test snapshot did not prepare.');
  return {
    raw,
    snapshot: {
      snapshotId: parsed.value.snapshotId,
      snapshotChecksum: parsed.value.snapshotChecksum,
      poolCount: parsed.value.pools.length,
      assetIds: new Set(['A', 'B']),
      context: prepared.value,
    },
  };
}

async function withService(run: (base: string, logs: string[]) => Promise<void>): Promise<void> {
  const { service, base, logs } = await start();
  try {
    await run(base, logs);
  } finally {
    await closeQuoteHttpService(service);
  }
}

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    snapshotId: 'http-fixture',
    assetIn: 'A',
    assetOut: 'B',
    amountIn: '100',
    ...overrides,
  };
}

async function post(base: string, body: string): Promise<Response> {
  return fetch(`${base}/v1/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

void test('health and snapshots expose only prepared immutable snapshot metadata', async () => {
  await withService(async (base, logs) => {
    const health = await fetch(`${base}/health`);
    assert.deepEqual(await health.json(), {
      requestId: 'rl-00000001', status: 'ok', snapshotCount: 1,
    });
    const snapshots = await fetch(`${base}/v1/snapshots`);
    const body = await snapshots.json() as { readonly snapshots?: readonly Record<string, unknown>[] };
    assert.equal(body.snapshots?.[0]?.['snapshotId'], 'http-fixture');
    assert.equal(typeof body.snapshots?.[0]?.['snapshotChecksum'], 'string');
    assert.equal(body.snapshots?.[0]?.['poolCount'], 2);
    assert.equal(logs.length, 2);
  });
});

void test('successful quote returns exact strings, routes, timing, fingerprint, and no diagnostics', async () => {
  await withService(async (base, logs) => {
    const response = await post(base, JSON.stringify(request()));
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body['amountIn'], '100');
    assert.equal(body['amountOut'], '66');
    assert.equal(body['requestedStrategy'], 'greedy-split');
    assert.equal(body['effort'], 'balanced');
    assert.equal(Array.isArray(body['routes']), true);
    assert.equal(typeof body['planFingerprint'], 'string');
    assert.equal(Object.hasOwn(body, 'work'), false);
    assert.equal(typeof body['timing'], 'object');
    assert.equal(Object.hasOwn(body, 'diagnostics'), false);
    const log = JSON.parse(logs[0] ?? '{}') as { readonly status?: unknown };
    assert.equal(log.status, 200);
    assert.deepEqual(Object.keys(log), [
      'requestId',
      'snapshotId',
      'strategy',
      'effort',
      'status',
      'errorCode',
      'termination',
      'routeCount',
      'totalElapsedMicros',
      'queueWaitMicros',
      'quoteServiceMicros',
    ]);
    assert.equal(Object.hasOwn(log, 'amountIn'), false);
    assert.equal(Object.hasOwn(log, 'routes'), false);
  });
});

void test('worker quote boundary rejects malformed required serialized fields', () => {
  const fixture = preparedFixture();
  const result = quote(fixture.snapshot.context, {
    snapshotId: fixture.snapshot.snapshotId,
    assetIn: 'A',
    assetOut: 'B',
    amountIn: 100n,
  });
  if (!result.ok) throw new Error('Serialized worker fixture quote failed.');
  const valid = serializeQuote(result.value);
  assert.deepEqual(parseSerializedQuote(valid), valid);
  const firstRoute = valid.routes[0];
  if (firstRoute === undefined) throw new Error('Serialized worker fixture has no route.');
  const malformed: unknown[] = [
    { ...valid, schemaVersion: 'wrong' },
    { ...valid, snapshotChecksum: 'wrong' },
    { ...valid, amountOut: '01' },
    { ...valid, routes: [] },
    { ...valid, routes: [{ ...firstRoute, hops: [] }] },
    { ...valid, termination: 'unknown' },
    { ...valid, planFingerprint: 'wrong' },
    { ...valid, timing: { elapsedMicros: -1 } },
  ];
  assert.equal(malformed.every((value) => parseSerializedQuote(value) === undefined), true);
});

void test('rejects malformed JSON and never exposes a stack trace', async () => {
  await withService(async (base) => {
    const response = await post(base, '{');
    assert.equal(response.status, 400);
    const text = await response.text();
    assert.match(text, /malformed-json/u);
    assert.doesNotMatch(text, /stack|server\.ts|Error:/u);
  });
});

void test('rejects streamed and declared bodies above 32 KiB', async () => {
  await withService(async (base) => {
    const response = await post(base, JSON.stringify({ padding: 'x'.repeat(SERVICE_POLICY.bodyBytes) }));
    assert.equal(response.status, 413);
    assert.match(await response.text(), /body-too-large/u);
  });
});

void test('rejects JSON numeric and noncanonical decimal amounts', async () => {
  await withService(async (base) => {
    for (const amountIn of [100, '01', '0', '-1', '1.0']) {
      const response = await post(base, JSON.stringify(request({ amountIn })));
      assert.equal(response.status, 400);
      const body = await response.json() as { readonly error?: { readonly field?: string } };
      assert.equal(body.error?.field, 'amountIn');
    }
  });
});

void test('rejects unknown snapshots and assets with typed fields', async () => {
  await withService(async (base) => {
    const snapshot = await post(base, JSON.stringify(request({ snapshotId: 'missing' })));
    assert.equal(snapshot.status, 404);
    assert.match(await snapshot.text(), /unknown-snapshot/u);
    const asset = await post(base, JSON.stringify(request({ assetOut: 'missing' })));
    assert.equal(asset.status, 404);
    assert.match(await asset.text(), /unknown-asset/u);
  });
});

void test('server policy bounds deadline, hops, routes, identifiers, and diagnostics exposure', async () => {
  await withService(async (base) => {
    const invalid = [
      { deadlineMs: SERVICE_POLICY.maxDeadlineMs + 1 },
      { maxHops: SERVICE_POLICY.maxHops + 1 },
      { maxRoutes: SERVICE_POLICY.maxRoutes + 1 },
      { assetIn: 'x'.repeat(SERVICE_POLICY.assetIdLength + 1) },
      { includeDiagnostics: true },
    ];
    for (const override of invalid) {
      const response = await post(base, JSON.stringify(request(override)));
      assert.equal(response.status, 400);
    }
  });
});

void test('graceful shutdown stops the listening server after completed work', async () => {
  const { service, base, logs } = await start();
  assert.equal((await fetch(`${base}/health`)).status, 200);
  await closeQuoteHttpService(service);
  assert.equal(service.server.listening, false);
  assert.equal(logs.length, 1);
});

void test('bounded admission returns typed overload with Retry-After', async () => {
  const controlled = controlledExecutor(1);
  const { service, base } = await start(controlled.executor);
  try {
    const first = post(base, JSON.stringify(request()));
    await waitFor(() => controlled.pending() === 1, 'First quote did not become active.');
    const second = post(base, JSON.stringify(request()));
    await waitFor(
      () => service.readMetrics().maximumQueuedWork === 1,
      'Second quote did not enter the bounded queue.',
    );
    const overloaded = await post(base, JSON.stringify(request()));
    assert.equal(overloaded.status, 503);
    assert.equal(overloaded.headers.get('retry-after'), '1');
    assert.match(await overloaded.text(), /overloaded/u);
    controlled.releaseOne();
    assert.equal((await first).status, 200);
    await waitFor(() => controlled.pending() === 1, 'Queued quote did not start.');
    controlled.releaseOne();
    assert.equal((await second).status, 200);
    assert.equal(service.readMetrics().overloadCount, 1);
  } finally {
    await closeQuoteHttpService(service);
  }
});

void test('queued deadline expiry returns without invoking the router', async () => {
  const controlled = controlledExecutor();
  const { service, base } = await start(controlled.executor);
  try {
    const first = post(base, JSON.stringify(request()));
    await waitFor(() => controlled.pending() === 1, 'First quote did not become active.');
    const expiring = post(base, JSON.stringify(request({ deadlineMs: 0 })));
    await waitFor(
      () => service.readMetrics().maximumQueuedWork === 1,
      'Deadline test quote did not queue.',
    );
    controlled.releaseOne();
    assert.equal((await first).status, 200);
    const expired = await expiring;
    assert.equal(expired.status, 408);
    assert.match(await expired.text(), /deadline-before-plan/u);
    assert.equal(controlled.calls(), 1);
  } finally {
    await closeQuoteHttpService(service);
  }
});

void test('client abort removes queued work before quote execution', async () => {
  const controlled = controlledExecutor();
  const { service, base, logs } = await start(controlled.executor);
  try {
    const first = post(base, JSON.stringify(request()));
    await waitFor(() => controlled.pending() === 1, 'First quote did not become active.');
    let abortRequest: ReturnType<typeof httpRequest> | undefined;
    const aborted = new Promise<void>((resolve) => {
      const body = JSON.stringify(request());
      abortRequest = httpRequest(`${base}/v1/quote`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      });
      abortRequest.once('error', () => resolve());
      abortRequest.end(body);
    });
    await waitFor(
      () => service.readMetrics().maximumQueuedWork === 1,
      'Abort test quote did not queue.',
    );
    abortRequest?.destroy(new Error('test-abort'));
    await aborted;
    await waitFor(
      () => logs.some((line) => line.includes('client-aborted')),
      'Aborted quote completion was not logged.',
    );
    controlled.releaseOne();
    assert.equal((await first).status, 200);
    const abortLog = logs.map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((value) => value['errorCode'] === 'client-aborted');
    assert.equal(abortLog?.['status'], 499);
    assert.equal(controlled.calls(), 1);
  } finally {
    await closeQuoteHttpService(service);
  }
});

void test('child server announces readiness and shuts down across the process boundary', async () => {
  const child = await startQuoteServiceProcess();
  assert.equal(child.mode, 'same-thread');
  assert.equal(child.snapshotCount, 1);
  const health = await fetch(child.endpoint.replace('/v1/quote', '/health'));
  assert.equal(health.status, 200);
  await child.shutdown();
  await assert.rejects(fetch(child.endpoint.replace('/v1/quote', '/health')));
});

void test('worker initializes snapshots once, matches same-thread semantics, and fails closed', async () => {
  const fixture = preparedFixture();
  await assert.rejects(
    createWorkerQuoteExecutor([{ invalid: true }], 1),
    /initialization|snapshot/u,
  );
  const executor = await createWorkerQuoteExecutor([fixture.raw], 1);
  const parsed = parseServiceQuote({
    ...request(),
    strategy: 'greedy-split',
    effort: 'fast',
    maxHops: 1,
    maxRoutes: 2,
    deadlineMs: 1_000,
  });
  if (!parsed.ok) throw new Error('Worker test request did not parse.');
  const direct = quote(fixture.snapshot.context, parsed.value.request, parsed.value.options);
  if (!direct.ok) throw new Error('Same-thread worker comparison quote failed.');
  const worker = await executor.execute(
    fixture.snapshot,
    parsed.value,
    parsed.value.options,
  );
  assert.equal(worker.ok, true);
  if (worker.ok) {
    const expected = serializeQuote(direct.value);
    assert.deepEqual(
      { ...worker.value, timing: undefined },
      { ...expected, timing: undefined },
    );
  }
  await executor.close();
  const closed = await executor.execute(fixture.snapshot, parsed.value, parsed.value.options);
  assert.equal(closed.ok, false);
  if (!closed.ok) assert.equal(closed.error.code, 'worker-failure');
});
