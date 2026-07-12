import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../../src/domain/index.ts';
import {
  replayExactInputSplit,
  type ExactInputSplitReplayErrorCode,
  type ExactInputSplitReplayRequest,
} from '../../src/replay/exact-input-split/index.ts';
import type {
  DirectionalRouteHop,
  ExactInputRouteReplayErrorCode,
  ExactInputRouteReplayReceipt,
} from '../../src/replay/exact-input-route/index.ts';

interface OracleTransitionReceipt extends DirectionalRouteHop {
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly reserveInBefore: bigint;
  readonly reserveOutBefore: bigint;
  readonly reserveInAfter: bigint;
  readonly reserveOutAfter: bigint;
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

function snapshot(
  pools: readonly ConstantProductPool[],
  snapshotId = 'oracle-split-snapshot',
  snapshotChecksum = 'oracle-split-checksum',
): LiquiditySnapshot {
  return { snapshotId, snapshotChecksum, pools };
}

function route(poolId: string): readonly DirectionalRouteHop[] {
  return [{ assetIn: 'A', poolId, assetOut: 'C' }];
}

function request(
  overrides: Partial<ExactInputSplitReplayRequest> = {},
): ExactInputSplitReplayRequest {
  return {
    snapshotId: 'oracle-split-snapshot',
    snapshotChecksum: 'oracle-split-checksum',
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 100n,
    legs: [
      { allocation: 50n, route: route('left-ac') },
      { allocation: 50n, route: route('right-ac') },
    ],
    ...overrides,
  };
}

// Decimal long division avoids both the production pool helper and bigint
// division when deriving expected financial outputs.
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

function oracleRouteReplay(
  value: LiquiditySnapshot,
  assetIn: string,
  assetOut: string,
  amountIn: bigint,
  hops: readonly DirectionalRouteHop[],
): ExactInputRouteReplayReceipt | undefined {
  const states = new Map(value.pools.map((entry) => [entry.poolId, { ...entry }] as const));
  const receipts: OracleTransitionReceipt[] = [];
  let currentAmount = amountIn;

  for (const hop of hops) {
    const state = states.get(hop.poolId);
    if (state === undefined) return undefined;
    const forward = state.asset0 === hop.assetIn && state.asset1 === hop.assetOut;
    const reverse = state.asset1 === hop.assetIn && state.asset0 === hop.assetOut;
    if (!forward && !reverse) return undefined;
    const reserveIn = forward ? state.reserve0 : state.reserve1;
    const reserveOut = forward ? state.reserve1 : state.reserve0;
    const retained = state.feeDenominator - state.feeChargedNumerator;
    const numerator = currentAmount * retained * reserveOut;
    const denominator = reserveIn * state.feeDenominator + currentAmount * retained;
    const amountOutForHop = floorDivideWithoutDivision(numerator, denominator);
    if (currentAmount > 0n && amountOutForHop === 0n) return undefined;
    const reserveInAfter = reserveIn + currentAmount;
    const reserveOutAfter = reserveOut - amountOutForHop;
    states.set(hop.poolId, {
      ...state,
      reserve0: forward ? reserveInAfter : reserveOutAfter,
      reserve1: forward ? reserveOutAfter : reserveInAfter,
    });
    receipts.push({
      ...hop,
      amountIn: currentAmount,
      amountOut: amountOutForHop,
      reserveInBefore: reserveIn,
      reserveOutBefore: reserveOut,
      reserveInAfter,
      reserveOutAfter,
    });
    currentAmount = amountOutForHop;
  }

  return {
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    assetIn,
    assetOut,
    amountIn,
    amountOut: currentAmount,
    hops: receipts,
  };
}

function oracleSplit(value: LiquiditySnapshot, input: ExactInputSplitReplayRequest) {
  const legs = input.legs.map((leg) => {
    const receipt = oracleRouteReplay(
      value,
      input.assetIn,
      input.assetOut,
      leg.allocation,
      leg.route,
    );
    assert.ok(receipt !== undefined, 'oracle fixture must contain an executable route');
    return { allocation: leg.allocation, receipt };
  });
  return {
    snapshotId: input.snapshotId,
    snapshotChecksum: input.snapshotChecksum,
    assetIn: input.assetIn,
    assetOut: input.assetOut,
    amountIn: input.amountIn,
    amountOut: legs.reduce((sum, leg) => sum + leg.receipt.amountOut, 0n),
    legs,
  };
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) assertDeepFrozen(Reflect.get(value, key), seen);
}

function assertAtomicFailure(
  value: LiquiditySnapshot,
  input: ExactInputSplitReplayRequest,
  code: ExactInputSplitReplayErrorCode,
  legIndex: number | null = null,
  causeCode: ExactInputRouteReplayErrorCode | null = null,
): void {
  const snapshotBefore = structuredClone(value);
  const requestBefore = structuredClone(input);
  const first = replayExactInputSplit(value, input);
  const second = replayExactInputSplit(value, input);
  assert.equal(first.ok, false);
  if (first.ok) return;
  assert.equal(first.error.code, code);
  assert.equal(first.error.legIndex, legIndex);
  assert.equal(first.error.causeCode, causeCode);
  assert.notEqual(first.error.message.length, 0);
  assert.equal('value' in first, false);
  assert.deepEqual(second, first);
  assert.deepEqual(value, snapshotBefore);
  assert.deepEqual(input, requestBefore);
  assertDeepFrozen(first);
}

const M0_POOLS = [
  pool('left-ac', 'A', 100n, 'C', 100n),
  pool('right-ac', 'A', 100n, 'C', 100n),
];

void test('matches the independent M0 formula and fresh per-leg reserve receipts', () => {
  const value = snapshot(M0_POOLS);
  const input = request();
  const actual = replayExactInputSplit(value, input);
  assert.deepEqual(actual, { ok: true, value: oracleSplit(value, input) });
  assert.equal(actual.ok, true);
  if (!actual.ok) return;
  assert.equal(actual.value.amountOut, 66n);
  assert.deepEqual(
    actual.value.legs.map(({ receipt }) => receipt.hops[0]),
    [
      {
        poolId: 'left-ac',
        assetIn: 'A',
        assetOut: 'C',
        amountIn: 50n,
        amountOut: 33n,
        reserveInBefore: 100n,
        reserveOutBefore: 100n,
        reserveInAfter: 150n,
        reserveOutAfter: 67n,
      },
      {
        poolId: 'right-ac',
        assetIn: 'A',
        assetOut: 'C',
        amountIn: 50n,
        amountOut: 33n,
        reserveInBefore: 100n,
        reserveOutBefore: 100n,
        reserveInAfter: 150n,
        reserveOutAfter: 67n,
      },
    ],
  );
  assert.notEqual(actual.value.legs, input.legs);
  assertDeepFrozen(actual);
});

void test('matches independent huge bigint formula outputs and uneven exact allocations', () => {
  const unit = 10n ** 80n;
  const value = snapshot([
    pool('p0-ac', 'A', unit, 'C', 2n * unit),
    pool('p1-ac', 'A', unit, 'C', 2n * unit),
    pool('p2-ac', 'A', unit, 'C', 2n * unit),
  ]);
  const input = request({
    amountIn: 3n * unit + 2n,
    legs: [
      { allocation: unit + 1n, route: route('p0-ac') },
      { allocation: unit + 1n, route: route('p1-ac') },
      { allocation: unit, route: route('p2-ac') },
    ],
  });
  const actual = replayExactInputSplit(value, input);
  assert.deepEqual(actual, { ok: true, value: oracleSplit(value, input) });
  assert.equal(actual.ok, true);
  if (!actual.ok) return;
  assert.equal(actual.value.amountOut, 3n * unit);
  assert.deepEqual(
    actual.value.legs.map(({ allocation, receipt }) => [allocation, receipt.amountOut]),
    [
      [unit + 1n, unit],
      [unit + 1n, unit],
      [unit, unit],
    ],
  );
  assert.equal(typeof actual.value.amountOut, 'bigint');
});

void test('rejects every allocation, ordering, sharing, and atomic replay boundary', () => {
  const value = snapshot(M0_POOLS);
  assertAtomicFailure(value, request({ amountIn: 99n }), 'allocation-sum-mismatch');
  assertAtomicFailure(
    value,
    request({ legs: [{ allocation: 0n, route: route('left-ac') }, ...request().legs] }),
    'nonpositive-allocation',
    0,
  );
  assertAtomicFailure(
    value,
    request({
      legs: [
        { allocation: -1n, route: route('left-ac') },
        { allocation: 101n, route: route('right-ac') },
      ],
    }),
    'nonpositive-allocation',
    0,
  );
  assertAtomicFailure(
    value,
    request({ legs: [{ allocation: 50n, route: [] }, request().legs[1]!] }),
    'empty-route',
    0,
  );
  assertAtomicFailure(
    value,
    request({ legs: [...request().legs].reverse() }),
    'noncanonical-route-order',
    1,
  );
  assertAtomicFailure(
    value,
    request({
      legs: [
        { allocation: 50n, route: route('left-ac') },
        { allocation: 50n, route: route('left-ac') },
      ],
    }),
    'duplicate-route',
    1,
  );

  const oppositeDirection = snapshot([
    pool('a-ax', 'A', 100n, 'X', 100n),
    pool('b-ay', 'A', 100n, 'Y', 100n),
    pool('shared-xy', 'X', 100n, 'Y', 100n),
    pool('x-d', 'X', 100n, 'D', 100n),
    pool('y-d', 'Y', 100n, 'D', 100n),
  ]);
  assertAtomicFailure(
    oppositeDirection,
    request({
      assetOut: 'D',
      legs: [
        {
          allocation: 50n,
          route: [
            { assetIn: 'A', poolId: 'a-ax', assetOut: 'X' },
            { assetIn: 'X', poolId: 'shared-xy', assetOut: 'Y' },
            { assetIn: 'Y', poolId: 'y-d', assetOut: 'D' },
          ],
        },
        {
          allocation: 50n,
          route: [
            { assetIn: 'A', poolId: 'b-ay', assetOut: 'Y' },
            { assetIn: 'Y', poolId: 'shared-xy', assetOut: 'X' },
            { assetIn: 'X', poolId: 'x-d', assetOut: 'D' },
          ],
        },
      ],
    }),
    'shared-pool',
    1,
  );

  const lateFailure = snapshot([
    pool('a-good', 'A', 1n, 'C', 2n),
    pool('z-zero', 'A', 100n, 'C', 1n),
  ]);
  assertAtomicFailure(
    lateFailure,
    request({
      amountIn: 2n,
      legs: [
        { allocation: 1n, route: route('a-good') },
        { allocation: 1n, route: route('z-zero') },
      ],
    }),
    'leg-replay-failed',
    1,
    'hop-transition-failed',
  );
});

void test('follows the frozen validation precedence with typed frozen failures', () => {
  const value = snapshot(M0_POOLS);
  const cases: readonly [
    Partial<ExactInputSplitReplayRequest>,
    ExactInputSplitReplayErrorCode,
    number | null,
  ][] = [
    [
      { snapshotChecksum: 'wrong', assetIn: '', amountIn: 0n, legs: [] },
      'snapshot-identity-mismatch',
      null,
    ],
    [{ assetIn: '', assetOut: '', amountIn: 0n }, 'empty-identifier', null],
    [{ assetOut: '', amountIn: 0n }, 'empty-identifier', null],
    [{ amountIn: 1 as unknown as bigint, assetOut: 'A' }, 'nonpositive-input', null],
    [{ amountIn: 0n, assetOut: 'A' }, 'nonpositive-input', null],
    [{ assetOut: 'A', legs: [] }, 'same-asset-request', null],
    [{ legs: [] }, 'empty-legs', null],
  ];
  for (const [overrides, code, legIndex] of cases) {
    assertAtomicFailure(value, request(overrides), code, legIndex);
  }
});

void test('uses raw UTF-16 ordering and captures every mutable field before validation', () => {
  const emoji = '\u{1f600}-pool';
  const privateUse = '\ue000-pool';
  const utfValue = snapshot([
    pool(privateUse, 'A', 100n, 'C', 100n),
    pool(emoji, 'A', 100n, 'C', 100n),
  ]);
  const canonical = request({
    legs: [
      { allocation: 50n, route: route(emoji) },
      { allocation: 50n, route: route(privateUse) },
    ],
  });
  assert.equal(replayExactInputSplit(utfValue, canonical).ok, true);
  assertAtomicFailure(
    utfValue,
    request({ legs: [...canonical.legs].reverse() }),
    'noncanonical-route-order',
    1,
  );

  const reads = new Map<string, number>();
  const count = <T>(key: string, value: T): T => {
    reads.set(key, (reads.get(key) ?? 0) + 1);
    return value;
  };
  const mutable = { poolId: 'left-ac' };
  const getterPool = {
    get poolId() {
      return count('pool.poolId', mutable.poolId);
    },
    get asset0() {
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
      return count('snapshot.snapshotId', 'oracle-split-snapshot');
    },
    get snapshotChecksum() {
      return count('snapshot.snapshotChecksum', 'oracle-split-checksum');
    },
    get pools() {
      return count('snapshot.pools', [getterPool]);
    },
  } as LiquiditySnapshot;
  const stable = request({
    amountIn: 100n,
    legs: [{ allocation: 100n, route: route('left-ac') }],
  });
  const descriptors: PropertyDescriptorMap = {};
  for (const key of Object.keys(stable) as (keyof ExactInputSplitReplayRequest)[]) {
    descriptors[key] = {
      enumerable: true,
      get() {
        if (key === 'snapshotId') mutable.poolId = 'mutated-after-capture';
        return count(`request.${key}`, stable[key]);
      },
    };
  }
  const getterRequest = Object.defineProperties(
    {},
    descriptors,
  ) as ExactInputSplitReplayRequest;
  const actual = replayExactInputSplit(getterSnapshot, getterRequest);
  assert.equal(actual.ok, true);
  if (!actual.ok) return;
  assert.equal(actual.value.legs[0]?.receipt.hops[0]?.poolId, 'left-ac');
  for (const readCount of reads.values()) assert.equal(readCount, 1);
  assert.equal(reads.size, 3 + 7 + 6);
  assertDeepFrozen(actual);
});
