export interface ConstantProductPool {
  readonly poolId: string;
  readonly asset0: string;
  readonly reserve0: bigint;
  readonly asset1: string;
  readonly reserve1: bigint;
  readonly feeChargedNumerator: bigint;
  readonly feeDenominator: bigint;
}

export interface LiquiditySnapshot {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly pools: readonly ConstantProductPool[];
}

export type SnapshotValidationErrorCode =
  | 'invalid-type'
  | 'missing-field'
  | 'unknown-field'
  | 'empty-identifier'
  | 'invalid-exact-string'
  | 'nonpositive-reserve'
  | 'duplicate-pool-assets'
  | 'invalid-fee-denominator'
  | 'invalid-fee-charged-numerator'
  | 'duplicate-pool-id';

export interface SnapshotValidationError {
  readonly code: SnapshotValidationErrorCode;
  readonly path: string;
  readonly message: string;
}

export type SnapshotValidationResult =
  | { readonly ok: true; readonly value: LiquiditySnapshot }
  | { readonly ok: false; readonly errors: readonly SnapshotValidationError[] };

type InputObject = Record<string, unknown>;

interface ParsedPoolFields {
  poolId: string | undefined;
  asset0: string | undefined;
  reserve0: bigint | undefined;
  asset1: string | undefined;
  reserve1: bigint | undefined;
  feeChargedNumerator: bigint | undefined;
  feeDenominator: bigint | undefined;
}

const SNAPSHOT_FIELDS = new Set(['snapshotId', 'snapshotChecksum', 'pools']);
const POOL_FIELDS = new Set([
  'poolId',
  'asset0',
  'reserve0',
  'asset1',
  'reserve1',
  'feeChargedNumerator',
  'feeDenominator',
]);
const CANONICAL_UNSIGNED_DECIMAL = /^(?:0|[1-9][0-9]*)$/u;

function isInputObject(input: unknown): input is InputObject {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function hasOwn(input: InputObject, field: string): boolean {
  return Object.hasOwn(input, field);
}

function error(
  code: SnapshotValidationErrorCode,
  path: string,
  message: string,
): SnapshotValidationError {
  return Object.freeze({ code, path, message });
}

function readIdentifier(
  input: InputObject,
  field: string,
  path: string,
  errors: SnapshotValidationError[],
): string | undefined {
  const fieldPath = `${path}.${field}`;
  if (!hasOwn(input, field)) {
    errors.push(error('missing-field', fieldPath, `Missing required field ${field}.`));
    return undefined;
  }

  const value = input[field];
  if (typeof value !== 'string') {
    errors.push(error('invalid-type', fieldPath, `${field} must be a string.`));
    return undefined;
  }
  if (value.length === 0) {
    errors.push(error('empty-identifier', fieldPath, `${field} must not be empty.`));
    return undefined;
  }
  return value;
}

function readExactString(
  input: InputObject,
  field: string,
  path: string,
  errors: SnapshotValidationError[],
): bigint | undefined {
  const fieldPath = `${path}.${field}`;
  if (!hasOwn(input, field)) {
    errors.push(error('missing-field', fieldPath, `Missing required field ${field}.`));
    return undefined;
  }

  const value = input[field];
  if (typeof value !== 'string') {
    errors.push(
      error('invalid-type', fieldPath, `${field} must be a canonical unsigned decimal string.`),
    );
    return undefined;
  }
  if (!CANONICAL_UNSIGNED_DECIMAL.test(value)) {
    errors.push(
      error(
        'invalid-exact-string',
        fieldPath,
        `${field} must use the canonical unsigned decimal grammar 0|[1-9][0-9]*.`,
      ),
    );
    return undefined;
  }
  return BigInt(value);
}

function reportUnknownFields(
  input: InputObject,
  knownFields: ReadonlySet<string>,
  path: string,
  errors: SnapshotValidationError[],
): void {
  const unknownFields = Object.keys(input)
    .filter((field) => !knownFields.has(field))
    .sort();

  for (const field of unknownFields) {
    errors.push(error('unknown-field', `${path}.${field}`, `Unknown field ${field}.`));
  }
}

function parsePool(
  input: unknown,
  index: number,
  seenPoolIds: Set<string>,
  errors: SnapshotValidationError[],
): ConstantProductPool | undefined {
  const path = `$.pools[${index}]`;
  if (!isInputObject(input)) {
    errors.push(error('invalid-type', path, 'Pool must be an object.'));
    return undefined;
  }

  const fields: ParsedPoolFields = {
    poolId: undefined,
    asset0: undefined,
    reserve0: undefined,
    asset1: undefined,
    reserve1: undefined,
    feeChargedNumerator: undefined,
    feeDenominator: undefined,
  };
  fields.poolId = readIdentifier(input, 'poolId', path, errors);
  fields.asset0 = readIdentifier(input, 'asset0', path, errors);
  fields.reserve0 = readExactString(input, 'reserve0', path, errors);
  if (fields.reserve0 === 0n) {
    errors.push(
      error('nonpositive-reserve', `${path}.reserve0`, 'reserve0 must be positive.'),
    );
  }
  fields.asset1 = readIdentifier(input, 'asset1', path, errors);
  fields.reserve1 = readExactString(input, 'reserve1', path, errors);
  if (fields.reserve1 === 0n) {
    errors.push(
      error('nonpositive-reserve', `${path}.reserve1`, 'reserve1 must be positive.'),
    );
  }
  fields.feeChargedNumerator = readExactString(
    input,
    'feeChargedNumerator',
    path,
    errors,
  );
  fields.feeDenominator = readExactString(input, 'feeDenominator', path, errors);
  if (fields.feeDenominator === 0n) {
    errors.push(
      error(
        'invalid-fee-denominator',
        `${path}.feeDenominator`,
        'feeDenominator must be positive.',
      ),
    );
  }

  reportUnknownFields(input, POOL_FIELDS, path, errors);

  if (fields.poolId !== undefined) {
    if (seenPoolIds.has(fields.poolId)) {
      errors.push(
        error(
          'duplicate-pool-id',
          `${path}.poolId`,
          `poolId duplicates an earlier pool: ${fields.poolId}.`,
        ),
      );
    } else {
      seenPoolIds.add(fields.poolId);
    }
  }
  if (
    fields.asset0 !== undefined &&
    fields.asset1 !== undefined &&
    fields.asset0 === fields.asset1
  ) {
    errors.push(
      error(
        'duplicate-pool-assets',
        `${path}.asset1`,
        'asset0 and asset1 must be distinct.',
      ),
    );
  }
  if (
    fields.feeChargedNumerator !== undefined &&
    fields.feeDenominator !== undefined &&
    fields.feeChargedNumerator >= fields.feeDenominator
  ) {
    errors.push(
      error(
        'invalid-fee-charged-numerator',
        `${path}.feeChargedNumerator`,
        'feeChargedNumerator must be less than feeDenominator.',
      ),
    );
  }

  if (
    fields.poolId === undefined ||
    fields.asset0 === undefined ||
    fields.reserve0 === undefined ||
    fields.reserve0 === 0n ||
    fields.asset1 === undefined ||
    fields.reserve1 === undefined ||
    fields.reserve1 === 0n ||
    fields.feeChargedNumerator === undefined ||
    fields.feeDenominator === undefined ||
    fields.feeDenominator === 0n ||
    fields.asset0 === fields.asset1 ||
    fields.feeChargedNumerator >= fields.feeDenominator
  ) {
    return undefined;
  }

  return Object.freeze({
    poolId: fields.poolId,
    asset0: fields.asset0,
    reserve0: fields.reserve0,
    asset1: fields.asset1,
    reserve1: fields.reserve1,
    feeChargedNumerator: fields.feeChargedNumerator,
    feeDenominator: fields.feeDenominator,
  });
}

export function parseLiquiditySnapshot(input: unknown): SnapshotValidationResult {
  if (!isInputObject(input)) {
    return Object.freeze({
      ok: false,
      errors: Object.freeze([error('invalid-type', '$', 'Snapshot must be an object.')]),
    });
  }

  const errors: SnapshotValidationError[] = [];
  const snapshotId = readIdentifier(input, 'snapshotId', '$', errors);
  const snapshotChecksum = readIdentifier(input, 'snapshotChecksum', '$', errors);
  const pools: ConstantProductPool[] = [];

  if (!hasOwn(input, 'pools')) {
    errors.push(error('missing-field', '$.pools', 'Missing required field pools.'));
  } else if (!Array.isArray(input['pools'])) {
    errors.push(error('invalid-type', '$.pools', 'pools must be an array.'));
  } else {
    const seenPoolIds = new Set<string>();
    for (const [index, poolInput] of input['pools'].entries()) {
      const pool = parsePool(poolInput, index, seenPoolIds, errors);
      if (pool !== undefined) {
        pools.push(pool);
      }
    }
  }

  reportUnknownFields(input, SNAPSHOT_FIELDS, '$', errors);

  if (errors.length > 0 || snapshotId === undefined || snapshotChecksum === undefined) {
    return Object.freeze({ ok: false, errors: Object.freeze(errors) });
  }

  const frozenPools = Object.freeze(pools);
  const value: LiquiditySnapshot = Object.freeze({
    snapshotId,
    snapshotChecksum,
    pools: frozenPools,
  });
  return Object.freeze({ ok: true, value });
}
