export interface BoundedSnapshotJsonLimits {
  readonly maxRawPublicationBytes: number;
  readonly snapshotRootMembers: number;
  readonly poolMembers: number;
  readonly maxContainerDepth: number;
  readonly maxPools: number;
  readonly maxIdentifierCodeUnits: number;
  readonly maxIdentifierUtf8Bytes: number;
  readonly maxExactDecimalDigits: number;
}

export type BoundedSnapshotJsonErrorCode =
  | 'invalid-raw-publication'
  | 'raw-publication-byte-limit'
  | 'invalid-utf8'
  | 'invalid-json'
  | 'duplicate-member'
  | 'unknown-member'
  | 'missing-member'
  | 'invalid-member-type'
  | 'container-depth-limit'
  | 'publication-limit'
  | 'invalid-identifier'
  | 'invalid-snapshot-checksum'
  | 'invalid-exact-decimal';

export interface BoundedSnapshotJsonError {
  readonly code: BoundedSnapshotJsonErrorCode;
  readonly path: string;
  readonly message: string;
  readonly limit?: keyof BoundedSnapshotJsonLimits;
}

export type DecodeBoundedSnapshotJsonResult =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly error: BoundedSnapshotJsonError };

interface ScanState {
  readonly text: string;
  readonly end: number;
  readonly limits: BoundedSnapshotJsonLimits;
  index: number;
}

interface ValueSpan {
  readonly start: number;
  readonly end: number;
}

class JsonPreflightFailure extends Error {
  readonly error: BoundedSnapshotJsonError;

  constructor(error: BoundedSnapshotJsonError) {
    super(error.message);
    this.error = error;
  }
}

const ROOT_FIELDS = new Set(['snapshotId', 'snapshotChecksum', 'pools']);
const POOL_FIELDS = new Set([
  'poolId',
  'asset0',
  'reserve0',
  'asset1',
  'reserve1',
  'feeChargedNumerator',
  'feeDenominator',
]);
const IDENTIFIER_POOL_FIELDS = new Set(['poolId', 'asset0', 'asset1']);
const EXACT_POOL_FIELDS = new Set([
  'reserve0',
  'reserve1',
  'feeChargedNumerator',
  'feeDenominator',
]);
const CANONICAL_UNSIGNED_DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const LOWERCASE_SHA256 = /^sha256:[0-9a-f]{64}$/u;

function intrinsicTypedArrayByteLength(value: Uint8Array): number {
  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype) as object,
    'byteLength',
  ) as { readonly get?: unknown } | undefined;
  const getter = descriptor?.get;
  if (typeof getter !== 'function') {
    throw new TypeError('Typed-array byteLength getter is unavailable.');
  }
  const length: unknown = Reflect.apply(getter, value, []);
  if (typeof length !== 'number') {
    throw new TypeError('Typed-array byteLength getter returned a non-number.');
  }
  return length;
}

function frozenError(
  code: BoundedSnapshotJsonErrorCode,
  path: string,
  message: string,
  limit?: keyof BoundedSnapshotJsonLimits,
): BoundedSnapshotJsonError {
  return limit === undefined
    ? Object.freeze({ code, path, message })
    : Object.freeze({ code, path, message, limit });
}

function failure(
  code: BoundedSnapshotJsonErrorCode,
  path: string,
  message: string,
  limit?: keyof BoundedSnapshotJsonLimits,
): never {
  throw new JsonPreflightFailure(frozenError(code, path, message, limit));
}

function skipWhitespace(state: ScanState): void {
  while (state.index < state.end) {
    const code = state.text.charCodeAt(state.index);
    if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return;
    state.index += 1;
  }
}

function expectCharacter(state: ScanState, expected: string, path: string): void {
  if (state.text[state.index] !== expected) {
    failure('invalid-json', path, `Expected ${JSON.stringify(expected)}.`);
  }
  state.index += 1;
}

function isHexDigit(value: string | undefined): boolean {
  return value !== undefined && /^[0-9A-Fa-f]$/u.test(value);
}

function parseJsonString(state: ScanState, path: string): string {
  skipWhitespace(state);
  if (state.text[state.index] !== '"') {
    failure('invalid-member-type', path, 'Expected a JSON string.');
  }
  const start = state.index;
  state.index += 1;
  while (state.index < state.end) {
    const code = state.text.charCodeAt(state.index);
    if (code === 0x22) {
      state.index += 1;
      const token = state.text.slice(start, state.index);
      try {
        const parsed: unknown = JSON.parse(token);
        if (typeof parsed !== 'string') {
          failure('invalid-json', path, 'Invalid JSON string token.');
        }
        return parsed;
      } catch (error: unknown) {
        if (error instanceof JsonPreflightFailure) throw error;
        failure('invalid-json', path, 'Invalid JSON string token.');
      }
    }
    if (code < 0x20) {
      failure('invalid-json', path, 'JSON strings cannot contain raw control characters.');
    }
    if (code !== 0x5c) {
      state.index += 1;
      continue;
    }
    state.index += 1;
    const escape = state.text[state.index];
    if (escape === undefined) {
      failure('invalid-json', path, 'JSON string ends inside an escape sequence.');
    }
    if ('"\\/bfnrt'.includes(escape)) {
      state.index += 1;
      continue;
    }
    if (escape !== 'u') {
      failure('invalid-json', path, 'JSON string contains an invalid escape sequence.');
    }
    for (let offset = 1; offset <= 4; offset += 1) {
      if (!isHexDigit(state.text[state.index + offset])) {
        failure('invalid-json', path, 'JSON string contains an invalid Unicode escape.');
      }
    }
    state.index += 5;
  }
  failure('invalid-json', path, 'Unterminated JSON string.');
}

function skipNumber(state: ScanState, path: string): void {
  const source = state.text.slice(state.index, state.end);
  const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(source);
  if (match === null) failure('invalid-json', path, 'Invalid JSON number.');
  state.index += match[0].length;
}

function skipLiteral(state: ScanState, literal: string, path: string): void {
  if (!state.text.startsWith(literal, state.index)) {
    failure('invalid-json', path, 'Invalid JSON value.');
  }
  state.index += literal.length;
}

function assertDepth(state: ScanState, depth: number, path: string): void {
  if (depth > state.limits.maxContainerDepth) {
    failure(
      'container-depth-limit',
      path,
      `JSON container depth exceeds ${state.limits.maxContainerDepth}.`,
      'maxContainerDepth',
    );
  }
}

function skipGenericObject(
  state: ScanState,
  depth: number,
  path: string,
  enforceDuplicateMembers: boolean,
): void {
  assertDepth(state, depth, path);
  expectCharacter(state, '{', path);
  skipWhitespace(state);
  if (state.text[state.index] === '}') {
    state.index += 1;
    return;
  }
  const members = new Set<string>();
  while (true) {
    const field = parseJsonString(state, path);
    if (enforceDuplicateMembers && members.has(field)) {
      failure('duplicate-member', `${path}.${field}`, `Duplicate member ${field}.`);
    }
    members.add(field);
    skipWhitespace(state);
    expectCharacter(state, ':', path);
    skipValue(state, depth + 1, `${path}.${field}`, enforceDuplicateMembers);
    skipWhitespace(state);
    const delimiter = state.text[state.index];
    if (delimiter === '}') {
      state.index += 1;
      return;
    }
    if (delimiter !== ',') failure('invalid-json', path, 'Expected comma or object end.');
    state.index += 1;
    skipWhitespace(state);
  }
}

function skipGenericArray(
  state: ScanState,
  depth: number,
  path: string,
  enforceDuplicateMembers: boolean,
): void {
  assertDepth(state, depth, path);
  expectCharacter(state, '[', path);
  skipWhitespace(state);
  if (state.text[state.index] === ']') {
    state.index += 1;
    return;
  }
  let itemIndex = 0;
  while (true) {
    skipValue(
      state,
      depth + 1,
      `${path}[${itemIndex}]`,
      enforceDuplicateMembers,
    );
    itemIndex += 1;
    skipWhitespace(state);
    const delimiter = state.text[state.index];
    if (delimiter === ']') {
      state.index += 1;
      return;
    }
    if (delimiter !== ',') failure('invalid-json', path, 'Expected comma or array end.');
    state.index += 1;
    skipWhitespace(state);
  }
}

function skipValue(
  state: ScanState,
  depth: number,
  path: string,
  enforceDuplicateMembers = true,
): void {
  skipWhitespace(state);
  const token = state.text[state.index];
  if (token === '"') {
    parseJsonString(state, path);
    return;
  }
  if (token === '{') {
    skipGenericObject(state, depth, path, enforceDuplicateMembers);
    return;
  }
  if (token === '[') {
    skipGenericArray(state, depth, path, enforceDuplicateMembers);
    return;
  }
  if (token === 't') {
    skipLiteral(state, 'true', path);
    return;
  }
  if (token === 'f') {
    skipLiteral(state, 'false', path);
    return;
  }
  if (token === 'n') {
    skipLiteral(state, 'null', path);
    return;
  }
  if (token === '-' || (token !== undefined && token >= '0' && token <= '9')) {
    skipNumber(state, path);
    return;
  }
  failure('invalid-json', path, 'Invalid JSON value.');
}

function validateIdentifier(
  value: string,
  path: string,
  limits: BoundedSnapshotJsonLimits,
): void {
  const isWellFormed = value.isWellFormed();
  const exceedsCodeUnits = value.length > limits.maxIdentifierCodeUnits;
  const exceedsUtf8Bytes =
    isWellFormed && Buffer.byteLength(value, 'utf8') > limits.maxIdentifierUtf8Bytes;
  if (
    value.length === 0 ||
    !isWellFormed ||
    exceedsCodeUnits ||
    exceedsUtf8Bytes
  ) {
    failure(
      'invalid-identifier',
      path,
      'Identifier violates the service Unicode or encoded-length contract.',
      exceedsCodeUnits
        ? 'maxIdentifierCodeUnits'
        : exceedsUtf8Bytes
          ? 'maxIdentifierUtf8Bytes'
          : undefined,
    );
  }
  for (const codePoint of value) {
    const scalar = codePoint.codePointAt(0);
    if (scalar !== undefined && (scalar <= 0x1f || scalar === 0x7f)) {
      failure('invalid-identifier', path, 'Identifier contains a C0 or DEL control.');
    }
  }
}

function validateExactDecimal(
  value: string,
  path: string,
  limits: BoundedSnapshotJsonLimits,
): void {
  if (!CANONICAL_UNSIGNED_DECIMAL.test(value)) {
    failure(
      'invalid-exact-decimal',
      path,
      'Exact values must use canonical unsigned decimal syntax.',
    );
  }
  if (value.length > limits.maxExactDecimalDigits) {
    failure(
      'publication-limit',
      path,
      `Exact decimal exceeds ${limits.maxExactDecimalDigits} digits.`,
      'maxExactDecimalDigits',
    );
  }
}

function scanPoolSpans(
  state: ScanState,
  path: string,
): readonly ValueSpan[] {
  assertDepth(state, 2, path);
  skipWhitespace(state);
  expectCharacter(state, '[', path);
  skipWhitespace(state);
  const spans: ValueSpan[] = [];
  if (state.text[state.index] === ']') {
    state.index += 1;
    return spans;
  }
  while (true) {
    const itemIndex = spans.length;
    const itemPath = `${path}[${itemIndex}]`;
    skipWhitespace(state);
    if (state.text[state.index] !== '{') {
      failure('invalid-member-type', itemPath, 'Pool must be a JSON object.');
    }
    const start = state.index;
    skipValue(state, 3, itemPath, false);
    spans.push(Object.freeze({ start, end: state.index }));
    if (spans.length > state.limits.maxPools) {
      failure(
        'publication-limit',
        path,
        `Pool count exceeds ${state.limits.maxPools}.`,
        'maxPools',
      );
    }
    skipWhitespace(state);
    const delimiter = state.text[state.index];
    if (delimiter === ']') {
      state.index += 1;
      break;
    }
    if (delimiter !== ',') failure('invalid-json', path, 'Expected comma or array end.');
    state.index += 1;
    skipWhitespace(state);
  }
  return spans;
}

function parsePoolSpan(
  text: string,
  span: ValueSpan,
  poolIndex: number,
  limits: BoundedSnapshotJsonLimits,
): void {
  const path = `$.pools[${poolIndex}]`;
  const state: ScanState = { text, index: span.start, end: span.end, limits };
  expectCharacter(state, '{', path);
  skipWhitespace(state);
  const seen = new Set<string>();
  if (state.text[state.index] === '}') state.index += 1;
  else {
    while (true) {
      const field = parseJsonString(state, path);
      const fieldPath = `${path}.${field}`;
      if (seen.has(field)) {
        failure('duplicate-member', fieldPath, `Duplicate member ${field}.`);
      }
      seen.add(field);
      if (!POOL_FIELDS.has(field)) {
        failure('unknown-member', fieldPath, `Unknown pool member ${field}.`);
      }
      skipWhitespace(state);
      expectCharacter(state, ':', fieldPath);
      const value = parseJsonString(state, fieldPath);
      if (IDENTIFIER_POOL_FIELDS.has(field)) validateIdentifier(value, fieldPath, limits);
      else if (EXACT_POOL_FIELDS.has(field)) validateExactDecimal(value, fieldPath, limits);
      skipWhitespace(state);
      const delimiter = state.text[state.index];
      if (delimiter === '}') {
        state.index += 1;
        break;
      }
      if (delimiter !== ',') failure('invalid-json', path, 'Expected comma or object end.');
      state.index += 1;
      skipWhitespace(state);
    }
  }
  if (seen.size !== limits.poolMembers) {
    for (const field of POOL_FIELDS) {
      if (!seen.has(field)) {
        failure('missing-member', `${path}.${field}`, `Missing pool member ${field}.`);
      }
    }
    failure('invalid-json', path, `Pool must contain exactly ${limits.poolMembers} members.`);
  }
  skipWhitespace(state);
  if (state.index !== state.end) failure('invalid-json', path, 'Unexpected pool content.');
}

function preflightSnapshotJson(
  text: string,
  limits: BoundedSnapshotJsonLimits,
): void {
  const state: ScanState = { text, index: 0, end: text.length, limits };
  skipWhitespace(state);
  assertDepth(state, 1, '$');
  expectCharacter(state, '{', '$');
  skipWhitespace(state);
  const seen = new Set<string>();
  let poolSpans: readonly ValueSpan[] | undefined;
  if (state.text[state.index] === '}') state.index += 1;
  else {
    while (true) {
      const field = parseJsonString(state, '$');
      const path = `$.${field}`;
      if (seen.has(field)) failure('duplicate-member', path, `Duplicate member ${field}.`);
      seen.add(field);
      if (!ROOT_FIELDS.has(field)) {
        failure('unknown-member', path, `Unknown snapshot member ${field}.`);
      }
      skipWhitespace(state);
      expectCharacter(state, ':', path);
      if (field === 'pools') {
        poolSpans = scanPoolSpans(state, path);
      } else {
        const value = parseJsonString(state, path);
        if (field === 'snapshotId') validateIdentifier(value, path, limits);
        else if (!LOWERCASE_SHA256.test(value)) {
          failure(
            'invalid-snapshot-checksum',
            path,
            'Snapshot checksum must be lowercase sha256 followed by 64 hex digits.',
          );
        }
      }
      skipWhitespace(state);
      const delimiter = state.text[state.index];
      if (delimiter === '}') {
        state.index += 1;
        break;
      }
      if (delimiter !== ',') failure('invalid-json', '$', 'Expected comma or object end.');
      state.index += 1;
      skipWhitespace(state);
    }
  }
  if (seen.size !== limits.snapshotRootMembers) {
    for (const field of ROOT_FIELDS) {
      if (!seen.has(field)) {
        failure('missing-member', `$.${field}`, `Missing snapshot member ${field}.`);
      }
    }
    failure(
      'invalid-json',
      '$',
      `Snapshot must contain exactly ${limits.snapshotRootMembers} members.`,
    );
  }
  skipWhitespace(state);
  if (state.index !== state.end) failure('invalid-json', '$', 'Unexpected trailing JSON content.');
  if (poolSpans === undefined) {
    failure('missing-member', '$.pools', 'Missing snapshot member pools.');
  }
  for (let index = 0; index < poolSpans.length; index += 1) {
    const span = poolSpans[index];
    if (span === undefined) failure('invalid-json', `$.pools[${index}]`, 'Missing pool span.');
    parsePoolSpan(text, span, index, limits);
  }
}

export function decodeBoundedSnapshotJson(
  rawSnapshotUtf8: Uint8Array,
  limits: BoundedSnapshotJsonLimits,
): DecodeBoundedSnapshotJsonResult {
  let byteLength: number;
  try {
    if (!(rawSnapshotUtf8 instanceof Uint8Array)) {
      return Object.freeze({
        ok: false,
        error: frozenError(
          'invalid-raw-publication',
          '$',
          'Raw snapshot publication must be a Uint8Array.',
        ),
      });
    }
    byteLength = intrinsicTypedArrayByteLength(rawSnapshotUtf8);
  } catch {
    return Object.freeze({
      ok: false,
      error: frozenError(
        'invalid-raw-publication',
        '$',
        'Raw snapshot publication cannot be inspected safely.',
      ),
    });
  }
  if (byteLength > limits.maxRawPublicationBytes) {
    return Object.freeze({
      ok: false,
      error: frozenError(
        'raw-publication-byte-limit',
        '$',
        `Raw snapshot publication exceeds ${limits.maxRawPublicationBytes} bytes.`,
        'maxRawPublicationBytes',
      ),
    });
  }
  let copied: Uint8Array;
  try {
    copied = new Uint8Array(byteLength);
    copied.set(rawSnapshotUtf8);
  } catch {
    return Object.freeze({
      ok: false,
      error: frozenError(
        'invalid-raw-publication',
        '$',
        'Raw snapshot publication cannot be copied safely.',
      ),
    });
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(copied);
  } catch {
    return Object.freeze({
      ok: false,
      error: frozenError('invalid-utf8', '$', 'Raw snapshot publication is not valid UTF-8.'),
    });
  }
  try {
    preflightSnapshotJson(text, limits);
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      failure('invalid-member-type', '$', 'Snapshot must be a JSON object.');
    }
    return Object.freeze({ ok: true, value: parsed as Record<string, unknown> });
  } catch (error: unknown) {
    if (error instanceof JsonPreflightFailure) {
      return Object.freeze({ ok: false, error: error.error });
    }
    return Object.freeze({
      ok: false,
      error: frozenError('invalid-json', '$', 'Raw snapshot publication is not valid JSON.'),
    });
  }
}
