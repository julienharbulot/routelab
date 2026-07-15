import { parseStrictJsonText } from '../json/strict-json.ts';
import {
  requireJsonArray,
  requireString,
  type JsonObject,
  type JsonValue,
} from '../types.ts';

const UNSIGNED = /^(0|[1-9][0-9]*)$/u;
const POSITIVE = /^[1-9][0-9]*$/u;
const SIGNED = /^(0|-?[1-9][0-9]*)$/u;
const NANOSECONDS = /^(0|[1-9][0-9]{0,19})$/u;
const BOUNDED_SIGNED = /^(0|-?[1-9][0-9]{0,22})$/u;
const BOUNDED_POSITIVE = /^[1-9][0-9]{0,22}$/u;
const TOTAL_MEMORY = /^[1-9][0-9]{0,15}$/u;
const BINARY64 = /^[0-9a-f]{16}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const MAX_NANOSECONDS = 99_999_999_999_999_999_999n;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export interface DecodedRouteHop {
  readonly assetIn: string;
  readonly poolId: string;
  readonly assetOut: string;
}

function fail(): never {
  throw new TypeError('Artifact primitive codec rejected a value.');
}

function regexString(value: JsonValue, expression: RegExp): string {
  const text = requireString(value);
  if (!expression.test(text)) return fail();
  return text;
}

function canonicalRelativePath(value: JsonValue): string {
  const text = requireString(value);
  if (
    text.length === 0 ||
    text.includes('\\') ||
    text.includes('\0') ||
    text.startsWith('/') ||
    text.split('/').some((segment) =>
      segment.length === 0 || segment === '.' || segment === '..')
  ) {
    return fail();
  }
  return text;
}

function routeHop(value: JsonValue): DecodedRouteHop {
  const tuple = requireJsonArray(value);
  if (tuple.length !== 3) return fail();
  const assetIn = requireString(tuple[0]);
  const poolId = requireString(tuple[1]);
  const assetOut = requireString(tuple[2]);
  if (assetIn.length === 0 || poolId.length === 0 || assetOut.length === 0) {
    return fail();
  }
  return Object.freeze({ assetIn, poolId, assetOut });
}

function decodeCanonicalJsonString(value: JsonValue): JsonValue {
  const text = requireString(value);
  const parsed = parseStrictJsonText(text);
  if (JSON.stringify(parsed) !== text) return fail();
  return parsed;
}

export function decodeCanonicalRouteKey(value: JsonValue): readonly DecodedRouteHop[] {
  const routes = requireJsonArray(decodeCanonicalJsonString(value));
  if (routes.length === 0) return fail();
  return Object.freeze(routes.map(routeHop));
}

export function decodeCanonicalCandidateSetKey(
  value: JsonValue,
): readonly (readonly DecodedRouteHop[])[] {
  const set = requireJsonArray(decodeCanonicalJsonString(value));
  if (set.length === 0) return fail();
  return Object.freeze(set.map((route) => {
    const hops = requireJsonArray(route);
    if (hops.length === 0) return fail();
    return Object.freeze(hops.map(routeHop));
  }));
}

export function compareDecodedRoutes(
  left: readonly DecodedRouteHop[],
  right: readonly DecodedRouteHop[],
): number {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const leftHop = left[index];
    const rightHop = right[index];
    if (leftHop === undefined || rightHop === undefined) return fail();
    for (const field of ['assetIn', 'poolId', 'assetOut'] as const) {
      if (leftHop[field] < rightHop[field]) return -1;
      if (leftHop[field] > rightHop[field]) return 1;
    }
  }
  return left.length - right.length;
}

export function validatePrimitiveCodec(
  codecId: string,
  value: JsonValue,
): void {
  switch (codecId) {
    case 'boolean':
      if (typeof value !== 'boolean') return fail();
      return;
    case 'safeNonnegativeInteger':
      if (!Number.isSafeInteger(value) || (value as number) < 0) return fail();
      return;
    case 'safePositiveInteger':
      if (!Number.isSafeInteger(value) || (value as number) <= 0) return fail();
      return;
    case 'counterVector': {
      const vector = requireJsonArray(value);
      if (vector.length !== 12 || vector.some((counter) =>
        !Number.isSafeInteger(counter) || (counter as number) < 0 ||
        (counter as number) > 100_000)) return fail();
      return;
    }
    case 'canonicalUnsignedDecimal':
      regexString(value, UNSIGNED);
      return;
    case 'canonicalPositiveDecimal':
      regexString(value, POSITIVE);
      return;
    case 'canonicalSignedDecimal':
      regexString(value, SIGNED);
      return;
    case 'nanoseconds': {
      const text = regexString(value, NANOSECONDS);
      if (BigInt(text) > MAX_NANOSECONDS) return fail();
      return;
    }
    case 'boundedMetricSignedDecimal':
      regexString(value, BOUNDED_SIGNED);
      return;
    case 'boundedMetricPositiveDecimal':
      regexString(value, BOUNDED_POSITIVE);
      return;
    case 'recordOnlyTotalMemoryBytes': {
      const text = regexString(value, TOTAL_MEMORY);
      if (BigInt(text) > MAX_SAFE_BIGINT) return fail();
      return;
    }
    case 'recordOnlyTimezone': {
      const text = requireString(value);
      if (text.length === 0 || new TextEncoder().encode(text).byteLength > 128) {
        return fail();
      }
      return;
    }
    case 'binary64Bits':
      regexString(value, BINARY64);
      return;
    case 'sha256':
      regexString(value, SHA256);
      return;
    case 'gitRevision':
      regexString(value, REVISION);
      return;
    case 'relativePosixPath':
      canonicalRelativePath(value);
      return;
    case 'identifier': {
      const text = requireString(value);
      if (text.length === 0) return fail();
      return;
    }
    case 'canonicalRouteKey':
      decodeCanonicalRouteKey(value);
      return;
    case 'canonicalCandidateSetKey':
      decodeCanonicalCandidateSetKey(value);
      return;
    default:
      return fail();
  }
}

export function canonicalRouteKey(
  hops: readonly Readonly<{
    readonly poolId: string;
    readonly assetIn: string;
    readonly assetOut: string;
  }>[],
): string {
  return JSON.stringify(hops.map((hop) => [hop.assetIn, hop.poolId, hop.assetOut]));
}

export function canonicalCandidateSetKey(
  routes: readonly (readonly Readonly<{
    readonly poolId: string;
    readonly assetIn: string;
    readonly assetOut: string;
  }>[])[],
): string {
  return JSON.stringify(routes.map((route) =>
    route.map((hop) => [hop.assetIn, hop.poolId, hop.assetOut])));
}

export function asJsonObject(value: JsonValue): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail();
  }
  return value as JsonObject;
}
