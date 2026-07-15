import type { QuoteEffort, QuoteStrategy } from '../index.ts';
import { SERVICE_POLICY } from './policy.ts';
import type { ServiceError, ServiceParseResult } from './types.ts';

const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const FIELDS = new Set([
  'snapshotId',
  'assetIn',
  'assetOut',
  'amountIn',
  'strategy',
  'effort',
  'maxHops',
  'maxRoutes',
  'deadlineMs',
]);
const STRATEGIES = new Set<QuoteStrategy>(['best-single', 'greedy-split', 'numerical-split']);
const EFFORTS = new Set<QuoteEffort>(['fast', 'balanced', 'thorough']);

function failure(
  code: string,
  message: string,
  field?: string,
  status = 400,
): ServiceParseResult {
  const error: ServiceError = field === undefined
    ? { status, code, message }
    : { status, code, message, field };
  return Object.freeze({ ok: false, error: Object.freeze(error) });
}

function record(input: unknown): Record<string, unknown> | undefined {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : undefined;
}

function identifier(
  input: Record<string, unknown>,
  field: 'snapshotId' | 'assetIn' | 'assetOut',
  maximum: number,
): string | ServiceParseResult {
  const value = input[field];
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    return failure('invalid-request', `${field} must be a nonempty string of at most ${maximum} characters.`, field);
  }
  return value;
}

function optionalInteger(
  input: Record<string, unknown>,
  field: 'maxHops' | 'maxRoutes' | 'deadlineMs',
  minimum: number,
  maximum: number,
): number | undefined | ServiceParseResult {
  const value = input[field];
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    return failure('invalid-request', `${field} must be an integer from ${minimum} through ${maximum}.`, field);
  }
  return value as number;
}

function failed(value: string | number | undefined | ServiceParseResult): value is ServiceParseResult {
  return typeof value === 'object';
}

export function parseServiceQuote(input: unknown): ServiceParseResult {
  const value = record(input);
  if (value === undefined) return failure('invalid-json-shape', 'The request body must be a JSON object.');
  for (const field of Object.keys(value)) {
    if (!FIELDS.has(field)) return failure('unknown-field', `Unknown request field ${field}.`, field);
  }
  const snapshotId = identifier(value, 'snapshotId', SERVICE_POLICY.snapshotIdLength);
  if (failed(snapshotId)) return snapshotId;
  const assetIn = identifier(value, 'assetIn', SERVICE_POLICY.assetIdLength);
  if (failed(assetIn)) return assetIn;
  const assetOut = identifier(value, 'assetOut', SERVICE_POLICY.assetIdLength);
  if (failed(assetOut)) return assetOut;
  const amountIn = value['amountIn'];
  if (
    typeof amountIn !== 'string' ||
    amountIn.length > SERVICE_POLICY.amountDigits ||
    !DECIMAL.test(amountIn) ||
    amountIn === '0'
  ) {
    return failure(
      'invalid-request',
      `amountIn must be a positive canonical decimal string of at most ${SERVICE_POLICY.amountDigits} digits.`,
      'amountIn',
    );
  }
  const strategy = value['strategy'] ?? 'greedy-split';
  if (typeof strategy !== 'string' || !STRATEGIES.has(strategy as QuoteStrategy)) {
    return failure('invalid-request', 'strategy must be best-single, greedy-split, or numerical-split.', 'strategy');
  }
  const effort = value['effort'] ?? 'balanced';
  if (typeof effort !== 'string' || !EFFORTS.has(effort as QuoteEffort)) {
    return failure('invalid-request', 'effort must be fast, balanced, or thorough.', 'effort');
  }
  const maxHops = optionalInteger(value, 'maxHops', 1, SERVICE_POLICY.maxHops);
  if (failed(maxHops)) return maxHops;
  const maxRoutes = optionalInteger(value, 'maxRoutes', 1, SERVICE_POLICY.maxRoutes);
  if (failed(maxRoutes)) return maxRoutes;
  const deadlineMs = optionalInteger(value, 'deadlineMs', 0, SERVICE_POLICY.maxDeadlineMs);
  if (failed(deadlineMs)) return deadlineMs;
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      request: Object.freeze({
        snapshotId,
        assetIn,
        assetOut,
        amountIn: BigInt(amountIn),
        ...(maxHops === undefined ? {} : { maxHops }),
        ...(maxRoutes === undefined ? {} : { maxRoutes }),
      }),
      options: Object.freeze({
        strategy: strategy as QuoteStrategy,
        effort: effort as QuoteEffort,
        ...(deadlineMs === undefined ? {} : { deadlineMs }),
      }),
    }),
  });
}
