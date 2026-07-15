import {
  recomputeAnalysis,
  type AnalysisDescriptors,
} from './analysis/recompute.ts';
import { ServiceFastAnalysisAccumulator } from './analysis/accumulator.ts';
import {
  artifactSchemaDescriptor,
  configDescriptor,
} from './contract.ts';
import {
  regenerateCallObservations,
  regenerateTimelineObservations,
} from './complete-regeneration.ts';
import { regenerateDeadlineObservations } from './deadline-regeneration.ts';
import {
  integrityFailure,
  isIntegrityFailure,
  type ServiceFastIntegrityFailureCode,
} from './failure.ts';
import { admitServiceFastVerifierHost } from './host-admission.ts';
import {
  admitRetainedArtifactFiles,
  BoundedFileError,
  readBoundedRegularFile,
} from './io/bounded-file.ts';
import { scanCanonicalNdjson } from './io/ndjson-cursor.ts';
import { replayAndAdmitExperimentInputs } from './input-replay.ts';
import { parseCanonicalJson } from './json/strict-json.ts';
import { recomputeManifest } from './manifest-recompute.ts';
import {
  recordAnalysisRecomputeEnforcement,
  recordArtifactRegenerationEnforcement,
  recordEnvironmentRecordOnlyEnforcement,
  recordInputReplayEnforcement,
  recordManifestRecomputeEnforcement,
  recordSourceAdmissionEnforcement,
} from './rules/enforcement.ts';
import {
  recordParentAuthenticatedPrecondition,
  recordRetainedExecutionGateEvidence,
} from './rules/execution-gates.ts';
import {
  admitSchemaRuleRegistry,
  registeredSchemaRules,
} from './rules/registry.ts';
import {
  assertRuleVerificationLedger,
  createRuleVerificationLedger,
  type RuleVerificationLedger,
} from './rules/types.ts';
import {
  compileArtifactSchemaProgram,
  validateBoundRecord,
  type ArtifactSchemaProgram,
} from './schema/program.ts';
import { regenerateSemanticCorpus } from './semantic-regeneration.ts';
import { admitServiceFastSources } from './source-admission.ts';
import {
  requireJsonArray,
  requireJsonObject,
  type ArtifactDescriptor,
  type EnvironmentValue,
  type JsonObject,
  type JsonValue,
  type VerificationAggregates,
} from './types.ts';

interface AdmittedArtifactDocuments {
  readonly analysis: JsonObject;
  readonly analysisBytes: Uint8Array;
  readonly manifest: JsonObject;
  readonly manifestBytes: Uint8Array;
  readonly readmeBytes: Uint8Array;
}

function retainedDescriptor(
  retained: ReadonlyMap<string, ArtifactDescriptor>,
  name: string,
): ArtifactDescriptor {
  const descriptor = retained.get(name);
  if (descriptor === undefined) return integrityFailure('artifact-shape-failure');
  return descriptor;
}

async function asIntegrity<T>(
  code: ServiceFastIntegrityFailureCode,
  action: () => Promise<T> | T,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (isIntegrityFailure(error)) throw error;
    return integrityFailure(code);
  }
}

async function admitArtifactDocuments(
  repositoryRoot: string,
  retained: ReadonlyMap<string, ArtifactDescriptor>,
  program: ArtifactSchemaProgram,
): Promise<AdmittedArtifactDocuments> {
  const ndjson = Object.freeze([
    Object.freeze({
      name: 'inputs.ndjson',
      binding: 'inputs.ndjson',
      count: 1_584,
      cap: 64 * 1024 * 1024,
      recordCap: 256 * 1024,
    }),
    Object.freeze({
      name: 'semantic-results.ndjson',
      binding: 'semantic-results.ndjson',
      count: 38_016,
      cap: 256 * 1024 * 1024,
      recordCap: 6_961,
    }),
    Object.freeze({
      name: 'call-timing-observations.ndjson',
      binding: 'call-timing-observations.ndjson',
      count: 30_240,
      cap: 128 * 1024 * 1024,
      recordCap: 16 * 1024,
    }),
    Object.freeze({
      name: 'incumbent-timeline-observations.ndjson',
      binding: 'incumbent-timeline-observations.ndjson',
      count: 18_144,
      cap: 128 * 1024 * 1024,
      recordCap: 16 * 1024,
    }),
    Object.freeze({
      name: 'deadline-observations.ndjson',
      binding: 'deadline-observations.ndjson',
      count: 108_864,
      cap: 256 * 1024 * 1024,
      recordCap: 32 * 1024,
    }),
  ]);
  for (const contract of ndjson) {
    await scanCanonicalNdjson(
      repositoryRoot,
      retainedDescriptor(retained, contract.name),
      contract.cap,
      contract.count,
      contract.recordCap,
      ({ value }) => {
        validateBoundRecord(program, contract.binding, value);
      },
    );
  }
  const analysisDescriptor = retainedDescriptor(retained, 'analysis.json');
  const manifestDescriptor = retainedDescriptor(retained, 'manifest.json');
  const readmeDescriptor = retainedDescriptor(retained, 'README.md');
  const [analysisBytes, manifestBytes, readmeBytes] = await Promise.all([
    readBoundedRegularFile(
      repositoryRoot,
      analysisDescriptor.path,
      8 * 1024 * 1024,
      analysisDescriptor,
    ),
    readBoundedRegularFile(
      repositoryRoot,
      manifestDescriptor.path,
      1024 * 1024,
      manifestDescriptor,
    ),
    readBoundedRegularFile(
      repositoryRoot,
      readmeDescriptor.path,
      1024 * 1024,
      readmeDescriptor,
    ),
  ]);
  const analysis = validateBoundRecord(
    program,
    'analysis.json',
    parseCanonicalJson(analysisBytes),
  );
  const manifest = validateBoundRecord(
    program,
    'manifest.json',
    parseCanonicalJson(manifestBytes),
  );
  return Object.freeze({
    analysis,
    analysisBytes,
    manifest,
    manifestBytes,
    readmeBytes,
  });
}

function requiredRuntime(config: JsonObject): JsonObject {
  return requireJsonObject(requireJsonObject(config['runtime'])['required']);
}

function admittedRetainedEnvironment(
  config: JsonObject,
  analysis: JsonObject,
  ledger: RuleVerificationLedger,
): EnvironmentValue {
  const required = requiredRuntime(config);
  const environment = requireJsonObject(analysis['environment']);
  const exactRequiredFields = Object.freeze([
    'nodeVersion',
    'v8Version',
    'uvVersion',
    'platform',
    'arch',
    'endianness',
    'osType',
    'osRelease',
    'cpuModel',
    'logicalCpuCount',
    'availableParallelism',
    'execArgv',
    'mainThread',
  ]);
  if (
    exactRequiredFields.some((field) =>
      JSON.stringify(environment[field]) !== JSON.stringify(required[field])) ||
    !requireJsonArray(required['nodeOptionsState']).includes(
      environment['nodeOptionsState'] as JsonValue,
    )
  ) {
    return integrityFailure('runtime-mismatch');
  }
  recordEnvironmentRecordOnlyEnforcement(ledger);
  return environment as EnvironmentValue;
}

function descriptorSet(
  sources: Awaited<ReturnType<typeof admitServiceFastSources>>,
): AnalysisDescriptors {
  return Object.freeze({
    config: configDescriptor(),
    artifactSchema: artifactSchemaDescriptor(),
    sourceClosure: sources.closure.descriptor,
    inputArtifact: sources.publicInputDescriptor,
  });
}

export async function verifyServiceFastArtifacts(
  repositoryRoot: string,
): Promise<VerificationAggregates> {
  admitServiceFastVerifierHost();

  let retained: ReadonlyMap<string, ArtifactDescriptor>;
  try {
    retained = await admitRetainedArtifactFiles(repositoryRoot);
  } catch (error) {
    if (error instanceof BoundedFileError && error.code === 'cap') {
      return integrityFailure('artifact-cap-failure');
    }
    return integrityFailure('artifact-shape-failure');
  }

  const sources = await admitServiceFastSources(repositoryRoot);
  const program = await asIntegrity('artifact-shape-failure', () => {
    const compiled = compileArtifactSchemaProgram(
      sources.artifactSchema,
      sources.config,
    );
    admitSchemaRuleRegistry(compiled);
    validateBoundRecord(
      compiled,
      'fixtures/m7c/service-fast-numerical/source-closure.v1.json',
      sources.closure.value,
    );
    return compiled;
  });
  const documents = await asIntegrity('artifact-shape-failure', () =>
    admitArtifactDocuments(repositoryRoot, retained, program));

  const ledger = createRuleVerificationLedger();
  recordSourceAdmissionEnforcement(ledger);
  recordParentAuthenticatedPrecondition(ledger, sources.closure);
  recordRetainedExecutionGateEvidence(ledger, sources.closure);

  const replayed = await replayAndAdmitExperimentInputs(
    repositoryRoot,
    sources.publicInputDescriptor,
    retainedDescriptor(retained, 'inputs.ndjson'),
  );
  for (const input of replayed.records) {
    await asIntegrity('artifact-shape-failure', () => {
      validateBoundRecord(program, 'inputs.ndjson', input.value);
    });
  }
  recordInputReplayEnforcement(ledger);

  const accumulator = new ServiceFastAnalysisAccumulator();
  const semantic = await asIntegrity('exact-replay-mismatch', () =>
    regenerateSemanticCorpus(
      repositoryRoot,
      retainedDescriptor(retained, 'semantic-results.ndjson'),
      program,
      replayed,
      (record, input) => accumulator.acceptSemantic(record, input),
    ));
  await asIntegrity('exact-replay-mismatch', () =>
    regenerateCallObservations(
      repositoryRoot,
      retainedDescriptor(retained, 'call-timing-observations.ndjson'),
      program,
      semantic,
      (record) => accumulator.acceptCall(record),
    ));
  await asIntegrity('exact-replay-mismatch', () =>
    regenerateTimelineObservations(
      repositoryRoot,
      retainedDescriptor(retained, 'incumbent-timeline-observations.ndjson'),
      program,
      semantic,
      ledger,
      (record) => accumulator.acceptTimeline(record),
    ));
  await asIntegrity('exact-replay-mismatch', () =>
    regenerateDeadlineObservations(
      repositoryRoot,
      retainedDescriptor(retained, 'deadline-observations.ndjson'),
      program,
      semantic,
      (record) => accumulator.acceptDeadline(record),
    ));
  recordArtifactRegenerationEnforcement(ledger);

  const environment = admittedRetainedEnvironment(
    sources.config,
    documents.analysis,
    ledger,
  );
  const regeneratedAnalysis = await asIntegrity('clock-invariant-failure', () =>
    recomputeAnalysis(
      accumulator,
      sources.config,
      sources.closure,
      descriptorSet(sources),
      environment,
    ));
  if (JSON.stringify(regeneratedAnalysis) !== JSON.stringify(documents.analysis)) {
    return integrityFailure('artifact-shape-failure');
  }
  recordAnalysisRecomputeEnforcement(ledger);
  const recomputedManifest = await asIntegrity('artifact-shape-failure', () =>
    recomputeManifest({
      config: configDescriptor(),
      artifactSchema: artifactSchemaDescriptor(),
      sourceClosure: sources.closure,
      inputArtifact: sources.publicInputDescriptor,
      retained,
      analysis: regeneratedAnalysis,
      environment,
      manifestBytes: documents.manifestBytes,
      readmeBytes: documents.readmeBytes,
    }));
  if (JSON.stringify(recomputedManifest.manifest) !== JSON.stringify(documents.manifest)) {
    return integrityFailure('artifact-shape-failure');
  }
  recordManifestRecomputeEnforcement(ledger);
  await asIntegrity('artifact-shape-failure', () => {
    assertRuleVerificationLedger(ledger, registeredSchemaRules());
  });
  return recomputedManifest.aggregates;
}
