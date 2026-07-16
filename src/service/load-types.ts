import type { EvidenceSourceIdentity } from '../evidence/source-identity.ts';
import type { ServiceMetrics } from './types.ts';

export type ServiceMode = 'same-thread' | 'worker';
export type ServiceLoadMode = ServiceMode | 'compare';

export interface ClientLatencyDistribution {
  readonly samples: number;
  readonly p50Micros: number;
  readonly p95Micros: number;
  readonly p99Micros: number | null;
  readonly maxMicros: number;
}

export interface ServiceLoadRow {
  readonly mode: ServiceMode;
  readonly concurrency: number;
  readonly requests: number;
  readonly completed: number;
  readonly typedErrors: number;
  readonly timedOut: number;
  readonly responseSchemaFailures: number;
  readonly exactOutputPresenceCount: number;
  readonly fingerprintPresenceCount: number;
  readonly semanticMatchCount: number;
  readonly deadlineCompletionCount: number;
  readonly deadlineCompletionRatePpm: number | null;
  readonly successfulLatency: ClientLatencyDistribution | null;
  readonly errorResponseLatency: ClientLatencyDistribution | null;
  readonly throughputPerSecond: number;
  readonly server: ServiceMetrics;
}

export type DeadlineClassification =
  | 'complete-exact-quote'
  | 'validated-deadline-incumbent'
  | 'deadline-before-plan'
  | 'overload'
  | 'client-timeout'
  | 'schema-or-internal-failure';

export interface DeadlineLoadRow {
  readonly mode: 'worker';
  readonly concurrency: 16;
  readonly deadlineMs: 25 | 50 | 100;
  readonly requests: number;
  readonly classifications: Readonly<Record<DeadlineClassification, number>>;
  readonly exactValidationCount: number;
  readonly completeQuoteLatency: ClientLatencyDistribution | null;
  readonly deadlineIncumbentLatency: ClientLatencyDistribution | null;
  readonly errorResponseLatency: ClientLatencyDistribution | null;
  readonly server: ServiceMetrics;
}

export interface OverloadBurstResult {
  readonly mode: 'worker';
  readonly requests: number;
  readonly activeCapacity: number;
  readonly queueCapacity: number;
  readonly acceptedCount: number;
  readonly overloadedCount: number;
  readonly retryAfterCount: number;
  readonly acceptedExactQuoteCount: number;
  readonly clientTimeoutCount: number;
  readonly schemaOrInternalFailureCount: number;
  readonly server: ServiceMetrics;
}

export interface ServiceExecutionIdentity {
  readonly sourceRevision: string;
  readonly sourceDigest: string;
  readonly node: string;
  readonly platform: string;
  readonly arch: string;
  readonly cpu: string;
}

export interface WorkerRetentionGate {
  readonly semanticAndSchemaRegressionFree: boolean;
  readonly tailLatencyMetric: 'p95' | 'p99' | null;
  readonly tailLatencyImprovementPpm: number | null;
  readonly eventLoopMaxImprovementPpm: number | null;
  readonly tailOrEventLoopPassed: boolean;
  readonly concurrency16ThroughputRatioPpm: number | null;
  readonly throughputPassed: boolean;
  readonly concurrency1P50OverheadMicros: number | null;
  readonly concurrency1OverheadPassed: boolean;
  readonly noLostRequests: boolean;
  readonly memoryReported: boolean;
}

export interface ServiceLoadReport {
  readonly schemaVersion: 'routelab.service-load-summary.v2';
  readonly evidenceSource: EvidenceSourceIdentity;
  readonly observedAt: string;
  readonly environment: {
    readonly node: string;
    readonly platform: string;
    readonly arch: string;
    readonly cpu: string;
    readonly commit: string;
  };
  readonly comparisonIdentity: {
    readonly sameThread: ServiceExecutionIdentity;
    readonly worker: ServiceExecutionIdentity;
  } | null;
  readonly corpus: {
    readonly corpusId: string;
    readonly snapshotId: string;
    readonly snapshotChecksum: string;
    readonly requestCount: number;
    readonly claim: 'synthetic exact-input requests derived from one historical pool-reserve snapshot';
  };
  readonly configuration: {
    readonly modes: readonly ServiceMode[];
    readonly processModel: 'isolated-load-generator-and-server-processes';
    readonly host: '127.0.0.1';
    readonly requestsPerConcurrency: number;
    readonly warmupsPerConcurrency: number;
    readonly requestTimeoutMs: number;
    readonly quoteDeadlineMs: number;
    readonly strategy: 'greedy-split';
    readonly effort: 'fast';
    readonly caseCount: number;
    readonly sameThreadMaximumActiveWork: number;
    readonly workerMaximumActiveWork: number;
    readonly maximumQueuedWork: number;
    readonly workerCount: number;
    readonly deadlineConcurrency: 16;
    readonly deadlineValuesMs: readonly [25, 50, 100];
    readonly deadlineRequestsPerValue: number;
    readonly overloadBurstRequests: number;
  };
  readonly rows: readonly ServiceLoadRow[];
  readonly deadlineSweep: readonly DeadlineLoadRow[];
  readonly overloadBurst: OverloadBurstResult | null;
  readonly workerDecision: {
    readonly evaluated: boolean;
    readonly retained: boolean;
    readonly decision: 'not-evaluated' | 'retained' | 'rejected';
    readonly gate: WorkerRetentionGate | null;
    readonly reason: string;
  };
}
