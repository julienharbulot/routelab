import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  prepareNearIntentsFixtureAdapter,
  quoteNearIntentsExactInput,
} from '../src/adapters/near-intents/index.ts';
import type { LiquiditySnapshot } from '../src/domain/index.ts';
import { computeCanonicalSnapshotChecksum } from '../src/serialization/canonical-snapshot/index.ts';

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

function snapshot(): unknown {
  const pending: LiquiditySnapshot = {
    snapshotId: 'near-intents-local-fixture',
    snapshotChecksum: 'pending',
    pools: [
      {
        poolId: 'local-left', asset0: 'A', reserve0: 100n, asset1: 'B', reserve1: 100n,
        feeChargedNumerator: 0n, feeDenominator: 1n,
      },
      {
        poolId: 'local-right', asset0: 'A', reserve0: 100n, asset1: 'B', reserve1: 100n,
        feeChargedNumerator: 0n, feeDenominator: 1n,
      },
    ],
  };
  return {
    ...pending,
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

async function prepared() {
  const result = prepareNearIntentsFixtureAdapter(
    snapshot(),
    await json('fixtures/near-intents/asset-map.json'),
  );
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected adapter preparation.');
  return result.value;
}

void test('fixture exact-input request produces the frozen expected unsigned candidate', async () => {
  const adapter = await prepared();
  const request = await json('fixtures/near-intents/exact-input-request.json');
  const expected = await json('fixtures/near-intents/expected-unsigned-quote.json');
  const result = quoteNearIntentsExactInput(adapter, request);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected unsigned quote.');
  assert.deepEqual(result.value, expected);
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(result.value.unsigned, true);
  assert.equal(Object.hasOwn(result.value, 'signed_data'), false);
  assert.equal(Object.hasOwn(result.value, 'quote_hash'), false);
});

void test('rejects exact output before other quote-shape validation', async () => {
  const result = quoteNearIntentsExactInput(await prepared(), {
    exact_amount_out: '10',
  });
  assert.deepEqual(result, {
    ok: false,
    error: {
      code: 'exact-output-unsupported',
      message: 'Fixture adapter supports exact input only.',
      field: 'exact_amount_out',
    },
  });
});

void test('rejects noncanonical amounts and unreasonable validity periods', async () => {
  const adapter = await prepared();
  const base = await json('fixtures/near-intents/exact-input-request.json') as Record<string, unknown>;
  for (const exact_amount_in of [1, '0', '01', '-1', '1.0', 'x']) {
    const result = quoteNearIntentsExactInput(adapter, { ...base, exact_amount_in });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.field, 'exact_amount_in');
  }
  for (const min_deadline_ms of [999, 300_001, 1_000.5, '60000']) {
    const result = quoteNearIntentsExactInput(adapter, { ...base, min_deadline_ms });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.field, 'min_deadline_ms');
  }
});

void test('requires explicit mapped fictional assets and rejects unknown fields', async () => {
  const adapter = await prepared();
  const base = await json('fixtures/near-intents/exact-input-request.json') as Record<string, unknown>;
  for (const override of [
    { defuse_asset_identifier_in: 'nep141:unknown.fixture.invalid' },
    { defuse_asset_identifier_out: 'nep141:unknown.fixture.invalid' },
  ]) {
    const result = quoteNearIntentsExactInput(adapter, { ...base, ...override });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'unknown-asset');
  }
  const unknown = quoteNearIntentsExactInput(adapter, { ...base, quote_id: 'not-supported' });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.error.code, 'invalid-request');
});

void test('asset map is closed, unique, bounded, and snapshot-bound', async () => {
  const source = await json('fixtures/near-intents/asset-map.json') as Record<string, unknown>;
  const mismatch = prepareNearIntentsFixtureAdapter(snapshot(), { ...source, snapshotId: 'other' });
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.equal(mismatch.error.code, 'snapshot-mismatch');

  const assets = source['assets'] as readonly Record<string, unknown>[];
  const duplicate = prepareNearIntentsFixtureAdapter(snapshot(), {
    ...source,
    assets: [assets[0], assets[0]],
  });
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.error.code, 'invalid-asset-map');

  const extra = prepareNearIntentsFixtureAdapter(snapshot(), { ...source, liveEndpoint: true });
  assert.equal(extra.ok, false);
  if (!extra.ok) assert.equal(extra.error.code, 'invalid-asset-map');
});

void test('adapter implementation depends on the root facade rather than routing internals', async () => {
  const source = await readFile('src/adapters/near-intents/adapter.ts', 'utf8');
  assert.match(source, /from '\.\.\/\.\.\/index\.ts'/u);
  assert.doesNotMatch(source, /router\/|runtime\/|replay\/|allocation\//u);
});
