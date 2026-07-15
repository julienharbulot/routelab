export type AcceptedRunFailureCause =
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
  | 'owned-staging-cleanup-failure'
  | 'owned-lock-cleanup-failure'
  | 'provisional-destination-cleanup-failure'
  | 'unexpected-tool-exception';

export type AcceptedRunFailurePhase =
  | 'invocation'
  | 'preflight'
  | 'candidate'
  | 'serialization'
  | 'publication-precommit'
  | 'publication-postcommit'
  | 'cleanup'
  | 'verification';

export type AcceptedCleanupCause =
  | 'owned-staging-cleanup-failure'
  | 'owned-lock-cleanup-failure'
  | 'provisional-destination-cleanup-failure';

export const ACCEPTED_RUN_INTERNAL_FAILURE_REGISTRY = Object.freeze({
  'invocation-argument-count': Object.freeze({ cause: 'invalid-invocation', phase: 'invocation' }),
  'preflight-repository-binding': Object.freeze({ cause: 'repository-state-mismatch', phase: 'preflight' }),
  'preflight-runtime-import-binding': Object.freeze({ cause: 'runtime-import-closure-mismatch', phase: 'preflight' }),
  'preflight-filesystem-admission': Object.freeze({ cause: 'filesystem-not-admitted', phase: 'preflight' }),
  'preflight-environment-admission': Object.freeze({ cause: 'environment-admission-failure', phase: 'preflight' }),
  'preflight-lock-exists': Object.freeze({ cause: 'publication-lock-conflict', phase: 'preflight' }),
  'preflight-destination-exists': Object.freeze({ cause: 'initial-destination-conflict', phase: 'preflight' }),
  'precommit-filesystem-admission': Object.freeze({ cause: 'filesystem-not-admitted', phase: 'publication-precommit' }),
  'precommit-artifact-write': Object.freeze({ cause: 'artifact-write-failure', phase: 'publication-precommit' }),
  'precommit-artifact-sync': Object.freeze({ cause: 'artifact-sync-failure', phase: 'publication-precommit' }),
  'precommit-destination-exists': Object.freeze({ cause: 'final-destination-conflict', phase: 'publication-precommit' }),
  'precommit-rename': Object.freeze({ cause: 'publication-rename-failure', phase: 'publication-precommit' }),
  'postcommit-parent-sync': Object.freeze({ cause: 'postcommit-parent-sync-failure', phase: 'publication-postcommit' }),
  'cleanup-owned-staging': Object.freeze({ cause: 'owned-staging-cleanup-failure', phase: 'cleanup' }),
  'cleanup-owned-lock': Object.freeze({ cause: 'owned-lock-cleanup-failure', phase: 'cleanup' }),
  'cleanup-provisional-destination': Object.freeze({ cause: 'provisional-destination-cleanup-failure', phase: 'cleanup' }),
  'invocation-unexpected': Object.freeze({ cause: 'unexpected-tool-exception', phase: 'invocation' }),
  'candidate-unexpected': Object.freeze({ cause: 'unexpected-tool-exception', phase: 'candidate' }),
  'serialization-unexpected': Object.freeze({ cause: 'unexpected-tool-exception', phase: 'serialization' }),
  'precommit-unexpected': Object.freeze({ cause: 'unexpected-tool-exception', phase: 'publication-precommit' }),
  'verification-unexpected': Object.freeze({ cause: 'unexpected-tool-exception', phase: 'verification' }),
} as const satisfies Readonly<Record<string, Readonly<{
  readonly cause: AcceptedRunFailureCause;
  readonly phase: AcceptedRunFailurePhase;
}>>>);

export type AcceptedRunInternalFailureCode =
  keyof typeof ACCEPTED_RUN_INTERNAL_FAILURE_REGISTRY;

export interface AcceptedRunFailureEnvelope {
  readonly ok: false;
  readonly cause: AcceptedRunFailureCause;
  readonly phase: AcceptedRunFailurePhase;
  readonly detailCode: AcceptedRunFailureCause;
  readonly committed: boolean;
  readonly secondaryCleanup: null | Readonly<{
    readonly cause: AcceptedCleanupCause;
    readonly detailCode: AcceptedCleanupCause;
  }>;
}

const ACCEPTED_RUN_FAILURE_TOKEN = Object.freeze({});
const acceptedRunFailures = new WeakSet<object>();

export class AcceptedRunFailure extends Error {
  readonly toolFailureFamily = 'accepted-run';
  readonly envelope: AcceptedRunFailureEnvelope;

  constructor(
    token: typeof ACCEPTED_RUN_FAILURE_TOKEN,
    cause: AcceptedRunFailureCause,
    phase: AcceptedRunFailurePhase,
    committed = false,
    secondaryCleanup: AcceptedCleanupCause | null = null,
  ) {
    super('The accepted experiment run failed.');
    if (token !== ACCEPTED_RUN_FAILURE_TOKEN) {
      throw new TypeError('Accepted run failures require internal construction.');
    }
    this.envelope = Object.freeze({
      ok: false,
      cause,
      phase,
      detailCode: cause,
      committed,
      secondaryCleanup: secondaryCleanup === null
        ? null
        : Object.freeze({ cause: secondaryCleanup, detailCode: secondaryCleanup }),
    });
    acceptedRunFailures.add(this);
  }
}

export function acceptedRunFailure(
  internalCode: AcceptedRunInternalFailureCode,
  committed = false,
  secondaryCleanup: AcceptedCleanupCause | null = null,
): AcceptedRunFailure {
  const projection = ACCEPTED_RUN_INTERNAL_FAILURE_REGISTRY[internalCode];
  return new AcceptedRunFailure(
    ACCEPTED_RUN_FAILURE_TOKEN,
    projection.cause,
    projection.phase,
    committed,
    secondaryCleanup,
  );
}

function ownData(value: unknown, key: string): unknown {
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

const ACCEPTED_CAUSES = new Set<AcceptedRunFailureCause>([
  'invalid-invocation',
  'repository-state-mismatch',
  'runtime-import-closure-mismatch',
  'filesystem-not-admitted',
  'environment-admission-failure',
  'publication-lock-conflict',
  'initial-destination-conflict',
  'artifact-write-failure',
  'artifact-sync-failure',
  'final-destination-conflict',
  'publication-rename-failure',
  'postcommit-parent-sync-failure',
  'owned-staging-cleanup-failure',
  'owned-lock-cleanup-failure',
  'provisional-destination-cleanup-failure',
  'unexpected-tool-exception',
]);
const ACCEPTED_PHASES = new Set<AcceptedRunFailurePhase>([
  'invocation',
  'preflight',
  'candidate',
  'serialization',
  'publication-precommit',
  'publication-postcommit',
  'cleanup',
  'verification',
]);
const ACCEPTED_CLEANUP_CAUSES = new Set<AcceptedCleanupCause>([
  'owned-staging-cleanup-failure',
  'owned-lock-cleanup-failure',
  'provisional-destination-cleanup-failure',
]);

function admittedEnvelope(error: unknown): AcceptedRunFailureEnvelope | null {
  if (typeof error !== 'object' || error === null || !acceptedRunFailures.has(error)) {
    return null;
  }
  const raw = ownData(error, 'envelope');
  const cause = ownData(raw, 'cause');
  const phase = ownData(raw, 'phase');
  const detailCode = ownData(raw, 'detailCode');
  const committed = ownData(raw, 'committed');
  const secondary = ownData(raw, 'secondaryCleanup');
  if (
    typeof cause !== 'string' || !ACCEPTED_CAUSES.has(cause as AcceptedRunFailureCause) ||
    typeof phase !== 'string' || !ACCEPTED_PHASES.has(phase as AcceptedRunFailurePhase) ||
    detailCode !== cause || typeof committed !== 'boolean'
  ) return null;
  let projectedSecondary: AcceptedRunFailureEnvelope['secondaryCleanup'] = null;
  if (secondary !== null) {
    const secondaryCause = ownData(secondary, 'cause');
    const secondaryDetailCode = ownData(secondary, 'detailCode');
    if (
      typeof secondaryCause !== 'string' ||
      !ACCEPTED_CLEANUP_CAUSES.has(secondaryCause as AcceptedCleanupCause) ||
      secondaryDetailCode !== secondaryCause
    ) return null;
    projectedSecondary = Object.freeze({
      cause: secondaryCause as AcceptedCleanupCause,
      detailCode: secondaryCause as AcceptedCleanupCause,
    });
  }
  return Object.freeze({
    ok: false,
    cause: cause as AcceptedRunFailureCause,
    phase: phase as AcceptedRunFailurePhase,
    detailCode: cause as AcceptedRunFailureCause,
    committed,
    secondaryCleanup: projectedSecondary,
  });
}

export function projectAcceptedRunFailure(
  error: unknown,
  fallbackInternalCode: AcceptedRunInternalFailureCode,
): AcceptedRunFailure {
  const envelope = admittedEnvelope(error);
  if (envelope !== null) {
    return new AcceptedRunFailure(
        ACCEPTED_RUN_FAILURE_TOKEN,
        envelope.cause,
        envelope.phase,
        envelope.committed,
        envelope.secondaryCleanup?.cause ?? null,
      );
  }
  const family = ownData(error, 'toolFailureFamily');
  if (family === 'runtime-import') {
    return acceptedRunFailure('preflight-runtime-import-binding');
  }
  if (family === 'repository') {
    return acceptedRunFailure('preflight-repository-binding');
  }
  if (family === 'environment') {
    return acceptedRunFailure('preflight-environment-admission');
  }
  if (family === 'invocation') {
    return acceptedRunFailure('invocation-argument-count');
  }
  return acceptedRunFailure(fallbackInternalCode);
}

export function appendAcceptedCleanupFailure(
  primary: AcceptedRunFailure,
  secondaryCleanup: AcceptedCleanupCause,
): AcceptedRunFailure {
  const envelope = admittedEnvelope(primary);
  if (envelope === null) return acceptedRunFailure('precommit-unexpected');
  return new AcceptedRunFailure(
    ACCEPTED_RUN_FAILURE_TOKEN,
    envelope.cause,
    envelope.phase,
    envelope.committed,
    secondaryCleanup,
  );
}

export function acceptedRunFailureEnvelope(
  error: unknown,
  fallbackPhase: AcceptedRunFailurePhase,
): AcceptedRunFailureEnvelope {
  const projected = admittedEnvelope(error);
  if (projected !== null) return projected;
  const family = ownData(error, 'toolFailureFamily');
  const cause: AcceptedRunFailureCause = family === 'repository'
    ? 'repository-state-mismatch'
    : family === 'runtime-import'
      ? 'runtime-import-closure-mismatch'
      : family === 'environment'
        ? 'environment-admission-failure'
        : family === 'invocation'
          ? 'invalid-invocation'
          : 'unexpected-tool-exception';
  const phase = cause === 'invalid-invocation'
    ? 'invocation'
    : cause === 'repository-state-mismatch' ||
        cause === 'runtime-import-closure-mismatch' ||
        cause === 'environment-admission-failure'
      ? 'preflight'
      : fallbackPhase;
  return Object.freeze({
    ok: false,
    cause,
    phase,
    detailCode: cause,
    committed: false,
    secondaryCleanup: null,
  });
}

export function encodeAcceptedRunFailure(
  error: unknown,
  fallbackPhase: AcceptedRunFailurePhase,
): string {
  return `${JSON.stringify(acceptedRunFailureEnvelope(error, fallbackPhase))}\n`;
}
