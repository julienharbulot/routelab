import {
  prepareSnapshot,
  quote,
  type QuoteEffort,
  type QuoteStrategy,
  type RoutingContext,
} from '../../index.ts';
import type {
  NearIntentsAdapterError,
  NearIntentsAdapterErrorCode,
  NearIntentsFixtureAdapter,
  NearIntentsQuoteResult,
  PrepareNearIntentsAdapterResult,
} from './types.ts';

interface AdapterState {
  readonly context: RoutingContext;
  readonly assets: ReadonlyMap<string, string>;
}

const adapterStates = new WeakMap<NearIntentsFixtureAdapter, AdapterState>();
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const REQUEST_FIELDS = new Set([
  'defuse_asset_identifier_in',
  'defuse_asset_identifier_out',
  'exact_amount_in',
  'min_deadline_ms',
]);
const MAX_ASSETS = 128;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_AMOUNT_DIGITS = 78;
const MIN_VALIDITY_MS = 1_000;
const MAX_VALIDITY_MS = 300_000;
const STRATEGY: QuoteStrategy = 'greedy-split';
const EFFORT: QuoteEffort = 'balanced';

function error(
  code: NearIntentsAdapterErrorCode,
  message: string,
  field?: string,
  causeCode?: string,
): NearIntentsAdapterError {
  return Object.freeze({
    code,
    message,
    ...(field === undefined ? {} : { field }),
    ...(causeCode === undefined ? {} : { causeCode }),
  });
}

function failure(
  code: NearIntentsAdapterErrorCode,
  message: string,
  field?: string,
  causeCode?: string,
): NearIntentsQuoteResult {
  return Object.freeze({ ok: false, error: error(code, message, field, causeCode) });
}

function object(input: unknown): Record<string, unknown> | undefined {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : undefined;
}

function exactFields(input: Record<string, unknown>, expected: ReadonlySet<string>): boolean {
  return Object.keys(input).every((field) => expected.has(field));
}

function parseAssetMap(input: unknown):
  | { readonly ok: true; readonly snapshotId: string; readonly assets: ReadonlyMap<string, string> }
  | { readonly ok: false; readonly error: NearIntentsAdapterError } {
  const value = object(input);
  if (
    value === undefined ||
    !exactFields(value, new Set(['schemaVersion', 'snapshotId', 'assets'])) ||
    value['schemaVersion'] !== 'routelab.near-intents-asset-map.v1' ||
    typeof value['snapshotId'] !== 'string' ||
    value['snapshotId'].length === 0 ||
    value['snapshotId'].length > MAX_IDENTIFIER_LENGTH ||
    !Array.isArray(value['assets']) ||
    value['assets'].length === 0 ||
    value['assets'].length > MAX_ASSETS
  ) {
    return Object.freeze({
      ok: false,
      error: error('invalid-asset-map', 'Asset map must match the bounded v1 fixture schema.'),
    });
  }
  const external = new Set<string>();
  const internal = new Set<string>();
  const entries: [string, string][] = [];
  for (const source of value['assets']) {
    const entry = object(source);
    const externalId = entry?.['defuse_asset_identifier'];
    const snapshotId = entry?.['snapshot_asset_id'];
    if (
      entry === undefined ||
      !exactFields(entry, new Set(['defuse_asset_identifier', 'snapshot_asset_id'])) ||
      typeof externalId !== 'string' ||
      typeof snapshotId !== 'string' ||
      externalId.length === 0 ||
      snapshotId.length === 0 ||
      externalId.length > MAX_IDENTIFIER_LENGTH ||
      snapshotId.length > MAX_IDENTIFIER_LENGTH ||
      external.has(externalId) ||
      internal.has(snapshotId)
    ) {
      return Object.freeze({
        ok: false,
        error: error('invalid-asset-map', 'Asset map entries must be unique bounded string pairs.'),
      });
    }
    external.add(externalId);
    internal.add(snapshotId);
    entries.push([externalId, snapshotId]);
  }
  return Object.freeze({
    ok: true,
    snapshotId: value['snapshotId'],
    assets: Object.freeze(new Map(entries)),
  });
}

export function prepareNearIntentsFixtureAdapter(
  snapshotInput: unknown,
  assetMapInput: unknown,
): PrepareNearIntentsAdapterResult {
  const prepared = prepareSnapshot(snapshotInput);
  if (!prepared.ok) {
    return Object.freeze({
      ok: false,
      error: error('snapshot-preparation-failed', 'The fixture snapshot failed public preparation.'),
    });
  }
  const assetMap = parseAssetMap(assetMapInput);
  if (!assetMap.ok) return Object.freeze({ ok: false, error: assetMap.error });
  if (assetMap.snapshotId !== prepared.value.snapshotId) {
    return Object.freeze({
      ok: false,
      error: error('snapshot-mismatch', 'The asset map snapshotId does not match the prepared snapshot.', 'snapshotId'),
    });
  }
  const adapter = Object.freeze({
    snapshotId: prepared.value.snapshotId,
    snapshotChecksum: prepared.value.snapshotChecksum,
    assetCount: assetMap.assets.size,
  }) as NearIntentsFixtureAdapter;
  adapterStates.set(adapter, Object.freeze({ context: prepared.value, assets: assetMap.assets }));
  return Object.freeze({ ok: true, value: adapter });
}

export function quoteNearIntentsExactInput(
  adapter: NearIntentsFixtureAdapter,
  input: unknown,
): NearIntentsQuoteResult {
  const state = adapterStates.get(adapter);
  if (state === undefined) return failure('snapshot-mismatch', 'Adapter was not created by the fixture preparer.');
  const value = object(input);
  if (value === undefined) return failure('invalid-request', 'Quote request must be a JSON object.');
  if (Object.hasOwn(value, 'exact_amount_out')) {
    return failure('exact-output-unsupported', 'Fixture adapter supports exact input only.', 'exact_amount_out');
  }
  for (const field of Object.keys(value)) {
    if (!REQUEST_FIELDS.has(field)) return failure('invalid-request', `Unknown quote request field ${field}.`, field);
  }
  const assetIn = value['defuse_asset_identifier_in'];
  const assetOut = value['defuse_asset_identifier_out'];
  const amountIn = value['exact_amount_in'];
  const validity = value['min_deadline_ms'];
  if (typeof assetIn !== 'string' || assetIn.length === 0 || assetIn.length > MAX_IDENTIFIER_LENGTH) {
    return failure('invalid-request', 'Input asset identifier is invalid.', 'defuse_asset_identifier_in');
  }
  if (typeof assetOut !== 'string' || assetOut.length === 0 || assetOut.length > MAX_IDENTIFIER_LENGTH) {
    return failure('invalid-request', 'Output asset identifier is invalid.', 'defuse_asset_identifier_out');
  }
  if (assetIn === assetOut) {
    return failure('invalid-request', 'Input and output asset identifiers must differ.', 'defuse_asset_identifier_out');
  }
  if (
    typeof amountIn !== 'string' ||
    amountIn.length > MAX_AMOUNT_DIGITS ||
    amountIn === '0' ||
    !DECIMAL.test(amountIn)
  ) {
    return failure('invalid-request', 'exact_amount_in must be a positive canonical decimal string.', 'exact_amount_in');
  }
  if (
    !Number.isSafeInteger(validity) ||
    (validity as number) < MIN_VALIDITY_MS ||
    (validity as number) > MAX_VALIDITY_MS
  ) {
    return failure(
      'invalid-request',
      `min_deadline_ms must be an integer from ${MIN_VALIDITY_MS} through ${MAX_VALIDITY_MS}.`,
      'min_deadline_ms',
    );
  }
  const mappedIn = state.assets.get(assetIn);
  if (mappedIn === undefined) return failure('unknown-asset', 'Input asset is not mapped.', 'defuse_asset_identifier_in');
  const mappedOut = state.assets.get(assetOut);
  if (mappedOut === undefined) return failure('unknown-asset', 'Output asset is not mapped.', 'defuse_asset_identifier_out');
  const result = quote(state.context, {
    snapshotId: state.context.snapshotId,
    assetIn: mappedIn,
    assetOut: mappedOut,
    amountIn: BigInt(amountIn),
  }, { strategy: STRATEGY, effort: EFFORT });
  if (!result.ok) {
    return failure('quote-failed', 'The exact router did not produce an unsigned candidate.', undefined, result.error.code);
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      schemaVersion: 'routelab.near-intents-unsigned-quote.v1',
      unsigned: true,
      defuse_asset_identifier_in: assetIn,
      defuse_asset_identifier_out: assetOut,
      amount_in: amountIn,
      amount_out: result.value.amountOut.toString(10),
      valid_for_ms: validity as number,
      snapshot_id: result.value.snapshotId,
      snapshot_checksum: result.value.snapshotChecksum,
      routelab_semantic_fingerprint: result.value.semanticFingerprint,
      selected_strategy: result.value.requestedStrategy,
      effort: result.value.effort,
      termination: result.value.termination,
    }),
  });
}
