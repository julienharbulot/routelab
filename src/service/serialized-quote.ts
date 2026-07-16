import type { SerializedQuote } from '../index.ts';

const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const STRATEGIES = new Set(['best-single', 'greedy-split', 'numerical-split']);
const EFFORTS = new Set(['fast', 'balanced', 'thorough']);
const TERMINATIONS = new Set(['complete', 'work-limit', 'deadline', 'interrupted']);

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function decimal(value: unknown): value is string {
  return typeof value === 'string' && DECIMAL.test(value);
}

function hop(value: unknown): boolean {
  const input = record(value);
  return input !== undefined
    && nonempty(input['poolId'])
    && nonempty(input['assetIn'])
    && nonempty(input['assetOut'])
    && decimal(input['amountIn'])
    && decimal(input['amountOut']);
}

function route(value: unknown): boolean {
  const input = record(value);
  return input !== undefined
    && decimal(input['allocation'])
    && decimal(input['amountOut'])
    && Array.isArray(input['hops'])
    && input['hops'].length > 0
    && input['hops'].every(hop);
}

/** A deliberately small fail-closed validator for the worker/service boundary. */
export function parseSerializedQuote(value: unknown): SerializedQuote | undefined {
  const input = record(value);
  const timing = record(input?.['timing']);
  if (
    input?.['schemaVersion'] !== 'routelab.quote.v1'
    || !nonempty(input['snapshotId'])
    || typeof input['snapshotChecksum'] !== 'string'
    || !SHA256.test(input['snapshotChecksum'])
    || !nonempty(input['assetIn'])
    || !nonempty(input['assetOut'])
    || !decimal(input['amountIn'])
    || !decimal(input['amountOut'])
    || !Array.isArray(input['routes'])
    || input['routes'].length === 0
    || !input['routes'].every(route)
    || typeof input['requestedStrategy'] !== 'string'
    || !STRATEGIES.has(input['requestedStrategy'])
    || typeof input['effort'] !== 'string'
    || !EFFORTS.has(input['effort'])
    || (input['planKind'] !== 'single' && input['planKind'] !== 'split')
    || typeof input['termination'] !== 'string'
    || !TERMINATIONS.has(input['termination'])
    || typeof input['planFingerprint'] !== 'string'
    || !SHA256.test(input['planFingerprint'])
    || timing === undefined
    || typeof timing['elapsedMicros'] !== 'number'
    || !Number.isFinite(timing['elapsedMicros'])
    || timing['elapsedMicros'] < 0
    || (input['numericalImprovementSelected'] !== undefined
      && typeof input['numericalImprovementSelected'] !== 'boolean')
    || input['diagnostics'] !== undefined
  ) return undefined;
  return value as SerializedQuote;
}
