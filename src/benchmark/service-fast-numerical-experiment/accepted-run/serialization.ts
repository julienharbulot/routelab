import { renderServiceFastExperimentReadme } from '../tooling/readme-template.ts';
import {
  ACCEPTED_EXECUTION_SCHEDULE,
  ACCEPTED_EXPERIMENT_ID,
  ACCEPTED_LIMITATIONS,
  ACCEPTED_TASK_ID,
  acceptedRetainedFileContracts,
  type AcceptedArtifactDescriptor,
  type AcceptedJsonObject,
} from './contract.ts';
import type { AcceptedAnalysisAccumulator } from './analysis.ts';
import { buildAcceptedAnalysis } from './analysis.ts';
import type { AcceptedPreflightResult } from './preflight.ts';
import type { AcceptedPreparedArtifact } from './publication.ts';
import { hashAcceptedBytes } from './projection.ts';

const encoder = new TextEncoder();

function descriptorJson(value: AcceptedArtifactDescriptor): AcceptedJsonObject {
  return Object.freeze({ path: value.path, bytes: value.bytes, sha256: value.sha256 });
}

function sourceDescriptor(
  value: Readonly<{ readonly path: string; readonly bytes: number; readonly sha256: string }>,
): AcceptedArtifactDescriptor {
  return Object.freeze({ path: value.path, bytes: value.bytes, sha256: value.sha256 });
}

function encodeJson(value: AcceptedJsonObject): Uint8Array {
  return encoder.encode(`${JSON.stringify(value)}\n`);
}

class AcceptedNdjsonChunks {
  readonly chunks: Uint8Array[] = [];
  readonly name: string;
  readonly maximumBytes: number;
  readonly expectedRecords: number;
  bytes = 0;
  records = 0;

  constructor(
    name: string,
    maximumBytes: number,
    expectedRecords: number,
  ) {
    this.name = name;
    this.maximumBytes = maximumBytes;
    this.expectedRecords = expectedRecords;
  }

  append(value: AcceptedJsonObject): void {
    const bytes = encodeJson(value);
    if (
      !Number.isSafeInteger(this.bytes + bytes.byteLength) ||
      this.bytes + bytes.byteLength > this.maximumBytes ||
      this.records >= this.expectedRecords
    ) throw new TypeError(`Accepted ${this.name} in-memory cap is exceeded.`);
    this.chunks.push(bytes);
    this.bytes += bytes.byteLength;
    this.records += 1;
  }

  seal(): Uint8Array {
    if (this.records !== this.expectedRecords) {
      throw new TypeError(`Accepted ${this.name} record count is incomplete.`);
    }
    const result = new Uint8Array(this.bytes);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }
}

function contract(name: string): Readonly<{
  readonly maxBytes: number;
  readonly recordCount: number | null;
}> {
  const result = acceptedRetainedFileContracts().find((entry) => entry.name === name);
  if (result === undefined) throw new TypeError('Accepted retained file contract is absent.');
  return result;
}

function chunks(name: string): AcceptedNdjsonChunks {
  const file = contract(name);
  if (file.recordCount === null) throw new TypeError('Accepted NDJSON record count is absent.');
  return new AcceptedNdjsonChunks(name, file.maxBytes, file.recordCount);
}

export class AcceptedEvidenceSerializer {
  readonly semantic = chunks('semantic-results.ndjson');
  readonly call = chunks('call-timing-observations.ndjson');
  readonly timeline = chunks('incumbent-timeline-observations.ndjson');
  readonly deadline = chunks('deadline-observations.ndjson');

  appendSemantic(value: AcceptedJsonObject): void {
    this.semantic.append(value);
  }

  appendCall(value: AcceptedJsonObject): void {
    this.call.append(value);
  }

  appendTimeline(value: AcceptedJsonObject): void {
    this.timeline.append(value);
  }

  appendDeadline(value: AcceptedJsonObject): void {
    this.deadline.append(value);
  }
}

function prepared(
  name: string,
  bytes: Uint8Array,
  recordCount: number | null,
): AcceptedPreparedArtifact {
  const file = contract(name);
  if (
    bytes.byteLength > file.maxBytes ||
    recordCount !== file.recordCount
  ) throw new TypeError('Accepted prepared artifact violates its frozen contract.');
  return Object.freeze({ name, bytes, sha256: hashAcceptedBytes(bytes), recordCount });
}

function manifestEntry(artifact: AcceptedPreparedArtifact): AcceptedJsonObject {
  const file = acceptedRetainedFileContracts().find((entry) => entry.name === artifact.name);
  if (file === undefined || file.contentRole === null) {
    throw new TypeError('Accepted manifest artifact contract is absent.');
  }
  return Object.freeze({
    name: artifact.name,
    contentRole: file.contentRole,
    schemaVersion: file.schemaVersion,
    recordCount: file.recordCount,
    bytes: artifact.bytes.byteLength,
    sha256: artifact.sha256,
  });
}

export interface SealAcceptedEvidenceInput {
  readonly preflight: AcceptedPreflightResult;
  readonly accumulator: AcceptedAnalysisAccumulator;
  readonly serializer: AcceptedEvidenceSerializer;
}

/** Seal all in-memory evidence before the publisher can create staging. @internal */
export function sealAcceptedEvidence(
  input: SealAcceptedEvidenceInput,
): readonly AcceptedPreparedArtifact[] {
  const config = sourceDescriptor(input.preflight.closure.config);
  const artifactSchema = sourceDescriptor(input.preflight.closure.artifactSchema);
  const analysis = buildAcceptedAnalysis(
    input.accumulator,
    input.preflight.configValue,
    Object.freeze({
      implementationInputRevision: input.preflight.closure.implementationInputRevision,
    }),
    Object.freeze({
      config,
      artifactSchema,
      sourceClosure: input.preflight.sourceClosureDescriptor,
      inputArtifact: input.preflight.inputDescriptor,
    }),
    input.preflight.environment,
  );
  const inputs = prepared('inputs.ndjson', input.preflight.inputBytes, 1_584);
  const semantic = prepared(
    'semantic-results.ndjson',
    input.serializer.semantic.seal(),
    ACCEPTED_EXECUTION_SCHEDULE.semanticCalls,
  );
  const call = prepared(
    'call-timing-observations.ndjson',
    input.serializer.call.seal(),
    ACCEPTED_EXECUTION_SCHEDULE.callRetained,
  );
  const timeline = prepared(
    'incumbent-timeline-observations.ndjson',
    input.serializer.timeline.seal(),
    ACCEPTED_EXECUTION_SCHEDULE.timelineRetained,
  );
  const deadline = prepared(
    'deadline-observations.ndjson',
    input.serializer.deadline.seal(),
    ACCEPTED_EXECUTION_SCHEDULE.deadlineRetained,
  );
  const analysisArtifact = prepared('analysis.json', encodeJson(analysis), null);
  const decision = analysis['decision'];
  if (typeof decision !== 'object' || decision === null || Array.isArray(decision)) {
    throw new TypeError('Accepted analysis decision is absent.');
  }
  const readmeText = renderServiceFastExperimentReadme({
    experimentId: ACCEPTED_EXPERIMENT_ID,
    implementationRevision: input.preflight.closure.implementationInputRevision,
    inputArtifact: input.preflight.inputDescriptor,
    sourceClosure: input.preflight.sourceClosureDescriptor,
    environment: input.preflight.environment as unknown as { readonly timezone: string },
    decision: decision as unknown as Parameters<typeof renderServiceFastExperimentReadme>[0]['decision'],
  });
  const readme = prepared('README.md', encoder.encode(readmeText), null);
  const manifestArtifacts = Object.freeze([
    inputs,
    semantic,
    call,
    timeline,
    deadline,
    analysisArtifact,
    readme,
  ]);
  const manifest: AcceptedJsonObject = Object.freeze({
    schemaVersion: 'routelab.service-fast-numerical-manifest.v1',
    experimentId: ACCEPTED_EXPERIMENT_ID,
    taskId: ACCEPTED_TASK_ID,
    config: descriptorJson(config),
    artifactSchema: descriptorJson(artifactSchema),
    sourceClosure: descriptorJson(input.preflight.sourceClosureDescriptor),
    inputArtifact: descriptorJson(input.preflight.inputDescriptor),
    implementationRevision: input.preflight.closure.implementationInputRevision,
    environment: input.preflight.environment,
    executionSchedule: ACCEPTED_EXECUTION_SCHEDULE,
    artifacts: Object.freeze(manifestArtifacts.map(manifestEntry)),
    decision: decision as AcceptedJsonObject,
    limitations: ACCEPTED_LIMITATIONS,
  });
  const manifestArtifact = prepared('manifest.json', encodeJson(manifest), null);
  const result = Object.freeze([
    inputs,
    semantic,
    call,
    timeline,
    deadline,
    analysisArtifact,
    manifestArtifact,
    readme,
  ]);
  const total = result.reduce((sum, artifact) => sum + artifact.bytes.byteLength, 0);
  if (!Number.isSafeInteger(total) || total > 768 * 1024 * 1024) {
    throw new TypeError('Accepted retained directory cap is exceeded.');
  }
  return result;
}
