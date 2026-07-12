import type { ConstantProductPool } from '../../domain/index.ts';

export type ConstantProductExecutionErrorCode =
  | 'negative-input'
  | 'unknown-asset-in'
  | 'zero-output-ineligible';

export interface ConstantProductExecutionError {
  readonly code: ConstantProductExecutionErrorCode;
  readonly message: string;
}

export interface ConstantProductQuote {
  readonly poolId: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
}

export interface ConstantProductTransitionReceipt extends ConstantProductQuote {
  readonly reserveInBefore: bigint;
  readonly reserveOutBefore: bigint;
  readonly reserveInAfter: bigint;
  readonly reserveOutAfter: bigint;
}

export type ConstantProductQuoteResult =
  | { readonly ok: true; readonly value: ConstantProductQuote }
  | { readonly ok: false; readonly error: ConstantProductExecutionError };

export type ConstantProductTransitionResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly pool: ConstantProductPool;
        readonly receipt: ConstantProductTransitionReceipt;
      };
    }
  | { readonly ok: false; readonly error: ConstantProductExecutionError };

interface DirectionalPool {
  readonly assetOut: string;
  readonly reserveIn: bigint;
  readonly reserveOut: bigint;
  readonly assetInIsAsset0: boolean;
}

function executionError(
  code: ConstantProductExecutionErrorCode,
  message: string,
): ConstantProductExecutionError {
  return Object.freeze({ code, message });
}

function failure(
  code: ConstantProductExecutionErrorCode,
  message: string,
): { readonly ok: false; readonly error: ConstantProductExecutionError } {
  return Object.freeze({ ok: false, error: executionError(code, message) });
}

function resolveDirection(
  pool: ConstantProductPool,
  assetIn: string,
): DirectionalPool | undefined {
  if (assetIn === pool.asset0) {
    return {
      assetOut: pool.asset1,
      reserveIn: pool.reserve0,
      reserveOut: pool.reserve1,
      assetInIsAsset0: true,
    };
  }
  if (assetIn === pool.asset1) {
    return {
      assetOut: pool.asset0,
      reserveIn: pool.reserve1,
      reserveOut: pool.reserve0,
      assetInIsAsset0: false,
    };
  }
  return undefined;
}

export function quoteConstantProductExactInput(
  pool: ConstantProductPool,
  assetIn: string,
  amountIn: bigint,
): ConstantProductQuoteResult {
  if (amountIn < 0n) {
    return failure('negative-input', 'amountIn must be nonnegative.');
  }

  const direction = resolveDirection(pool, assetIn);
  if (direction === undefined) {
    return failure(
      'unknown-asset-in',
      `assetIn ${assetIn} is not an asset in pool ${pool.poolId}.`,
    );
  }

  const inputMultiplier = pool.feeDenominator - pool.feeChargedNumerator;
  const multipliedInput = amountIn * inputMultiplier;
  const amountOut =
    (multipliedInput * direction.reserveOut) /
    (direction.reserveIn * pool.feeDenominator + multipliedInput);

  const value: ConstantProductQuote = Object.freeze({
    poolId: pool.poolId,
    assetIn,
    assetOut: direction.assetOut,
    amountIn,
    amountOut,
  });
  return Object.freeze({ ok: true, value });
}

export function transitionConstantProductExactInput(
  pool: ConstantProductPool,
  assetIn: string,
  amountIn: bigint,
): ConstantProductTransitionResult {
  const quoteResult = quoteConstantProductExactInput(pool, assetIn, amountIn);
  if (!quoteResult.ok) return quoteResult;

  const quote = quoteResult.value;
  if (amountIn > 0n && quote.amountOut === 0n) {
    return failure(
      'zero-output-ineligible',
      'A positive input that quotes zero output is ineligible for transition.',
    );
  }

  const direction = resolveDirection(pool, assetIn);
  if (direction === undefined) {
    return failure(
      'unknown-asset-in',
      `assetIn ${assetIn} is not an asset in pool ${pool.poolId}.`,
    );
  }

  const reserveInAfter = direction.reserveIn + amountIn;
  const reserveOutAfter = direction.reserveOut - quote.amountOut;
  const transitionedPool: ConstantProductPool = Object.freeze({
    poolId: pool.poolId,
    asset0: pool.asset0,
    reserve0: direction.assetInIsAsset0 ? reserveInAfter : reserveOutAfter,
    asset1: pool.asset1,
    reserve1: direction.assetInIsAsset0 ? reserveOutAfter : reserveInAfter,
    feeChargedNumerator: pool.feeChargedNumerator,
    feeDenominator: pool.feeDenominator,
  });
  const receipt: ConstantProductTransitionReceipt = Object.freeze({
    ...quote,
    reserveInBefore: direction.reserveIn,
    reserveOutBefore: direction.reserveOut,
    reserveInAfter,
    reserveOutAfter,
  });
  const value = Object.freeze({ pool: transitionedPool, receipt });
  return Object.freeze({ ok: true, value });
}
