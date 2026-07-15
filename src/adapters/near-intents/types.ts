import type { QuoteEffort, QuoteStrategy } from '../../index.ts';

declare const nearIntentsAdapterBrand: unique symbol;

export interface NearIntentsFixtureAdapter {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetCount: number;
  readonly [nearIntentsAdapterBrand]: typeof nearIntentsAdapterBrand;
}

export interface NearIntentsExactInputRequest {
  readonly defuse_asset_identifier_in: string;
  readonly defuse_asset_identifier_out: string;
  readonly exact_amount_in: string;
  readonly min_deadline_ms: number;
}

export interface NearIntentsUnsignedQuoteCandidate {
  readonly schemaVersion: 'routelab.near-intents-unsigned-quote.v1';
  readonly unsigned: true;
  readonly defuse_asset_identifier_in: string;
  readonly defuse_asset_identifier_out: string;
  readonly amount_in: string;
  readonly amount_out: string;
  readonly valid_for_ms: number;
  readonly snapshot_id: string;
  readonly snapshot_checksum: string;
  readonly routelab_semantic_fingerprint: string;
  readonly selected_strategy: QuoteStrategy;
  readonly effort: QuoteEffort;
  readonly termination: string;
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

export type NearIntentsQuoteResult =
  | { readonly ok: true; readonly value: NearIntentsUnsignedQuoteCandidate }
  | { readonly ok: false; readonly error: NearIntentsAdapterError };
