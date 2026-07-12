import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConstantProductPool } from '../../src/domain/index.ts';
import {
  quoteConstantProductExactInput,
  transitionConstantProductExactInput,
} from '../../src/pools/constant-product/index.ts';

function referenceOutputWithoutDivision(
  reserveIn: bigint,
  reserveOut: bigint,
  feeChargedNumerator: bigint,
  feeDenominator: bigint,
  amountIn: bigint,
): bigint {
  const retainedNumerator = feeDenominator - feeChargedNumerator;
  const scaledInput = amountIn * retainedNumerator;
  const numerator = scaledInput * reserveOut;
  const denominator = reserveIn * feeDenominator + scaledInput;
  let output = 0n;

  while ((output + 1n) * denominator <= numerator) {
    output += 1n;
  }

  return output;
}

function pool(
  reserve0: bigint,
  reserve1: bigint,
  feeChargedNumerator: bigint,
  feeDenominator: bigint,
): ConstantProductPool {
  return {
    poolId: 'pool-ab',
    asset0: 'A',
    reserve0,
    asset1: 'B',
    reserve1,
    feeChargedNumerator,
    feeDenominator,
  };
}

void test('matches the accepted direct, single-floor, and fee fixture goldens', () => {
  const direct = pool(1000n, 1000n, 3n, 1000n);
  const directQuote = quoteConstantProductExactInput(direct, 'A', 100n);
  assert.deepEqual(directQuote, {
    ok: true,
    value: {
      poolId: 'pool-ab',
      assetIn: 'A',
      assetOut: 'B',
      amountIn: 100n,
      amountOut: 90n,
    },
  });
  assert.equal(Object.isFrozen(directQuote), true);
  if (!directQuote.ok) return;
  assert.equal(Object.isFrozen(directQuote.value), true);

  const directTransition = transitionConstantProductExactInput(direct, 'A', 100n);
  assert.deepEqual(directTransition, {
    ok: true,
    value: {
      pool: {
        ...direct,
        reserve0: 1100n,
        reserve1: 910n,
      },
      receipt: {
        poolId: 'pool-ab',
        assetIn: 'A',
        assetOut: 'B',
        amountIn: 100n,
        amountOut: 90n,
        reserveInBefore: 1000n,
        reserveOutBefore: 1000n,
        reserveInAfter: 1100n,
        reserveOutAfter: 910n,
      },
    },
  });

  const rounding = pool(1n, 3n, 1n, 2n);
  const roundingQuote = quoteConstantProductExactInput(rounding, 'A', 1n);
  assert.equal(roundingQuote.ok, true);
  if (roundingQuote.ok) assert.equal(roundingQuote.value.amountOut, 1n);
  const roundingTransition = transitionConstantProductExactInput(rounding, 'A', 1n);
  assert.equal(roundingTransition.ok, true);
  if (roundingTransition.ok) {
    assert.equal(roundingTransition.value.pool.reserve0, 2n);
    assert.equal(roundingTransition.value.pool.reserve1, 2n);
  }

  const zeroFeeQuote = quoteConstantProductExactInput(pool(1000n, 1000n, 0n, 1n), 'A', 100n);
  assert.equal(zeroFeeQuote.ok, true);
  if (zeroFeeQuote.ok) assert.equal(zeroFeeQuote.value.amountOut, 90n);

  const highFeeQuote = quoteConstantProductExactInput(
    pool(1000n, 1000n, 90n, 100n),
    'A',
    100n,
  );
  assert.equal(highFeeQuote.ok, true);
  if (highFeeQuote.ok) assert.equal(highFeeQuote.value.amountOut, 9n);
});

void test('maps asymmetric reserves and receipts correctly in both directions', () => {
  const asymmetric = pool(17n, 29n, 1n, 7n);
  const cases = [
    {
      assetIn: 'A',
      amountOut: 5n,
      reserve0After: 22n,
      reserve1After: 24n,
      reserveInBefore: 17n,
      reserveOutBefore: 29n,
      reserveInAfter: 22n,
      reserveOutAfter: 24n,
    },
    {
      assetIn: 'B',
      amountOut: 2n,
      reserve0After: 15n,
      reserve1After: 34n,
      reserveInBefore: 29n,
      reserveOutBefore: 17n,
      reserveInAfter: 34n,
      reserveOutAfter: 15n,
    },
  ] as const;

  for (const expected of cases) {
    const quote = quoteConstantProductExactInput(asymmetric, expected.assetIn, 5n);
    assert.equal(quote.ok, true);
    if (!quote.ok) continue;
    assert.equal(quote.value.amountOut, expected.amountOut);

    const transition = transitionConstantProductExactInput(asymmetric, expected.assetIn, 5n);
    assert.equal(transition.ok, true);
    if (!transition.ok) continue;
    assert.equal(transition.value.pool.reserve0, expected.reserve0After);
    assert.equal(transition.value.pool.reserve1, expected.reserve1After);
    assert.deepEqual(transition.value.receipt, {
      ...quote.value,
      reserveInBefore: expected.reserveInBefore,
      reserveOutBefore: expected.reserveOutBefore,
      reserveInAfter: expected.reserveInAfter,
      reserveOutAfter: expected.reserveOutAfter,
    });
    assert.equal(Object.isFrozen(transition), true);
    assert.equal(Object.isFrozen(transition.value), true);
    assert.equal(Object.isFrozen(transition.value.pool), true);
    assert.equal(Object.isFrozen(transition.value.receipt), true);
  }
});

void test('makes zero input a frozen no-op without aliasing or mutating a mutable caller', () => {
  const caller = {
    poolId: 'mutable-ab',
    asset0: 'A',
    reserve0: 17n,
    asset1: 'B',
    reserve1: 29n,
    feeChargedNumerator: 1n,
    feeDenominator: 7n,
  };
  const before = { ...caller };

  const quote = quoteConstantProductExactInput(caller, 'A', 0n);
  assert.deepEqual(quote, {
    ok: true,
    value: {
      poolId: 'mutable-ab',
      assetIn: 'A',
      assetOut: 'B',
      amountIn: 0n,
      amountOut: 0n,
    },
  });

  const transition = transitionConstantProductExactInput(caller, 'A', 0n);
  assert.equal(transition.ok, true);
  if (!transition.ok) return;
  assert.deepEqual(caller, before);
  assert.equal(Object.isFrozen(caller), false);
  assert.notEqual(transition.value.pool, caller);
  assert.deepEqual(transition.value.pool, caller);
  assert.deepEqual(transition.value.receipt, {
    poolId: 'mutable-ab',
    assetIn: 'A',
    assetOut: 'B',
    amountIn: 0n,
    amountOut: 0n,
    reserveInBefore: 17n,
    reserveOutBefore: 29n,
    reserveInAfter: 17n,
    reserveOutAfter: 29n,
  });
  assert.equal(Object.isFrozen(transition.value.pool), true);
  assert.equal(Object.isFrozen(transition.value.receipt), true);

  caller.reserve0 = 999n;
  assert.equal(transition.value.pool.reserve0, 17n);
});

void test('keeps arithmetic quotes separate from typed transition eligibility', () => {
  const tiny = pool(1n, 3n, 1n, 2n);
  const tinyQuote = quoteConstantProductExactInput(tiny, 'B', 1n);
  assert.deepEqual(tinyQuote, {
    ok: true,
    value: {
      poolId: 'pool-ab',
      assetIn: 'B',
      assetOut: 'A',
      amountIn: 1n,
      amountOut: 0n,
    },
  });

  const firstRejection = transitionConstantProductExactInput(tiny, 'B', 1n);
  const repeatedRejection = transitionConstantProductExactInput(tiny, 'B', 1n);
  assert.equal(firstRejection.ok, false);
  if (firstRejection.ok) return;
  assert.equal(firstRejection.error.code, 'zero-output-ineligible');
  assert.equal(typeof firstRejection.error.message, 'string');
  assert.ok(firstRejection.error.message.length > 0);
  assert.equal('value' in firstRejection, false);
  assert.equal(Object.isFrozen(firstRejection), true);
  assert.equal(Object.isFrozen(firstRejection.error), true);
  assert.deepEqual(repeatedRejection, firstRejection);
  assert.deepEqual(tiny, pool(1n, 3n, 1n, 2n));
});

void test('returns deterministic frozen errors for negative input and unknown direction', () => {
  const validPool = pool(17n, 29n, 1n, 7n);
  const negativeQuote = quoteConstantProductExactInput(validPool, 'A', -1n);
  const negativeTransition = transitionConstantProductExactInput(validPool, 'A', -1n);
  const unknownQuote = quoteConstantProductExactInput(validPool, 'a', 1n);
  const unknownTransition = transitionConstantProductExactInput(validPool, 'a', 1n);

  for (const [result, code] of [
    [negativeQuote, 'negative-input'],
    [negativeTransition, 'negative-input'],
    [unknownQuote, 'unknown-asset-in'],
    [unknownTransition, 'unknown-asset-in'],
  ] as const) {
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.equal(result.error.code, code);
    assert.equal(typeof result.error.message, 'string');
    assert.ok(result.error.message.length > 0);
    assert.equal('value' in result, false);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.error), true);
  }

  assert.deepEqual(quoteConstantProductExactInput(validPool, 'a', 1n), unknownQuote);
  assert.deepEqual(validPool, pool(17n, 29n, 1n, 7n));
});

void test('handles the maximum valid fee boundary and huge bigint intermediates exactly', () => {
  const boundary = pool(1n, 2001n, 999n, 1000n);
  const boundaryQuote = quoteConstantProductExactInput(boundary, 'A', 1n);
  assert.equal(boundaryQuote.ok, true);
  if (boundaryQuote.ok) assert.equal(boundaryQuote.value.amountOut, 1n);
  const boundaryTransition = transitionConstantProductExactInput(boundary, 'A', 1n);
  assert.equal(boundaryTransition.ok, true);
  if (boundaryTransition.ok) {
    assert.equal(boundaryTransition.value.pool.reserve0, 2n);
    assert.equal(boundaryTransition.value.pool.reserve1, 2000n);
    assert.ok(
      boundaryTransition.value.pool.reserve0 * boundaryTransition.value.pool.reserve1 >=
        boundary.reserve0 * boundary.reserve1,
    );
  }

  const scale = 10n ** 80n;
  const huge = pool(scale, 2n * scale, 0n, 1n);
  const hugeQuote = quoteConstantProductExactInput(huge, 'A', scale);
  assert.equal(hugeQuote.ok, true);
  if (!hugeQuote.ok) return;
  assert.equal(hugeQuote.value.amountOut, scale);
  assert.equal(typeof hugeQuote.value.amountIn, 'bigint');
  assert.equal(typeof hugeQuote.value.amountOut, 'bigint');

  const hugeTransition = transitionConstantProductExactInput(huge, 'A', scale);
  assert.equal(hugeTransition.ok, true);
  if (!hugeTransition.ok) return;
  assert.equal(hugeTransition.value.pool.reserve0, 2n * scale);
  assert.equal(hugeTransition.value.pool.reserve1, scale);
  assert.equal(
    hugeTransition.value.pool.reserve0 * hugeTransition.value.pool.reserve1,
    huge.reserve0 * huge.reserve1,
  );
});

void test('matches a bounded no-division oracle and exact transition properties', () => {
  for (let reserve0 = 1n; reserve0 <= 8n; reserve0 += 1n) {
    for (let reserve1 = 1n; reserve1 <= 8n; reserve1 += 1n) {
      for (let feeDenominator = 1n; feeDenominator <= 5n; feeDenominator += 1n) {
        for (
          let feeChargedNumerator = 0n;
          feeChargedNumerator < feeDenominator;
          feeChargedNumerator += 1n
        ) {
          const candidatePool = pool(
            reserve0,
            reserve1,
            feeChargedNumerator,
            feeDenominator,
          );
          const directions = [
            {
              assetIn: 'A',
              assetOut: 'B',
              reserveIn: reserve0,
              reserveOut: reserve1,
            },
            {
              assetIn: 'B',
              assetOut: 'A',
              reserveIn: reserve1,
              reserveOut: reserve0,
            },
          ] as const;

          for (const direction of directions) {
            let previousOutput = -1n;
            for (let amountIn = 0n; amountIn <= 12n; amountIn += 1n) {
              const expectedOutput = referenceOutputWithoutDivision(
                direction.reserveIn,
                direction.reserveOut,
                feeChargedNumerator,
                feeDenominator,
                amountIn,
              );
              assert.ok(expectedOutput >= previousOutput);
              assert.ok(expectedOutput < direction.reserveOut);
              previousOutput = expectedOutput;

              const quote = quoteConstantProductExactInput(
                candidatePool,
                direction.assetIn,
                amountIn,
              );
              assert.equal(quote.ok, true);
              if (!quote.ok) continue;
              assert.equal(quote.value.poolId, candidatePool.poolId);
              assert.equal(quote.value.assetIn, direction.assetIn);
              assert.equal(quote.value.assetOut, direction.assetOut);
              assert.equal(quote.value.amountIn, amountIn);
              assert.equal(quote.value.amountOut, expectedOutput);
              assert.equal(typeof quote.value.amountIn, 'bigint');
              assert.equal(typeof quote.value.amountOut, 'bigint');

              const transition = transitionConstantProductExactInput(
                candidatePool,
                direction.assetIn,
                amountIn,
              );
              if (amountIn > 0n && expectedOutput === 0n) {
                assert.equal(transition.ok, false);
                if (!transition.ok) {
                  assert.equal(transition.error.code, 'zero-output-ineligible');
                  assert.equal('value' in transition, false);
                }
                continue;
              }

              assert.equal(transition.ok, true);
              if (!transition.ok) continue;
              const expectedReserve0 =
                direction.assetIn === 'A'
                  ? reserve0 + amountIn
                  : reserve0 - expectedOutput;
              const expectedReserve1 =
                direction.assetIn === 'A'
                  ? reserve1 - expectedOutput
                  : reserve1 + amountIn;
              assert.equal(transition.value.pool.reserve0, expectedReserve0);
              assert.equal(transition.value.pool.reserve1, expectedReserve1);
              assert.deepEqual(transition.value.receipt, {
                ...quote.value,
                reserveInBefore: direction.reserveIn,
                reserveOutBefore: direction.reserveOut,
                reserveInAfter: direction.reserveIn + amountIn,
                reserveOutAfter: direction.reserveOut - expectedOutput,
              });
              assert.ok(
                transition.value.pool.reserve0 * transition.value.pool.reserve1 >=
                  reserve0 * reserve1,
              );
              assert.ok(direction.reserveOut - expectedOutput > 0n);
            }
          }
        }
      }
    }
  }
});
