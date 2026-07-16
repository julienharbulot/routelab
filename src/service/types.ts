import type { Server } from 'node:http';

import type {
  QuoteOptions,
  QuoteRequest,
  RoutingContext,
  SerializedQuote,
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

export interface ServiceLatencyDistribution {
  readonly samples: number;
  readonly p50Micros: number;
  readonly p95Micros: number;
  readonly p99Micros: number | null;
  readonly maxMicros: number;
}

export interface ServiceMetrics {
  readonly initialRssBytes: number;
  readonly peakRssBytes: number;
  readonly finalRssBytes: number;
  readonly initialHeapUsedBytes: number;
  readonly peakHeapUsedBytes: number;
  readonly finalHeapUsedBytes: number;
  readonly admissionAcceptedCount: number;
  readonly admissionRejectedCount: number;
  readonly overloadCount: number;
  readonly maximumActiveWork: number;
  readonly maximumQueuedWork: number;
  readonly structuredCompletionCount: number;
  readonly terminationCounts: Readonly<Record<string, number>>;
  readonly routeCountCounts: Readonly<Record<string, number>>;
  readonly quoteService: ServiceLatencyDistribution | null;
  readonly eventLoopDelayP95Micros: number;
  readonly eventLoopDelayMaxMicros: number;
}

export interface QuoteHttpService {
  readonly server: Server;
  readonly snapshots: readonly Omit<ServiceSnapshot, 'assetIds' | 'context'>[];
  readonly resetMetrics: () => void;
  readonly readMetrics: () => ServiceMetrics;
  readonly closeExecution: () => Promise<void>;
}

export type ServiceLogger = (line: string) => void;

export type ServiceExecutionResult =
  | { readonly ok: true; readonly value: SerializedQuote }
  | { readonly ok: false; readonly error: ServiceError };

export interface ServiceQuoteExecutor {
  readonly maximumActiveWork: number;
  readonly maximumQueuedWork: number;
  readonly execute: (
    snapshot: ServiceSnapshot,
    parsed: ParsedServiceQuote,
    options: QuoteOptions,
  ) => Promise<ServiceExecutionResult>;
  readonly close: () => Promise<void>;
}
