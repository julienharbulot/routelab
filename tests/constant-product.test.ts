import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConstantProductPool } from '../src/domain/index.ts';
import {
  quoteConstantProductExactInput,
  transitionConstantProductExactInput,
} from '../src/pools/constant-product/index.ts';

function asymmetricPool(): ConstantProductPool {
  return {
    poolId: 'pool-ab',
    asset0: 'A',
    reserve0: 1_000n,
    asset1: 'B',
    reserve1: 2_000n,
    feeChargedNumerator: 3n,
    feeDenominator: 1_000n,
  };
}

void test('quotes both directions with exact paired reserves', () => {
  const pool = asymmetricPool();

  const forward = quoteConstantProductExactInput(pool, 'A', 100n);
  const reverse = quoteConstantProductExactInput(pool, 'B', 100n);

  assert.deepEqual(forward, {
    ok: true,
    value: {
      poolId: 'pool-ab',
      assetIn: 'A',
      assetOut: 'B',
      amountIn: 100n,
      amountOut: 181n,
    },
  });
  assert.deepEqual(reverse, {
    ok: true,
    value: {
      poolId: 'pool-ab',
      assetIn: 'B',
      assetOut: 'A',
      amountIn: 100n,
      amountOut: 47n,
    },
  });
  assert.equal(Object.isFrozen(forward), true);
  assert.equal(forward.ok && Object.isFrozen(forward.value), true);
  assert.equal(Object.isFrozen(reverse), true);
  assert.equal(reverse.ok && Object.isFrozen(reverse.value), true);
});

void test('uses one final floor rather than a rounded integer net input', () => {
  const pool: ConstantProductPool = {
    poolId: 'rounding-ab',
    asset0: 'A',
    reserve0: 1n,
    asset1: 'B',
    reserve1: 3n,
    feeChargedNumerator: 1n,
    feeDenominator: 2n,
  };

  const quote = quoteConstantProductExactInput(pool, 'A', 1n);
  const transition = transitionConstantProductExactInput(pool, 'A', 1n);

  assert.equal(quote.ok && quote.value.amountOut, 1n);
  assert.deepEqual(transition, {
    ok: true,
    value: {
      pool: {
        poolId: 'rounding-ab',
        asset0: 'A',
        reserve0: 2n,
        asset1: 'B',
        reserve1: 2n,
        feeChargedNumerator: 1n,
        feeDenominator: 2n,
      },
      receipt: {
        poolId: 'rounding-ab',
        assetIn: 'A',
        assetOut: 'B',
        amountIn: 1n,
        amountOut: 1n,
        reserveInBefore: 1n,
        reserveOutBefore: 3n,
        reserveInAfter: 2n,
        reserveOutAfter: 2n,
      },
    },
  });
});

void test('transitions both directions with gross input credit and no mutation', () => {
  const pool = asymmetricPool();
  const before = { ...pool };

  const forward = transitionConstantProductExactInput(pool, 'A', 100n);
  const reverse = transitionConstantProductExactInput(pool, 'B', 100n);

  assert.equal(forward.ok, true);
  assert.equal(reverse.ok, true);
  if (!forward.ok || !reverse.ok) return;
  assert.deepEqual(forward.value.pool, {
    ...pool,
    reserve0: 1_100n,
    reserve1: 1_819n,
  });
  assert.deepEqual(forward.value.receipt, {
    poolId: 'pool-ab',
    assetIn: 'A',
    assetOut: 'B',
    amountIn: 100n,
    amountOut: 181n,
    reserveInBefore: 1_000n,
    reserveOutBefore: 2_000n,
    reserveInAfter: 1_100n,
    reserveOutAfter: 1_819n,
  });
  assert.deepEqual(reverse.value.pool, {
    ...pool,
    reserve0: 953n,
    reserve1: 2_100n,
  });
  assert.deepEqual(reverse.value.receipt, {
    poolId: 'pool-ab',
    assetIn: 'B',
    assetOut: 'A',
    amountIn: 100n,
    amountOut: 47n,
    reserveInBefore: 2_000n,
    reserveOutBefore: 1_000n,
    reserveInAfter: 2_100n,
    reserveOutAfter: 953n,
  });
  assert.deepEqual(pool, before);
  assert.notEqual(forward.value.pool, pool);
  assert.notEqual(reverse.value.pool, pool);
  assert.equal(Object.isFrozen(forward), true);
  assert.equal(Object.isFrozen(forward.value), true);
  assert.equal(Object.isFrozen(forward.value.pool), true);
  assert.equal(Object.isFrozen(forward.value.receipt), true);
});

void test('makes zero input a fresh frozen no-op transition', () => {
  const pool = asymmetricPool();

  const quote = quoteConstantProductExactInput(pool, 'A', 0n);
  const transition = transitionConstantProductExactInput(pool, 'A', 0n);

  assert.equal(quote.ok && quote.value.amountOut, 0n);
  assert.equal(transition.ok, true);
  if (!transition.ok) return;
  assert.deepEqual(transition.value.pool, pool);
  assert.notEqual(transition.value.pool, pool);
  assert.deepEqual(transition.value.receipt, {
    poolId: 'pool-ab',
    assetIn: 'A',
    assetOut: 'B',
    amountIn: 0n,
    amountOut: 0n,
    reserveInBefore: 1_000n,
    reserveOutBefore: 2_000n,
    reserveInAfter: 1_000n,
    reserveOutAfter: 2_000n,
  });
  assert.equal(Object.isFrozen(transition.value.pool), true);
  assert.equal(Object.isFrozen(transition.value.receipt), true);
});

void test('keeps positive zero-output quotes mathematical but transition-ineligible', () => {
  const pool: ConstantProductPool = {
    poolId: 'tiny-output',
    asset0: 'A',
    reserve0: 1_000n,
    asset1: 'B',
    reserve1: 1n,
    feeChargedNumerator: 0n,
    feeDenominator: 1n,
  };
  const before = { ...pool };

  const quote = quoteConstantProductExactInput(pool, 'A', 1n);
  const transition = transitionConstantProductExactInput(pool, 'A', 1n);

  assert.deepEqual(quote, {
    ok: true,
    value: {
      poolId: 'tiny-output',
      assetIn: 'A',
      assetOut: 'B',
      amountIn: 1n,
      amountOut: 0n,
    },
  });
  assert.deepEqual(transition, {
    ok: false,
    error: {
      code: 'zero-output-ineligible',
      message: 'A positive input that quotes zero output is ineligible for transition.',
    },
  });
  assert.equal('value' in transition, false);
  assert.equal(Object.isFrozen(transition), true);
  assert.equal(!transition.ok && Object.isFrozen(transition.error), true);
  assert.deepEqual(pool, before);
});

void test('returns frozen typed failures for negative input and unknown direction', () => {
  const pool = asymmetricPool();

  const negative = quoteConstantProductExactInput(pool, 'A', -1n);
  const unknown = transitionConstantProductExactInput(pool, 'a', 1n);

  assert.deepEqual(negative, {
    ok: false,
    error: { code: 'negative-input', message: 'amountIn must be nonnegative.' },
  });
  assert.deepEqual(unknown, {
    ok: false,
    error: {
      code: 'unknown-asset-in',
      message: 'assetIn a is not an asset in pool pool-ab.',
    },
  });
  assert.equal('value' in negative, false);
  assert.equal('value' in unknown, false);
  assert.equal(Object.isFrozen(negative), true);
  assert.equal(!negative.ok && Object.isFrozen(negative.error), true);
  assert.equal(Object.isFrozen(unknown), true);
  assert.equal(!unknown.ok && Object.isFrozen(unknown.error), true);
});

void test('handles fee boundaries and exact values far above the safe-integer range', () => {
  const scale = 10n ** 50n;
  const hugePool: ConstantProductPool = {
    poolId: 'huge-zero-fee',
    asset0: 'A',
    reserve0: scale,
    asset1: 'B',
    reserve1: scale,
    feeChargedNumerator: 0n,
    feeDenominator: 1n,
  };
  const hugeTransition = transitionConstantProductExactInput(hugePool, 'A', scale);

  assert.equal(hugeTransition.ok, true);
  if (!hugeTransition.ok) return;
  assert.equal(hugeTransition.value.receipt.amountOut, 5n * 10n ** 49n);
  assert.equal(hugeTransition.value.pool.reserve0, 2n * scale);
  assert.equal(hugeTransition.value.pool.reserve1, 5n * 10n ** 49n);
  assert.equal(
    hugeTransition.value.pool.reserve0 * hugeTransition.value.pool.reserve1 >=
      hugePool.reserve0 * hugePool.reserve1,
    true,
  );

  const maximumFeePool: ConstantProductPool = {
    ...asymmetricPool(),
    poolId: 'maximum-fee',
    reserve1: 1_000n,
    feeChargedNumerator: 99n,
    feeDenominator: 100n,
  };
  const maximumFeeQuote = quoteConstantProductExactInput(maximumFeePool, 'A', 1_000n);
  assert.equal(maximumFeeQuote.ok && maximumFeeQuote.value.amountOut, 9n);
});

void test('produces deterministic receipts and keeps output below its reserve', () => {
  const pool = asymmetricPool();

  const first = transitionConstantProductExactInput(pool, 'A', 10n ** 30n);
  const second = transitionConstantProductExactInput(pool, 'A', 10n ** 30n);

  assert.deepEqual(first, second);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.value.receipt.amountOut < first.value.receipt.reserveOutBefore, true);
  assert.equal(first.value.receipt.reserveOutAfter > 0n, true);
});
