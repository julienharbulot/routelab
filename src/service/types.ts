import type { Server } from 'node:http';

import type {
  QuoteOptions,
  QuoteRequest,
  RoutingContext,
} from '../index.ts';

export interface ServiceSnapshot {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly poolCount: number;
  readonly assetIds: ReadonlySet<string>;
  readonly context: RoutingContext;
}

export interface ParsedServiceQuote {
  readonly request: QuoteRequest;
  readonly options: QuoteOptions;
}

export interface ServiceError {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly field?: string;
}

export type ServiceParseResult =
  | { readonly ok: true; readonly value: ParsedServiceQuote }
  | { readonly ok: false; readonly error: ServiceError };

export interface QuoteHttpService {
  readonly server: Server;
  readonly snapshots: readonly Omit<ServiceSnapshot, 'assetIds' | 'context'>[];
}

export type ServiceLogger = (line: string) => void;
