import type { PreparedRoutingContext } from '../../runtime/prepared-routing-context/index.ts';

export interface SyntheticRequestCorpusVerifierDependencies {
  readonly readFile: (path: string) => Promise<Uint8Array>;
}
export type SyntheticRequestAmountBucket =
  | 'max-reserve-1-in-100000'
  | 'max-reserve-1-in-10000'
  | 'max-reserve-1-in-1000';

export type SyntheticRequestTopology =
  | 'direct-edge-present'
  | 'direct-edge-absent-common-neighbor-present';

export interface SyntheticExactInputRequest {
  readonly requestId: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountBucket: SyntheticRequestAmountBucket;
  readonly amountIn: bigint;
  readonly topology: SyntheticRequestTopology;
}

export interface VerifiedSyntheticRequestCorpus {
  readonly corpusId: string;
  readonly datasetId: string;
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly requests: readonly SyntheticExactInputRequest[];
}

export type SyntheticRequestCorpusVerificationErrorCode =
  | 'manifest-read-failed'
  | 'invalid-manifest-json'
  | 'invalid-manifest-shape'
  | 'historical-dataset-invalid'
  | 'requests-read-failed'
  | 'requests-size-mismatch'
  | 'requests-hash-mismatch'
  | 'invalid-requests-json'
  | 'invalid-requests-shape'
  | 'corpus-derivation-mismatch'
  | 'manifest-metadata-mismatch';

export interface SyntheticRequestCorpusVerificationError {
  readonly code: SyntheticRequestCorpusVerificationErrorCode;
  readonly artifact: string;
  readonly message: string;
}

export interface SyntheticRequestCorpusVerificationSummary {
  readonly schemaVersion: 'routelab.synthetic-request-corpus-verification-summary.v1';
  readonly corpusId: string;
  readonly datasetId: string;
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly artifactSha256: string;
  readonly requestCount: number;
  readonly amountBucketCount: number;
  readonly directRequestCount: number;
  readonly multiHopOnlyRequestCount: number;
  readonly randomness: 'none';
}

export type SyntheticRequestCorpusVerificationResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly context: PreparedRoutingContext;
        readonly corpus: VerifiedSyntheticRequestCorpus;
        readonly summary: SyntheticRequestCorpusVerificationSummary;
      };
    }
  | { readonly ok: false; readonly error: SyntheticRequestCorpusVerificationError };

export interface SourceDatasetBinding {
  readonly datasetId: string;
  readonly policySha256: string;
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
}

export interface AmountBucketDefinition {
  readonly id: string;
  readonly numerator: string;
  readonly denominator: string;
}

export interface DerivationContract {
  readonly selectionMode: string;
  readonly randomness: string;
  readonly assetOrder: string;
  readonly pairOrder: string;
  readonly amountOrder: readonly string[];
  readonly reserveStatistic: string;
  readonly amountFormula: string;
  readonly amountBuckets: readonly AmountBucketDefinition[];
  readonly topologyClassification: string;
}

export interface CorpusArtifact {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface CorpusCounts {
  readonly assetCount: number;
  readonly poolCount: number;
  readonly orderedPairCount: number;
  readonly requestCount: number;
  readonly amountBucketCounts: Readonly<Record<string, number>>;
  readonly topologyCounts: Readonly<Record<string, number>>;
}

export interface CorpusManifest {
  readonly schemaVersion: string;
  readonly corpusId: string;
  readonly sourceDataset: SourceDatasetBinding;
  readonly derivation: DerivationContract;
  readonly artifact: CorpusArtifact;
  readonly counts: CorpusCounts;
  readonly limitations: readonly string[];
}

export interface SerializedSyntheticRequest {
  readonly requestId: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountBucket: SyntheticRequestAmountBucket;
  readonly amountIn: string;
  readonly topology: SyntheticRequestTopology;
}

export interface SerializedCorpus {
  readonly schemaVersion: string;
  readonly corpusId: string;
  readonly sourceDataset: SourceDatasetBinding;
  readonly derivation: DerivationContract;
  readonly requests: readonly SerializedSyntheticRequest[];
}
