import type { ExactRationalValue, JsonObject } from '../types.ts';

export function rational(
  numerator: bigint,
  denominator: bigint,
): ExactRationalValue {
  if (denominator <= 0n) throw new TypeError('Rational denominator is invalid.');
  return Object.freeze({ numerator, denominator });
}

export function compareRational(
  left: ExactRationalValue,
  right: ExactRationalValue,
): -1 | 0 | 1 {
  const compared = left.numerator * right.denominator -
    right.numerator * left.denominator;
  return compared < 0n ? -1 : compared > 0n ? 1 : 0;
}

export function medianRational(values: readonly bigint[]): ExactRationalValue {
  if (values.length === 0) throw new TypeError('Median population is empty.');
  const ordered = [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  const half = Math.floor(ordered.length / 2);
  const upper = ordered[half];
  if (upper === undefined) throw new TypeError('Median member is absent.');
  if (ordered.length % 2 === 1) return rational(upper, 1n);
  const lower = ordered[half - 1];
  if (lower === undefined) throw new TypeError('Median member is absent.');
  return rational(lower + upper, 2n);
}

export function medianOfFive(values: readonly bigint[]): bigint {
  if (values.length !== 5) throw new TypeError('Five-sweep median is incomplete.');
  const ordered = [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  const value = ordered[2];
  if (value === undefined) throw new TypeError('Five-sweep median is absent.');
  return value;
}

export function nullableMedianOfThree(
  values: readonly (bigint | null)[],
): bigint | null {
  if (values.length !== 3) throw new TypeError('Three-sweep median is incomplete.');
  const ordered = [...values].sort((left, right) => {
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return ordered[1] ?? null;
}

export function rationalJson(value: ExactRationalValue): JsonObject {
  return Object.freeze({
    numerator: value.numerator.toString(10),
    denominator: value.denominator.toString(10),
  });
}
