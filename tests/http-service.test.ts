import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import type { LiquiditySnapshot } from '../src/domain/index.ts';
import { computeCanonicalSnapshotChecksum } from '../src/serialization/canonical-snapshot/index.ts';
import {
  closeQuoteHttpService,
  createQuoteHttpService,
  SERVICE_POLICY,
  type QuoteHttpService,
} from '../src/service/index.ts';

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

async function start(): Promise<{
  readonly service: QuoteHttpService;
  readonly base: string;
  readonly logs: string[];
}> {
  const logs: string[] = [];
  const service = createQuoteHttpService([wireSnapshot()], (line) => logs.push(line));
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  const address = service.server.address() as AddressInfo;
  return { service, base: `http://127.0.0.1:${address.port}`, logs };
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
    assert.equal(typeof body['semanticFingerprint'], 'string');
    assert.equal(typeof body['timing'], 'object');
    assert.equal(Object.hasOwn(body, 'diagnostics'), false);
    const log = JSON.parse(logs[0] ?? '{}') as { readonly status?: unknown };
    assert.equal(log.status, 200);
  });
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
