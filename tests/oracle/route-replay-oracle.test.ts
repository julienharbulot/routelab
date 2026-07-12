import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../../src/domain/index.ts';
import {
  replayExactInputRoute,
  type DirectionalRouteHop,
  type ExactInputRouteReplayRequest,
} from '../../src/replay/exact-input-route/index.ts';

interface OracleTransitionReceipt {
  readonly poolId: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly reserveInBefore: bigint;
  readonly reserveOutBefore: bigint;
  readonly reserveInAfter: bigint;
  readonly reserveOutAfter: bigint;
}

type OracleReplayOutcome =
  | {
      readonly ok: true;
      readonly value: {
        readonly snapshotId: string;
        readonly snapshotChecksum: string;
        readonly assetIn: string;
        readonly assetOut: string;
        readonly amountIn: bigint;
        readonly amountOut: bigint;
        readonly hops: readonly OracleTransitionReceipt[];
      };
    }
  | { readonly ok: false; readonly hopIndex: number };

interface ExpectedFailure {
  readonly code: string;
  readonly hopIndex: number | null;
  readonly causeCode: string | null;
}

function oracleTransition(
  pool: ConstantProductPool,
  hop: DirectionalRouteHop,
  amountIn: bigint,
): { readonly pool: ConstantProductPool; readonly receipt: OracleTransitionReceipt } | null {
  const forward = pool.asset0 === hop.assetIn && pool.asset1 === hop.assetOut;
  const reverse = pool.asset1 === hop.assetIn && pool.asset0 === hop.assetOut;
  if (!forward && !reverse) {
    throw new Error('The bounded oracle accepts only prevalidated directed pool pairs.');
  }

  const reserveIn = forward ? pool.reserve0 : pool.reserve1;
  const reserveOut = forward ? pool.reserve1 : pool.reserve0;
  const retainedMultiplier = pool.feeDenominator - pool.feeChargedNumerator;
  const numerator = amountIn * retainedMultiplier * reserveOut;
  const denominator = reserveIn * pool.feeDenominator + amountIn * retainedMultiplier;

  // Deliberately avoid division: bounded multiplication comparisons independently
  // identify the greatest integer output whose scaled value does not exceed N.
  let amountOut = 0n;
  for (let candidate = 1n; candidate <= reserveOut; candidate += 1n) {
    if (candidate * denominator > numerator) break;
    amountOut = candidate;
  }
  if (amountOut === 0n) return null;

  const reserveInAfter = reserveIn + amountIn;
  const reserveOutAfter = reserveOut - amountOut;
  const transitionedPool: ConstantProductPool = {
    ...pool,
    reserve0: forward ? reserveInAfter : reserveOutAfter,
    reserve1: forward ? reserveOutAfter : reserveInAfter,
  };

  return {
    pool: transitionedPool,
    receipt: {
      poolId: pool.poolId,
      assetIn: hop.assetIn,
      assetOut: hop.assetOut,
      amountIn,
      amountOut,
      reserveInBefore: reserveIn,
      reserveOutBefore: reserveOut,
      reserveInAfter,
      reserveOutAfter,
    },
  };
}

function oracleReplay(
  snapshot: LiquiditySnapshot,
  request: ExactInputRouteReplayRequest,
): OracleReplayOutcome {
  const localPools = new Map(snapshot.pools.map((pool) => [pool.poolId, { ...pool }]));
  const receipts: OracleTransitionReceipt[] = [];
  let amountIn = request.amountIn;

  for (const [hopIndex, hop] of request.hops.entries()) {
    const pool = localPools.get(hop.poolId);
    if (pool === undefined) {
      throw new Error('The bounded oracle accepts only routes over known pools.');
    }
    const transition = oracleTransition(pool, hop, amountIn);
    if (transition === null) return { ok: false, hopIndex };

    localPools.set(hop.poolId, transition.pool);
    receipts.push(transition.receipt);
    amountIn = transition.receipt.amountOut;
  }

  return {
    ok: true,
    value: {
      snapshotId: request.snapshotId,
      snapshotChecksum: request.snapshotChecksum,
      assetIn: request.assetIn,
      assetOut: request.assetOut,
      amountIn: request.amountIn,
      amountOut: amountIn,
      hops: receipts,
    },
  };
}

function m0Snapshot(): LiquiditySnapshot {
  return {
    snapshotId: 'm0-snapshot',
    snapshotChecksum: 'm0-checksum',
    pools: [
      {
        poolId: 'direct-ac',
        asset0: 'A',
        reserve0: 1_000n,
        asset1: 'C',
        reserve1: 1_000n,
        feeChargedNumerator: 0n,
        feeDenominator: 1n,
      },
      {
        poolId: 'hop-ab',
        asset0: 'A',
        reserve0: 1_000n,
        asset1: 'B',
        reserve1: 2_000n,
        feeChargedNumerator: 0n,
        feeDenominator: 1n,
      },
      {
        poolId: 'hop-bc',
        asset0: 'B',
        reserve0: 2_000n,
        asset1: 'C',
        reserve1: 2_000n,
        feeChargedNumerator: 0n,
        feeDenominator: 1n,
      },
    ],
  };
}

function m0Request(): ExactInputRouteReplayRequest {
  return {
    snapshotId: 'm0-snapshot',
    snapshotChecksum: 'm0-checksum',
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 100n,
    hops: [
      { assetIn: 'A', poolId: 'hop-ab', assetOut: 'B' },
      { assetIn: 'B', poolId: 'hop-bc', assetOut: 'C' },
    ],
  };
}

function validationSnapshot(): LiquiditySnapshot {
  return {
    snapshotId: 'validation-snapshot',
    snapshotChecksum: 'validation-checksum',
    pools: [
      {
        poolId: 'pool-ab',
        asset0: 'A',
        reserve0: 100n,
        asset1: 'B',
        reserve1: 200n,
        feeChargedNumerator: 0n,
        feeDenominator: 1n,
      },
      {
        poolId: 'pool-bc',
        asset0: 'B',
        reserve0: 200n,
        asset1: 'C',
        reserve1: 300n,
        feeChargedNumerator: 1n,
        feeDenominator: 10n,
      },
      {
        poolId: 'pool-cd',
        asset0: 'C',
        reserve0: 300n,
        asset1: 'D',
        reserve1: 400n,
        feeChargedNumerator: 0n,
        feeDenominator: 1n,
      },
      {
        poolId: 'tiny-az',
        asset0: 'A',
        reserve0: 1_000n,
        asset1: 'Z',
        reserve1: 1n,
        feeChargedNumerator: 0n,
        feeDenominator: 1n,
      },
      {
        poolId: 'tiny-bz',
        asset0: 'B',
        reserve0: 1_000n,
        asset1: 'Z',
        reserve1: 1n,
        feeChargedNumerator: 0n,
        feeDenominator: 1n,
      },
    ],
  };
}

function validationRequest(
  overrides: Partial<ExactInputRouteReplayRequest> = {},
): ExactInputRouteReplayRequest {
  return {
    snapshotId: 'validation-snapshot',
    snapshotChecksum: 'validation-checksum',
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 10n,
    hops: [
      { assetIn: 'A', poolId: 'pool-ab', assetOut: 'B' },
      { assetIn: 'B', poolId: 'pool-bc', assetOut: 'C' },
    ],
    ...overrides,
  };
}

function assertAtomicFailure(
  snapshot: LiquiditySnapshot,
  request: ExactInputRouteReplayRequest,
  expected: ExpectedFailure,
): void {
  const snapshotBefore = structuredClone(snapshot);
  const requestBefore = structuredClone(request);

  const result = replayExactInputRoute(snapshot, request);
  const repeated = replayExactInputRoute(snapshot, request);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, expected.code);
  assert.equal(result.error.hopIndex, expected.hopIndex);
  assert.equal(result.error.causeCode, expected.causeCode);
  assert.equal(result.error.message.length > 0, true);
  assert.deepEqual(repeated, result);
  assert.equal('value' in result, false);
  assert.equal('hops' in result.error, false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.error), true);
  assert.deepEqual(snapshot, snapshotBefore);
  assert.deepEqual(request, requestBefore);
}

void test('reproduces the independent M0 two-hop golden receipt exactly', () => {
  const snapshot = m0Snapshot();
  const request = m0Request();
  const snapshotBefore = structuredClone(snapshot);
  const requestBefore = structuredClone(request);

  const result = replayExactInputRoute(snapshot, request);
  const repeated = replayExactInputRoute(snapshot, request);

  assert.deepEqual(result, {
    ok: true,
    value: {
      snapshotId: 'm0-snapshot',
      snapshotChecksum: 'm0-checksum',
      assetIn: 'A',
      assetOut: 'C',
      amountIn: 100n,
      amountOut: 165n,
      hops: [
        {
          poolId: 'hop-ab',
          assetIn: 'A',
          assetOut: 'B',
          amountIn: 100n,
          amountOut: 181n,
          reserveInBefore: 1_000n,
          reserveOutBefore: 2_000n,
          reserveInAfter: 1_100n,
          reserveOutAfter: 1_819n,
        },
        {
          poolId: 'hop-bc',
          assetIn: 'B',
          assetOut: 'C',
          amountIn: 181n,
          amountOut: 165n,
          reserveInBefore: 2_000n,
          reserveOutBefore: 2_000n,
          reserveInAfter: 2_181n,
          reserveOutAfter: 1_835n,
        },
      ],
    },
  });
  assert.deepEqual(repeated, result);
  assert.deepEqual(snapshot, snapshotBefore);
  assert.deepEqual(request, requestBefore);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.hops), true);
  for (const receipt of result.value.hops) {
    assert.equal(Object.isFrozen(receipt), true);
  }
  assert.notEqual(result.value.hops, request.hops);
});

void test('agrees with a multiplication-only oracle over 192 bounded unique chains', () => {
  let successfulChains = 0;
  let zeroOutputChains = 0;
  let laterZeroOutputChains = 0;

  for (let seed = 0n; seed < 192n; seed += 1n) {
    const hopCount = Number(seed % 3n) + 1;
    const hops: DirectionalRouteHop[] = [];
    const pools: ConstantProductPool[] = [];

    for (let hopIndex = 0, hopSeed = 0n; hopIndex < hopCount; hopIndex += 1, hopSeed += 1n) {
      const assetIn = `asset-${seed.toString()}-${hopIndex.toString()}`;
      const assetOut = `asset-${seed.toString()}-${(hopIndex + 1).toString()}`;
      const poolId = `pool-${seed.toString()}-${hopIndex.toString()}`;
      const reserveIn = 1n + ((seed * 7n + hopSeed * 5n) % 17n);
      const reserveOut = 1n + ((seed * 11n + hopSeed * 3n) % 17n);
      const feeDenominator = 1n + ((seed + hopSeed) % 5n);
      const feeChargedNumerator = (seed * 2n + hopSeed) % feeDenominator;
      const forward = (seed + hopSeed) % 2n === 0n;

      hops.push({ assetIn, poolId, assetOut });
      pools.push({
        poolId,
        asset0: forward ? assetIn : assetOut,
        reserve0: forward ? reserveIn : reserveOut,
        asset1: forward ? assetOut : assetIn,
        reserve1: forward ? reserveOut : reserveIn,
        feeChargedNumerator,
        feeDenominator,
      });
    }

    const snapshot: LiquiditySnapshot = {
      snapshotId: `bounded-snapshot-${seed.toString()}`,
      snapshotChecksum: `bounded-checksum-${seed.toString()}`,
      pools,
    };
    const request: ExactInputRouteReplayRequest = {
      snapshotId: snapshot.snapshotId,
      snapshotChecksum: snapshot.snapshotChecksum,
      assetIn: `asset-${seed.toString()}-0`,
      assetOut: `asset-${seed.toString()}-${hopCount.toString()}`,
      amountIn: 1n + (seed % 8n),
      hops,
    };

    const expected = oracleReplay(snapshot, request);
    const actual = replayExactInputRoute(snapshot, request);
    if (expected.ok) {
      successfulChains += 1;
      assert.deepEqual(actual, expected, `bounded seed ${seed.toString()}`);
    } else {
      zeroOutputChains += 1;
      if (expected.hopIndex > 0) laterZeroOutputChains += 1;
      assert.equal(actual.ok, false, `bounded seed ${seed.toString()}`);
      if (actual.ok) continue;
      assert.equal(actual.error.code, 'hop-transition-failed');
      assert.equal(actual.error.hopIndex, expected.hopIndex);
      assert.equal(actual.error.causeCode, 'zero-output-ineligible');
      assert.equal('value' in actual, false);
    }
  }

  assert.equal(successfulChains > 0, true);
  assert.equal(zeroOutputChains > 0, true);
  assert.equal(laterZeroOutputChains > 0, true);
  assert.equal(successfulChains + zeroOutputChains, 192);
});

void test('chains exact values far above the safe-integer range without number conversion', () => {
  const unit = 10n ** 80n;
  const snapshot: LiquiditySnapshot = {
    snapshotId: 'huge-snapshot',
    snapshotChecksum: 'huge-checksum',
    pools: [
      {
        poolId: 'huge-ab',
        asset0: 'A',
        reserve0: 6n * unit,
        asset1: 'B',
        reserve1: 18n * unit,
        feeChargedNumerator: 0n,
        feeDenominator: 1n,
      },
      {
        poolId: 'huge-bc-reverse',
        asset0: 'C',
        reserve0: 24n * unit,
        asset1: 'B',
        reserve1: 18n * unit,
        feeChargedNumerator: 0n,
        feeDenominator: 1n,
      },
    ],
  };
  const request: ExactInputRouteReplayRequest = {
    snapshotId: 'huge-snapshot',
    snapshotChecksum: 'huge-checksum',
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 6n * unit,
    hops: [
      { assetIn: 'A', poolId: 'huge-ab', assetOut: 'B' },
      { assetIn: 'B', poolId: 'huge-bc-reverse', assetOut: 'C' },
    ],
  };

  assert.deepEqual(replayExactInputRoute(snapshot, request), {
    ok: true,
    value: {
      snapshotId: 'huge-snapshot',
      snapshotChecksum: 'huge-checksum',
      assetIn: 'A',
      assetOut: 'C',
      amountIn: 6n * unit,
      amountOut: 8n * unit,
      hops: [
        {
          poolId: 'huge-ab',
          assetIn: 'A',
          assetOut: 'B',
          amountIn: 6n * unit,
          amountOut: 9n * unit,
          reserveInBefore: 6n * unit,
          reserveOutBefore: 18n * unit,
          reserveInAfter: 12n * unit,
          reserveOutAfter: 9n * unit,
        },
        {
          poolId: 'huge-bc-reverse',
          assetIn: 'B',
          assetOut: 'C',
          amountIn: 9n * unit,
          amountOut: 8n * unit,
          reserveInBefore: 18n * unit,
          reserveOutBefore: 24n * unit,
          reserveInAfter: 27n * unit,
          reserveOutAfter: 16n * unit,
        },
      ],
    },
  });
});

void test('returns deterministic atomic failures in the frozen precedence order', () => {
  const snapshot = validationSnapshot();
  const cases: readonly {
    readonly name: string;
    readonly request: ExactInputRouteReplayRequest;
    readonly expected: ExpectedFailure;
  }[] = [
    {
      name: 'snapshot identity precedes every malformed request field',
      request: validationRequest({
        snapshotId: '',
        assetIn: '',
        assetOut: '',
        amountIn: 0n,
        hops: [],
      }),
      expected: { code: 'snapshot-identity-mismatch', hopIndex: null, causeCode: null },
    },
    {
      name: 'checksum independently pins identity',
      request: validationRequest({ snapshotChecksum: 'different-checksum' }),
      expected: { code: 'snapshot-identity-mismatch', hopIndex: null, causeCode: null },
    },
    {
      name: 'request assetIn emptiness precedes assetOut and input',
      request: validationRequest({ assetIn: '', assetOut: '', amountIn: 0n }),
      expected: { code: 'empty-identifier', hopIndex: null, causeCode: null },
    },
    {
      name: 'request assetOut emptiness precedes input',
      request: validationRequest({ assetOut: '', amountIn: 0n }),
      expected: { code: 'empty-identifier', hopIndex: null, causeCode: null },
    },
    {
      name: 'nonpositive input precedes same-asset and empty route',
      request: validationRequest({ assetOut: 'A', amountIn: 0n, hops: [] }),
      expected: { code: 'nonpositive-input', hopIndex: null, causeCode: null },
    },
    {
      name: 'negative input is also nonpositive',
      request: validationRequest({ amountIn: -1n }),
      expected: { code: 'nonpositive-input', hopIndex: null, causeCode: null },
    },
    {
      name: 'same asset precedes empty route',
      request: validationRequest({ assetOut: 'A', hops: [] }),
      expected: { code: 'same-asset-request', hopIndex: null, causeCode: null },
    },
    {
      name: 'empty route is request-level',
      request: validationRequest({ hops: [] }),
      expected: { code: 'empty-route', hopIndex: null, causeCode: null },
    },
    {
      name: 'empty hop identifier precedes route-start mismatch',
      request: validationRequest({
        hops: [{ assetIn: '', poolId: '', assetOut: '' }],
      }),
      expected: { code: 'empty-identifier', hopIndex: 0, causeCode: null },
    },
    {
      name: 'empty hop pool ID is rejected',
      request: validationRequest({
        hops: [{ assetIn: 'A', poolId: '', assetOut: 'C' }],
      }),
      expected: { code: 'empty-identifier', hopIndex: 0, causeCode: null },
    },
    {
      name: 'empty hop output asset is rejected',
      request: validationRequest({
        hops: [{ assetIn: 'A', poolId: 'pool-ab', assetOut: '' }],
      }),
      expected: { code: 'empty-identifier', hopIndex: 0, causeCode: null },
    },
    {
      name: 'route start reports index zero',
      request: validationRequest({
        hops: [
          { assetIn: 'X', poolId: 'pool-ab', assetOut: 'B' },
          { assetIn: 'B', poolId: 'pool-bc', assetOut: 'C' },
        ],
      }),
      expected: { code: 'route-start-mismatch', hopIndex: 0, causeCode: null },
    },
    {
      name: 'noncontiguous route reports the later offending hop',
      request: validationRequest({
        hops: [
          { assetIn: 'A', poolId: 'pool-ab', assetOut: 'B' },
          { assetIn: 'X', poolId: 'pool-bc', assetOut: 'C' },
        ],
      }),
      expected: { code: 'noncontiguous-route', hopIndex: 1, causeCode: null },
    },
    {
      name: 'duplicate pool precedes snapshot lookup and direction',
      request: validationRequest({
        hops: [
          { assetIn: 'A', poolId: 'pool-ab', assetOut: 'B' },
          { assetIn: 'B', poolId: 'pool-ab', assetOut: 'C' },
        ],
      }),
      expected: { code: 'duplicate-pool', hopIndex: 1, causeCode: null },
    },
    {
      name: 'duplicate output asset precedes route-end mismatch',
      request: validationRequest({
        hops: [
          { assetIn: 'A', poolId: 'pool-ab', assetOut: 'B' },
          { assetIn: 'B', poolId: 'pool-bc', assetOut: 'A' },
        ],
      }),
      expected: { code: 'duplicate-asset', hopIndex: 1, causeCode: null },
    },
    {
      name: 'route end precedes pool lookup',
      request: validationRequest({
        assetOut: 'D',
        hops: [
          { assetIn: 'A', poolId: 'pool-ab', assetOut: 'B' },
          { assetIn: 'B', poolId: 'missing-bc', assetOut: 'C' },
        ],
      }),
      expected: { code: 'route-end-mismatch', hopIndex: 1, causeCode: null },
    },
    {
      name: 'unknown pool reports the earliest hop',
      request: validationRequest({
        hops: [
          { assetIn: 'A', poolId: 'missing-ab', assetOut: 'B' },
          { assetIn: 'B', poolId: 'missing-bc', assetOut: 'C' },
        ],
      }),
      expected: { code: 'unknown-pool', hopIndex: 0, causeCode: null },
    },
    {
      name: 'direction at an earlier hop precedes later lookup',
      request: validationRequest({
        hops: [
          { assetIn: 'A', poolId: 'pool-bc', assetOut: 'B' },
          { assetIn: 'B', poolId: 'missing-bc', assetOut: 'C' },
        ],
      }),
      expected: { code: 'pool-direction-mismatch', hopIndex: 0, causeCode: null },
    },
    {
      name: 'later lookup validation precedes earlier execution',
      request: validationRequest({
        hops: [
          { assetIn: 'A', poolId: 'tiny-az', assetOut: 'Z' },
          { assetIn: 'Z', poolId: 'missing-zc', assetOut: 'C' },
        ],
      }),
      expected: { code: 'unknown-pool', hopIndex: 1, causeCode: null },
    },
    {
      name: 'positive zero-output quote becomes an atomic transition failure',
      request: validationRequest({
        assetOut: 'Z',
        amountIn: 1n,
        hops: [{ assetIn: 'A', poolId: 'tiny-az', assetOut: 'Z' }],
      }),
      expected: {
        code: 'hop-transition-failed',
        hopIndex: 0,
        causeCode: 'zero-output-ineligible',
      },
    },
    {
      name: 'later zero-output failure discards an already completed hop',
      request: validationRequest({
        assetOut: 'Z',
        hops: [
          { assetIn: 'A', poolId: 'pool-ab', assetOut: 'B' },
          { assetIn: 'B', poolId: 'tiny-bz', assetOut: 'Z' },
        ],
      }),
      expected: {
        code: 'hop-transition-failed',
        hopIndex: 1,
        causeCode: 'zero-output-ineligible',
      },
    },
  ];

  for (const current of cases) {
    assertAtomicFailure(snapshot, current.request, current.expected);
  }
});
