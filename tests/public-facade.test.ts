import assert from 'node:assert/strict';
import test from 'node:test';

import type { LiquiditySnapshot } from '../src/domain/index.ts';
import {
  formatQuote,
  prepareSnapshot,
  quote,
  serializeQuote,
  type QuoteRequest,
  type RoutingContext,
  type ValidatedQuote,
} from '../src/index.ts';
import { replayExactInputSplit } from '../src/replay/exact-input-split/index.ts';
import { computeCanonicalSnapshotChecksum } from '../src/serialization/canonical-snapshot/index.ts';

type PoolInput = {
  readonly poolId: string;
  readonly asset0: string;
  readonly reserve0: bigint;
  readonly asset1: string;
  readonly reserve1: bigint;
  readonly feeChargedNumerator?: bigint;
  readonly feeDenominator?: bigint;
};

function snapshot(snapshotId: string, pools: readonly PoolInput[]): LiquiditySnapshot {
  const provisional: LiquiditySnapshot = {
    snapshotId,
    snapshotChecksum: 'pending',
    pools: pools.map((pool) => ({
      ...pool,
      feeChargedNumerator: pool.feeChargedNumerator ?? 0n,
      feeDenominator: pool.feeDenominator ?? 1n,
    })),
  };
  return {
    ...provisional,
    snapshotChecksum: computeCanonicalSnapshotChecksum(provisional),
  };
}

function wire(value: LiquiditySnapshot): unknown {
  return {
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    pools: value.pools.map((pool) => ({
      poolId: pool.poolId,
      asset0: pool.asset0,
      reserve0: pool.reserve0.toString(10),
      asset1: pool.asset1,
      reserve1: pool.reserve1.toString(10),
      feeChargedNumerator: pool.feeChargedNumerator.toString(10),
      feeDenominator: pool.feeDenominator.toString(10),
    })),
  };
}

function prepare(value: LiquiditySnapshot): RoutingContext {
  const result = prepareSnapshot(wire(value));
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected snapshot preparation to succeed.');
  return result.value;
}

function request(
  value: LiquiditySnapshot,
  overrides: Partial<QuoteRequest> = {},
): QuoteRequest {
  return {
    snapshotId: value.snapshotId,
    assetIn: 'A',
    assetOut: 'B',
    amountIn: 100n,
    ...overrides,
  };
}

function success(result: ReturnType<typeof quote>): ValidatedQuote {
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected quote success.');
  return result.value;
}

function independentlyReplay(value: LiquiditySnapshot, result: ValidatedQuote): void {
  const replay = replayExactInputSplit(value, {
    snapshotId: result.snapshotId,
    snapshotChecksum: result.snapshotChecksum,
    assetIn: result.assetIn,
    assetOut: result.assetOut,
    amountIn: result.amountIn,
    legs: result.routes.map((route) => ({
      allocation: route.allocation,
      route: route.hops.map(({ poolId, assetIn, assetOut }) => ({
        poolId,
        assetIn,
        assetOut,
      })),
    })),
  });
  assert.equal(replay.ok, true);
  if (replay.ok) assert.equal(replay.value.amountOut, result.amountOut);
}

const direct = snapshot('public-direct', [
  { poolId: 'direct', asset0: 'A', reserve0: 1_000n, asset1: 'B', reserve1: 1_000n },
]);

const twoHop = snapshot('public-two-hop', [
  { poolId: 'direct', asset0: 'A', reserve0: 1_000n, asset1: 'B', reserve1: 1_000n },
  { poolId: 'a-c', asset0: 'A', reserve0: 1_000n, asset1: 'C', reserve1: 2_000n },
  { poolId: 'c-b', asset0: 'C', reserve0: 2_000n, asset1: 'B', reserve1: 2_000n },
]);

const split = snapshot('public-split', [
  { poolId: 'left', asset0: 'A', reserve0: 100n, asset1: 'B', reserve1: 100n },
  { poolId: 'right', asset0: 'A', reserve0: 100n, asset1: 'B', reserve1: 100n },
]);

void test('quotes direct and two-hop exact routes through the root facade', () => {
  const directQuote = success(quote(prepare(direct), request(direct), {
    strategy: 'best-single',
  }));
  assert.equal(directQuote.amountOut, 90n);
  assert.equal(directQuote.planKind, 'single');
  assert.deepEqual(directQuote.routes[0]?.hops.map(({ poolId }) => poolId), ['direct']);
  independentlyReplay(direct, directQuote);

  const twoHopQuote = success(quote(prepare(twoHop), request(twoHop), {
    strategy: 'best-single',
    effort: 'balanced',
  }));
  assert.equal(twoHopQuote.amountOut, 165n);
  assert.deepEqual(twoHopQuote.routes[0]?.hops.map(({ poolId }) => poolId), ['a-c', 'c-b']);
  independentlyReplay(twoHop, twoHopQuote);
});

void test('defaults to a balanced greedy split and matches tiny exhaustive allocation', () => {
  const result = success(quote(prepare(split), request(split)));
  assert.equal(result.requestedStrategy, 'greedy-split');
  assert.equal(result.effort, 'balanced');
  assert.equal(result.planKind, 'split');
  assert.equal(result.amountOut, 66n);
  assert.deepEqual(result.routes.map(({ allocation }) => allocation), [50n, 50n]);

  let exhaustiveBest = 0n;
  for (let left = 1n; left < 100n; left += 1n) {
    const right = 100n - left;
    const output = (left * 100n) / (100n + left) + (right * 100n) / (100n + right);
    if (output > exhaustiveBest) exhaustiveBest = output;
  }
  assert.equal(result.amountOut, exhaustiveBest);
  independentlyReplay(split, result);
});

void test('numerical proposals remain exact-authorized and failures retain the baseline', () => {
  const numerical = success(quote(prepare(split), request(split), {
    strategy: 'numerical-split',
    includeDiagnostics: true,
  }));
  assert.equal(numerical.amountOut, 66n);
  assert.equal(numerical.diagnostics?.numericalIterations !== 0, true);
  independentlyReplay(split, numerical);

  const normalizationFailure = snapshot('public-numerical-failure', [
    { poolId: 'a', asset0: 'A', reserve0: 100n, asset1: 'B', reserve1: 100n },
    { poolId: 'b', asset0: 'A', reserve0: 100n, asset1: 'B', reserve1: 100n },
    { poolId: 'z', asset0: 'A', reserve0: 1n << 1_100n, asset1: 'B', reserve1: 1n },
  ]);
  const fallback = success(quote(
    prepare(normalizationFailure),
    request(normalizationFailure),
    { strategy: 'numerical-split', includeDiagnostics: true },
  ));
  assert.equal(fallback.amountOut, 66n);
  assert.equal(fallback.diagnostics?.numericalFailures !== 0, true);
  independentlyReplay(normalizationFailure, fallback);
});

void test('returns typed public errors for malformed requests and mismatched snapshots', () => {
  const context = prepare(direct);
  assert.deepEqual(quote(context, request(direct, { amountIn: 0n })), {
    ok: false,
    error: { code: 'invalid-request', field: 'amountIn', message: 'amountIn must be positive.' },
  });
  assert.equal(quote(context, request(direct, { assetIn: '' })).ok, false);
  assert.deepEqual(quote(context, request(direct, { snapshotId: 'other' })), {
    ok: false,
    error: {
      code: 'snapshot-mismatch',
      message: 'request.snapshotId must match the prepared snapshot.',
    },
  });
});

void test('deadline stops expose only a valid incumbent or deadline-before-plan', () => {
  const incumbent = success(quote(prepare(direct), request(direct), {
    strategy: 'greedy-split',
    deadlineMs: 0,
  }));
  assert.equal(incumbent.amountOut, 90n);
  assert.equal(incumbent.termination, 'deadline');
  independentlyReplay(direct, incumbent);

  const disconnected = snapshot('public-disconnected', [
    { poolId: 'a-x', asset0: 'A', reserve0: 100n, asset1: 'X', reserve1: 100n },
    { poolId: 'b-y', asset0: 'B', reserve0: 100n, asset1: 'Y', reserve1: 100n },
  ]);
  assert.deepEqual(quote(prepare(disconnected), request(disconnected), { deadlineMs: 0 }), {
    ok: false,
    error: {
      code: 'deadline-before-plan',
      message: 'The deadline was reached before an exact plan was available.',
    },
  });
});

void test('serializes decimal strings, formats routes, and fingerprints semantics only', () => {
  const context = prepare(split);
  const first = success(quote(context, request(split)));
  const second = success(quote(context, request(split)));
  assert.equal(first.semanticFingerprint, second.semanticFingerprint);

  const serialized = serializeQuote(first);
  const roundTrip = JSON.parse(JSON.stringify(serialized)) as Record<string, unknown>;
  assert.equal(roundTrip['amountIn'], '100');
  assert.equal(roundTrip['amountOut'], '66');
  assert.deepEqual(
    (roundTrip['routes'] as Array<Record<string, unknown>>).map(({ allocation }) => allocation),
    ['50', '50'],
  );
  assert.equal(BigInt(roundTrip['amountOut'] as string), first.amountOut);
  assert.match(formatQuote(first), /A 100 -> B 66/u);
  assert.match(formatQuote(first), /left/u);
});

void test('prepareSnapshot rejects malformed exact strings and checksum drift', () => {
  const malformed = wire(direct) as { pools: Array<{ reserve0: string }> };
  malformed.pools[0]!.reserve0 = '01';
  const malformedResult = prepareSnapshot(malformed);
  assert.equal(malformedResult.ok, false);
  if (!malformedResult.ok) assert.equal(malformedResult.error.code, 'invalid-snapshot');

  const mismatched = { ...(wire(direct) as Record<string, unknown>), snapshotChecksum: 'sha256:bad' };
  const mismatchResult = prepareSnapshot(mismatched);
  assert.equal(mismatchResult.ok, false);
  if (!mismatchResult.ok) assert.equal(mismatchResult.error.code, 'snapshot-mismatch');
});
