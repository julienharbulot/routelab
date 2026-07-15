import {
  SERVICE_FAST_EXECUTION_SCHEDULE,
  SERVICE_FAST_EXPERIMENT_ID,
  SERVICE_FAST_LIMITATIONS,
  SERVICE_FAST_TASK_ID,
  serviceFastRetainedFileContracts,
} from './contract.ts';
import { operationalAggregate, sha256Bytes } from './hash-projections.ts';
import { renderServiceFastReadme, decisionOutputIdentity } from './readme-recompute.ts';
import type { AdmittedSourceClosure } from './source-admission.ts';
import {
  requireJsonObject,
  requireString,
  type ArtifactDescriptor,
  type EnvironmentValue,
  type JsonObject,
  type VerificationAggregates,
} from './types.ts';

export interface ManifestRecomputeInput {
  readonly config: ArtifactDescriptor;
  readonly artifactSchema: ArtifactDescriptor;
  readonly sourceClosure: AdmittedSourceClosure;
  readonly inputArtifact: ArtifactDescriptor;
  readonly retained: ReadonlyMap<string, ArtifactDescriptor>;
  readonly analysis: JsonObject;
  readonly environment: EnvironmentValue;
  readonly manifestBytes: Uint8Array;
  readonly readmeBytes: Uint8Array;
}

function descriptorJson(value: ArtifactDescriptor): JsonObject {
  return Object.freeze({
    path: value.path,
    bytes: value.bytes,
    sha256: value.sha256,
  });
}

function manifestEntry(
  name: string,
  descriptor: ArtifactDescriptor,
): JsonObject {
  const contract = serviceFastRetainedFileContracts().find((candidate) =>
    candidate.name === name);
  if (contract === undefined || contract.contentRole === null) {
    throw new TypeError('Manifest artifact contract is absent.');
  }
  return Object.freeze({
    name,
    contentRole: contract.contentRole,
    schemaVersion: contract.schemaVersion,
    recordCount: contract.recordCount,
    bytes: descriptor.bytes,
    sha256: descriptor.sha256,
  });
}

export function recomputeManifest(
  input: ManifestRecomputeInput,
): Readonly<{
  readonly manifest: JsonObject;
  readonly aggregates: VerificationAggregates;
}> {
  const names = Object.freeze([
    'inputs.ndjson',
    'semantic-results.ndjson',
    'call-timing-observations.ndjson',
    'incumbent-timeline-observations.ndjson',
    'deadline-observations.ndjson',
    'analysis.json',
    'README.md',
  ]);
  const artifacts = names.map((name) => {
    const descriptor = input.retained.get(name);
    if (descriptor === undefined) throw new TypeError('Retained descriptor is absent.');
    return manifestEntry(name, descriptor);
  });
  const decision = requireJsonObject(input.analysis['decision']);
  const expectedReadme = renderServiceFastReadme({
    implementationRevision: input.sourceClosure.implementationInputRevision,
    inputArtifact: input.inputArtifact,
    sourceClosure: input.sourceClosure.descriptor,
    environment: input.environment,
    decision,
  });
  if (sha256Bytes(input.readmeBytes) !== sha256Bytes(expectedReadme) ||
    new TextDecoder('utf-8', { fatal: true }).decode(input.readmeBytes) !== expectedReadme) {
    throw new TypeError('Retained README differs from its frozen template.');
  }
  const manifest: JsonObject = Object.freeze({
    schemaVersion: 'routelab.service-fast-numerical-manifest.v1',
    experimentId: SERVICE_FAST_EXPERIMENT_ID,
    taskId: SERVICE_FAST_TASK_ID,
    config: descriptorJson(input.config),
    artifactSchema: descriptorJson(input.artifactSchema),
    sourceClosure: descriptorJson(input.sourceClosure.descriptor),
    inputArtifact: descriptorJson(input.inputArtifact),
    implementationRevision: input.sourceClosure.implementationInputRevision,
    environment: input.environment,
    executionSchedule: SERVICE_FAST_EXECUTION_SCHEDULE,
    artifacts: Object.freeze(artifacts),
    decision,
    limitations: SERVICE_FAST_LIMITATIONS,
  });
  const byName = new Map(artifacts.map((entry) => [entry['name'], entry]));
  const call = byName.get('call-timing-observations.ndjson');
  const timeline = byName.get('incumbent-timeline-observations.ndjson');
  const deadline = byName.get('deadline-observations.ndjson');
  const semantic = byName.get('semantic-results.ndjson');
  const analysis = byName.get('analysis.json');
  if (
    call === undefined || timeline === undefined || deadline === undefined ||
    semantic === undefined || analysis === undefined
  ) {
    throw new TypeError('Manifest aggregate entry is absent.');
  }
  const outputDecision = decisionOutputIdentity(decision);
  return Object.freeze({
    manifest,
    aggregates: Object.freeze({
      manifestSha256: sha256Bytes(input.manifestBytes),
      semanticAggregate: requireString(semantic['sha256']),
      operationalAggregate: operationalAggregate(call, timeline, deadline),
      analysisAggregate: requireString(analysis['sha256']),
      ...outputDecision,
    }),
  });
}
