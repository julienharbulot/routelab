declare const nearIntentsAdapterBrand: unique symbol;

export interface NearIntentsFixtureAdapter {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetCount: number;
  readonly [nearIntentsAdapterBrand]: typeof nearIntentsAdapterBrand;
}

export interface NearQuoteParamsExactInputInput {
  readonly defuse_asset_identifier_in: string;
  readonly defuse_asset_identifier_out: string;
  readonly exact_amount_in: string;
  readonly min_deadline_ms?: number;
}

export interface ParsedNearQuoteParamsExactInput {
  readonly defuse_asset_identifier_in: string;
  readonly defuse_asset_identifier_out: string;
  readonly exact_amount_in: string;
  readonly min_deadline_ms: number;
}

export interface NearSolverQuoteEventExactInput extends ParsedNearQuoteParamsExactInput {
  readonly quote_id: string;
}

export interface UnsignedNearSolverQuoteDraft {
  readonly schemaVersion: 'routelab.near-solver-quote-draft.v1';
  readonly unsigned: true;
  readonly quote_id: string;
  readonly quote_output: {
    readonly amount_out: string;
  };
  readonly intended_token_diff: {
    readonly receive_asset: string;
    readonly receive_amount: string;
    readonly give_asset: string;
    readonly give_amount: string;
  };
  readonly valid_for_ms: number;
  readonly routelab_plan_fingerprint: string;
}

export type NearIntentsAdapterErrorCode =
  | 'invalid-asset-map'
  | 'snapshot-preparation-failed'
  | 'snapshot-mismatch'
  | 'invalid-request'
  | 'exact-output-unsupported'
  | 'unknown-asset'
  | 'quote-failed';

export interface NearIntentsAdapterError {
  readonly code: NearIntentsAdapterErrorCode;
  readonly message: string;
  readonly field?: string;
  readonly causeCode?: string;
}

export type PrepareNearIntentsAdapterResult =
  | { readonly ok: true; readonly value: NearIntentsFixtureAdapter }
  | { readonly ok: false; readonly error: NearIntentsAdapterError };

export type ParseNearQuoteParamsResult =
  | { readonly ok: true; readonly value: ParsedNearQuoteParamsExactInput }
  | { readonly ok: false; readonly error: NearIntentsAdapterError };

export type NearSolverQuoteDraftResult =
  | { readonly ok: true; readonly value: UnsignedNearSolverQuoteDraft }
  | { readonly ok: false; readonly error: NearIntentsAdapterError };
