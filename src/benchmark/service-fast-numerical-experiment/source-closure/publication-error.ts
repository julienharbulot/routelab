export const SERVICE_FAST_SOURCE_CLOSURE_PUBLICATION_ERROR_CODES = Object.freeze([
  'destination-inspection-failure',
  'initial-destination-conflict',
  'final-destination-conflict',
  'source-closure-cap-exceeded',
  'invalid-temp-suffix',
  'temp-path-conflict',
  'temp-open-failure',
  'temp-identity-mismatch',
  'temp-write-failure',
  'temp-sync-failure',
  'temp-readback-failure',
  'temp-readback-mismatch',
  'source-closure-link-failure',
  'postlink-identity-mismatch',
  'postcommit-file-close-failure',
  'postcommit-parent-sync-failure',
  'postcommit-parent-close-failure',
  'postcommit-owned-temp-cleanup-failure',
  'postcommit-temp-unlink-sync-failure',
  'postcommit-cleanup-parent-close-failure',
  'provisional-destination-cleanup-failure',
  'precommit-owned-temp-cleanup-failure',
  'source-closure-publication-failure',
]);

export class SourceClosurePublicationError extends Error {
  readonly code: string;
  readonly artifact: string;
  readonly committed: boolean;
  readonly toolFailureFamily = 'publication';
  readonly secondaryCleanupCode: string | null;

  constructor(
    code: string,
    artifact: string,
    message: string,
    committed = false,
    secondaryCleanupCode: string | null = null,
  ) {
    super(message);
    this.code = code;
    this.artifact = artifact;
    this.committed = committed;
    this.secondaryCleanupCode = secondaryCleanupCode;
  }
}
