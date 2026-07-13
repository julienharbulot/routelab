import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../../src/domain/index.ts';
import type { ExactInputSplitWorkCaps } from '../../src/router/anytime-exact-input-split/index.ts';
import type { ExactInputSinglePathRouterRequest } from '../../src/router/single-path/index.ts';
import {
  replayExactInputRoute,
  type DirectionalRouteHop,
  type ExactInputRouteReplayError,
  type ExactInputRouteReplayRequest,
  type ExactInputRouteReplayReceipt,
} from '../../src/replay/exact-input-route/index.ts';
import {
  replayExactInputSplit,
  type ExactInputSplitReplayError,
  type ExactInputSplitReplayRequest,
  type ExactInputSplitReplayReceipt,
} from '../../src/replay/exact-input-split/index.ts';
import {
  prepareRoutingContext,
  replayPreparedExactInputSplit,
  type PreparedRoutingContext,
} from '../../src/runtime/prepared-routing-context/index.ts';
import { createCanonicalSinglePathRouterRun } from '../../src/serialization/canonical-router-run/index.ts';
import { createCanonicalSplitRouterRun } from '../../src/serialization/canonical-split-router-run/index.ts';

function compareRawUtf16(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function pool(
  poolId: string,
  asset0: string,
  reserve0: bigint,
  asset1: string,
  reserve1: bigint,
  feeChargedNumerator = 0n,
  feeDenominator = 1n,
): ConstantProductPool {
  return {
    poolId,
    asset0,
    reserve0,
    asset1,
    reserve1,
    feeChargedNumerator,
    feeDenominator,
  };
}

// This deliberately does not import the production canonical snapshot writer.
function independentSnapshotChecksum(value: LiquiditySnapshot): string {
  const pools = [...value.pools]
    .sort((left, right) => compareRawUtf16(left.poolId, right.poolId))
    .map((entry) => ({
      poolId: entry.poolId,
      asset0: entry.asset0,
      reserve0: entry.reserve0.toString(10),
      asset1: entry.asset1,
      reserve1: entry.reserve1.toString(10),
      feeChargedNumerator: entry.feeChargedNumerator.toString(10),
      feeDenominator: entry.feeDenominator.toString(10),
    }));
  const canonical = JSON.stringify({ schemaVersion: 'routelab.snapshot.v1', pools });
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

function snapshot(
  pools: readonly ConstantProductPool[],
  snapshotId = 'kernel-parity-snapshot',
): LiquiditySnapshot {
  const provisional: LiquiditySnapshot = {
    snapshotId,
    snapshotChecksum: 'pending',
    pools,
  };
  return { ...provisional, snapshotChecksum: independentSnapshotChecksum(provisional) };
}

function prepare(value: LiquiditySnapshot): PreparedRoutingContext {
  const result = prepareRoutingContext(value);
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail('independently checksummed snapshot did not prepare');
  return result.value;
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) assertDeepFrozen(Reflect.get(value, key), seen);
}

// Decimal long division keeps expected financial outputs independent from the
// production quote, transition, replay, and proposed kernel implementations.
function floorDivideWithoutDivision(numerator: bigint, denominator: bigint): bigint {
  let quotient = 0n;
  let remainder = 0n;
  for (const digit of numerator.toString(10)) {
    remainder = remainder * 10n + BigInt(digit);
    let quotientDigit = 0n;
    while ((quotientDigit + 1n) * denominator <= remainder) quotientDigit += 1n;
    assert.ok(quotientDigit <= 9n);
    quotient = quotient * 10n + quotientDigit;
    remainder -= quotientDigit * denominator;
  }
  return quotient;
}

interface OracleTransitionReceipt extends DirectionalRouteHop {
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly reserveInBefore: bigint;
  readonly reserveOutBefore: bigint;
  readonly reserveInAfter: bigint;
  readonly reserveOutAfter: bigint;
}

function oracleRouteReceipt(
  value: LiquiditySnapshot,
  request: ExactInputRouteReplayRequest,
): ExactInputRouteReplayReceipt | undefined {
  const states = new Map(value.pools.map((entry) => [entry.poolId, { ...entry }] as const));
  const receipts: OracleTransitionReceipt[] = [];
  let currentAmount = request.amountIn;

  for (const hop of request.hops) {
    const state = states.get(hop.poolId);
    if (state === undefined) return undefined;
    const forward = state.asset0 === hop.assetIn && state.asset1 === hop.assetOut;
    const reverse = state.asset1 === hop.assetIn && state.asset0 === hop.assetOut;
    if (!forward && !reverse) return undefined;
    const reserveIn = forward ? state.reserve0 : state.reserve1;
    const reserveOut = forward ? state.reserve1 : state.reserve0;
    const retained = state.feeDenominator - state.feeChargedNumerator;
    const amountOut = floorDivideWithoutDivision(
      currentAmount * retained * reserveOut,
      reserveIn * state.feeDenominator + currentAmount * retained,
    );
    if (currentAmount > 0n && amountOut === 0n) return undefined;
    const reserveInAfter = reserveIn + currentAmount;
    const reserveOutAfter = reserveOut - amountOut;
    states.set(hop.poolId, {
      ...state,
      reserve0: forward ? reserveInAfter : reserveOutAfter,
      reserve1: forward ? reserveOutAfter : reserveInAfter,
    });
    receipts.push({
      ...hop,
      amountIn: currentAmount,
      amountOut,
      reserveInBefore: reserveIn,
      reserveOutBefore: reserveOut,
      reserveInAfter,
      reserveOutAfter,
    });
    currentAmount = amountOut;
  }

  return {
    snapshotId: request.snapshotId,
    snapshotChecksum: request.snapshotChecksum,
    assetIn: request.assetIn,
    assetOut: request.assetOut,
    amountIn: request.amountIn,
    amountOut: currentAmount,
    hops: receipts,
  };
}

function oracleSplitReceipt(
  value: LiquiditySnapshot,
  request: ExactInputSplitReplayRequest,
): ExactInputSplitReplayReceipt {
  const legs = request.legs.map((leg) => {
    const receipt = oracleRouteReceipt(value, {
      snapshotId: request.snapshotId,
      snapshotChecksum: request.snapshotChecksum,
      assetIn: request.assetIn,
      assetOut: request.assetOut,
      amountIn: leg.allocation,
      hops: leg.route,
    });
    assert.ok(receipt !== undefined, 'oracle success fixture must contain executable legs');
    return { allocation: leg.allocation, receipt };
  });
  return {
    snapshotId: request.snapshotId,
    snapshotChecksum: request.snapshotChecksum,
    assetIn: request.assetIn,
    assetOut: request.assetOut,
    amountIn: request.amountIn,
    amountOut: legs.reduce((sum, leg) => sum + leg.receipt.amountOut, 0n),
    legs,
  };
}

const PARITY_POOLS = [
  pool('a-left-ac', 'A', 100n, 'C', 100n),
  pool('b-right-ac', 'A', 100n, 'C', 100n),
  pool('c-hop-ab', 'A', 1_000n, 'B', 2_000n),
  pool('d-hop-bc', 'B', 2_000n, 'C', 2_000n),
  pool('e-tiny-ac', 'A', 1_000n, 'C', 1n),
  pool('f-wrong-bd', 'B', 100n, 'D', 100n),
] as const;

function routeRequest(
  value: LiquiditySnapshot,
  overrides: Partial<ExactInputRouteReplayRequest> = {},
): ExactInputRouteReplayRequest {
  return {
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 100n,
    hops: [
      { assetIn: 'A', poolId: 'c-hop-ab', assetOut: 'B' },
      { assetIn: 'B', poolId: 'd-hop-bc', assetOut: 'C' },
    ],
    ...overrides,
  };
}

function splitRequest(
  value: LiquiditySnapshot,
  overrides: Partial<ExactInputSplitReplayRequest> = {},
): ExactInputSplitReplayRequest {
  return {
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 100n,
    legs: [
      {
        allocation: 50n,
        route: [{ assetIn: 'A', poolId: 'a-left-ac', assetOut: 'C' }],
      },
      {
        allocation: 50n,
        route: [{ assetIn: 'A', poolId: 'b-right-ac', assetOut: 'C' }],
      },
    ],
    ...overrides,
  };
}

function routeError(
  code: ExactInputRouteReplayError['code'],
  message: string,
  hopIndex: number | null = null,
  causeCode: ExactInputRouteReplayError['causeCode'] = null,
): ExactInputRouteReplayError {
  return { code, message, hopIndex, causeCode };
}

function splitError(
  code: ExactInputSplitReplayError['code'],
  message: string,
  legIndex: number | null = null,
  causeCode: ExactInputSplitReplayError['causeCode'] = null,
): ExactInputSplitReplayError {
  return { code, message, legIndex, causeCode };
}

function assertRouteFailure(
  value: LiquiditySnapshot,
  request: ExactInputRouteReplayRequest,
  expected: ExactInputRouteReplayError,
): void {
  const result = replayExactInputRoute(value, request);
  const repeated = replayExactInputRoute(value, request);
  assert.deepEqual(result, { ok: false, error: expected });
  assert.deepEqual(repeated, { ok: false, error: expected });
  assert.notEqual(result, repeated);
  if (!result.ok && !repeated.ok) assert.notEqual(result.error, repeated.error);
  assertDeepFrozen(result);
  assertDeepFrozen(repeated);
}

function assertSplitParityFailure(
  value: LiquiditySnapshot,
  context: PreparedRoutingContext,
  request: ExactInputSplitReplayRequest,
  expected: ExactInputSplitReplayError,
): void {
  const legacy = replayExactInputSplit(value, request);
  const repeatedLegacy = replayExactInputSplit(value, request);
  const prepared = replayPreparedExactInputSplit(context, request);
  const repeatedPrepared = replayPreparedExactInputSplit(context, request);
  assert.deepEqual(legacy, { ok: false, error: expected });
  assert.deepEqual(repeatedLegacy, { ok: false, error: expected });
  assert.deepEqual(prepared, { ok: false, error: expected });
  assert.deepEqual(repeatedPrepared, { ok: false, error: expected });
  assert.notEqual(legacy, prepared);
  assert.notEqual(legacy, repeatedLegacy);
  assert.notEqual(prepared, repeatedPrepared);
  if (!legacy.ok && !repeatedLegacy.ok) assert.notEqual(legacy.error, repeatedLegacy.error);
  if (!prepared.ok && !repeatedPrepared.ok) {
    assert.notEqual(prepared.error, repeatedPrepared.error);
  }
  assertDeepFrozen(legacy);
  assertDeepFrozen(repeatedLegacy);
  assertDeepFrozen(prepared);
  assertDeepFrozen(repeatedPrepared);
}

void test('hand-derives exact route and split receipts across legacy and prepared replay', () => {
  const value = snapshot(PARITY_POOLS);
  const context = prepare(value);
  const routeInput = routeRequest(value);
  const routeExpected = oracleRouteReceipt(value, routeInput);
  assert.ok(routeExpected !== undefined);

  const routeActual = replayExactInputRoute(value, routeInput);
  assert.deepEqual(routeActual, { ok: true, value: routeExpected });
  assert.equal(routeActual.ok, true);
  if (routeActual.ok) {
    assert.equal(routeActual.value.amountOut, 165n);
    assertDeepFrozen(routeActual);
  }

  const splitInput = splitRequest(value);
  const splitExpected = oracleSplitReceipt(value, splitInput);
  const firstLegacy = replayExactInputSplit(value, splitInput);
  const secondLegacy = replayExactInputSplit(value, splitInput);
  const firstPrepared = replayPreparedExactInputSplit(context, splitInput);
  const secondPrepared = replayPreparedExactInputSplit(context, splitInput);
  for (const actual of [firstLegacy, secondLegacy, firstPrepared, secondPrepared]) {
    assert.deepEqual(actual, { ok: true, value: splitExpected });
    assertDeepFrozen(actual);
  }
  assert.equal(splitExpected.amountOut, 66n);
  assert.notEqual(firstLegacy, secondLegacy);
  assert.notEqual(firstPrepared, secondPrepared);
  if (firstLegacy.ok && secondLegacy.ok && firstPrepared.ok && secondPrepared.ok) {
    assert.notEqual(firstLegacy.value, secondLegacy.value);
    assert.notEqual(firstPrepared.value, secondPrepared.value);
    assert.notEqual(firstLegacy.value.legs, splitInput.legs);
    assert.notEqual(firstPrepared.value.legs, splitInput.legs);
  }
});

void test('preserves every route validation class and first-error precedence', () => {
  const value = snapshot(PARITY_POOLS);
  const cases: readonly [ExactInputRouteReplayRequest, ExactInputRouteReplayError][] = [
    [
      routeRequest(value, { snapshotChecksum: 'wrong', assetIn: '', amountIn: 0n, hops: [] }),
      routeError(
        'snapshot-identity-mismatch',
        'Request snapshotId and snapshotChecksum must match the supplied snapshot.',
      ),
    ],
    [
      routeRequest(value, { assetIn: '', assetOut: '', amountIn: 0n }),
      routeError('empty-identifier', 'request.assetIn must not be empty.'),
    ],
    [
      routeRequest(value, { assetOut: '', amountIn: 0n }),
      routeError('empty-identifier', 'request.assetOut must not be empty.'),
    ],
    [
      routeRequest(value, { amountIn: 0n, assetOut: 'A', hops: [] }),
      routeError('nonpositive-input', 'request.amountIn must be positive.'),
    ],
    [
      routeRequest(value, { assetOut: 'A', hops: [] }),
      routeError(
        'same-asset-request',
        'request.assetIn and request.assetOut must be distinct.',
      ),
    ],
    [
      routeRequest(value, { hops: [] }),
      routeError('empty-route', 'request.hops must contain at least one hop.'),
    ],
    [
      routeRequest(value, { hops: [{ assetIn: '', poolId: '', assetOut: '' }] }),
      routeError('empty-identifier', 'request.hops[0].assetIn must not be empty.', 0),
    ],
    [
      routeRequest(value, { hops: [{ assetIn: 'A', poolId: '', assetOut: '' }] }),
      routeError('empty-identifier', 'request.hops[0].poolId must not be empty.', 0),
    ],
    [
      routeRequest(value, { hops: [{ assetIn: 'A', poolId: 'a-left-ac', assetOut: '' }] }),
      routeError('empty-identifier', 'request.hops[0].assetOut must not be empty.', 0),
    ],
    [
      routeRequest(value, {
        hops: [{ assetIn: 'B', poolId: 'd-hop-bc', assetOut: 'C' }],
      }),
      routeError('route-start-mismatch', 'The first hop assetIn must equal request.assetIn.', 0),
    ],
    [
      routeRequest(value, {
        hops: [
          { assetIn: 'A', poolId: 'c-hop-ab', assetOut: 'B' },
          { assetIn: 'X', poolId: 'd-hop-bc', assetOut: 'C' },
        ],
      }),
      routeError(
        'noncontiguous-route',
        'request.hops[1].assetIn must equal the prior hop assetOut.',
        1,
      ),
    ],
    [
      routeRequest(value, {
        hops: [
          { assetIn: 'A', poolId: 'c-hop-ab', assetOut: 'B' },
          { assetIn: 'B', poolId: 'c-hop-ab', assetOut: 'A' },
        ],
      }),
      routeError('duplicate-pool', 'request.hops[1].poolId repeats an earlier pool.', 1),
    ],
    [
      routeRequest(value, {
        hops: [
          { assetIn: 'A', poolId: 'c-hop-ab', assetOut: 'B' },
          { assetIn: 'B', poolId: 'd-hop-bc', assetOut: 'A' },
        ],
      }),
      routeError('duplicate-asset', 'request.hops[1].assetOut repeats an earlier route asset.', 1),
    ],
    [
      routeRequest(value, {
        hops: [{ assetIn: 'A', poolId: 'c-hop-ab', assetOut: 'B' }],
      }),
      routeError('route-end-mismatch', 'The final hop assetOut must equal request.assetOut.', 0),
    ],
    [
      routeRequest(value, {
        hops: [{ assetIn: 'A', poolId: 'missing-ac', assetOut: 'C' }],
      }),
      routeError(
        'unknown-pool',
        'request.hops[0].poolId does not exist in the supplied snapshot.',
        0,
      ),
    ],
    [
      routeRequest(value, {
        hops: [{ assetIn: 'A', poolId: 'c-hop-ab', assetOut: 'C' }],
      }),
      routeError(
        'pool-direction-mismatch',
        'request.hops[0] does not match either direction of pool c-hop-ab.',
        0,
      ),
    ],
    [
      routeRequest(value, {
        amountIn: 1n,
        hops: [{ assetIn: 'A', poolId: 'e-tiny-ac', assetOut: 'C' }],
      }),
      routeError(
        'hop-transition-failed',
        'Transition failed for request.hops[0]: A positive input that quotes zero output is ineligible for transition.',
        0,
        'zero-output-ineligible',
      ),
    ],
  ];

  for (const [input, expected] of cases) assertRouteFailure(value, input, expected);
});

void test('projects every route execution rejection identically through both split wrappers', () => {
  const value = snapshot(PARITY_POOLS);
  const context = prepare(value);
  const cases: readonly [readonly DirectionalRouteHop[], ExactInputRouteReplayError][] = [
    [
      [{ assetIn: 'B', poolId: 'd-hop-bc', assetOut: 'C' }],
      routeError('route-start-mismatch', 'The first hop assetIn must equal request.assetIn.', 0),
    ],
    [
      [
        { assetIn: 'A', poolId: 'c-hop-ab', assetOut: 'B' },
        { assetIn: 'X', poolId: 'd-hop-bc', assetOut: 'C' },
      ],
      routeError(
        'noncontiguous-route',
        'request.hops[1].assetIn must equal the prior hop assetOut.',
        1,
      ),
    ],
    [
      [
        { assetIn: 'A', poolId: 'c-hop-ab', assetOut: 'B' },
        { assetIn: 'B', poolId: 'c-hop-ab', assetOut: 'C' },
      ],
      routeError('duplicate-pool', 'request.hops[1].poolId repeats an earlier pool.', 1),
    ],
    [
      [
        { assetIn: 'A', poolId: 'c-hop-ab', assetOut: 'B' },
        { assetIn: 'B', poolId: 'd-hop-bc', assetOut: 'A' },
      ],
      routeError('duplicate-asset', 'request.hops[1].assetOut repeats an earlier route asset.', 1),
    ],
    [
      [{ assetIn: 'A', poolId: 'c-hop-ab', assetOut: 'B' }],
      routeError('route-end-mismatch', 'The final hop assetOut must equal request.assetOut.', 0),
    ],
    [
      [{ assetIn: 'A', poolId: 'missing-ac', assetOut: 'C' }],
      routeError(
        'unknown-pool',
        'request.hops[0].poolId does not exist in the supplied snapshot.',
        0,
      ),
    ],
    [
      [{ assetIn: 'A', poolId: 'c-hop-ab', assetOut: 'C' }],
      routeError(
        'pool-direction-mismatch',
        'request.hops[0] does not match either direction of pool c-hop-ab.',
        0,
      ),
    ],
    [
      [{ assetIn: 'A', poolId: 'e-tiny-ac', assetOut: 'C' }],
      routeError(
        'hop-transition-failed',
        'Transition failed for request.hops[0]: A positive input that quotes zero output is ineligible for transition.',
        0,
        'zero-output-ineligible',
      ),
    ],
  ];

  for (const [route, nested] of cases) {
    const amountIn = nested.code === 'hop-transition-failed' ? 1n : 100n;
    const input = splitRequest(value, {
      amountIn,
      legs: [{ allocation: amountIn, route }],
    });
    const expected = splitError(
      'leg-replay-failed',
      `Exact replay failed for request.legs[0]: ${nested.message}`,
      0,
      nested.code,
    );
    assertSplitParityFailure(value, context, input, expected);
  }
});

void test('preserves the split error lattice and allocation precedence across wrappers', () => {
  const value = snapshot(PARITY_POOLS);
  const context = prepare(value);
  const left = [{ assetIn: 'A', poolId: 'a-left-ac', assetOut: 'C' }] as const;
  const right = [{ assetIn: 'A', poolId: 'b-right-ac', assetOut: 'C' }] as const;
  const cases: readonly [ExactInputSplitReplayRequest, ExactInputSplitReplayError][] = [
    [
      splitRequest(value, { snapshotChecksum: 'wrong', assetIn: '', amountIn: 0n, legs: [] }),
      splitError(
        'snapshot-identity-mismatch',
        'Request snapshotId and snapshotChecksum must match the supplied snapshot.',
      ),
    ],
    [
      splitRequest(value, { assetIn: '', assetOut: '', amountIn: 0n }),
      splitError('empty-identifier', 'request.assetIn must not be empty.'),
    ],
    [
      splitRequest(value, { assetOut: '', amountIn: 0n }),
      splitError('empty-identifier', 'request.assetOut must not be empty.'),
    ],
    [
      splitRequest(value, { amountIn: 0n, assetOut: 'A', legs: [] }),
      splitError('nonpositive-input', 'request.amountIn must be a positive bigint.'),
    ],
    [
      splitRequest(value, { amountIn: 1 as unknown as bigint, assetOut: 'A', legs: [] }),
      splitError('nonpositive-input', 'request.amountIn must be a positive bigint.'),
    ],
    [
      splitRequest(value, { assetOut: 'A', legs: [] }),
      splitError(
        'same-asset-request',
        'request.assetIn and request.assetOut must be distinct.',
      ),
    ],
    [
      splitRequest(value, { legs: [] }),
      splitError('empty-legs', 'request.legs must contain at least one leg.'),
    ],
    [
      splitRequest(value, { legs: [{ allocation: 0n, route: [] }] }),
      splitError(
        'nonpositive-allocation',
        'request.legs[0].allocation must be a positive bigint.',
        0,
      ),
    ],
    [
      splitRequest(value, { amountIn: 1n, legs: [{ allocation: 1n, route: [] }] }),
      splitError('empty-route', 'request.legs[0].route must contain at least one hop.', 0),
    ],
    [
      splitRequest(value, { amountIn: 99n }),
      splitError('allocation-sum-mismatch', 'Leg allocations must sum exactly to request.amountIn.'),
    ],
    [
      splitRequest(value, {
        legs: [
          { allocation: 50n, route: left },
          { allocation: 50n, route: left },
        ],
      }),
      splitError('duplicate-route', 'request.legs[1].route duplicates the prior canonical route.', 1),
    ],
    [
      splitRequest(value, {
        legs: [
          { allocation: 50n, route: right },
          { allocation: 50n, route: left },
        ],
      }),
      splitError(
        'noncanonical-route-order',
        'request.legs routes must be sorted by raw UTF-16 directional route order.',
        1,
      ),
    ],
  ];

  for (const [input, expected] of cases) {
    assertSplitParityFailure(value, context, input, expected);
  }

  const sharedValue = snapshot([
    pool('a-ax', 'A', 100n, 'X', 100n),
    pool('b-ay', 'A', 100n, 'Y', 100n),
    pool('c-shared-xy', 'X', 100n, 'Y', 100n),
    pool('d-xd', 'X', 100n, 'D', 100n),
    pool('e-yd', 'Y', 100n, 'D', 100n),
  ]);
  const sharedContext = prepare(sharedValue);
  const sharedInput = splitRequest(sharedValue, {
    assetOut: 'D',
    legs: [
      {
        allocation: 50n,
        route: [
          { assetIn: 'A', poolId: 'a-ax', assetOut: 'X' },
          { assetIn: 'X', poolId: 'c-shared-xy', assetOut: 'Y' },
          { assetIn: 'Y', poolId: 'e-yd', assetOut: 'D' },
        ],
      },
      {
        allocation: 50n,
        route: [
          { assetIn: 'A', poolId: 'b-ay', assetOut: 'Y' },
          { assetIn: 'Y', poolId: 'c-shared-xy', assetOut: 'X' },
          { assetIn: 'X', poolId: 'd-xd', assetOut: 'D' },
        ],
      },
    ],
  });
  assertSplitParityFailure(
    sharedValue,
    sharedContext,
    sharedInput,
    splitError('shared-pool', 'request.legs[1] reuses pool c-shared-xy from another leg.', 1),
  );
});

void test('reconstructs huge bigint routes and splits without approximate coercion', () => {
  const unit = 10n ** 80n;
  const value = snapshot([
    pool('a-ab', 'A', unit, 'B', unit),
    pool('b-bc', 'B', unit, 'C', unit),
    pool('c-direct-ac', 'A', unit, 'C', unit),
  ]);
  const context = prepare(value);
  const routeInput = routeRequest(value, {
    amountIn: unit,
    hops: [
      { assetIn: 'A', poolId: 'a-ab', assetOut: 'B' },
      { assetIn: 'B', poolId: 'b-bc', assetOut: 'C' },
    ],
  });
  const routeExpected = oracleRouteReceipt(value, routeInput);
  assert.ok(routeExpected !== undefined);
  assert.equal(routeExpected.amountOut, unit / 3n);
  assert.deepEqual(replayExactInputRoute(value, routeInput), { ok: true, value: routeExpected });

  const splitInput = splitRequest(value, {
    amountIn: 2n * unit + 1n,
    legs: [
      {
        allocation: unit + 1n,
        route: [
          { assetIn: 'A', poolId: 'a-ab', assetOut: 'B' },
          { assetIn: 'B', poolId: 'b-bc', assetOut: 'C' },
        ],
      },
      {
        allocation: unit,
        route: [{ assetIn: 'A', poolId: 'c-direct-ac', assetOut: 'C' }],
      },
    ],
  });
  const expected = oracleSplitReceipt(value, splitInput);
  const legacy = replayExactInputSplit(value, splitInput);
  const prepared = replayPreparedExactInputSplit(context, splitInput);
  assert.deepEqual(legacy, { ok: true, value: expected });
  assert.deepEqual(prepared, { ok: true, value: expected });
  assert.equal(expected.legs.reduce((sum, leg) => sum + leg.allocation, 0n), 2n * unit + 1n);
  assert.equal(typeof expected.amountOut, 'bigint');
});

void test('is invariant to pool permutations and retains original-snapshot split-leg semantics', () => {
  const pools = [
    pool('a-left-ac', 'A', 100n, 'C', 100n),
    pool('b-right-ac', 'A', 100n, 'C', 100n),
    pool('c-unused-de', 'D', 10n, 'E', 20n),
  ];
  const orders = [pools, [...pools].reverse(), [pools[1]!, pools[2]!, pools[0]!]];
  let expected: ExactInputSplitReplayReceipt | undefined;
  for (const order of orders) {
    const value = snapshot(order);
    const input = splitRequest(value);
    expected ??= oracleSplitReceipt(value, input);
    assert.equal(value.snapshotChecksum, snapshot(pools).snapshotChecksum);
    assert.deepEqual(replayExactInputSplit(value, input), { ok: true, value: expected });
    assert.deepEqual(replayPreparedExactInputSplit(prepare(value), input), {
      ok: true,
      value: expected,
    });
  }
  assert.equal(expected?.amountOut, 66n);
  assert.equal(expected?.legs[0]?.receipt.hops[0]?.reserveInBefore, 100n);
  assert.equal(expected?.legs[1]?.receipt.hops[0]?.reserveInBefore, 100n);
});

interface GetterFixture {
  readonly snapshot: LiquiditySnapshot;
  readonly request: ExactInputSplitReplayRequest;
  readonly reads: ReadonlyMap<string, number>;
}

function getterFixture(checksum: string): GetterFixture {
  const reads = new Map<string, number>();
  const count = <T>(key: string, value: T): T => {
    reads.set(key, (reads.get(key) ?? 0) + 1);
    return value;
  };
  const mutable = { poolId: 'a-left-ac' };
  const getterPool = {
    get poolId() {
      return count('pool.poolId', mutable.poolId);
    },
    get asset0() {
      mutable.poolId = 'changed-after-pool-id-capture';
      return count('pool.asset0', 'A');
    },
    get reserve0() {
      return count('pool.reserve0', 100n);
    },
    get asset1() {
      return count('pool.asset1', 'C');
    },
    get reserve1() {
      return count('pool.reserve1', 100n);
    },
    get feeChargedNumerator() {
      return count('pool.feeChargedNumerator', 0n);
    },
    get feeDenominator() {
      return count('pool.feeDenominator', 1n);
    },
  };
  const getterSnapshot = {
    get snapshotId() {
      return count('snapshot.snapshotId', 'kernel-parity-snapshot');
    },
    get snapshotChecksum() {
      return count('snapshot.snapshotChecksum', checksum);
    },
    get pools() {
      return count('snapshot.pools', [getterPool]);
    },
  } as LiquiditySnapshot;

  const getterHop = {
    get assetIn() {
      return count('hop.assetIn', 'A');
    },
    get poolId() {
      return count('hop.poolId', 'a-left-ac');
    },
    get assetOut() {
      return count('hop.assetOut', 'C');
    },
  };
  const getterLeg = {
    get allocation() {
      return count('leg.allocation', 100n);
    },
    get route() {
      return count('leg.route', [getterHop]);
    },
  };
  const getterRequest = {
    get snapshotId() {
      return count('request.snapshotId', 'kernel-parity-snapshot');
    },
    get snapshotChecksum() {
      return count('request.snapshotChecksum', checksum);
    },
    get assetIn() {
      return count('request.assetIn', 'A');
    },
    get assetOut() {
      return count('request.assetOut', 'C');
    },
    get amountIn() {
      return count('request.amountIn', 100n);
    },
    get legs() {
      return count('request.legs', [getterLeg]);
    },
  } as ExactInputSplitReplayRequest;
  return { snapshot: getterSnapshot, request: getterRequest, reads };
}

void test('preserves defensive capture, getter observation, and caller-alias isolation', () => {
  const stable = snapshot([pool('a-left-ac', 'A', 100n, 'C', 100n)]);

  const legacyFixture = getterFixture(stable.snapshotChecksum);
  const legacy = replayExactInputSplit(legacyFixture.snapshot, legacyFixture.request);
  assert.equal(legacy.ok, true);
  if (legacy.ok) assert.equal(legacy.value.amountOut, 50n);
  for (const count of legacyFixture.reads.values()) assert.equal(count, 1);
  assert.equal(legacyFixture.reads.size, 3 + 7 + 6 + 2 + 3);

  const preparationFixture = getterFixture(stable.snapshotChecksum);
  const preparedContext = prepare(preparationFixture.snapshot);
  for (const [key, count] of preparationFixture.reads) {
    if (key.startsWith('snapshot.') || key.startsWith('pool.')) assert.equal(count, 1);
  }
  const preparedRequestFixture = getterFixture(stable.snapshotChecksum);
  const prepared = replayPreparedExactInputSplit(
    preparedContext,
    preparedRequestFixture.request,
  );
  assert.equal(prepared.ok, true);
  if (prepared.ok) assert.equal(prepared.value.amountOut, 50n);
  for (const [key, count] of preparedRequestFixture.reads) {
    if (key.startsWith('request.') || key.startsWith('leg.') || key.startsWith('hop.')) {
      assert.equal(count, 1);
    }
  }

  const mutablePools = [pool('a-left-ac', 'A', 100n, 'C', 100n)];
  const mutableSnapshot = snapshot(mutablePools);
  const capturedContext = prepare(mutableSnapshot);
  mutablePools[0] = pool('a-left-ac', 'A', 10_000n, 'C', 1n);
  const retained = replayPreparedExactInputSplit(capturedContext, splitRequest(mutableSnapshot, {
    legs: [{ allocation: 100n, route: [{ assetIn: 'A', poolId: 'a-left-ac', assetOut: 'C' }] }],
  }));
  assert.equal(retained.ok, true);
  if (retained.ok) assert.equal(retained.value.amountOut, 50n);
});

void test('rejects forged prepared capabilities with the established misuse exception', () => {
  const value = snapshot(PARITY_POOLS);
  const forged = Object.freeze({}) as PreparedRoutingContext;
  assert.throws(
    () => replayPreparedExactInputSplit(forged, splitRequest(value)),
    {
      name: 'TypeError',
      message: 'PreparedRoutingContext was not created by prepareRoutingContext.',
    },
  );
});

void test('preserves fixed canonical single and split v1 bytes and hashes', () => {
  const singleValue = snapshot(
    [pool('direct-ab', 'A', 1_000n, 'B', 1_000n, 3n, 1_000n)],
    'snapshot-direct',
  );
  assert.equal(
    singleValue.snapshotChecksum,
    'sha256:ed8bb56fbc26b3105c7a1c1772ab2a05babe3ec8aa473fcba0e22ef086ececb3',
  );
  const singleRequest: ExactInputSinglePathRouterRequest = {
    snapshotId: singleValue.snapshotId,
    snapshotChecksum: singleValue.snapshotChecksum,
    assetIn: 'A',
    assetOut: 'B',
    amountIn: 100n,
    maxHops: 1,
    maxExpansions: 10,
  };
  const single = createCanonicalSinglePathRouterRun(singleValue, singleRequest);
  assert.equal(single.ok, true);
  if (!single.ok) assert.fail('fixed canonical single run failed');
  assert.equal(Buffer.byteLength(single.value.canonicalJson, 'utf8'), 1_142);
  assert.equal(
    single.value.determinismHash,
    'sha256:c4b3c03b960ba1405c1b1f86a92fd7e6d51d5a5a59ab22caefd689b18efc4011',
  );
  assert.equal(
    single.value.determinismHash,
    `sha256:${createHash('sha256').update(single.value.canonicalJson, 'utf8').digest('hex')}`,
  );

  const splitValue = snapshot(
    [
      pool('direct-0', 'A', 100n, 'B', 100n),
      pool('direct-1', 'A', 100n, 'B', 100n),
    ],
    'pre-m6-two-direct-pools',
  );
  assert.equal(
    splitValue.snapshotChecksum,
    'sha256:15d26e434befa00d782d61ee4bf9e0fd704a83bb3b3720b89fd63ff0f7120b6f',
  );
  const caps: ExactInputSplitWorkCaps = {
    maxPathExpansions: 100,
    maxBestSingleCandidateReplays: 100,
    maxCandidateSetExpansions: 100,
    maxEqualProposalReplays: 100,
    maxGreedyOptionReplays: 100,
    maxFinalAuthorizationReplays: 100,
  };
  const split = createCanonicalSplitRouterRun(
    splitValue,
    {
      snapshotId: splitValue.snapshotId,
      snapshotChecksum: splitValue.snapshotChecksum,
      assetIn: 'A',
      assetOut: 'B',
      amountIn: 100n,
      maxHops: 1,
      maxRoutes: 2,
      greedyParts: 2,
    },
    caps,
  );
  assert.equal(split.ok, true);
  if (!split.ok) assert.fail('fixed canonical split run failed');
  assert.equal(Buffer.byteLength(split.value.canonicalJson, 'utf8'), 2_430);
  assert.equal(
    split.value.determinismHash,
    'sha256:d38c5035cf41b14847adf623ab9bc18051a1a48c5e8433afb257fcc7f1944f7a',
  );
  assert.equal(
    split.value.determinismHash,
    `sha256:${createHash('sha256').update(split.value.canonicalJson, 'utf8').digest('hex')}`,
  );
});
