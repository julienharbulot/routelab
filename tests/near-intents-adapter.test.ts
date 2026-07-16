import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  draftNearSolverQuoteExactInput,
  parseNearQuoteParamsExactInput,
  prepareNearIntentsFixtureAdapter,
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

void test('parses the official exact-input public quote parameter subset', async () => {
  const request = await json('fixtures/near-intents/public-quote-official-example.json');
  const result = parseNearQuoteParamsExactInput(request);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected exact-input quote parameters.');
  assert.deepEqual(result.value, request);
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.hasOwn(result.value, 'quote_id'), false);
});

void test('defaults omitted public min_deadline_ms to 60,000 ms', async () => {
  const request = await json(
    'fixtures/near-intents/public-quote-official-example.json',
  ) as Record<string, unknown>;
  delete request['min_deadline_ms'];
  const result = parseNearQuoteParamsExactInput(request);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected defaulted exact-input quote parameters.');
  assert.equal(result.value.min_deadline_ms, 60_000);
  assert.equal(Object.isFrozen(result.value), true);
});

void test('rejects exact-output-only and simultaneous public or solver fields as unsupported', async () => {
  const adapter = await prepared();
  const base = await json(
    'fixtures/near-intents/quote-params-exact-input.json',
  ) as Record<string, unknown>;
  for (const request of [
    {
      defuse_asset_identifier_in: base['defuse_asset_identifier_in'],
      defuse_asset_identifier_out: base['defuse_asset_identifier_out'],
      exact_amount_out: '10',
      min_deadline_ms: base['min_deadline_ms'],
    },
    { ...base, exact_amount_out: '10' },
  ]) {
    const expected = {
      ok: false,
      error: {
        code: 'exact-output-unsupported',
        message: 'The fixture supports exact-input quotes only; exact_amount_out is unsupported.',
        field: 'exact_amount_out',
      },
    };
    assert.deepEqual(parseNearQuoteParamsExactInput(request), expected);
    assert.deepEqual(
      draftNearSolverQuoteExactInput(adapter, { quote_id: 'unsupported-fixture', ...request }),
      expected,
    );
  }
});

void test('solver quote event produces the frozen expected internal unsigned draft', async () => {
  const adapter = await prepared();
  const event = await json('fixtures/near-intents/solver-quote-event-exact-input.json');
  const expected = await json('fixtures/near-intents/expected-unsigned-solver-quote-draft.json');
  const result = draftNearSolverQuoteExactInput(adapter, event);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected unsigned solver quote draft.');
  assert.deepEqual(result.value, expected);
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.quote_output), true);
  assert.equal(Object.isFrozen(result.value.intended_token_diff), true);
  const serialized = JSON.stringify(result.value);
  for (const forbidden of ['signed_data', 'quote_hash', 'nonce', 'signature', 'public_key']) {
    assert.doesNotMatch(serialized, new RegExp(forbidden, 'u'));
  }
});

void test('validates solver quote IDs, canonical amounts, and validity periods', async () => {
  const adapter = await prepared();
  const base = await json(
    'fixtures/near-intents/solver-quote-event-exact-input.json',
  ) as Record<string, unknown>;
  for (const quote_id of ['', 1, 'x'.repeat(201)]) {
    const result = draftNearSolverQuoteExactInput(adapter, { ...base, quote_id });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.field, 'quote_id');
  }
  for (const exact_amount_in of [1, '0', '01', '-1', '1.0', 'x']) {
    const result = draftNearSolverQuoteExactInput(adapter, { ...base, exact_amount_in });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.field, 'exact_amount_in');
  }
  for (const min_deadline_ms of [999, 300_001, 1_000.5, '60000']) {
    const result = draftNearSolverQuoteExactInput(adapter, { ...base, min_deadline_ms });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.field, 'min_deadline_ms');
  }
  const missingValidity = { ...base };
  delete missingValidity['min_deadline_ms'];
  const result = draftNearSolverQuoteExactInput(adapter, missingValidity);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.field, 'min_deadline_ms');
});

void test('rejects invalid explicit public validity types and ranges', async () => {
  const base = await json(
    'fixtures/near-intents/public-quote-official-example.json',
  ) as Record<string, unknown>;
  for (const min_deadline_ms of [undefined, 999, 300_001, 1_000.5, '60000']) {
    const result = parseNearQuoteParamsExactInput({ ...base, min_deadline_ms });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.field, 'min_deadline_ms');
  }
});

void test('requires explicitly mapped fictional assets and rejects shape conflation', async () => {
  const adapter = await prepared();
  const event = await json(
    'fixtures/near-intents/solver-quote-event-exact-input.json',
  ) as Record<string, unknown>;
  for (const override of [
    { defuse_asset_identifier_in: 'nep141:unknown.fixture.invalid' },
    { defuse_asset_identifier_out: 'nep141:unknown.fixture.invalid' },
  ]) {
    const result = draftNearSolverQuoteExactInput(adapter, { ...event, ...override });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'unknown-asset');
  }
  const publicParams = { ...event };
  delete publicParams['quote_id'];
  const missingQuoteId = draftNearSolverQuoteExactInput(adapter, publicParams);
  assert.equal(missingQuoteId.ok, false);
  if (!missingQuoteId.ok) assert.equal(missingQuoteId.error.field, 'quote_id');

  const solverEventAsPublicParams = parseNearQuoteParamsExactInput(event);
  assert.equal(solverEventAsPublicParams.ok, false);
  if (!solverEventAsPublicParams.ok) {
    assert.equal(solverEventAsPublicParams.error.field, 'quote_id');
  }
});

void test('asset map is unique, bounded, snapshot-bound, and closed over snapshot assets', async () => {
  const source = await json('fixtures/near-intents/asset-map.json') as Record<string, unknown>;
  for (const [field, value] of [
    ['snapshotId', 'other'],
    ['snapshotChecksum', 'sha256:other'],
  ] as const) {
    const mismatch = prepareNearIntentsFixtureAdapter(snapshot(), { ...source, [field]: value });
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) {
      assert.equal(mismatch.error.code, 'snapshot-mismatch');
      assert.equal(mismatch.error.field, field);
    }
  }

  const assets = source['assets'] as readonly Record<string, unknown>[];
  for (const duplicate of [
    [assets[0], assets[0]],
    [assets[0], { ...assets[1], snapshot_asset_id: assets[0]?.['snapshot_asset_id'] }],
  ]) {
    const result = prepareNearIntentsFixtureAdapter(snapshot(), { ...source, assets: duplicate });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'invalid-asset-map');
  }

  const absent = prepareNearIntentsFixtureAdapter(snapshot(), {
    ...source,
    assets: [assets[0], { ...assets[1], snapshot_asset_id: 'C' }],
  });
  assert.equal(absent.ok, false);
  if (!absent.ok) {
    assert.equal(absent.error.code, 'invalid-asset-map');
    assert.equal(absent.error.field, 'assets');
  }

  const extra = prepareNearIntentsFixtureAdapter(snapshot(), { ...source, liveEndpoint: true });
  assert.equal(extra.ok, false);
  if (!extra.ok) assert.equal(extra.error.code, 'invalid-asset-map');
});

void test('routing uses the root facade and no adapter reaches routing internals', async () => {
  const source = await readFile('src/adapters/near-intents/adapter.ts', 'utf8');
  assert.match(source, /from '\.\.\/\.\.\/index\.ts'/u);
  assert.match(source, /quote\(state\.context/u);
  assert.doesNotMatch(source, /router\/|runtime\/|replay\/|allocation\//u);
});
