import type { PreparedRoutingContext } from '../../runtime/prepared-routing-context/index.ts';

export interface SelectedToken {
  readonly symbol: string;
  readonly address: string;
  readonly decimals: number;
}

export interface HistoricalDatasetVerifierDependencies {
  readonly readFile: (path: string) => Promise<Uint8Array>;
}

export type HistoricalDatasetVerificationErrorCode =
  | 'manifest-read-failed'
  | 'invalid-manifest-json'
  | 'invalid-manifest-shape'
  | 'artifact-read-failed'
  | 'artifact-size-mismatch'
  | 'artifact-hash-mismatch'
  | 'invalid-policy'
  | 'invalid-source-dataset'
  | 'invalid-reconciliation'
  | 'source-reconciliation-mismatch'
  | 'invalid-snapshot'
  | 'snapshot-order-mismatch'
  | 'canonical-content-mismatch'
  | 'snapshot-preparation-failed'
  | 'manifest-metadata-mismatch';

export interface HistoricalDatasetVerificationError {
  readonly code: HistoricalDatasetVerificationErrorCode;
  readonly artifact: string;
  readonly message: string;
}

export interface HistoricalDatasetVerificationSummary {
  readonly schemaVersion: 'routelab.dataset-verification-summary.v1';
  readonly datasetId: string;
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly artifactCount: 6;
  readonly poolCount: number;
  readonly assetCount: number;
  readonly sourcePairCount: number;
  readonly exactReconciliation: true;
}

export type HistoricalDatasetVerificationResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly context: PreparedRoutingContext;
        readonly summary: HistoricalDatasetVerificationSummary;
      };
    }
  | { readonly ok: false; readonly error: HistoricalDatasetVerificationError };

export interface ManifestArtifact {
  readonly role: string;
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface DatasetManifest {
  readonly schemaVersion: string;
  readonly datasetId: string;
  readonly policySha256: string;
  readonly publication: Record<string, unknown>;
  readonly chain: Record<string, unknown>;
  readonly venue: Record<string, unknown>;
  readonly selectionPolicy: string;
  readonly tokenBehaviorPolicy: string;
  readonly selectedTokens: readonly SelectedToken[];
  readonly acquisition: Record<string, unknown>;
  readonly snapshot: Record<string, unknown>;
  readonly artifacts: readonly ManifestArtifact[];
  readonly limitations: readonly string[];
}

export interface DatasetPolicy {
  readonly schemaVersion: string;
  readonly datasetId: string;
  readonly chainId: string;
  readonly block: Record<string, unknown>;
  readonly venue: Record<string, unknown>;
  readonly selectionPolicy: string;
  readonly tokenBehaviorPolicy: string;
  readonly tokens: readonly SelectedToken[];
}

export interface SourcePair {
  readonly pair: string;
  readonly token0: string;
  readonly token1: string;
  readonly reserve0: string;
  readonly reserve1: string;
}

export interface NormalizedSource {
  readonly schemaVersion: string;
  readonly datasetId: string;
  readonly source: string;
  readonly policySha256: string;
  readonly selectedTokenSymbols: readonly string[];
  readonly block: Record<string, unknown>;
  readonly factoryAddress: string;
  readonly pairs: readonly SourcePair[];
}

export interface Reconciliation {
  readonly schemaVersion: string;
  readonly datasetId: string;
  readonly exactMatch: boolean;
  readonly comparedSources: readonly string[];
  readonly checkedFields: readonly string[];
  readonly comparedPairCount: number;
  readonly includedPositiveReservePairCount: number;
  readonly differences: readonly string[];
}
