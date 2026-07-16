import {
  prepareSnapshot,
  quote,
  type RoutingContext,
} from '../../index.ts';
import { parseLiquiditySnapshot } from '../../domain/index.ts';
import type {
  NearIntentsAdapterError,
  NearIntentsAdapterErrorCode,
  NearIntentsFixtureAdapter,
  NearSolverQuoteDraftResult,
  NearSolverQuoteEventExactInput,
  ParseNearQuoteParamsResult,
  PrepareNearIntentsAdapterResult,
} from './types.ts';

interface AdapterState {
  readonly context: RoutingContext;
  readonly assets: ReadonlyMap<string, string>;
}

interface ParsedAssetMap {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assets: ReadonlyMap<string, string>;
}

const adapterStates = new WeakMap<NearIntentsFixtureAdapter, AdapterState>();
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const QUOTE_FIELDS = new Set([
  'defuse_asset_identifier_in',
  'defuse_asset_identifier_out',
  'exact_amount_in',
  'min_deadline_ms',
]);
const SOLVER_EVENT_FIELDS = new Set([...QUOTE_FIELDS, 'quote_id']);
const MAX_ASSETS = 128;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_AMOUNT_DIGITS = 78;
const MIN_VALIDITY_MS = 1_000;
const MAX_VALIDITY_MS = 300_000;

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
): NearSolverQuoteDraftResult {
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
  | { readonly ok: true; readonly value: ParsedAssetMap }
  | { readonly ok: false; readonly error: NearIntentsAdapterError } {
  const value = object(input);
  if (
    value === undefined ||
    !exactFields(value, new Set(['schemaVersion', 'snapshotId', 'snapshotChecksum', 'assets'])) ||
    value['schemaVersion'] !== 'routelab.near-intents-asset-map.v2' ||
    typeof value['snapshotId'] !== 'string' ||
    value['snapshotId'].length === 0 ||
    value['snapshotId'].length > MAX_IDENTIFIER_LENGTH ||
    typeof value['snapshotChecksum'] !== 'string' ||
    value['snapshotChecksum'].length === 0 ||
    value['snapshotChecksum'].length > MAX_IDENTIFIER_LENGTH ||
    !Array.isArray(value['assets']) ||
    value['assets'].length === 0 ||
    value['assets'].length > MAX_ASSETS
  ) {
    return Object.freeze({
      ok: false,
      error: error('invalid-asset-map', 'Asset map must match the bounded v2 fixture schema.'),
    });
  }
  const external = new Set<string>();
  const internal = new Set<string>();
  const entries: [string, string][] = [];
  for (const source of value['assets']) {
    const entry = object(source);
    const externalId = entry?.['defuse_asset_identifier'];
    const internalId = entry?.['snapshot_asset_id'];
    if (
      entry === undefined ||
      !exactFields(entry, new Set(['defuse_asset_identifier', 'snapshot_asset_id'])) ||
      typeof externalId !== 'string' ||
      typeof internalId !== 'string' ||
      externalId.length === 0 ||
      internalId.length === 0 ||
      externalId.length > MAX_IDENTIFIER_LENGTH ||
      internalId.length > MAX_IDENTIFIER_LENGTH ||
      external.has(externalId) ||
      internal.has(internalId)
    ) {
      return Object.freeze({
        ok: false,
        error: error('invalid-asset-map', 'Asset map entries must be unique bounded string pairs.'),
      });
    }
    external.add(externalId);
    internal.add(internalId);
    entries.push([externalId, internalId]);
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      snapshotId: value['snapshotId'],
      snapshotChecksum: value['snapshotChecksum'],
      assets: new Map(entries),
    }),
  });
}

function parseExactInput(
  input: unknown,
  fields: ReadonlySet<string>,
): ParseNearQuoteParamsResult {
  const value = object(input);
  if (value === undefined) {
    return Object.freeze({
      ok: false,
      error: error('invalid-request', 'Quote parameters must be a JSON object.'),
    });
  }
  if (Object.hasOwn(value, 'exact_amount_out')) {
    return Object.freeze({
      ok: false,
      error: error(
        'exact-output-unsupported',
        'The fixture supports exact-input quotes only; exact_amount_out is unsupported.',
        'exact_amount_out',
      ),
    });
  }
  for (const field of Object.keys(value)) {
    if (!fields.has(field)) {
      return Object.freeze({
        ok: false,
        error: error('invalid-request', `Unknown quote parameter field ${field}.`, field),
      });
    }
  }
  const assetIn = value['defuse_asset_identifier_in'];
  const assetOut = value['defuse_asset_identifier_out'];
  const amountIn = value['exact_amount_in'];
  const validity = value['min_deadline_ms'];
  if (typeof assetIn !== 'string' || assetIn.length === 0 || assetIn.length > MAX_IDENTIFIER_LENGTH) {
    return Object.freeze({
      ok: false,
      error: error('invalid-request', 'Input asset identifier is invalid.', 'defuse_asset_identifier_in'),
    });
  }
  if (typeof assetOut !== 'string' || assetOut.length === 0 || assetOut.length > MAX_IDENTIFIER_LENGTH) {
    return Object.freeze({
      ok: false,
      error: error('invalid-request', 'Output asset identifier is invalid.', 'defuse_asset_identifier_out'),
    });
  }
  if (assetIn === assetOut) {
    return Object.freeze({
      ok: false,
      error: error(
        'invalid-request',
        'Input and output asset identifiers must differ.',
        'defuse_asset_identifier_out',
      ),
    });
  }
  if (
    typeof amountIn !== 'string' ||
    amountIn.length > MAX_AMOUNT_DIGITS ||
    amountIn === '0' ||
    !DECIMAL.test(amountIn)
  ) {
    return Object.freeze({
      ok: false,
      error: error(
        'invalid-request',
        'exact_amount_in must be a positive canonical decimal string.',
        'exact_amount_in',
      ),
    });
  }
  if (
    !Number.isSafeInteger(validity) ||
    (validity as number) < MIN_VALIDITY_MS ||
    (validity as number) > MAX_VALIDITY_MS
  ) {
    return Object.freeze({
      ok: false,
      error: error(
        'invalid-request',
        `min_deadline_ms must be an integer from ${MIN_VALIDITY_MS} through ${MAX_VALIDITY_MS}.`,
        'min_deadline_ms',
      ),
    });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      defuse_asset_identifier_in: assetIn,
      defuse_asset_identifier_out: assetOut,
      exact_amount_in: amountIn,
      min_deadline_ms: validity as number,
    }),
  });
}

export function parseNearQuoteParamsExactInput(input: unknown): ParseNearQuoteParamsResult {
  return parseExactInput(input, QUOTE_FIELDS);
}

function parseSolverQuoteEvent(input: unknown):
  | { readonly ok: true; readonly value: NearSolverQuoteEventExactInput }
  | { readonly ok: false; readonly error: NearIntentsAdapterError } {
  const parsed = parseExactInput(input, SOLVER_EVENT_FIELDS);
  if (!parsed.ok) return parsed;
  const quoteId = object(input)?.['quote_id'];
  if (typeof quoteId !== 'string' || quoteId.length === 0 || quoteId.length > MAX_IDENTIFIER_LENGTH) {
    return Object.freeze({
      ok: false,
      error: error('invalid-request', 'quote_id is invalid.', 'quote_id'),
    });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({ quote_id: quoteId, ...parsed.value }),
  });
}

export function prepareNearIntentsFixtureAdapter(
  snapshotInput: unknown,
  assetMapInput: unknown,
): PrepareNearIntentsAdapterResult {
  const parsedSnapshot = parseLiquiditySnapshot(snapshotInput);
  const prepared = prepareSnapshot(snapshotInput);
  if (!parsedSnapshot.ok || !prepared.ok) {
    return Object.freeze({
      ok: false,
      error: error('snapshot-preparation-failed', 'The fixture snapshot failed public preparation.'),
    });
  }
  const assetMap = parseAssetMap(assetMapInput);
  if (!assetMap.ok) return Object.freeze({ ok: false, error: assetMap.error });
  if (assetMap.value.snapshotId !== prepared.value.snapshotId) {
    return Object.freeze({
      ok: false,
      error: error(
        'snapshot-mismatch',
        'The asset map snapshotId does not match the prepared snapshot.',
        'snapshotId',
      ),
    });
  }
  if (assetMap.value.snapshotChecksum !== prepared.value.snapshotChecksum) {
    return Object.freeze({
      ok: false,
      error: error(
        'snapshot-mismatch',
        'The asset map snapshotChecksum does not match the prepared snapshot.',
        'snapshotChecksum',
      ),
    });
  }
  const snapshotAssets = new Set(
    parsedSnapshot.value.pools.flatMap(({ asset0, asset1 }) => [asset0, asset1]),
  );
  for (const internalId of assetMap.value.assets.values()) {
    if (!snapshotAssets.has(internalId)) {
      return Object.freeze({
        ok: false,
        error: error(
          'invalid-asset-map',
          `Mapped snapshot asset does not exist: ${internalId}.`,
          'assets',
        ),
      });
    }
  }
  const adapter = Object.freeze({
    snapshotId: prepared.value.snapshotId,
    snapshotChecksum: prepared.value.snapshotChecksum,
    assetCount: assetMap.value.assets.size,
  }) as NearIntentsFixtureAdapter;
  adapterStates.set(adapter, Object.freeze({ context: prepared.value, assets: assetMap.value.assets }));
  return Object.freeze({ ok: true, value: adapter });
}

export function draftNearSolverQuoteExactInput(
  adapter: NearIntentsFixtureAdapter,
  input: unknown,
): NearSolverQuoteDraftResult {
  const state = adapterStates.get(adapter);
  if (state === undefined) {
    return failure('snapshot-mismatch', 'Adapter was not created by the fixture preparer.');
  }
  const parsed = parseSolverQuoteEvent(input);
  if (!parsed.ok) return Object.freeze({ ok: false, error: parsed.error });
  const event = parsed.value;
  const mappedIn = state.assets.get(event.defuse_asset_identifier_in);
  if (mappedIn === undefined) {
    return failure('unknown-asset', 'Input asset is not mapped.', 'defuse_asset_identifier_in');
  }
  const mappedOut = state.assets.get(event.defuse_asset_identifier_out);
  if (mappedOut === undefined) {
    return failure('unknown-asset', 'Output asset is not mapped.', 'defuse_asset_identifier_out');
  }
  const result = quote(state.context, {
    snapshotId: state.context.snapshotId,
    assetIn: mappedIn,
    assetOut: mappedOut,
    amountIn: BigInt(event.exact_amount_in),
  }, { strategy: 'greedy-split', effort: 'balanced' });
  if (!result.ok) {
    return failure(
      'quote-failed',
      'The exact router did not produce an unsigned solver draft.',
      undefined,
      result.error.code,
    );
  }
  const amountOut = result.value.amountOut.toString(10);
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      schemaVersion: 'routelab.near-solver-quote-draft.v1',
      unsigned: true,
      quote_id: event.quote_id,
      quote_output: Object.freeze({ amount_out: amountOut }),
      intended_token_diff: Object.freeze({
        receive_asset: event.defuse_asset_identifier_in,
        receive_amount: event.exact_amount_in,
        give_asset: event.defuse_asset_identifier_out,
        give_amount: amountOut,
      }),
      valid_for_ms: event.min_deadline_ms,
      routelab_plan_fingerprint: result.value.planFingerprint,
    }),
  });
}
