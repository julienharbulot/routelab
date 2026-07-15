import type { ArtifactDescriptor, EnvironmentValue, JsonObject } from './types.ts';
import { requireString } from './types.ts';

export interface ReadmeValues {
  readonly implementationRevision: string;
  readonly inputArtifact: ArtifactDescriptor;
  readonly sourceClosure: ArtifactDescriptor;
  readonly environment: EnvironmentValue;
  readonly decision: JsonObject;
}

export function decisionOutputIdentity(decision: JsonObject): Readonly<{
  readonly decisionStatus:
    | 'selected-policy'
    | 'strict-reference-fallback'
    | 'rejected-observation';
  readonly decisionIdentity: string;
}> {
  const status = requireString(decision['status']);
  if (status === 'selected-policy') {
    return Object.freeze({
      decisionStatus: status,
      decisionIdentity: requireString(decision['policyId']),
    });
  }
  if (status === 'strict-reference-fallback') {
    return Object.freeze({
      decisionStatus: status,
      decisionIdentity: 'strict-reference-fallback',
    });
  }
  if (status === 'rejected-observation') {
    return Object.freeze({
      decisionStatus: status,
      decisionIdentity: 'none',
    });
  }
  throw new TypeError('README decision status is invalid.');
}

export function renderServiceFastReadme(values: ReadmeValues): string {
  const decision = decisionOutputIdentity(values.decision);
  return `# Service-fast numerical experiment

Experiment: \`m7c-core12-service-fast-numerical-v1\`
Implementation/input revision: \`${values.implementationRevision}\`
Input artifact: \`${values.inputArtifact.sha256}\`
Source closure: \`${values.sourceClosure.sha256}\`
Decision: \`${decision.decisionStatus}\` / \`${decision.decisionIdentity}\`
Recorded timezone: \`${values.environment.timezone}\`

This retained evidence covers only the frozen numerical candidate stage. It does not make the selected policy supported, establish full-service latency, load or concurrency behavior, representative demand, production financial execution, or unrestricted optimality.
`;
}
