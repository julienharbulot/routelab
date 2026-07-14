import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  routeExactInputSplitNumericalAnytime,
  type NumericalExactInputSplitRuntimeResult,
} from '../../../router/numerical-exact-input-split/index.ts';
import {
  parseAndPrepareRoutingContext,
  replayPreparedExactInputSplit,
  resolvePreparedPathShadowPriceRoutes,
  type PreparedRoutingContext,
} from '../../../runtime/prepared-routing-context/index.ts';
import { discoverSharedRoutes } from '../../../search/shared-route-discovery/index.ts';
import type { ExactInputSplitReplayReceipt } from '../../../replay/exact-input-split/index.ts';
import {
  canonicalCandidateSetKey,
  canonicalRouteKey,
  encodeCanonicalNdjsonRecord,
  projectExactIncumbent,
  projectProtectedBaselineResult,
  sha256,
  type DirectionalHopInput,
  type ResolvedHopInput,
} from './codec.ts';
import {
  SERVICE_FAST_INPUT_BUILTIN_RUNTIME_ALLOWLIST,
  SERVICE_FAST_INPUT_PROJECT_RUNTIME_ALLOWLIST,
} from './closure-audit.ts';
import {
  SERVICE_FAST_EXPERIMENT_CONFIG_PATH,
  SERVICE_FAST_EXPERIMENT_INPUT_RUNTIME_ROOTS,
} from './frozen-bindings.ts';

const STRUCTURAL_REQUEST = Object.freeze({
  maxHops: 2,
  maxRoutes: 2,
  greedyParts: 16,
});

const PROTECTED_NUMERICAL_CONFIGURATION = Object.freeze({
  outerIterations: 64,
  innerIterations: 64,
  convergenceTolerance: 2 ** -40,
});

const STRUCTURAL_COMPLETE_CAPS = Object.freeze({
  maxPathExpansions: 121,
  maxBestSingleCandidateReplays: 11,
  maxCandidateSetExpansions: 110,
  maxEqualProposalReplays: 55,
  maxGreedyOptionReplays: 1760,
  maxFinalAuthorizationReplays: 110,
  maxNumericalProposals: 55,
  maxNumericalIterations: 3520,
  maxNumericalResidualReplays: 110,
  maxNumericalAuthorizationReplays: 55,
});

const SNAPSHOT_BINDING_NAMES = Object.freeze([
  'historicalSnapshot',
  'dualTreeSnapshot',
  'compressedSnapshot',
  'amplifiedSnapshot',
]);

const INPUT_RECORD_FIELDS = Object.freeze([
  'schemaVersion',
  'sourceIndex',
  'caseId',
  'requestId',
  'snapshot',
  'request',
  'priorEligibility',
  'serviceDecisionMember',
  'amplifiedStressMember',
  'timingCohortIndex',
  'entryBaseline',
  'candidateDiscovery',
  'repairTargetSetIndex',
  'actionCeilingProfileId',
]);

const RUNTIME_CLOSURE_FIELDS = Object.freeze([
  'schemaVersion',
  'profileId',
  'entryRoots',
  'projectSources',
  'nodeBuiltins',
  'commandManifest',
  'repositoryAdmission',
  'byteBinding',
  'lexicalAudit',
]);

const RUNTIME_DESCRIPTOR_FIELDS = Object.freeze(['path', 'bytes', 'sha256']);
const COMMAND_MANIFEST_FIELDS = Object.freeze([
  'path',
  'bytes',
  'sha256',
  'requiredScripts',
]);

export const SERVICE_FAST_EXPERIMENT_INPUT_REQUIRED_SCRIPTS = Object.freeze({
  'experiment:service-fast:inputs':
    'node cli/verify-service-fast-numerical-experiment-config.ts --input-admission && node cli/build-service-fast-numerical-experiment-inputs.ts',
  'experiment:service-fast': 'node cli/run-service-fast-numerical-experiment.ts',
  'verify:service-fast-experiment':
    'node cli/verify-service-fast-numerical-experiment.ts',
});

type JsonRecord = Record<string, unknown>;

export interface ImmutableDescriptor {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface ExperimentInputCommandManifest extends ImmutableDescriptor {
  readonly requiredScripts: typeof SERVICE_FAST_EXPERIMENT_INPUT_REQUIRED_SCRIPTS;
}

export interface ExperimentInputRuntimeClosureContract {
  readonly schemaVersion: 'routelab.service-fast-numerical-input-runtime-closure.v1';
  readonly profileId: 'candidate-free-input-runtime-v1';
  readonly entryRoots: readonly string[];
  readonly projectSources: readonly ImmutableDescriptor[];
  readonly nodeBuiltins: readonly string[];
  readonly commandManifest: ExperimentInputCommandManifest;
  readonly repositoryAdmission: 'stable-reviewed-head-clean-index-and-worktree-no-untracked-nonignored-files-no-submodules-no-concurrent-mutation';
  readonly byteBinding: 'primary-before-construction';
  readonly lexicalAudit: 'defense-in-depth';
}

export interface ExperimentInputRequestSource {
  readonly requestId: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountBucket: string;
  readonly amountIn: string;
  readonly topology: string;
}

export interface ExperimentInputCaseSource {
  readonly caseId: string;
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly serviceDecision: boolean;
  readonly operational: boolean;
  readonly snapshot: unknown;
  readonly requests: readonly ExperimentInputRequestSource[];
}

export interface IdentityCohortContract {
  readonly count: number;
  readonly sha256: string;
}

export interface OperationalCohortContract extends IdentityCohortContract {
  readonly perCaseCounts: Readonly<Record<string, number>>;
  readonly nonemptyStrataPerCase: Readonly<Record<string, number>>;
}

export interface ExperimentInputCohortContract {
  readonly full: IdentityCohortContract;
  readonly serviceDecision: IdentityCohortContract;
  readonly amplifiedStress: IdentityCohortContract;
  readonly priorEligibleBoundOnly: IdentityCohortContract;
  readonly priorEligibleServiceBoundOnly: IdentityCohortContract;
  readonly operational: OperationalCohortContract;
}

export interface ExperimentInputSource {
  readonly schemaVersion: 'routelab.service-fast-numerical-experiment-input.v1';
  readonly artifactPath: string;
  readonly maximumBytes: number;
  readonly runtimeClosure: ExperimentInputRuntimeClosureContract;
  readonly cases: readonly ExperimentInputCaseSource[];
  readonly baselineCells: readonly unknown[];
  readonly eligibilityCells: readonly unknown[];
  readonly cohorts: ExperimentInputCohortContract;
}

export interface ProtectedInputRequest {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly maxHops: number;
  readonly maxRoutes: number;
  readonly greedyParts: number;
  readonly numerical: Readonly<{
    outerIterations: number;
    innerIterations: number;
    convergenceTolerance: number;
  }>;
}

export interface ProtectedInputControl {
  readonly workCaps: typeof STRUCTURAL_COMPLETE_CAPS;
}

export interface StructuralDiscoveryValue {
  readonly search: Readonly<{
    pathExpansions: number;
    enumeratedPaths: number;
    pathTermination: 'complete' | 'work-limit';
    candidateSetExpansions: number;
    enumeratedCandidateSets: number;
    candidateSetTermination: 'complete' | 'work-limit';
  }>;
  readonly candidateSets: readonly Readonly<{
    routes: readonly (readonly DirectionalHopInput[])[];
  }>[];
}

export interface ExperimentInputOperations {
  readonly prepare: (
    snapshot: unknown,
  ) => Readonly<{ readonly ok: true; readonly value: unknown } | { readonly ok: false }>;
  readonly route: (
    context: unknown,
    request: ProtectedInputRequest,
    control: ProtectedInputControl,
  ) => NumericalExactInputSplitRuntimeResult;
  readonly discover: (
    context: unknown,
    request: Readonly<{
      snapshotId: string;
      snapshotChecksum: string;
      assetIn: string;
      assetOut: string;
      maxHops: number;
      maxPathExpansions: number;
      maxRoutes: number;
      maxCandidateSetExpansions: number;
    }>,
  ) => Readonly<
    { readonly ok: true; readonly value: StructuralDiscoveryValue } | { readonly ok: false }
  >;
  readonly resolve: (
    context: unknown,
    routes: readonly (readonly DirectionalHopInput[])[],
  ) => Readonly<
    | {
        readonly ok: true;
        readonly value: readonly (readonly ResolvedHopInput[])[];
      }
    | { readonly ok: false }
  >;
  readonly replay: (
    context: unknown,
    request: Readonly<{
      snapshotId: string;
      snapshotChecksum: string;
      assetIn: string;
      assetOut: string;
      amountIn: bigint;
      legs: readonly Readonly<{
        allocation: bigint;
        route: readonly DirectionalHopInput[];
      }>[];
    }>,
  ) => Readonly<
    { readonly ok: true; readonly value: ExactInputSplitReplayReceipt } | { readonly ok: false }
  >;
}

export interface ExperimentInputSink {
  readonly write: (chunk: Uint8Array) => Promise<void>;
}

export interface ExperimentInputBuildSummary {
  readonly recordCount: number;
  readonly bytes: number;
  readonly sha256: string;
}

export interface ExperimentInputPublicationAccounting {
  readonly bytes: number;
  readonly sha256: string;
}

export interface ExperimentInputSourceDependencies {
  readonly readFile: (filePath: string) => Promise<Uint8Array>;
}

export class ExperimentInputBuildError extends Error {
  readonly code: string;
  readonly artifact: string;

  constructor(code: string, artifact: string, message: string) {
    super(message);
    this.code = code;
    this.artifact = artifact;
  }
}

export function validateExperimentInputPublicationAccounting(
  summary: ExperimentInputBuildSummary,
  accounting: ExperimentInputPublicationAccounting,
): void {
  if (summary.bytes !== accounting.bytes || summary.sha256 !== accounting.sha256) {
    inputFailure(
      'publication-accounting-mismatch',
      'experiment-inputs',
      'Publisher byte/hash accounting differs from the canonical input stream.',
    );
  }
}

function inputFailure(code: string, artifact: string, message: string): never {
  throw new ExperimentInputBuildError(code, artifact, message);
}

function record(value: unknown, artifact: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    inputFailure('invalid-object', artifact, `Expected an object at ${artifact}.`);
  }
  return value as JsonRecord;
}

function list(value: unknown, artifact: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    inputFailure('invalid-array', artifact, `Expected an array at ${artifact}.`);
  }
  return value;
}

function text(value: unknown, artifact: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    inputFailure('invalid-string', artifact, `Expected a nonempty string at ${artifact}.`);
  }
  return value;
}

function boolean(value: unknown, artifact: string): boolean {
  if (typeof value !== 'boolean') {
    inputFailure('invalid-boolean', artifact, `Expected a boolean at ${artifact}.`);
  }
  return value;
}

function nonnegativeInteger(value: unknown, artifact: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    inputFailure('invalid-integer', artifact, `Expected a safe nonnegative integer at ${artifact}.`);
  }
  return value as number;
}

function positiveInteger(value: unknown, artifact: string): number {
  const parsed = nonnegativeInteger(value, artifact);
  if (parsed === 0) {
    inputFailure('invalid-integer', artifact, `Expected a positive integer at ${artifact}.`);
  }
  return parsed;
}

function canonicalPositiveDecimal(value: unknown, artifact: string): string {
  const parsed = text(value, artifact);
  if (!/^[1-9][0-9]*$/u.test(parsed)) {
    inputFailure('invalid-exact-decimal', artifact, `Expected a canonical positive decimal at ${artifact}.`);
  }
  return parsed;
}

function descriptor(value: unknown, artifact: string): ImmutableDescriptor {
  const parsed = record(value, artifact);
  const descriptorPath = text(parsed['path'], `${artifact}.path`);
  if (
    path.isAbsolute(descriptorPath) ||
    descriptorPath.split('/').some((segment) => segment === '..' || segment === '')
  ) {
    inputFailure('invalid-descriptor-path', artifact, `Descriptor path is not repository-relative: ${descriptorPath}.`);
  }
  const expectedHash = text(parsed['sha256'], `${artifact}.sha256`);
  if (!/^sha256:[0-9a-f]{64}$/u.test(expectedHash)) {
    inputFailure('invalid-descriptor-hash', artifact, `Descriptor hash is invalid at ${artifact}.`);
  }
  return Object.freeze({
    path: descriptorPath,
    bytes: nonnegativeInteger(parsed['bytes'], `${artifact}.bytes`),
    sha256: expectedHash,
  });
}

function runtimeClosureFailure(artifact: string, message: string): never {
  inputFailure('runtime-closure-contract-mismatch', artifact, message);
}

function exactRuntimeKeys(
  parsed: JsonRecord,
  expected: readonly string[],
  artifact: string,
): void {
  if (!isDeepStrictEqual(Object.keys(parsed), expected)) {
    runtimeClosureFailure(artifact, `Runtime closure keys differ at ${artifact}.`);
  }
}

function runtimeDescriptor(value: unknown, artifact: string): ImmutableDescriptor {
  const parsed = record(value, artifact);
  exactRuntimeKeys(parsed, RUNTIME_DESCRIPTOR_FIELDS, artifact);
  const binding = descriptor(parsed, artifact);
  if (binding.bytes === 0) {
    runtimeClosureFailure(artifact, `Runtime descriptor must bind positive bytes at ${artifact}.`);
  }
  return binding;
}

export function parseExperimentInputRuntimeClosure(
  value: unknown,
  artifact = 'inputConstruction.runtimeClosure',
): ExperimentInputRuntimeClosureContract {
  const parsed = record(value, artifact);
  exactRuntimeKeys(parsed, RUNTIME_CLOSURE_FIELDS, artifact);
  if (
    parsed['schemaVersion'] !==
      'routelab.service-fast-numerical-input-runtime-closure.v1' ||
    parsed['profileId'] !== 'candidate-free-input-runtime-v1' ||
    parsed['repositoryAdmission'] !==
      'stable-reviewed-head-clean-index-and-worktree-no-untracked-nonignored-files-no-submodules-no-concurrent-mutation' ||
    parsed['byteBinding'] !== 'primary-before-construction' ||
    parsed['lexicalAudit'] !== 'defense-in-depth'
  ) {
    runtimeClosureFailure(artifact, 'Runtime closure identity or admission policy changed.');
  }
  if (!isDeepStrictEqual(parsed['entryRoots'], SERVICE_FAST_EXPERIMENT_INPUT_RUNTIME_ROOTS)) {
    runtimeClosureFailure(`${artifact}.entryRoots`, 'Runtime entry roots differ from the exact input root.');
  }
  if (!isDeepStrictEqual(parsed['nodeBuiltins'], SERVICE_FAST_INPUT_BUILTIN_RUNTIME_ALLOWLIST)) {
    runtimeClosureFailure(`${artifact}.nodeBuiltins`, 'Runtime built-ins differ from the exact input set.');
  }

  const rawProjectSources = list(parsed['projectSources'], `${artifact}.projectSources`);
  if (rawProjectSources.length !== SERVICE_FAST_INPUT_PROJECT_RUNTIME_ALLOWLIST.length) {
    runtimeClosureFailure(
      `${artifact}.projectSources`,
      'Runtime project source count differs from the exact input graph.',
    );
  }
  const projectSources = rawProjectSources.map((rawDescriptor, index) => {
    const binding = runtimeDescriptor(rawDescriptor, `${artifact}.projectSources[${index}]`);
    if (binding.path !== SERVICE_FAST_INPUT_PROJECT_RUNTIME_ALLOWLIST[index]) {
      runtimeClosureFailure(
        `${artifact}.projectSources[${index}].path`,
        'Runtime project source paths are missing, unknown, duplicated, or reordered.',
      );
    }
    return binding;
  });

  const rawCommandManifest = record(parsed['commandManifest'], `${artifact}.commandManifest`);
  exactRuntimeKeys(
    rawCommandManifest,
    COMMAND_MANIFEST_FIELDS,
    `${artifact}.commandManifest`,
  );
  const commandDescriptor = descriptor(rawCommandManifest, `${artifact}.commandManifest`);
  if (commandDescriptor.path !== 'package.json' || commandDescriptor.bytes === 0) {
    runtimeClosureFailure(
      `${artifact}.commandManifest.path`,
      'The command manifest must bind positive package.json bytes.',
    );
  }
  const requiredScripts = record(
    rawCommandManifest['requiredScripts'],
    `${artifact}.commandManifest.requiredScripts`,
  );
  exactRuntimeKeys(
    requiredScripts,
    Object.keys(SERVICE_FAST_EXPERIMENT_INPUT_REQUIRED_SCRIPTS),
    `${artifact}.commandManifest.requiredScripts`,
  );
  if (!isDeepStrictEqual(requiredScripts, SERVICE_FAST_EXPERIMENT_INPUT_REQUIRED_SCRIPTS)) {
    runtimeClosureFailure(
      `${artifact}.commandManifest.requiredScripts`,
      'Required package scripts differ from the exact command manifest.',
    );
  }

  return Object.freeze({
    schemaVersion: 'routelab.service-fast-numerical-input-runtime-closure.v1',
    profileId: 'candidate-free-input-runtime-v1',
    entryRoots: SERVICE_FAST_EXPERIMENT_INPUT_RUNTIME_ROOTS,
    projectSources: Object.freeze(projectSources),
    nodeBuiltins: SERVICE_FAST_INPUT_BUILTIN_RUNTIME_ALLOWLIST,
    commandManifest: Object.freeze({
      ...commandDescriptor,
      requiredScripts: SERVICE_FAST_EXPERIMENT_INPUT_REQUIRED_SCRIPTS,
    }),
    repositoryAdmission:
      'stable-reviewed-head-clean-index-and-worktree-no-untracked-nonignored-files-no-submodules-no-concurrent-mutation',
    byteBinding: 'primary-before-construction',
    lexicalAudit: 'defense-in-depth',
  });
}

function parseJson(bytes: Uint8Array, artifact: string): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    inputFailure('invalid-json', artifact, `Invalid UTF-8 JSON: ${artifact}.`);
  }
}

async function readVerified(
  dependencies: ExperimentInputSourceDependencies,
  binding: ImmutableDescriptor,
): Promise<Uint8Array> {
  const bytes = Uint8Array.from(await dependencies.readFile(binding.path));
  verifyImmutableDescriptorBytes(binding, bytes);
  return bytes;
}

export function verifyImmutableDescriptorBytes(
  binding: ImmutableDescriptor,
  bytes: Uint8Array,
): void {
  if (bytes.byteLength !== binding.bytes) {
    inputFailure('descriptor-byte-mismatch', binding.path, `Byte count mismatch for ${binding.path}.`);
  }
  if (sha256(bytes) !== binding.sha256) {
    inputFailure('descriptor-hash-mismatch', binding.path, `SHA-256 mismatch for ${binding.path}.`);
  }
}

export function verifyExperimentInputCommandManifest(
  manifest: ExperimentInputCommandManifest,
  bytes: Uint8Array,
): void {
  verifyImmutableDescriptorBytes(manifest, bytes);
  const parsedPackage = record(parseJson(bytes, manifest.path), manifest.path);
  const scripts = record(parsedPackage['scripts'], `${manifest.path}.scripts`);
  for (const [name, expected] of Object.entries(manifest.requiredScripts)) {
    if (scripts[name] !== expected) {
      inputFailure(
        'package-command-manifest-mismatch',
        `${manifest.path}.scripts.${name}`,
        `Required package script ${name} differs from the admitted command manifest.`,
      );
    }
  }
}

export async function constructAfterExperimentInputAdmission<Result>(
  source: ExperimentInputSource,
  admit: (runtimeClosure: ExperimentInputRuntimeClosureContract) => Promise<void>,
  construct: (admittedSource: ExperimentInputSource) => Promise<Result>,
): Promise<Result> {
  await admit(source.runtimeClosure);
  return construct(source);
}

function sameArray(actual: unknown, expected: readonly unknown[], artifact: string): void {
  if (!isDeepStrictEqual(actual, expected)) {
    inputFailure('frozen-contract-mismatch', artifact, `Frozen array contract mismatch at ${artifact}.`);
  }
}

function cohortContract(value: unknown, artifact: string): IdentityCohortContract {
  const parsed = record(value, artifact);
  return Object.freeze({
    count: nonnegativeInteger(parsed['count'], `${artifact}.count`),
    sha256: text(parsed['sha256'], `${artifact}.sha256`),
  });
}

function requestSource(value: unknown, artifact: string): ExperimentInputRequestSource {
  const parsed = record(value, artifact);
  return Object.freeze({
    requestId: text(parsed['requestId'], `${artifact}.requestId`),
    assetIn: text(parsed['assetIn'], `${artifact}.assetIn`),
    assetOut: text(parsed['assetOut'], `${artifact}.assetOut`),
    amountBucket: text(parsed['amountBucket'], `${artifact}.amountBucket`),
    amountIn: canonicalPositiveDecimal(parsed['amountIn'], `${artifact}.amountIn`),
    topology: text(parsed['topology'], `${artifact}.topology`),
  });
}

export function defaultExperimentInputSourceDependencies(
  repositoryRoot = '.',
): ExperimentInputSourceDependencies {
  const root = path.resolve(repositoryRoot);
  return Object.freeze({
    readFile: async (filePath: string) => Uint8Array.from(await readFile(path.resolve(root, filePath))),
  });
}

export async function loadVerifiedExperimentInputSource(
  dependencies: ExperimentInputSourceDependencies,
): Promise<ExperimentInputSource> {
  const configBytes = Uint8Array.from(
    await dependencies.readFile(SERVICE_FAST_EXPERIMENT_CONFIG_PATH),
  );
  const config = record(
    parseJson(configBytes, SERVICE_FAST_EXPERIMENT_CONFIG_PATH),
    SERVICE_FAST_EXPERIMENT_CONFIG_PATH,
  );
  const inputConstruction = record(config['inputConstruction'], 'inputConstruction');
  const runtimeClosure = parseExperimentInputRuntimeClosure(
    inputConstruction['runtimeClosure'],
  );
  const commandManifestBytes = Uint8Array.from(
    await dependencies.readFile(runtimeClosure.commandManifest.path),
  );
  verifyExperimentInputCommandManifest(
    runtimeClosure.commandManifest,
    commandManifestBytes,
  );
  const verifiedBytes = new Map<string, Uint8Array>();
  const verifyNamedDescriptors = async (value: unknown, artifact: string): Promise<void> => {
    for (const [name, rawBinding] of Object.entries(record(value, artifact))) {
      const binding = descriptor(rawBinding, `${artifact}.${name}`);
      const prior = verifiedBytes.get(binding.path);
      if (prior === undefined) verifiedBytes.set(binding.path, await readVerified(dependencies, binding));
      else if (prior.byteLength !== binding.bytes || sha256(prior) !== binding.sha256) {
        inputFailure('descriptor-conflict', binding.path, `Conflicting descriptor for ${binding.path}.`);
      }
    }
  };

  await verifyNamedDescriptors(config['authorityBindings'], 'authorityBindings');
  const artifactSchemaBinding = descriptor(config['artifactSchema'], 'artifactSchema');
  verifiedBytes.set(
    artifactSchemaBinding.path,
    await readVerified(dependencies, artifactSchemaBinding),
  );
  await verifyNamedDescriptors(config['boundInputs'], 'boundInputs');
  await verifyNamedDescriptors(config['protectedRuntimeSources'], 'protectedRuntimeSources');

  const boundInputs = record(config['boundInputs'], 'boundInputs');
  const boundDocument = (name: string): JsonRecord => {
    const binding = descriptor(boundInputs[name], `boundInputs.${name}`);
    const bytes = verifiedBytes.get(binding.path);
    if (bytes === undefined) inputFailure('missing-bound-input', name, `Missing verified input ${name}.`);
    return record(parseJson(bytes, binding.path), binding.path);
  };
  const requestsDocument = boundDocument('requests');
  const baselineDocument = boundDocument('baselineSemanticResults');
  const eligibilityDocument = boundDocument('baselineEligibility');
  const requestCases = list(requestsDocument['cases'], 'requests.cases');
  const baselineCells = list(baselineDocument['cells'], 'baselineSemanticResults.cells');
  const eligibilityCells = list(eligibilityDocument['cells'], 'baselineEligibility.cells');

  const cohorts = record(config['cohorts'], 'cohorts');
  const configuredCases = list(cohorts['cases'], 'cohorts.cases');
  sameArray(
    cohorts['caseOrder'],
    configuredCases.map((value, index) =>
      text(record(value, `cohorts.cases[${index}]`)['caseId'], `cohorts.cases[${index}].caseId`),
    ),
    'cohorts.caseOrder',
  );
  if (
    configuredCases.length !== SNAPSHOT_BINDING_NAMES.length ||
    requestCases.length !== configuredCases.length
  ) {
    inputFailure('case-count-mismatch', 'cohorts.cases', 'Configured and request case counts differ.');
  }

  const cases: ExperimentInputCaseSource[] = [];
  for (let caseIndex = 0; caseIndex < configuredCases.length; caseIndex += 1) {
    const configured = record(configuredCases[caseIndex], `cohorts.cases[${caseIndex}]`);
    const requestCase = record(requestCases[caseIndex], `requests.cases[${caseIndex}]`);
    const snapshotBindingName = SNAPSHOT_BINDING_NAMES[caseIndex];
    if (snapshotBindingName === undefined) {
      inputFailure('snapshot-binding-missing', String(caseIndex), 'Snapshot binding is missing.');
    }
    const snapshotBinding = descriptor(
      boundInputs[snapshotBindingName],
      `boundInputs.${snapshotBindingName}`,
    );
    const snapshotBytes = verifiedBytes.get(snapshotBinding.path);
    if (snapshotBytes === undefined) {
      inputFailure('snapshot-binding-missing', snapshotBinding.path, 'Verified snapshot bytes are missing.');
    }
    const caseId = text(configured['caseId'], `cohorts.cases[${caseIndex}].caseId`);
    const snapshotId = text(configured['snapshotId'], `cohorts.cases[${caseIndex}].snapshotId`);
    const snapshotChecksum = text(
      configured['snapshotChecksum'],
      `cohorts.cases[${caseIndex}].snapshotChecksum`,
    );
    if (
      requestCase['caseId'] !== caseId ||
      requestCase['snapshotId'] !== snapshotId ||
      requestCase['snapshotChecksum'] !== snapshotChecksum
    ) {
      inputFailure('request-case-identity-mismatch', caseId, `Request case identity mismatch for ${caseId}.`);
    }
    const requests = list(requestCase['requests'], `requests.${caseId}`).map((value, index) =>
      requestSource(value, `requests.${caseId}[${index}]`),
    );
    if (requests.length !== positiveInteger(configured['requestCount'], `${caseId}.requestCount`)) {
      inputFailure('request-count-mismatch', caseId, `Request count mismatch for ${caseId}.`);
    }
    cases.push(
      Object.freeze({
        caseId,
        snapshotId,
        snapshotChecksum,
        serviceDecision: boolean(configured['serviceDecision'], `${caseId}.serviceDecision`),
        operational: boolean(configured['operational'], `${caseId}.operational`),
        snapshot: parseJson(snapshotBytes, snapshotBinding.path),
        requests: Object.freeze(requests),
      }),
    );
  }

  const artifact = record(inputConstruction['inputArtifact'], 'inputConstruction.inputArtifact');
  sameArray(artifact['recordFieldOrder'], INPUT_RECORD_FIELDS, 'inputConstruction.inputArtifact.recordFieldOrder');
  if (
    artifact['schemaVersion'] !== 'routelab.service-fast-numerical-experiment-input.v1' ||
    artifact['candidatePolicyImportsOrCalls'] !== 'forbidden' ||
    artifact['noCandidateOutputsOrTiming'] !== true
  ) {
    inputFailure(
      'frozen-artifact-contract-mismatch',
      'inputConstruction.inputArtifact',
      'The input artifact boundary is not candidate-free.',
    );
  }
  if (
    positiveInteger(artifact['recordCount'], 'inputConstruction.inputArtifact.recordCount') !==
    nonnegativeInteger(record(cohorts['full'], 'cohorts.full')['count'], 'cohorts.full.count')
  ) {
    inputFailure(
      'frozen-artifact-contract-mismatch',
      'inputConstruction.inputArtifact.recordCount',
      'The input artifact record count differs from the full cohort.',
    );
  }
  if (
    record(inputConstruction['workProfile'], 'inputConstruction.workProfile')['profileId'] !==
      'structural-complete' ||
    !isDeepStrictEqual(
      record(record(inputConstruction['workProfile'], 'inputConstruction.workProfile')['workCaps'], 'workCaps'),
      STRUCTURAL_COMPLETE_CAPS,
    ) ||
    !isDeepStrictEqual(record(inputConstruction['request'], 'inputConstruction.request'), STRUCTURAL_REQUEST)
  ) {
    inputFailure('frozen-construction-mismatch', 'inputConstruction', 'Input construction contract changed.');
  }
  const operational = record(cohorts['operational'], 'cohorts.operational');
  return Object.freeze({
    schemaVersion: 'routelab.service-fast-numerical-experiment-input.v1',
    artifactPath: text(artifact['path'], 'inputConstruction.inputArtifact.path'),
    maximumBytes: positiveInteger(artifact['maxBytes'], 'inputConstruction.inputArtifact.maxBytes'),
    runtimeClosure,
    cases: Object.freeze(cases),
    baselineCells,
    eligibilityCells,
    cohorts: Object.freeze({
      full: cohortContract(cohorts['full'], 'cohorts.full'),
      serviceDecision: cohortContract(cohorts['serviceDecision'], 'cohorts.serviceDecision'),
      amplifiedStress: cohortContract(cohorts['amplifiedStress'], 'cohorts.amplifiedStress'),
      priorEligibleBoundOnly: cohortContract(
        cohorts['priorEligibleBoundOnly'],
        'cohorts.priorEligibleBoundOnly',
      ),
      priorEligibleServiceBoundOnly: cohortContract(
        cohorts['priorEligibleServiceBoundOnly'],
        'cohorts.priorEligibleServiceBoundOnly',
      ),
      operational: Object.freeze({
        ...cohortContract(operational, 'cohorts.operational'),
        perCaseCounts: Object.freeze(
          Object.fromEntries(
            Object.entries(record(operational['perCaseCounts'], 'cohorts.operational.perCaseCounts')).map(
              ([caseId, count]) => [caseId, nonnegativeInteger(count, `perCaseCounts.${caseId}`)],
            ),
          ),
        ),
        nonemptyStrataPerCase: Object.freeze(
          Object.fromEntries(
            Object.entries(
              record(operational['nonemptyStrataPerCase'], 'cohorts.operational.nonemptyStrataPerCase'),
            ).map(([caseId, count]) => [
              caseId,
              nonnegativeInteger(count, `nonemptyStrataPerCase.${caseId}`),
            ]),
          ),
        ),
      }),
    }),
  });
}

export function protectedExperimentInputOperations(): ExperimentInputOperations {
  return Object.freeze({
    prepare: (snapshot: unknown) => parseAndPrepareRoutingContext(snapshot),
    route: (context: unknown, request: ProtectedInputRequest, control: ProtectedInputControl) =>
      routeExactInputSplitNumericalAnytime(
        context as PreparedRoutingContext,
        request,
        control,
      ),
    discover: (
      context: unknown,
      request: Parameters<ExperimentInputOperations['discover']>[1],
    ) =>
      discoverSharedRoutes(context as PreparedRoutingContext, request),
    resolve: (
      context: unknown,
      routes: Parameters<ExperimentInputOperations['resolve']>[1],
    ) =>
      resolvePreparedPathShadowPriceRoutes(context as PreparedRoutingContext, routes),
    replay: (
      context: unknown,
      request: Parameters<ExperimentInputOperations['replay']>[1],
    ) =>
      replayPreparedExactInputSplit(context as PreparedRoutingContext, request),
  });
}

interface FlattenedCell {
  readonly sourceIndex: number;
  readonly suiteCase: ExperimentInputCaseSource;
  readonly request: ExperimentInputRequestSource;
  readonly baselineCell: JsonRecord;
  readonly eligibilityCell: JsonRecord;
  readonly timingCohortIndex: number | null;
}

function identity(caseId: string, requestId: string): object {
  return { caseId, requestId };
}

function identitiesHash(identities: readonly object[]): string {
  return sha256(JSON.stringify(identities));
}

function verifyIdentityCohort(
  identities: readonly object[],
  expected: IdentityCohortContract,
  artifact: string,
): void {
  if (identities.length !== expected.count) {
    inputFailure('cohort-count-mismatch', artifact, `Cohort count mismatch for ${artifact}.`);
  }
  if (identitiesHash(identities) !== expected.sha256) {
    inputFailure('cohort-hash-mismatch', artifact, `Cohort hash mismatch for ${artifact}.`);
  }
}

function projectPriorEligibility(cell: JsonRecord, artifact: string): object {
  const status = text(cell['status'], `${artifact}.status`);
  if (status !== 'eligible' && status !== 'ineligible') {
    inputFailure('eligibility-status-invalid', artifact, `Invalid eligibility status at ${artifact}.`);
  }
  let reason: string | null;
  if (status === 'eligible') {
    if (cell['reason'] !== undefined && cell['reason'] !== null) {
      inputFailure('eligibility-reason-invalid', artifact, `Eligible cell has a reason at ${artifact}.`);
    }
    reason = null;
  } else {
    reason = text(cell['reason'], `${artifact}.reason`);
    if (reason !== 'baseline-no-authorized-incumbent' && reason !== 'no-model-valid-candidate-set') {
      inputFailure('eligibility-reason-invalid', artifact, `Invalid eligibility reason at ${artifact}.`);
    }
  }
  const search = record(cell['search'], `${artifact}.search`);
  const pathTermination = text(search['pathTermination'], `${artifact}.search.pathTermination`);
  const candidateSetTermination = text(
    search['candidateSetTermination'],
    `${artifact}.search.candidateSetTermination`,
  );
  if (
    (pathTermination !== 'complete' && pathTermination !== 'work-limit') ||
    (candidateSetTermination !== 'complete' && candidateSetTermination !== 'work-limit')
  ) {
    inputFailure('eligibility-termination-invalid', artifact, `Invalid eligibility termination at ${artifact}.`);
  }
  return {
    status,
    reason,
    search: {
      pathExpansions: nonnegativeInteger(search['pathExpansions'], `${artifact}.search.pathExpansions`),
      enumeratedPaths: nonnegativeInteger(search['enumeratedPaths'], `${artifact}.search.enumeratedPaths`),
      pathTermination,
      candidateSetExpansions: nonnegativeInteger(
        search['candidateSetExpansions'],
        `${artifact}.search.candidateSetExpansions`,
      ),
      enumeratedCandidateSets: nonnegativeInteger(
        search['enumeratedCandidateSets'],
        `${artifact}.search.enumeratedCandidateSets`,
      ),
      candidateSetTermination,
    },
    modelValidCandidateSetCount: nonnegativeInteger(
      cell['modelValidCandidateSetCount'],
      `${artifact}.modelValidCandidateSetCount`,
    ),
  };
}

function snapshotIdentity(snapshot: unknown, artifact: string): Readonly<{
  snapshotId: string;
  snapshotChecksum: string;
}> {
  const parsed = record(snapshot, artifact);
  return Object.freeze({
    snapshotId: text(parsed['snapshotId'], `${artifact}.snapshotId`),
    snapshotChecksum: text(parsed['snapshotChecksum'], `${artifact}.snapshotChecksum`),
  });
}

function validateSourceAndCohorts(source: ExperimentInputSource): readonly FlattenedCell[] {
  const cells: Omit<FlattenedCell, 'timingCohortIndex'>[] = [];
  const seenCases = new Set<string>();
  for (const suiteCase of source.cases) {
    if (seenCases.has(suiteCase.caseId)) {
      inputFailure('duplicate-case', suiteCase.caseId, `Duplicate case ${suiteCase.caseId}.`);
    }
    seenCases.add(suiteCase.caseId);
    const snapshot = snapshotIdentity(suiteCase.snapshot, suiteCase.caseId);
    if (
      snapshot.snapshotId !== suiteCase.snapshotId ||
      snapshot.snapshotChecksum !== suiteCase.snapshotChecksum
    ) {
      inputFailure('snapshot-identity-mismatch', suiteCase.caseId, `Snapshot identity mismatch for ${suiteCase.caseId}.`);
    }
    for (const request of suiteCase.requests) {
      const sourceIndex = cells.length;
      const baselineCell = record(source.baselineCells[sourceIndex], `baselineCells[${sourceIndex}]`);
      const eligibilityCell = record(
        source.eligibilityCells[sourceIndex],
        `eligibilityCells[${sourceIndex}]`,
      );
      if (
        baselineCell['caseId'] !== suiteCase.caseId ||
        baselineCell['requestId'] !== request.requestId ||
        eligibilityCell['caseId'] !== suiteCase.caseId ||
        eligibilityCell['requestId'] !== request.requestId
      ) {
        inputFailure(
          'source-order-mismatch',
          String(sourceIndex),
          `Request, baseline, and eligibility identities differ at source index ${sourceIndex}.`,
        );
      }
      if (baselineCell['result'] === undefined) {
        inputFailure('baseline-result-missing', String(sourceIndex), `Baseline result is missing at ${sourceIndex}.`);
      }
      projectPriorEligibility(eligibilityCell, `eligibilityCells[${sourceIndex}]`);
      cells.push(Object.freeze({ sourceIndex, suiteCase, request, baselineCell, eligibilityCell }));
    }
  }
  if (
    cells.length !== source.baselineCells.length ||
    cells.length !== source.eligibilityCells.length
  ) {
    inputFailure('source-length-mismatch', 'source', 'Request, baseline, and eligibility lengths differ.');
  }

  const full = cells.map(({ suiteCase, request }) => identity(suiteCase.caseId, request.requestId));
  const service = cells
    .filter(({ suiteCase }) => suiteCase.serviceDecision)
    .map(({ suiteCase, request }) => identity(suiteCase.caseId, request.requestId));
  const amplified = cells
    .filter(({ suiteCase }) => !suiteCase.serviceDecision)
    .map(({ suiteCase, request }) => identity(suiteCase.caseId, request.requestId));
  const priorEligible = cells
    .filter(({ eligibilityCell }) => eligibilityCell['status'] === 'eligible')
    .map(({ suiteCase, request }) => identity(suiteCase.caseId, request.requestId));
  const priorEligibleService = cells
    .filter(
      ({ suiteCase, eligibilityCell }) =>
        suiteCase.serviceDecision && eligibilityCell['status'] === 'eligible',
    )
    .map(({ suiteCase, request }) => identity(suiteCase.caseId, request.requestId));
  verifyIdentityCohort(full, source.cohorts.full, 'full');
  verifyIdentityCohort(service, source.cohorts.serviceDecision, 'serviceDecision');
  verifyIdentityCohort(amplified, source.cohorts.amplifiedStress, 'amplifiedStress');
  verifyIdentityCohort(priorEligible, source.cohorts.priorEligibleBoundOnly, 'priorEligibleBoundOnly');
  verifyIdentityCohort(
    priorEligibleService,
    source.cohorts.priorEligibleServiceBoundOnly,
    'priorEligibleServiceBoundOnly',
  );

  const stratumCounts = new Map<string, number>();
  const strataByCase = new Map<string, Set<string>>();
  const timingSourceIndexes: number[] = [];
  for (const cell of cells) {
    if (!cell.suiteCase.operational) continue;
    const localStratum = `${cell.request.topology}\u0000${cell.request.amountBucket}`;
    const stratum = `${cell.suiteCase.caseId}\u0000${localStratum}`;
    const count = stratumCounts.get(stratum) ?? 0;
    stratumCounts.set(stratum, count + 1);
    const caseStrata = strataByCase.get(cell.suiteCase.caseId) ?? new Set<string>();
    caseStrata.add(localStratum);
    strataByCase.set(cell.suiteCase.caseId, caseStrata);
    if (count < 12) timingSourceIndexes.push(cell.sourceIndex);
  }
  const timingIndexBySource = new Map(
    timingSourceIndexes.map((sourceIndex, timingIndex) => [sourceIndex, timingIndex]),
  );
  const timingIdentities = timingSourceIndexes.map((sourceIndex) => {
    const cell = cells[sourceIndex];
    if (cell === undefined) inputFailure('timing-index-invalid', String(sourceIndex), 'Timing index is invalid.');
    return identity(cell.suiteCase.caseId, cell.request.requestId);
  });
  verifyIdentityCohort(timingIdentities, source.cohorts.operational, 'operational');
  for (const suiteCase of source.cases.filter(({ operational }) => operational)) {
    const selectedCount = timingSourceIndexes.filter(
      (sourceIndex) => cells[sourceIndex]?.suiteCase.caseId === suiteCase.caseId,
    ).length;
    if (selectedCount !== source.cohorts.operational.perCaseCounts[suiteCase.caseId]) {
      inputFailure('timing-case-count-mismatch', suiteCase.caseId, `Timing count mismatch for ${suiteCase.caseId}.`);
    }
    if (
      (strataByCase.get(suiteCase.caseId)?.size ?? 0) !==
      source.cohorts.operational.nonemptyStrataPerCase[suiteCase.caseId]
    ) {
      inputFailure('timing-strata-mismatch', suiteCase.caseId, `Timing strata mismatch for ${suiteCase.caseId}.`);
    }
  }
  return Object.freeze(
    cells.map((cell) =>
      Object.freeze({
        ...cell,
        timingCohortIndex: timingIndexBySource.get(cell.sourceIndex) ?? null,
      }),
    ),
  );
}

function protectedSearch(result: NumericalExactInputSplitRuntimeResult): Readonly<{
  termination: string;
}> {
  if (result.status === 'success') return result.plan.search;
  if (result.status === 'no-route' || result.status === 'no-plan') return result.search;
  inputFailure('protected-result-invalid', result.status, `Protected reference returned ${result.status}.`);
}

function freshReplayRequest(receipt: ExactInputSplitReplayReceipt): Readonly<{
  snapshotId: string;
  snapshotChecksum: string;
  assetIn: string;
  assetOut: string;
  amountIn: bigint;
  legs: readonly Readonly<{ allocation: bigint; route: readonly DirectionalHopInput[] }>[];
}> {
  return Object.freeze({
    snapshotId: receipt.snapshotId,
    snapshotChecksum: receipt.snapshotChecksum,
    assetIn: receipt.assetIn,
    assetOut: receipt.assetOut,
    amountIn: receipt.amountIn,
    legs: Object.freeze(
      receipt.legs.map((leg) =>
        Object.freeze({
          allocation: leg.allocation,
          route: Object.freeze(
            leg.receipt.hops.map((hop) =>
              Object.freeze({
                assetIn: hop.assetIn,
                poolId: hop.poolId,
                assetOut: hop.assetOut,
              }),
            ),
          ),
        }),
      ),
    ),
  });
}

function projectCandidateSet(
  setIndex: number,
  routes: readonly (readonly DirectionalHopInput[])[],
  resolution: ReturnType<ExperimentInputOperations['resolve']>,
): object {
  let projectedRoutes: object[];
  if (resolution.ok) {
    if (
      resolution.value.length !== routes.length ||
      resolution.value.some((resolvedRoute, routeIndex) =>
        resolvedRoute.length !== routes[routeIndex]?.length,
      )
    ) {
      inputFailure('model-resolution-shape-mismatch', String(setIndex), 'Resolved model shape differs from routes.');
    }
    projectedRoutes = routes.map((route, routeIndex) => ({
      routeKey: canonicalRouteKey(route),
      hops: route.map((hop) => ({
        poolId: hop.poolId,
        assetIn: hop.assetIn,
        assetOut: hop.assetOut,
      })),
      resolvedHops: route.map((hop, hopIndex) => {
        const resolved = resolution.value[routeIndex]?.[hopIndex];
        if (resolved === undefined) {
          inputFailure('model-resolution-shape-mismatch', String(setIndex), 'Resolved hop is missing.');
        }
        return {
          poolId: hop.poolId,
          assetIn: hop.assetIn,
          assetOut: hop.assetOut,
          reserveIn: resolved.reserveIn.toString(10),
          reserveOut: resolved.reserveOut.toString(10),
          feeChargedNumerator: resolved.feeChargedNumerator.toString(10),
          feeDenominator: resolved.feeDenominator.toString(10),
        };
      }),
    }));
  } else {
    projectedRoutes = routes.map((route) => ({
      routeKey: canonicalRouteKey(route),
      hops: route.map((hop) => ({
        poolId: hop.poolId,
        assetIn: hop.assetIn,
        assetOut: hop.assetOut,
      })),
      resolvedHops: null,
    }));
  }
  return {
    setIndex,
    candidateSetKey: canonicalCandidateSetKey(routes),
    routes: projectedRoutes,
    resolutionStatus: resolution.ok ? 'resolved' : 'failed',
    failureCode: resolution.ok ? null : 'invalid-route-model',
  };
}

export async function streamExperimentInputRecords(
  source: ExperimentInputSource,
  operations: ExperimentInputOperations,
  sink: ExperimentInputSink,
): Promise<ExperimentInputBuildSummary> {
  const cells = validateSourceAndCohorts(source);
  const contexts = new Map<string, unknown>();
  for (const suiteCase of source.cases) {
    const prepared = operations.prepare(suiteCase.snapshot);
    if (!prepared.ok) {
      inputFailure('snapshot-preparation-failed', suiteCase.caseId, `Snapshot preparation failed for ${suiteCase.caseId}.`);
    }
    contexts.set(suiteCase.caseId, prepared.value);
  }

  let bytesWritten = 0;
  const outputHash = createHash('sha256');
  for (const cell of cells) {
    const context = contexts.get(cell.suiteCase.caseId);
    if (context === undefined) {
      inputFailure('prepared-context-missing', cell.suiteCase.caseId, 'Prepared context is missing.');
    }
    const amountIn = BigInt(cell.request.amountIn);
    const protectedRequest: ProtectedInputRequest = Object.freeze({
      snapshotId: cell.suiteCase.snapshotId,
      snapshotChecksum: cell.suiteCase.snapshotChecksum,
      assetIn: cell.request.assetIn,
      assetOut: cell.request.assetOut,
      amountIn,
      ...STRUCTURAL_REQUEST,
      numerical: PROTECTED_NUMERICAL_CONFIGURATION,
    });
    const result = operations.route(
      context,
      protectedRequest,
      Object.freeze({ workCaps: Object.freeze({ ...STRUCTURAL_COMPLETE_CAPS }) }),
    );
    if (protectedSearch(result).termination !== 'complete') {
      inputFailure(
        'protected-reference-incomplete',
        String(cell.sourceIndex),
        `Protected reference did not complete at source index ${cell.sourceIndex}.`,
      );
    }
    let projectedResult: object;
    try {
      projectedResult = projectProtectedBaselineResult(result);
    } catch (error) {
      inputFailure(
        'protected-result-invalid',
        String(cell.sourceIndex),
        error instanceof Error ? error.message : 'Protected result is invalid.',
      );
    }
    if (!isDeepStrictEqual(projectedResult, cell.baselineCell['result'])) {
      inputFailure(
        'baseline-parity-mismatch',
        String(cell.sourceIndex),
        `Complete protected result differs from the bound baseline at ${cell.sourceIndex}.`,
      );
    }
    if (result.status === 'success') {
      const replay = operations.replay(context, freshReplayRequest(result.plan.receipt));
      if (!replay.ok || !isDeepStrictEqual(replay.value, result.plan.receipt)) {
        inputFailure(
          'fresh-exact-replay-mismatch',
          String(cell.sourceIndex),
          `Fresh exact replay differs at source index ${cell.sourceIndex}.`,
        );
      }
    }
    if (
      result.status !== 'success' &&
      result.status !== 'no-route' &&
      result.status !== 'no-plan'
    ) {
      inputFailure('protected-result-invalid', String(cell.sourceIndex), 'Protected result cannot become an incumbent.');
    }

    const discovery = operations.discover(context, {
      snapshotId: cell.suiteCase.snapshotId,
      snapshotChecksum: cell.suiteCase.snapshotChecksum,
      assetIn: cell.request.assetIn,
      assetOut: cell.request.assetOut,
      maxHops: STRUCTURAL_REQUEST.maxHops,
      maxPathExpansions: STRUCTURAL_COMPLETE_CAPS.maxPathExpansions,
      maxRoutes: STRUCTURAL_REQUEST.maxRoutes,
      maxCandidateSetExpansions: STRUCTURAL_COMPLETE_CAPS.maxCandidateSetExpansions,
    });
    if (!discovery.ok) {
      inputFailure('candidate-discovery-failed', String(cell.sourceIndex), `Discovery failed at ${cell.sourceIndex}.`);
    }
    if (
      discovery.value.search.pathTermination !== 'complete' ||
      discovery.value.search.candidateSetTermination !== 'complete'
    ) {
      inputFailure(
        'candidate-discovery-incomplete',
        String(cell.sourceIndex),
        `Structural discovery did not complete at ${cell.sourceIndex}.`,
      );
    }
    const retainedSets = discovery.value.candidateSets.slice(0, 4);
    const candidateSets: object[] = [];
    let repairTargetSetIndex: number | null = null;
    for (let setIndex = 0; setIndex < retainedSets.length; setIndex += 1) {
      const candidateSet = retainedSets[setIndex];
      if (candidateSet === undefined) {
        inputFailure('candidate-set-missing', String(setIndex), 'Candidate set is missing.');
      }
      const resolution = operations.resolve(context, candidateSet.routes);
      candidateSets.push(projectCandidateSet(setIndex, candidateSet.routes, resolution));
      if (resolution.ok && repairTargetSetIndex === null) repairTargetSetIndex = setIndex;
    }

    const entryBaseline = {
      boundSemanticCellHash: sha256(JSON.stringify(cell.baselineCell)),
      freshReplayMatchesBoundCell: true,
      incumbent: projectExactIncumbent(result),
    };
    const outputRecord = {
      schemaVersion: source.schemaVersion,
      sourceIndex: cell.sourceIndex,
      caseId: cell.suiteCase.caseId,
      requestId: cell.request.requestId,
      snapshot: {
        snapshotId: cell.suiteCase.snapshotId,
        snapshotChecksum: cell.suiteCase.snapshotChecksum,
      },
      request: {
        assetIn: cell.request.assetIn,
        assetOut: cell.request.assetOut,
        amountBucket: cell.request.amountBucket,
        amountIn: cell.request.amountIn,
        topology: cell.request.topology,
        maxHops: STRUCTURAL_REQUEST.maxHops,
        maxRoutes: STRUCTURAL_REQUEST.maxRoutes,
        greedyParts: STRUCTURAL_REQUEST.greedyParts,
      },
      priorEligibility: projectPriorEligibility(
        cell.eligibilityCell,
        `eligibilityCells[${cell.sourceIndex}]`,
      ),
      serviceDecisionMember: cell.suiteCase.serviceDecision,
      amplifiedStressMember: !cell.suiteCase.serviceDecision,
      timingCohortIndex: cell.timingCohortIndex,
      entryBaseline,
      candidateDiscovery: {
        termination: 'complete',
        counters: {
          pathExpansions: discovery.value.search.pathExpansions,
          enumeratedPaths: discovery.value.search.enumeratedPaths,
          candidateSetExpansions: discovery.value.search.candidateSetExpansions,
          enumeratedCandidateSets: discovery.value.search.enumeratedCandidateSets,
        },
        candidateSets,
      },
      repairTargetSetIndex,
      actionCeilingProfileId: 'structural-complete',
    };
    sameArray(Object.keys(outputRecord), INPUT_RECORD_FIELDS, `record[${cell.sourceIndex}] fields`);
    const encoded = encodeCanonicalNdjsonRecord(outputRecord);
    const nextBytes = bytesWritten + encoded.byteLength;
    if (!Number.isSafeInteger(nextBytes) || nextBytes > source.maximumBytes) {
      inputFailure('artifact-cap-exceeded', source.artifactPath, 'Input artifact exceeds its byte cap.');
    }
    await sink.write(encoded);
    outputHash.update(encoded);
    bytesWritten = nextBytes;
  }
  if (cells.length !== source.cohorts.full.count) {
    inputFailure('record-count-mismatch', source.artifactPath, 'Input record count differs from the frozen cohort.');
  }
  return Object.freeze({
    recordCount: cells.length,
    bytes: bytesWritten,
    sha256: `sha256:${outputHash.digest('hex')}`,
  });
}
