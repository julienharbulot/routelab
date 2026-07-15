import type {
  ServiceFastExperimentIntegrityFailureCode,
} from '../evaluator-kernel.ts';

export const SERVICE_FAST_INTEGRITY_FAILURE_CODES = Object.freeze([
  'runtime-mismatch',
  'config-hash-mismatch',
  'input-hash-mismatch',
  'source-closure-mismatch',
  'protected-source-mismatch',
  'baseline-mismatch',
  'cohort-mismatch',
  'semantic-anchor-parity-mismatch',
  'exact-replay-mismatch',
  'counter-invariant-failure',
  'clock-invariant-failure',
  'artifact-shape-failure',
  'artifact-cap-failure',
  'unexpected-exception',
] as const);

export type ServiceFastIntegrityFailureCode =
  typeof SERVICE_FAST_INTEGRITY_FAILURE_CODES[number];

const INTEGRITY_FAILURE_CODES = new WeakMap<
  object,
  ServiceFastIntegrityFailureCode
>();
const ENVIRONMENT_FAILURES = new WeakSet<object>();

export class ServiceFastArtifactIntegrityError extends Error {
  readonly code: ServiceFastIntegrityFailureCode;

  constructor(code: ServiceFastIntegrityFailureCode) {
    super(code);
    if (!SERVICE_FAST_INTEGRITY_FAILURE_CODES.includes(code)) {
      throw new TypeError('Integrity failure code is invalid.');
    }
    this.code = code;
    INTEGRITY_FAILURE_CODES.set(this, code);
    Object.freeze(this);
  }
}

export class ServiceFastVerifierEnvironmentError extends Error {
  readonly code = 'environment-admission-failure';

  constructor() {
    super('environment-admission-failure');
    ENVIRONMENT_FAILURES.add(this);
    Object.freeze(this);
  }
}

export type ServiceFastVerifierToolFailurePhase = 'verification';

export function integrityFailure(
  code: ServiceFastIntegrityFailureCode,
): never {
  throw new ServiceFastArtifactIntegrityError(code);
}

export function rejectServiceFastEvaluatorIntegrityFailure(
  code: ServiceFastExperimentIntegrityFailureCode,
): never {
  switch (code) {
    case 'semantic-anchor-parity-mismatch':
      return integrityFailure('semantic-anchor-parity-mismatch');
    case 'exact-replay-mismatch':
      return integrityFailure('exact-replay-mismatch');
    case 'counter-invariant-failure':
      return integrityFailure('counter-invariant-failure');
    case 'unexpected-exception':
      return integrityFailure('unexpected-exception');
  }
}

export function isIntegrityFailure(
  error: unknown,
): error is ServiceFastArtifactIntegrityError {
  return integrityFailureCode(error) !== undefined;
}

export function integrityFailureCode(
  error: unknown,
): ServiceFastIntegrityFailureCode | undefined {
  return typeof error === 'object' && error !== null
    ? INTEGRITY_FAILURE_CODES.get(error)
    : undefined;
}

export function isVerifierEnvironmentFailure(
  error: unknown,
): error is ServiceFastVerifierEnvironmentError {
  return typeof error === 'object' && error !== null &&
    ENVIRONMENT_FAILURES.has(error);
}

export function encodeServiceFastVerifierToolFailure(
  error: unknown,
  phase: ServiceFastVerifierToolFailurePhase = 'verification',
): string {
  const cause = isVerifierEnvironmentFailure(error)
    ? 'environment-admission-failure'
    : 'unexpected-tool-exception';
  return `${JSON.stringify({
    ok: false,
    cause,
    phase,
    detailCode: cause,
    committed: false,
    secondaryCleanup: null,
  })}\n`;
}
