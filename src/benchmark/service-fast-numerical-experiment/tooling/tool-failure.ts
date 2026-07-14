import { SourceClosurePublicationError } from '../source-closure/publication-error.ts';

export type ServiceFastToolFailureCause =
  | 'invalid-invocation'
  | 'repository-state-mismatch'
  | 'runtime-import-closure-mismatch'
  | 'filesystem-not-admitted'
  | 'environment-admission-failure'
  | 'publication-lock-conflict'
  | 'initial-destination-conflict'
  | 'artifact-write-failure'
  | 'artifact-sync-failure'
  | 'final-destination-conflict'
  | 'publication-rename-failure'
  | 'postcommit-parent-sync-failure'
  | 'provisional-destination-cleanup-failure'
  | 'owned-staging-cleanup-failure'
  | 'owned-lock-cleanup-failure'
  | 'unexpected-tool-exception';

export type ServiceFastToolFailurePhase =
  | 'invocation'
  | 'preflight'
  | 'candidate'
  | 'serialization'
  | 'publication-precommit'
  | 'publication-postcommit'
  | 'cleanup'
  | 'verification';

export type ServiceFastToolFailureFamily =
  | 'invocation'
  | 'child-dispatch'
  | 'repository'
  | 'runtime-import'
  | 'publication';

export type ServiceFastSecondaryCleanupCause =
  | 'provisional-destination-cleanup-failure'
  | 'owned-staging-cleanup-failure'
  | 'owned-lock-cleanup-failure';

export interface ProjectedServiceFastToolFailure {
  readonly ok: false;
  readonly cause: ServiceFastToolFailureCause;
  readonly phase: ServiceFastToolFailurePhase;
  readonly detailCode: ServiceFastToolFailureCause;
  readonly committed: boolean;
  readonly secondaryCleanup: {
    readonly cause: ServiceFastSecondaryCleanupCause;
    readonly detailCode: ServiceFastSecondaryCleanupCause;
  } | null;
}

export class ServiceFastVerifierInvocationError extends Error {
  readonly code = 'invalid-invocation';
  readonly toolFailureFamily = 'invocation';
}

export class ServiceFastVerifierDispatchError extends Error {
  readonly code = 'child-launch-failure';
  readonly toolFailureFamily = 'child-dispatch';
}

function property(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && Object.hasOwn(descriptor, 'value')
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function stableDetailCode(error: unknown): string {
  const code = property(error, 'code');
  return typeof code === 'string' && /^[a-z][a-z0-9-]{0,79}$/u.test(code)
    ? code
    : 'unexpected-tool-exception';
}

function projection(
  cause: ServiceFastToolFailureCause,
  phase: ServiceFastToolFailurePhase,
): readonly [ServiceFastToolFailureCause, ServiceFastToolFailurePhase] {
  return Object.freeze([cause, phase]);
}

export const SERVICE_FAST_PUBLICATION_FAILURE_PROJECTION = Object.freeze({
  'destination-inspection-failure': projection('filesystem-not-admitted', 'publication-precommit'),
  'initial-destination-conflict': projection('initial-destination-conflict', 'publication-precommit'),
  'final-destination-conflict': projection('final-destination-conflict', 'publication-precommit'),
  'source-closure-cap-exceeded': projection('artifact-write-failure', 'serialization'),
  'invalid-temp-suffix': projection('unexpected-tool-exception', 'publication-precommit'),
  'temp-path-conflict': projection('artifact-write-failure', 'publication-precommit'),
  'temp-open-failure': projection('artifact-write-failure', 'publication-precommit'),
  'temp-identity-mismatch': projection('filesystem-not-admitted', 'publication-precommit'),
  'temp-write-failure': projection('artifact-write-failure', 'publication-precommit'),
  'temp-sync-failure': projection('artifact-sync-failure', 'publication-precommit'),
  'temp-readback-failure': projection('artifact-write-failure', 'publication-precommit'),
  'temp-readback-mismatch': projection('artifact-write-failure', 'publication-precommit'),
  'source-closure-link-failure': projection('publication-rename-failure', 'publication-precommit'),
  'postlink-identity-mismatch': projection('artifact-write-failure', 'publication-precommit'),
  'postcommit-file-close-failure': projection('artifact-sync-failure', 'publication-postcommit'),
  'postcommit-parent-sync-failure': projection('postcommit-parent-sync-failure', 'publication-postcommit'),
  'postcommit-parent-close-failure': projection('postcommit-parent-sync-failure', 'publication-postcommit'),
  'postcommit-owned-temp-cleanup-failure': projection('owned-staging-cleanup-failure', 'cleanup'),
  'postcommit-temp-unlink-sync-failure': projection('postcommit-parent-sync-failure', 'publication-postcommit'),
  'postcommit-cleanup-parent-close-failure': projection('postcommit-parent-sync-failure', 'publication-postcommit'),
  'provisional-destination-cleanup-failure': projection('provisional-destination-cleanup-failure', 'cleanup'),
  'precommit-owned-temp-cleanup-failure': projection('owned-staging-cleanup-failure', 'cleanup'),
  'source-closure-publication-failure': projection('unexpected-tool-exception', 'publication-precommit'),
});

const POSTCOMMIT_PUBLICATION_CODES = new Set<string>([
  'postcommit-file-close-failure',
  'postcommit-parent-sync-failure',
  'postcommit-parent-close-failure',
  'postcommit-owned-temp-cleanup-failure',
  'postcommit-temp-unlink-sync-failure',
  'postcommit-cleanup-parent-close-failure',
  'provisional-destination-cleanup-failure',
]);

function publicationDisposition(
  error: unknown,
  detailCode: keyof typeof SERVICE_FAST_PUBLICATION_FAILURE_PROJECTION,
): Readonly<{
  committed: boolean;
  secondaryCleanup: ProjectedServiceFastToolFailure['secondaryCleanup'];
}> {
  const internalSecondary = property(error, 'secondaryCleanupCode');
  if (
    detailCode === 'postlink-identity-mismatch' &&
    internalSecondary === 'provisional-destination-cleanup-failure'
  ) {
    return Object.freeze({
      committed: true,
      secondaryCleanup: Object.freeze({
        cause: 'provisional-destination-cleanup-failure',
        detailCode: 'provisional-destination-cleanup-failure',
      }),
    });
  }
  const committed = POSTCOMMIT_PUBLICATION_CODES.has(detailCode);
  if (
    (!committed && internalSecondary === 'precommit-owned-temp-cleanup-failure') ||
    (committed && internalSecondary === 'postcommit-owned-temp-cleanup-failure')
  ) {
    return Object.freeze({
      committed,
      secondaryCleanup: Object.freeze({
        cause: 'owned-staging-cleanup-failure',
        detailCode: 'owned-staging-cleanup-failure',
      }),
    });
  }
  return Object.freeze({ committed, secondaryCleanup: null });
}

export function projectServiceFastToolFailure(
  error: unknown,
  fallbackPhase: ServiceFastToolFailurePhase,
): ProjectedServiceFastToolFailure {
  const family = property(error, 'toolFailureFamily');
  const detailCode = stableDetailCode(error);
  let committed = false;
  let projectedSecondaryCleanup: ProjectedServiceFastToolFailure['secondaryCleanup'] = null;
  let cause: ServiceFastToolFailureCause;
  let phase: ServiceFastToolFailurePhase;
  if (family === 'invocation') {
    cause = 'invalid-invocation';
    phase = 'invocation';
  } else if (family === 'repository') {
    cause = 'repository-state-mismatch';
    phase = 'preflight';
  } else if (family === 'runtime-import') {
    cause = 'runtime-import-closure-mismatch';
    phase = 'preflight';
  } else if (family === 'publication' && error instanceof SourceClosurePublicationError) {
    const projected = SERVICE_FAST_PUBLICATION_FAILURE_PROJECTION[
      detailCode as keyof typeof SERVICE_FAST_PUBLICATION_FAILURE_PROJECTION
    ];
    if (projected === undefined) {
      [cause, phase] = projection('unexpected-tool-exception', 'publication-precommit');
    } else {
      [cause, phase] = projected;
      const disposition = publicationDisposition(
        error,
        detailCode as keyof typeof SERVICE_FAST_PUBLICATION_FAILURE_PROJECTION,
      );
      committed = disposition.committed;
      projectedSecondaryCleanup = disposition.secondaryCleanup;
    }
  } else if (family === 'publication') {
    cause = 'unexpected-tool-exception';
    phase = 'publication-precommit';
  } else {
    cause = 'unexpected-tool-exception';
    phase = family === 'child-dispatch' ? 'invocation' : fallbackPhase;
  }
  return Object.freeze({
    ok: false,
    cause,
    phase,
    detailCode: cause,
    committed,
    secondaryCleanup: projectedSecondaryCleanup,
  });
}

export function encodeProjectedServiceFastToolFailure(
  error: unknown,
  fallbackPhase: ServiceFastToolFailurePhase,
): string {
  return `${JSON.stringify(projectServiceFastToolFailure(error, fallbackPhase))}\n`;
}
