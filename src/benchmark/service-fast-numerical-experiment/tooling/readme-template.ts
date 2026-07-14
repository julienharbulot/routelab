const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const CANONICAL_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/)[^\\\0]+$/u;
const MAX_TIMEZONE_BYTES = 128;
const MAX_README_BYTES = 1_048_576;
const MAXIMAL_REVISION = 'f'.repeat(40);
const MAXIMAL_HASH = `sha256:${'f'.repeat(64)}`;
const MAXIMAL_TIMEZONE = 'T'.repeat(MAX_TIMEZONE_BYTES);

const FROZEN_POLICY_IDS = Object.freeze([
  'bisection-o64-i64--strict-reject--current',
  'bisection-o64-i64--strict-reject--bounded-exact-neighborhood-v1',
  'bisection-o64-i64--final-finite-replay--current',
  'bisection-o64-i64--final-finite-replay--bounded-exact-neighborhood-v1',
  'bisection-o64-i24--strict-reject--current',
  'bisection-o64-i24--strict-reject--bounded-exact-neighborhood-v1',
  'bisection-o64-i24--final-finite-replay--current',
  'bisection-o64-i24--final-finite-replay--bounded-exact-neighborhood-v1',
  'bisection-o32-i16--strict-reject--current',
  'bisection-o32-i16--strict-reject--bounded-exact-neighborhood-v1',
  'bisection-o32-i16--final-finite-replay--current',
  'bisection-o32-i16--final-finite-replay--bounded-exact-neighborhood-v1',
  'bisection-o16-i12--strict-reject--current',
  'bisection-o16-i12--strict-reject--bounded-exact-neighborhood-v1',
  'bisection-o16-i12--final-finite-replay--current',
  'bisection-o16-i12--final-finite-replay--bounded-exact-neighborhood-v1',
  'pinned-sqrt-o64--strict-reject--current',
  'pinned-sqrt-o64--strict-reject--bounded-exact-neighborhood-v1',
  'pinned-sqrt-o64--final-finite-replay--current',
  'pinned-sqrt-o64--final-finite-replay--bounded-exact-neighborhood-v1',
  'fixed-newton-sqrt-o64-n8--strict-reject--current',
  'fixed-newton-sqrt-o64-n8--strict-reject--bounded-exact-neighborhood-v1',
  'fixed-newton-sqrt-o64-n8--final-finite-replay--current',
  'fixed-newton-sqrt-o64-n8--final-finite-replay--bounded-exact-neighborhood-v1',
]);

export const SERVICE_FAST_EXPERIMENT_ID =
  'm7c-core12-service-fast-numerical-v1';
export const SERVICE_FAST_STRICT_REFERENCE_FALLBACK_ID =
  'strict-reference-fallback';

export interface ServiceFastReadmeDescriptor {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface ServiceFastReadmeEnvironment {
  readonly timezone: string;
}

export type ServiceFastReadmeDecision =
  | Readonly<{
    readonly status: 'selected-policy';
    readonly policyId: string;
    readonly fallbackDecisionId: null;
  }>
  | Readonly<{
    readonly status: 'strict-reference-fallback';
    readonly policyId: null;
    readonly fallbackDecisionId: 'strict-reference-fallback';
  }>
  | Readonly<{
    readonly status: 'rejected-observation';
    readonly policyId: null;
    readonly fallbackDecisionId: null;
  }>;

export interface ServiceFastReadmeEvidence {
  readonly experimentId: string;
  readonly implementationRevision: string;
  readonly inputArtifact: ServiceFastReadmeDescriptor;
  readonly sourceClosure: ServiceFastReadmeDescriptor;
  readonly decision: ServiceFastReadmeDecision;
  readonly environment: ServiceFastReadmeEnvironment;
}

export interface ServiceFastReadmeDecisionWitness {
  readonly decisionStatus:
    | 'selected-policy'
    | 'strict-reference-fallback'
    | 'rejected-observation';
  readonly decisionIdentity: string;
  readonly readme: string;
  readonly bytes: number;
}

export interface MaximalServiceFastReadmeRendering {
  readonly readme: string;
  readonly bytes: number;
  readonly witnesses: readonly ServiceFastReadmeDecisionWitness[];
}

export class ServiceFastReadmeRenderingError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function renderingFailure(code: string, message: string): never {
  throw new ServiceFastReadmeRenderingError(code, message);
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function validateDescriptor(
  descriptor: ServiceFastReadmeDescriptor,
  artifact: string,
): void {
  if (
    typeof descriptor.path !== 'string' ||
    !CANONICAL_PATH.test(descriptor.path) ||
    !Number.isSafeInteger(descriptor.bytes) ||
    descriptor.bytes <= 0 ||
    typeof descriptor.sha256 !== 'string' ||
    !SHA256.test(descriptor.sha256)
  ) {
    renderingFailure('invalid-readme-descriptor', `${artifact} is not a frozen descriptor.`);
  }
}

function decisionFields(
  decision: ServiceFastReadmeDecision,
): Readonly<{
  readonly decisionStatus: ServiceFastReadmeDecision['status'];
  readonly decisionIdentity: string;
}> {
  if (
    decision.status === 'selected-policy' &&
    typeof decision.policyId === 'string' &&
    FROZEN_POLICY_IDS.slice(1).includes(decision.policyId) &&
    decision.fallbackDecisionId === null
  ) {
    return Object.freeze({
      decisionStatus: decision.status,
      decisionIdentity: decision.policyId,
    });
  }
  if (
    decision.status === 'strict-reference-fallback' &&
    decision.policyId === null &&
    decision.fallbackDecisionId === SERVICE_FAST_STRICT_REFERENCE_FALLBACK_ID
  ) {
    return Object.freeze({
      decisionStatus: decision.status,
      decisionIdentity: SERVICE_FAST_STRICT_REFERENCE_FALLBACK_ID,
    });
  }
  if (
    decision.status === 'rejected-observation' &&
    decision.policyId === null &&
    decision.fallbackDecisionId === null
  ) {
    return Object.freeze({
      decisionStatus: decision.status,
      decisionIdentity: 'none',
    });
  }
  return renderingFailure('invalid-readme-decision', 'README decision fields do not form one frozen decision mapping.');
}

function renderValidatedReadme(
  evidence: ServiceFastReadmeEvidence,
  fields: ReturnType<typeof decisionFields>,
): string {
  return [
    '# Service-fast numerical experiment',
    '',
    `Experiment: \`${evidence.experimentId}\``,
    `Implementation/input revision: \`${evidence.implementationRevision}\``,
    `Input artifact: \`${evidence.inputArtifact.sha256}\``,
    `Source closure: \`${evidence.sourceClosure.sha256}\``,
    `Decision: \`${fields.decisionStatus}\` / \`${fields.decisionIdentity}\``,
    `Recorded timezone: \`${evidence.environment.timezone}\``,
    '',
    'This retained evidence covers only the frozen numerical candidate stage. It does not make the selected policy supported, establish full-service latency, load or concurrency behavior, representative demand, production financial execution, or unrestricted optimality.',
    '',
  ].join('\n');
}

export function renderServiceFastExperimentReadme(
  evidence: ServiceFastReadmeEvidence,
): string {
  if (evidence.experimentId !== SERVICE_FAST_EXPERIMENT_ID) {
    return renderingFailure('invalid-readme-experiment', 'README experiment identity is not frozen.');
  }
  if (!REVISION.test(evidence.implementationRevision)) {
    return renderingFailure('invalid-readme-revision', 'README implementation revision is not canonical.');
  }
  validateDescriptor(evidence.inputArtifact, 'input artifact');
  validateDescriptor(evidence.sourceClosure, 'source closure');
  const timezone = evidence.environment.timezone;
  if (
    typeof timezone !== 'string' ||
    timezone.length === 0 ||
    utf8Bytes(timezone) > MAX_TIMEZONE_BYTES
  ) {
    return renderingFailure('invalid-readme-environment', 'README timezone is not the admitted record-only value.');
  }
  const readme = renderValidatedReadme(evidence, decisionFields(evidence.decision));
  const maximal = renderMaximalServiceFastExperimentReadme();
  const actualBytes = utf8Bytes(readme);
  if (actualBytes > maximal.bytes || maximal.bytes > MAX_README_BYTES) {
    return renderingFailure(
      'readme-size-proof-failure',
      'README actual or maximal rendering violates the frozen 1 MiB bound.',
    );
  }
  return readme;
}

function longestNonanchorPolicyId(): string {
  const nonanchor = FROZEN_POLICY_IDS.slice(1);
  const first = nonanchor[0];
  if (first === undefined) {
    return renderingFailure('invalid-readme-policy-ids', 'README policy matrix has no nonanchor policy.');
  }
  return nonanchor.reduce((longest, policyId) =>
    utf8Bytes(policyId) > utf8Bytes(longest) ? policyId : longest, first);
}

export function renderMaximalServiceFastExperimentReadme(
): MaximalServiceFastReadmeRendering {
  const selectedPolicyId = longestNonanchorPolicyId();
  const base = Object.freeze({
    experimentId: SERVICE_FAST_EXPERIMENT_ID,
    implementationRevision: MAXIMAL_REVISION,
    inputArtifact: Object.freeze({ path: 'inputs.ndjson', bytes: 1, sha256: MAXIMAL_HASH }),
    sourceClosure: Object.freeze({ path: 'source-closure.v1.json', bytes: 1, sha256: MAXIMAL_HASH }),
    environment: Object.freeze({ timezone: MAXIMAL_TIMEZONE }),
  });
  const decisions: readonly ServiceFastReadmeDecision[] = Object.freeze([
    Object.freeze({
      status: 'selected-policy' as const,
      policyId: selectedPolicyId,
      fallbackDecisionId: null,
    }),
    Object.freeze({
      status: 'strict-reference-fallback' as const,
      policyId: null,
      fallbackDecisionId: SERVICE_FAST_STRICT_REFERENCE_FALLBACK_ID,
    }),
    Object.freeze({
      status: 'rejected-observation' as const,
      policyId: null,
      fallbackDecisionId: null,
    }),
  ]);
  const witnesses = Object.freeze(decisions.map((decision) => {
    const evidence = Object.freeze({ ...base, decision });
    const fields = decisionFields(decision);
    const readme = renderValidatedReadme(evidence, fields);
    return Object.freeze({
      ...fields,
      readme,
      bytes: utf8Bytes(readme),
    });
  }));
  const maximal = witnesses.reduce((current, witness) =>
    witness.bytes > current.bytes ? witness : current);
  if (maximal.bytes > MAX_README_BYTES) {
    return renderingFailure(
      'readme-size-proof-failure',
      'Maximal README rendering exceeds the frozen 1 MiB bound.',
    );
  }
  return Object.freeze({
    readme: maximal.readme,
    bytes: maximal.bytes,
    witnesses,
  });
}
