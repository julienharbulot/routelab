import { createHash } from 'node:crypto';
import { readFile as defaultReadFile } from 'node:fs/promises';
import { Session } from 'node:inspector/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { isMainThread } from 'node:worker_threads';

import {
  routeExactInputSplitNumericalAnytime,
  type NumericalExactInputSplitRuntimeResult,
  type NumericalExactInputSplitWorkCaps,
  type NumericalExactInputSplitWorkCounters,
} from '../../router/numerical-exact-input-split/index.ts';
import {
  projectCanonicalSplitRouterResult,
  projectCanonicalSplitRouterWorkCounters,
} from '../../serialization/canonical-split-router-result/index.ts';
import {
  CANONICAL_HISTORICAL_COMPOSED_SPLIT_EVALUATION_DIRECTORY,
  verifyHistoricalComposedSplitEvaluationWithVerifiedCorpus,
} from '../historical-composed-split/index.ts';
import {
  CANONICAL_HISTORICAL_NUMERICAL_SPLIT_EVALUATION_DIRECTORY,
  verifyHistoricalNumericalSplitEvaluation,
} from '../historical-numerical-split/index.ts';
import {
  CANONICAL_SYNTHETIC_REQUEST_CORPUS_DIRECTORY,
  verifySyntheticRequestCorpus,
  type SyntheticExactInputRequest,
} from '../../verification/synthetic-request-corpus/index.ts';

export const CANONICAL_NUMERICAL_BASELINE_PROFILE_CONFIG_PATH =
  'fixtures/m7/numerical-baseline-profile/profile-config.v1.json';

export const CANONICAL_HISTORICAL_NUMERICAL_BASELINE_PROFILE_DIRECTORY =
  'datasets/profiles/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/synthetic-exhaustive-v1/numerical-path-shadow-price-baseline-v1';

export const NUMERICAL_BASELINE_PROFILE_CONFIG_SHA256 =
  'sha256:894aca8f1c402a5677582f18db3d24de40f199141dca284fac75aef945438349';

export const NUMERICAL_BASELINE_PROFILE_CONFIG_BYTES = 10_435;
export const NUMERICAL_BASELINE_PROFILE_EVIDENCE_REVISION =
  '694be6f32c3aadc38f5b7f8eba68edde52e737e6';

const EXPECTED_NODE_VERSION = 'v24.18.0';
const EXPECTED_V8_VERSION = '13.6.233.17-node.50';
const PROFILE_ID = 'm7b-core12-synthetic-exhaustive-numerical-baseline-profile-v1';
const M7_SEMANTIC_PATH = path.join(
  CANONICAL_HISTORICAL_NUMERICAL_SPLIT_EVALUATION_DIRECTORY,
  'semantic-results.json',
);

const ARTIFACT_NAMES = Object.freeze([
  'semantic-work.json',
  'timing-observations.json',
  'cpu-profile-observations.json',
  'analysis.json',
  'manifest.json',
] as const);

const COUNTER_FIELDS = Object.freeze([
  'directCandidates',
  'directCandidateReplays',
  'directCandidateRejections',
  'pathExpansions',
  'bestSingleCandidateReplays',
  'bestSingleCandidateRejections',
  'candidateSetExpansions',
  'equalProposalReplays',
  'equalProposalRejections',
  'greedyOptionReplays',
  'greedyOptionRejections',
  'finalAuthorizationReplays',
  'finalAuthorizationRejections',
  'numericalProposals',
  'numericalProposalFailures',
  'numericalIterations',
  'numericalResidualReplays',
  'numericalResidualReplayRejections',
  'numericalAuthorizationReplays',
  'numericalAuthorizationReplayRejections',
] as const);

const SOURCE_PATHS = Object.freeze([
  'src/benchmark/historical-numerical-profile/index.ts',
  'cli/run-historical-numerical-profile.ts',
  'cli/verify-historical-numerical-profile.ts',
  'package.json',
] as const);

type JsonRecord = Record<string, unknown>;
type ArtifactName = (typeof ARTIFACT_NAMES)[number];
type CounterField = (typeof COUNTER_FIELDS)[number];
type SweepOrder = 'forward' | 'reverse';

interface ArtifactDescriptor {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

interface FrozenProfileConfig extends JsonRecord {
  readonly schemaVersion: 'routelab.numerical-baseline-profile-config.v1';
  readonly profileConfigId: string;
  readonly inputBinding: JsonRecord;
  readonly cohort: JsonRecord;
  readonly runtime: JsonRecord;
  readonly observationProtocol: JsonRecord;
  readonly attribution: JsonRecord;
  readonly decision: JsonRecord;
  readonly limitations: readonly string[];
}

interface ExpectedCell {
  readonly requestId: string;
  readonly profileId: string;
  readonly request: JsonRecord;
  readonly workCaps: NumericalExactInputSplitWorkCaps;
  readonly result: JsonRecord;
  readonly semanticHash: string;
}

interface NormalizedProfileNode {
  readonly id: string;
  readonly callFrame: {
    readonly functionName: string;
    readonly scriptId: string;
    readonly url: string;
    readonly lineNumber: string;
    readonly columnNumber: string;
  };
  readonly hitCount?: string;
  readonly children?: readonly string[];
  readonly deoptReason?: string;
  readonly positionTicks?: readonly {
    readonly line: string;
    readonly ticks: string;
  }[];
}

interface NormalizedCpuProfile {
  readonly nodes: readonly NormalizedProfileNode[];
  readonly startTime: string;
  readonly endTime: string;
  readonly samples: readonly string[];
  readonly timeDeltas: readonly string[];
}

interface CpuProfileRecord {
  readonly profileIndex: number;
  readonly sweepOrder: SweepOrder;
  readonly callCount: number;
  readonly profile: NormalizedCpuProfile;
  readonly runtimeRootMembership: readonly boolean[];
  readonly leafCategories: readonly string[];
}

interface ObservationEnvironment extends JsonRecord {
  readonly nodeVersion: string;
  readonly v8Version: string;
  readonly uvVersion: string;
  readonly platform: string;
  readonly arch: string;
  readonly endianness: string;
  readonly osType: string;
  readonly osRelease: string;
  readonly cpuModel: string;
  readonly cpuSpeedMHz: number;
  readonly logicalCpuCount: number;
  readonly availableParallelism: number;
  readonly totalMemoryBytes: string;
  readonly execArgv: readonly string[];
  readonly nodeOptionsState: 'unset' | 'empty';
  readonly mainThread: true;
}

export type HistoricalNumericalProfileErrorCode =
  | 'config-read-failed'
  | 'config-size-mismatch'
  | 'config-hash-mismatch'
  | 'invalid-config-json'
  | 'invalid-config-shape'
  | 'evidence-revision-mismatch'
  | 'bound-input-read-failed'
  | 'bound-input-size-mismatch'
  | 'bound-input-hash-mismatch'
  | 'corpus-invalid'
  | 'baseline-evaluation-invalid'
  | 'numerical-evaluation-invalid'
  | 'invalid-semantic-results'
  | 'cohort-mismatch'
  | 'environment-mismatch'
  | 'runtime-result-mismatch'
  | 'clock-invalid'
  | 'profiler-connect-failed'
  | 'profiler-enable-failed'
  | 'profiler-configure-failed'
  | 'profiler-start-failed'
  | 'profiler-stop-failed'
  | 'profiler-disable-failed'
  | 'profiler-disconnect-failed'
  | 'invalid-cpu-profile'
  | 'unsafe-profile-path'
  | 'resource-cap-exceeded'
  | 'artifact-read-failed'
  | 'artifact-size-mismatch'
  | 'artifact-hash-mismatch'
  | 'invalid-artifact-json'
  | 'invalid-artifact-shape'
  | 'semantic-reconstruction-mismatch'
  | 'observation-schedule-mismatch'
  | 'analysis-reconstruction-mismatch'
  | 'manifest-reconstruction-mismatch'
  | 'source-read-failed';

export interface HistoricalNumericalProfileError {
  readonly code: HistoricalNumericalProfileErrorCode;
  readonly artifact: string;
  readonly message: string;
}

export interface HistoricalNumericalProfileArtifacts {
  readonly files: Readonly<Record<ArtifactName, string>>;
  readonly summary: HistoricalNumericalProfileSummary;
}

export interface HistoricalNumericalProfileSummary {
  readonly schemaVersion: 'routelab.numerical-baseline-profile-summary.v1';
  readonly profileId: string;
  readonly profileConfigSha256: string;
  readonly eligibleCellCount: number;
  readonly totalNumericalCalls: number;
  readonly timingSampleCount: number;
  readonly cpuProfileCount: number;
  readonly semanticWorkSha256: string;
  readonly timingObservationsSha256: string;
  readonly cpuProfileObservationsSha256: string;
  readonly analysisSha256: string;
  readonly recommendation: string;
}

export type HistoricalNumericalProfileGenerationResult =
  | { readonly ok: true; readonly value: HistoricalNumericalProfileArtifacts }
  | { readonly ok: false; readonly error: HistoricalNumericalProfileError };

export type HistoricalNumericalProfileVerificationResult =
  | { readonly ok: true; readonly value: HistoricalNumericalProfileSummary }
  | { readonly ok: false; readonly error: HistoricalNumericalProfileError };

export interface HistoricalNumericalProfileReadDependencies {
  readonly readFile: (filePath: string) => Promise<Uint8Array>;
}

export interface HistoricalNumericalProfileClock {
  readonly now: () => bigint;
}

export interface HistoricalNumericalProfileProfiler {
  readonly connect: () => void | Promise<void>;
  readonly enable: () => Promise<void>;
  readonly setSamplingInterval: (microseconds: number) => Promise<void>;
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<unknown>;
  readonly disable: () => Promise<void>;
  readonly disconnect: () => void | Promise<void>;
}

export interface HistoricalNumericalProfileGenerationDependencies
  extends HistoricalNumericalProfileReadDependencies {
  readonly repositoryRoot: string;
  readonly evidenceRevision: string;
  readonly clock?: HistoricalNumericalProfileClock;
  readonly profiler?: HistoricalNumericalProfileProfiler;
  readonly environment?: ObservationEnvironment;
}

class ProfileAbort extends Error {
  readonly code: HistoricalNumericalProfileErrorCode;
  readonly artifact: string;

  constructor(code: HistoricalNumericalProfileErrorCode, artifact: string) {
    super(code);
    this.code = code;
    this.artifact = artifact;
  }
}

function failure(
  code: HistoricalNumericalProfileErrorCode,
  artifact: string,
): { readonly ok: false; readonly error: HistoricalNumericalProfileError } {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code,
      artifact,
      message: `Historical numerical baseline profile failed at ${artifact}.`,
    }),
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isCanonicalNonnegativeInteger(value: unknown): value is string {
  return typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(value)
    && Number.isSafeInteger(Number(value));
}

function isCanonicalSignedInteger(value: unknown): value is string {
  return typeof value === 'string' && /^(?:0|-?[1-9][0-9]*)$/u.test(value)
    && Number.isSafeInteger(Number(value));
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function hasOnlyKeys(value: JsonRecord, allowed: readonly string[], required: readonly string[]): boolean {
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) && keys.every((key) => allowed.includes(key));
}

function sha256(value: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function descriptor(relativePath: string, value: string): ArtifactDescriptor {
  return Object.freeze({
    path: relativePath,
    bytes: Buffer.byteLength(value, 'utf8'),
    sha256: sha256(value),
  });
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as JsonRecord)) deepFreeze(nested);
  return Object.freeze(value);
}

async function safeRead(
  readFile: (filePath: string) => Promise<Uint8Array>,
  filePath: string,
): Promise<Uint8Array | undefined> {
  try {
    return Uint8Array.from(await readFile(filePath));
  } catch {
    return undefined;
  }
}

function cachedDependencies(
  dependencies: HistoricalNumericalProfileReadDependencies,
): HistoricalNumericalProfileReadDependencies {
  const cache = new Map<string, Promise<Uint8Array>>();
  return Object.freeze({
    readFile(filePath: string): Promise<Uint8Array> {
      let pending = cache.get(filePath);
      if (pending === undefined) {
        pending = Promise.resolve().then(() => dependencies.readFile(filePath));
        cache.set(filePath, pending);
      }
      return pending.then((bytes) => Uint8Array.from(bytes));
    },
  });
}

function parseUtf8Json(bytes: Uint8Array): { readonly text: string; readonly value: unknown } | undefined {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return Object.freeze({ text, value: JSON.parse(text) as unknown });
  } catch {
    return undefined;
  }
}

function hasFrozenConfigShape(value: unknown): value is FrozenProfileConfig {
  if (!isRecord(value)) return false;
  return value['schemaVersion'] === 'routelab.numerical-baseline-profile-config.v1'
    && value['profileConfigId'] === 'm7b-core12-synthetic-exhaustive-numerical-baseline-profile-config-v1'
    && isRecord(value['inputBinding'])
    && isRecord(value['cohort'])
    && isRecord(value['runtime'])
    && isRecord(value['observationProtocol'])
    && isRecord(value['attribution'])
    && isRecord(value['decision'])
    && Array.isArray(value['limitations']);
}

async function readFrozenConfig(
  dependencies: HistoricalNumericalProfileReadDependencies,
): Promise<FrozenProfileConfig> {
  const bytes = await safeRead(dependencies.readFile, CANONICAL_NUMERICAL_BASELINE_PROFILE_CONFIG_PATH);
  if (bytes === undefined) throw new ProfileAbort('config-read-failed', CANONICAL_NUMERICAL_BASELINE_PROFILE_CONFIG_PATH);
  return validateFrozenProfileConfigBytes(bytes) as FrozenProfileConfig;
}

export function validateFrozenProfileConfigBytes(bytes: Uint8Array): Readonly<JsonRecord> {
  if (bytes.byteLength !== NUMERICAL_BASELINE_PROFILE_CONFIG_BYTES) {
    throw new ProfileAbort('config-size-mismatch', CANONICAL_NUMERICAL_BASELINE_PROFILE_CONFIG_PATH);
  }
  if (sha256(bytes) !== NUMERICAL_BASELINE_PROFILE_CONFIG_SHA256) {
    throw new ProfileAbort('config-hash-mismatch', CANONICAL_NUMERICAL_BASELINE_PROFILE_CONFIG_PATH);
  }
  const parsed = parseUtf8Json(bytes);
  if (parsed === undefined) throw new ProfileAbort('invalid-config-json', CANONICAL_NUMERICAL_BASELINE_PROFILE_CONFIG_PATH);
  if (!hasFrozenConfigShape(parsed.value) || parsed.text !== canonicalJson(parsed.value)) {
    throw new ProfileAbort('invalid-config-shape', CANONICAL_NUMERICAL_BASELINE_PROFILE_CONFIG_PATH);
  }
  return deepFreeze(parsed.value);
}

function parseDescriptor(value: unknown): ArtifactDescriptor | undefined {
  if (!isRecord(value)
    || typeof value['path'] !== 'string'
    || !isSafeNonnegativeInteger(value['bytes'])
    || !isSha256(value['sha256'])) return undefined;
  return Object.freeze({ path: value['path'], bytes: value['bytes'], sha256: value['sha256'] });
}

function boundInputDescriptors(config: FrozenProfileConfig): readonly ArtifactDescriptor[] {
  const binding = config.inputBinding;
  const m6 = binding['m6Baseline'];
  const m7 = binding['m7NumericalEvaluation'];
  const runtime = config.runtime;
  if (!isRecord(m6) || !isRecord(m7) || !isRecord(runtime['source'])) {
    throw new ProfileAbort('invalid-config-shape', 'inputBinding');
  }
  const candidates = [
    binding['datasetManifest'], binding['snapshotArtifact'], binding['corpusManifest'],
    binding['corpusRequests'], m6['comparisonConfig'], m6['observationConfig'],
    m6['evaluationManifest'], m6['semanticResults'], m7['comparisonConfig'],
    m7['eligibility'], m7['forcedFailureEvidence'], m7['evaluationManifest'],
    m7['semanticResults'], runtime['source'],
  ];
  const values = candidates.map(parseDescriptor);
  if (values.some((value) => value === undefined)) {
    throw new ProfileAbort('invalid-config-shape', 'inputBinding/artifacts');
  }
  return Object.freeze(values as ArtifactDescriptor[]);
}

async function verifyBoundInputs(
  dependencies: HistoricalNumericalProfileReadDependencies,
  config: FrozenProfileConfig,
): Promise<void> {
  for (const artifact of boundInputDescriptors(config)) {
    const bytes = await safeRead(dependencies.readFile, artifact.path);
    if (bytes === undefined) throw new ProfileAbort('bound-input-read-failed', artifact.path);
    if (bytes.byteLength !== artifact.bytes) throw new ProfileAbort('bound-input-size-mismatch', artifact.path);
    if (sha256(bytes) !== artifact.sha256) throw new ProfileAbort('bound-input-hash-mismatch', artifact.path);
  }
}

function actualProfiler(): HistoricalNumericalProfileProfiler {
  const session = new Session();
  return Object.freeze({
    connect(): void { session.connect(); },
    enable(): Promise<void> { return session.post('Profiler.enable'); },
    setSamplingInterval(microseconds: number): Promise<void> {
      return session.post('Profiler.setSamplingInterval', { interval: microseconds });
    },
    start(): Promise<void> { return session.post('Profiler.start'); },
    async stop(): Promise<unknown> { return (await session.post('Profiler.stop')).profile; },
    disable(): Promise<void> { return session.post('Profiler.disable'); },
    disconnect(): void { session.disconnect(); },
  });
}

function captureEnvironment(): ObservationEnvironment {
  const nodeOptions = process.env['NODE_OPTIONS'];
  if (process.version !== EXPECTED_NODE_VERSION || process.versions.v8 !== EXPECTED_V8_VERSION
    || process.execArgv.length !== 0 || (nodeOptions !== undefined && nodeOptions !== '')
    || !isMainThread) throw new ProfileAbort('environment-mismatch', 'environment');
  const cpus = os.cpus();
  const first = cpus[0];
  if (first === undefined || cpus.length === 0 || !isSafeNonnegativeInteger(first.speed)) {
    throw new ProfileAbort('environment-mismatch', 'environment/cpu');
  }
  return deepFreeze({
    nodeVersion: process.version,
    v8Version: process.versions.v8,
    uvVersion: process.versions.uv,
    platform: process.platform,
    arch: process.arch,
    endianness: os.endianness(),
    osType: os.type(),
    osRelease: os.release(),
    cpuModel: first.model,
    cpuSpeedMHz: first.speed,
    logicalCpuCount: cpus.length,
    availableParallelism: os.availableParallelism(),
    totalMemoryBytes: os.totalmem().toString(10),
    execArgv: Object.freeze([...process.execArgv]),
    nodeOptionsState: nodeOptions === undefined ? 'unset' : 'empty',
    mainThread: true,
  });
}

function validateEnvironment(value: unknown): value is ObservationEnvironment {
  if (!isRecord(value)) return false;
  const exactKeys = [
    'nodeVersion', 'v8Version', 'uvVersion', 'platform', 'arch', 'endianness', 'osType',
    'osRelease', 'cpuModel', 'cpuSpeedMHz', 'logicalCpuCount', 'availableParallelism',
    'totalMemoryBytes', 'execArgv', 'nodeOptionsState', 'mainThread',
  ];
  if (!isDeepStrictEqual(Object.keys(value), exactKeys)) return false;
  return typeof value['nodeVersion'] === 'string'
    && typeof value['v8Version'] === 'string'
    && typeof value['uvVersion'] === 'string'
    && typeof value['platform'] === 'string'
    && typeof value['arch'] === 'string'
    && typeof value['endianness'] === 'string'
    && typeof value['osType'] === 'string'
    && typeof value['osRelease'] === 'string'
    && typeof value['cpuModel'] === 'string'
    && isSafeNonnegativeInteger(value['cpuSpeedMHz'])
    && isSafeNonnegativeInteger(value['logicalCpuCount']) && value['logicalCpuCount'] > 0
    && isSafeNonnegativeInteger(value['availableParallelism']) && value['availableParallelism'] > 0
    && isCanonicalNonnegativeInteger(value['totalMemoryBytes'])
    && Array.isArray(value['execArgv']) && value['execArgv'].length === 0
    && (value['nodeOptionsState'] === 'unset' || value['nodeOptionsState'] === 'empty')
    && value['mainThread'] === true;
}

function projectNumericalCounters(counters: NumericalExactInputSplitWorkCounters): object {
  return {
    ...projectCanonicalSplitRouterWorkCounters(counters),
    numericalProposals: counters.numericalProposals,
    numericalProposalFailures: counters.numericalProposalFailures,
    numericalIterations: counters.numericalIterations,
    numericalResidualReplays: counters.numericalResidualReplays,
    numericalResidualReplayRejections: counters.numericalResidualReplayRejections,
    numericalAuthorizationReplays: counters.numericalAuthorizationReplays,
    numericalAuthorizationReplayRejections: counters.numericalAuthorizationReplayRejections,
  };
}

function projectDiagnostic(diagnostic: Extract<
  NumericalExactInputSplitRuntimeResult,
  { readonly status: 'success' }
>['plan']['search']['numericalDiagnostics'][number]): object {
  return {
    candidateSetKey: diagnostic.candidateSetKey,
    routeKeys: diagnostic.routeKeys,
    status: diagnostic.status,
    failureCode: diagnostic.failureCode,
    converged: diagnostic.converged,
    completedOuterIterations: diagnostic.completedOuterIterations,
    configuredInnerIterations: diagnostic.configuredInnerIterations,
    residualUnits: diagnostic.residualUnits === null ? null : diagnostic.residualUnits.toString(10),
    counters: {
      numericalProposals: diagnostic.counters.numericalProposals,
      numericalProposalFailures: diagnostic.counters.numericalProposalFailures,
      numericalIterations: diagnostic.counters.numericalIterations,
      numericalResidualReplays: diagnostic.counters.numericalResidualReplays,
      numericalResidualReplayRejections: diagnostic.counters.numericalResidualReplayRejections,
      numericalAuthorizationReplays: diagnostic.counters.numericalAuthorizationReplays,
      numericalAuthorizationReplayRejections:
        diagnostic.counters.numericalAuthorizationReplayRejections,
    },
  };
}

function projectNumericalResult(
  result: Extract<NumericalExactInputSplitRuntimeResult, { readonly status: 'success' }>,
): JsonRecord {
  const canonical = projectCanonicalSplitRouterResult(result) as { readonly plan: JsonRecord };
  return {
    status: 'success',
    plan: {
      receipt: canonical.plan['receipt'],
      search: {
        counters: projectNumericalCounters(result.plan.search.counters),
        termination: result.plan.search.termination,
        numericalDiagnostics: result.plan.search.numericalDiagnostics.map(projectDiagnostic),
      },
    },
  };
}

function parseExpectedCells(value: unknown): readonly ExpectedCell[] {
  if (!isRecord(value)
    || value['schemaVersion'] !== 'routelab.numerical-historical-semantic-results.v1'
    || !Array.isArray(value['cells']) || value['cells'].length !== 2_376) {
    throw new ProfileAbort('invalid-semantic-results', 'semantic-results.json');
  }
  const cells: ExpectedCell[] = [];
  for (const unknownCell of value['cells']) {
    if (!isRecord(unknownCell) || !isRecord(unknownCell['eligibility'])) {
      throw new ProfileAbort('invalid-semantic-results', 'semantic-results/cell');
    }
    if (unknownCell['eligibility']['status'] !== 'eligible') continue;
    const request = unknownCell['request'];
    const profile = unknownCell['profile'];
    const result = unknownCell['result'];
    if (!isRecord(request) || !isRecord(profile) || !isRecord(profile['workCaps'])
      || !isRecord(result) || typeof request['requestId'] !== 'string'
      || typeof profile['profileId'] !== 'string' || !isSha256(unknownCell['semanticHash'])) {
      throw new ProfileAbort('invalid-semantic-results', 'semantic-results/eligible-cell');
    }
    const capNames = [
      'maxPathExpansions', 'maxBestSingleCandidateReplays', 'maxCandidateSetExpansions',
      'maxEqualProposalReplays', 'maxGreedyOptionReplays', 'maxFinalAuthorizationReplays',
      'maxNumericalProposals', 'maxNumericalIterations', 'maxNumericalResidualReplays',
      'maxNumericalAuthorizationReplays',
    ] as const;
    const parsedCaps: Record<string, number> = {};
    for (const name of capNames) {
      if (!isSafeNonnegativeInteger(profile['workCaps'][name])) {
        throw new ProfileAbort('invalid-semantic-results', `semantic-results/workCaps/${name}`);
      }
      parsedCaps[name] = profile['workCaps'][name];
    }
    cells.push(deepFreeze({
      requestId: request['requestId'],
      profileId: profile['profileId'],
      request,
      workCaps: parsedCaps as unknown as NumericalExactInputSplitWorkCaps,
      result,
      semanticHash: unknownCell['semanticHash'],
    }));
  }
  if (cells.length !== 414) throw new ProfileAbort('cohort-mismatch', 'semantic-results/eligible-count');
  return Object.freeze(cells);
}

function buildRequest(cell: ExpectedCell, request: SyntheticExactInputRequest): Parameters<
  typeof routeExactInputSplitNumericalAnytime
>[1] {
  if (request.requestId !== cell.requestId
    || cell.request['assetIn'] !== request.assetIn
    || cell.request['assetOut'] !== request.assetOut
    || cell.request['amountIn'] !== request.amountIn.toString(10)) {
    throw new ProfileAbort('cohort-mismatch', `${cell.requestId}/${cell.profileId}`);
  }
  return Object.freeze({
    snapshotId: 'ethereum-mainnet-uniswap-v2-block-19000000-core12-v1',
    snapshotChecksum: 'sha256:5d21166cf218997776efc23b203c2f70637b1fb822807fb236bfc6fd0bf3e755',
    assetIn: request.assetIn,
    assetOut: request.assetOut,
    amountIn: request.amountIn,
    maxHops: 2,
    maxRoutes: 2,
    greedyParts: 16,
    numerical: Object.freeze({
      outerIterations: 64,
      innerIterations: 64,
      convergenceTolerance: 2 ** -40,
    }),
  });
}

function assertResultParity(
  result: NumericalExactInputSplitRuntimeResult,
  cell: ExpectedCell,
): Extract<NumericalExactInputSplitRuntimeResult, { readonly status: 'success' }> {
  if (result.status !== 'success' || !isDeepStrictEqual(projectNumericalResult(result), cell.result)) {
    throw new ProfileAbort('runtime-result-mismatch', `${cell.requestId}/${cell.profileId}`);
  }
  return result;
}

function countersFromExpected(cell: ExpectedCell): Readonly<Record<CounterField, number>> {
  const plan = cell.result['plan'];
  if (!isRecord(plan) || !isRecord(plan['search']) || !isRecord(plan['search']['counters'])) {
    throw new ProfileAbort('invalid-semantic-results', `${cell.requestId}/${cell.profileId}/counters`);
  }
  const counters: Partial<Record<CounterField, number>> = {};
  for (const field of COUNTER_FIELDS) {
    const current = plan['search']['counters'][field];
    if (!isSafeNonnegativeInteger(current)) {
      throw new ProfileAbort('invalid-semantic-results', `${cell.requestId}/${cell.profileId}/${field}`);
    }
    counters[field] = current;
  }
  return Object.freeze(counters) as Readonly<Record<CounterField, number>>;
}

function diagnosticsFromExpected(cell: ExpectedCell): readonly unknown[] {
  const plan = cell.result['plan'];
  if (!isRecord(plan) || !isRecord(plan['search']) || !Array.isArray(plan['search']['numericalDiagnostics'])) {
    throw new ProfileAbort('invalid-semantic-results', `${cell.requestId}/${cell.profileId}/diagnostics`);
  }
  return plan['search']['numericalDiagnostics'];
}

function buildSemanticWork(config: FrozenProfileConfig, cells: readonly ExpectedCell[]): JsonRecord {
  const totals = Object.fromEntries(COUNTER_FIELDS.map((field) => [field, 0])) as Record<CounterField, number>;
  const maxima = Object.fromEntries(COUNTER_FIELDS.map((field) => [field, 0])) as Record<CounterField, number>;
  const projectedCells = cells.map((cell, cohortIndex) => {
    const counters = countersFromExpected(cell);
    for (const field of COUNTER_FIELDS) {
      const next = totals[field] + counters[field];
      if (!Number.isSafeInteger(next)) throw new ProfileAbort('invalid-semantic-results', `counter-total/${field}`);
      totals[field] = next;
      maxima[field] = Math.max(maxima[field], counters[field]);
    }
    const diagnostics = diagnosticsFromExpected(cell);
    return {
      cohortIndex,
      requestId: cell.requestId,
      profileId: cell.profileId,
      semanticHash: cell.semanticHash,
      resultSha256: sha256(JSON.stringify(cell.result)),
      counters,
      numericalDiagnosticCount: diagnostics.length,
      numericalDiagnosticsSha256: sha256(JSON.stringify(diagnostics)),
    };
  });
  return {
    schemaVersion: 'routelab.numerical-baseline-profile-semantic-work.v1',
    profileId: PROFILE_ID,
    inputBinding: {
      profileConfigSha256: NUMERICAL_BASELINE_PROFILE_CONFIG_SHA256,
      acceptedEvidenceRevision: NUMERICAL_BASELINE_PROFILE_EVIDENCE_REVISION,
      numericalSemanticResults:
        (config.inputBinding['m7NumericalEvaluation'] as JsonRecord)['semanticResults'] !== undefined
          ? (config.inputBinding['m7NumericalEvaluation'] as JsonRecord)['semanticResults']
          : null,
    },
    cohort: {
      order: 'eligibility-source-cell-order',
      eligibleCellCount: cells.length,
      cells: projectedCells,
    },
    work: {
      kindsRemainSeparate: true,
      counterFields: COUNTER_FIELDS,
      counterTotals: totals,
      counterMaxima: maxima,
    },
  };
}

function decimalInteger(value: number, artifact: string): string {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw new ProfileAbort('invalid-cpu-profile', artifact);
  }
  return value.toString(10);
}

function decimalSignedInteger(value: number, artifact: string): string {
  if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
    throw new ProfileAbort('invalid-cpu-profile', artifact);
  }
  return value.toString(10);
}

function normalizeUrl(url: string, repositoryRoot: string): string {
  if (url.startsWith('file:')) {
    let absolute: string;
    try {
      absolute = fileURLToPath(url);
    } catch {
      throw new ProfileAbort('unsafe-profile-path', 'cpu-profile/url');
    }
    const relative = path.relative(path.resolve(repositoryRoot), path.resolve(absolute));
    if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new ProfileAbort('unsafe-profile-path', 'cpu-profile/url');
    }
    return relative.split(path.sep).join('/');
  }
  if (path.isAbsolute(url) || /^[A-Za-z]:[\\/]/u.test(url)) {
    throw new ProfileAbort('unsafe-profile-path', 'cpu-profile/url');
  }
  return url;
}

function normalizeProfileNode(value: unknown, repositoryRoot: string): NormalizedProfileNode {
  if (!isRecord(value)
    || !hasOnlyKeys(
      value,
      ['id', 'callFrame', 'hitCount', 'children', 'deoptReason', 'positionTicks'],
      ['id', 'callFrame'],
    )
    || !isSafeNonnegativeInteger(value['id']) || !isRecord(value['callFrame'])) {
    throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile/node');
  }
  const frame = value['callFrame'];
  if (!hasOnlyKeys(
    frame,
    ['functionName', 'scriptId', 'url', 'lineNumber', 'columnNumber'],
    ['functionName', 'scriptId', 'url', 'lineNumber', 'columnNumber'],
  ) || typeof frame['functionName'] !== 'string' || typeof frame['scriptId'] !== 'string'
    || typeof frame['url'] !== 'string' || typeof frame['lineNumber'] !== 'number'
    || !Number.isSafeInteger(frame['lineNumber']) || typeof frame['columnNumber'] !== 'number'
    || !Number.isSafeInteger(frame['columnNumber'])) {
    throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile/call-frame');
  }
  const node: {
    id: string;
    callFrame: NormalizedProfileNode['callFrame'];
    hitCount?: string;
    children?: readonly string[];
    deoptReason?: string;
    positionTicks?: readonly { readonly line: string; readonly ticks: string }[];
  } = {
    id: decimalInteger(value['id'], 'cpu-profile/node/id'),
    callFrame: {
      functionName: frame['functionName'],
      scriptId: frame['scriptId'],
      url: normalizeUrl(frame['url'], repositoryRoot),
      lineNumber: decimalSignedInteger(frame['lineNumber'], 'cpu-profile/call-frame/line'),
      columnNumber: decimalSignedInteger(frame['columnNumber'], 'cpu-profile/call-frame/column'),
    },
  };
  if (value['hitCount'] !== undefined) {
    if (!isSafeNonnegativeInteger(value['hitCount'])) throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile/hit-count');
    node.hitCount = decimalInteger(value['hitCount'], 'cpu-profile/hit-count');
  }
  if (value['children'] !== undefined) {
    if (!Array.isArray(value['children'])) throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile/children');
    node.children = Object.freeze(value['children'].map((child) => {
      if (!isSafeNonnegativeInteger(child)) throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile/child');
      return decimalInteger(child, 'cpu-profile/child');
    }));
  }
  if (value['deoptReason'] !== undefined) {
    if (typeof value['deoptReason'] !== 'string') throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile/deopt-reason');
    node.deoptReason = value['deoptReason'];
  }
  if (value['positionTicks'] !== undefined) {
    if (!Array.isArray(value['positionTicks'])) throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile/position-ticks');
    node.positionTicks = Object.freeze(value['positionTicks'].map((tick) => {
      if (!isRecord(tick) || !hasOnlyKeys(tick, ['line', 'ticks'], ['line', 'ticks'])
        || !isSafeNonnegativeInteger(tick['line']) || !isSafeNonnegativeInteger(tick['ticks'])) {
        throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile/position-tick');
      }
      return Object.freeze({
        line: decimalInteger(tick['line'], 'cpu-profile/position-tick/line'),
        ticks: decimalInteger(tick['ticks'], 'cpu-profile/position-tick/ticks'),
      });
    }));
  }
  return deepFreeze(node);
}

export function normalizeCpuProfile(
  value: unknown,
  repositoryRoot: string,
  maxSamples: number,
  maxNodes: number,
): NormalizedCpuProfile {
  if (!isRecord(value) || !hasOnlyKeys(
    value,
    ['nodes', 'startTime', 'endTime', 'samples', 'timeDeltas'],
    ['nodes', 'startTime', 'endTime', 'samples', 'timeDeltas'],
  ) || !Array.isArray(value['nodes'])
    || !isSafeNonnegativeInteger(value['startTime']) || !isSafeNonnegativeInteger(value['endTime'])
    || !Array.isArray(value['samples']) || !Array.isArray(value['timeDeltas'])
    || value['samples'].length === 0 || value['samples'].length !== value['timeDeltas'].length
    || value['samples'].length > maxSamples || value['nodes'].length > maxNodes) {
    throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile');
  }
  if (value['endTime'] < value['startTime']) {
    throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile/time-range');
  }
  const nodes = Object.freeze(value['nodes'].map((node) => normalizeProfileNode(node, repositoryRoot)));
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length) throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile/node-ids');
  const samples = Object.freeze((value['samples'] as unknown[]).map((sample) => {
    if (!isSafeNonnegativeInteger(sample)) throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile/sample');
    const id = decimalInteger(sample, 'cpu-profile/sample');
    if (!ids.has(id)) throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile/sample-reference');
    return id;
  }));
  const timeDeltas = Object.freeze((value['timeDeltas'] as unknown[]).map((delta) => {
    if (!isSafeNonnegativeInteger(delta)) throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile/time-delta');
    return decimalInteger(delta, 'cpu-profile/time-delta');
  }));
  for (const node of nodes) {
    for (const child of node.children ?? []) {
      if (!ids.has(child)) throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile/child-reference');
    }
  }
  return deepFreeze({
    nodes,
    startTime: decimalInteger(value['startTime'], 'cpu-profile/start-time'),
    endTime: decimalInteger(value['endTime'], 'cpu-profile/end-time'),
    samples,
    timeDeltas,
  });
}

export function validateNormalizedCpuProfile(
  value: unknown,
  maxSamples: number,
  maxNodes: number,
): NormalizedCpuProfile {
  if (!isRecord(value) || !hasOnlyKeys(
    value,
    ['nodes', 'startTime', 'endTime', 'samples', 'timeDeltas'],
    ['nodes', 'startTime', 'endTime', 'samples', 'timeDeltas'],
  ) || !Array.isArray(value['nodes']) || !Array.isArray(value['samples'])
    || !Array.isArray(value['timeDeltas']) || value['samples'].length === 0
    || value['samples'].length !== value['timeDeltas'].length
    || value['samples'].length > maxSamples || value['nodes'].length > maxNodes
    || !isCanonicalNonnegativeInteger(value['startTime'])
    || !isCanonicalNonnegativeInteger(value['endTime'])) {
    throw new ProfileAbort('invalid-artifact-shape', 'cpu-profile-observations.json/profile');
  }
  const ids = new Set<string>();
  for (const unknownNode of value['nodes'] as unknown[]) {
    const node: unknown = unknownNode;
    if (!isRecord(node) || !hasOnlyKeys(
      node,
      ['id', 'callFrame', 'hitCount', 'children', 'deoptReason', 'positionTicks'],
      ['id', 'callFrame'],
    ) || !isCanonicalNonnegativeInteger(node['id']) || !isRecord(node['callFrame'])) {
      throw new ProfileAbort('invalid-artifact-shape', 'cpu-profile-observations.json/node');
    }
    if (ids.has(node['id'])) throw new ProfileAbort('invalid-artifact-shape', 'cpu-profile-observations.json/node-id');
    ids.add(node['id']);
    const frame = node['callFrame'];
    if (!hasOnlyKeys(
      frame,
      ['functionName', 'scriptId', 'url', 'lineNumber', 'columnNumber'],
      ['functionName', 'scriptId', 'url', 'lineNumber', 'columnNumber'],
    ) || typeof frame['functionName'] !== 'string' || typeof frame['scriptId'] !== 'string'
      || typeof frame['url'] !== 'string' || frame['url'].startsWith('file:') || path.isAbsolute(frame['url'])
      || !isCanonicalSignedInteger(frame['lineNumber'])
      || !isCanonicalSignedInteger(frame['columnNumber'])) {
      throw new ProfileAbort('unsafe-profile-path', 'cpu-profile-observations.json/url');
    }
    if (node['hitCount'] !== undefined && !isCanonicalNonnegativeInteger(node['hitCount'])) {
      throw new ProfileAbort('invalid-artifact-shape', 'cpu-profile-observations.json/hit-count');
    }
    if (node['children'] !== undefined && (!Array.isArray(node['children'])
      || !(node['children'] as unknown[]).every(isCanonicalNonnegativeInteger))) {
      throw new ProfileAbort('invalid-artifact-shape', 'cpu-profile-observations.json/children');
    }
    if (node['deoptReason'] !== undefined && typeof node['deoptReason'] !== 'string') {
      throw new ProfileAbort('invalid-artifact-shape', 'cpu-profile-observations.json/deopt-reason');
    }
    if (node['positionTicks'] !== undefined && (!Array.isArray(node['positionTicks'])
      || !(node['positionTicks'] as unknown[]).every((tick) => isRecord(tick)
        && hasOnlyKeys(tick, ['line', 'ticks'], ['line', 'ticks'])
        && isCanonicalNonnegativeInteger(tick['line'])
        && isCanonicalNonnegativeInteger(tick['ticks'])))) {
      throw new ProfileAbort('invalid-artifact-shape', 'cpu-profile-observations.json/position-ticks');
    }
  }
  if (!(value['samples'] as unknown[]).every(isCanonicalNonnegativeInteger)
    || !(value['timeDeltas'] as unknown[]).every(isCanonicalNonnegativeInteger)) {
    throw new ProfileAbort('invalid-artifact-shape', 'cpu-profile-observations.json/samples');
  }
  if (Number(value['endTime']) < Number(value['startTime'])) {
    throw new ProfileAbort('invalid-artifact-shape', 'cpu-profile-observations.json/time-range');
  }
  for (const node of value['nodes'] as JsonRecord[]) {
    for (const child of (node['children'] as readonly string[] | undefined) ?? []) {
      if (!ids.has(child)) throw new ProfileAbort('invalid-artifact-shape', 'cpu-profile-observations.json/child-reference');
    }
  }
  for (const sample of value['samples'] as string[]) {
    if (!ids.has(sample)) throw new ProfileAbort('invalid-artifact-shape', 'cpu-profile-observations.json/sample-reference');
  }
  return value as unknown as NormalizedCpuProfile;
}

interface AttributionCategory {
  readonly id: string;
  readonly functionNames?: readonly string[];
  readonly paths?: readonly string[];
  readonly pathPrefixes?: readonly string[];
  readonly pathFunctionNames?: readonly string[];
  readonly urlPrefixes?: readonly string[];
  readonly fallback?: boolean;
}

function parseCategories(config: FrozenProfileConfig): readonly AttributionCategory[] {
  const categories = config.attribution['categories'];
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new ProfileAbort('invalid-config-shape', 'attribution/categories');
  }
  return Object.freeze(categories.map((category) => {
    if (!isRecord(category) || typeof category['id'] !== 'string') {
      throw new ProfileAbort('invalid-config-shape', 'attribution/category');
    }
    return category as unknown as AttributionCategory;
  }));
}

function categoryForNode(node: NormalizedProfileNode, categories: readonly AttributionCategory[]): string {
  for (const category of categories) {
    if (category.fallback === true) return category.id;
    const frame = node.callFrame;
    if (category.functionNames?.includes(frame.functionName) === true
      || category.pathFunctionNames?.includes(frame.functionName) === true
      || category.paths?.includes(frame.url) === true
      || category.pathPrefixes?.some((prefix) => frame.url.startsWith(prefix)) === true
      || category.urlPrefixes?.some((prefix) => frame.url.startsWith(prefix)) === true) return category.id;
  }
  throw new ProfileAbort('invalid-config-shape', 'attribution/fallback');
}

function annotateProfile(
  profile: NormalizedCpuProfile,
  config: FrozenProfileConfig,
): { readonly membership: readonly boolean[]; readonly categories: readonly string[] } {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map<string, string>();
  for (const node of profile.nodes) {
    for (const child of node.children ?? []) {
      if (parents.has(child)) throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile/multiple-parents');
      parents.set(child, node.id);
    }
  }
  const categories = parseCategories(config);
  const membership: boolean[] = [];
  const leafCategories: string[] = [];
  for (const sample of profile.samples) {
    const leaf = nodes.get(sample);
    if (leaf === undefined) throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile/sample-reference');
    leafCategories.push(categoryForNode(leaf, categories));
    let current: NormalizedProfileNode | undefined = leaf;
    const visited = new Set<string>();
    let withinRoot = false;
    while (current !== undefined) {
      if (visited.has(current.id)) throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile/cycle');
      visited.add(current.id);
      if (current.callFrame.url === 'src/router/numerical-exact-input-split/index.ts'
        && current.callFrame.functionName === 'routeExactInputSplitNumericalAnytime') withinRoot = true;
      const parent = parents.get(current.id);
      current = parent === undefined ? undefined : nodes.get(parent);
    }
    membership.push(withinRoot);
  }
  return Object.freeze({ membership: Object.freeze(membership), categories: Object.freeze(leafCategories) });
}

export function attributeNormalizedCpuProfile(
  profile: NormalizedCpuProfile,
  configValue: unknown,
): { readonly membership: readonly boolean[]; readonly categories: readonly string[] } {
  if (!hasFrozenConfigShape(configValue)) {
    throw new ProfileAbort('invalid-config-shape', 'attribution/config');
  }
  return annotateProfile(profile, configValue);
}

export function deriveNumericalBaselineProfileRecommendation(
  leaders: readonly (string | null)[],
  candidateSetExpansions: number,
): 'design-one-sound-candidate-set-pruning-experiment' | 'decline-sound-pruning-selection-from-this-profile' {
  if (!isSafeNonnegativeInteger(candidateSetExpansions)) {
    throw new ProfileAbort('invalid-artifact-shape', 'semantic-work/candidate-set-work');
  }
  return leaders.length === 3
    && leaders.every((leader) => leader === 'candidate-set-discovery')
    && candidateSetExpansions > 0
    ? 'design-one-sound-candidate-set-pruning-experiment'
    : 'decline-sound-pruning-selection-from-this-profile';
}

function resourceCaps(config: FrozenProfileConfig): JsonRecord {
  const protocol = config.observationProtocol;
  if (!isRecord(protocol['resourceCaps'])) throw new ProfileAbort('invalid-config-shape', 'resourceCaps');
  return protocol['resourceCaps'];
}

function requiredCap(config: FrozenProfileConfig, name: string): number {
  const value = resourceCaps(config)[name];
  if (!isSafeNonnegativeInteger(value)) throw new ProfileAbort('invalid-config-shape', `resourceCaps/${name}`);
  return value;
}

function buildAnalysis(
  config: FrozenProfileConfig,
  semanticWork: JsonRecord,
  records: readonly CpuProfileRecord[],
): JsonRecord {
  const categoryIds = parseCategories(config).map((category) => category.id);
  const analyses = records.map((record) => {
    const all = Object.fromEntries(categoryIds.map((id) => [id, { samples: 0, microseconds: 0 }])) as Record<
      string,
      { samples: number; microseconds: number }
    >;
    const within = Object.fromEntries(categoryIds.map((id) => [id, { samples: 0, microseconds: 0 }])) as Record<
      string,
      { samples: number; microseconds: number }
    >;
    let total = 0;
    let withinTotal = 0;
    for (let index = 0; index < record.profile.samples.length; index += 1) {
      const category = record.leafCategories[index];
      const delta = Number(record.profile.timeDeltas[index]);
      const inRoot = record.runtimeRootMembership[index];
      if (category === undefined || inRoot === undefined || !Number.isSafeInteger(delta)) {
        throw new ProfileAbort('invalid-cpu-profile', `cpu-profile/${record.profileIndex}/sample`);
      }
      const allCurrent = all[category];
      if (allCurrent === undefined) throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile/category');
      allCurrent.samples += 1;
      allCurrent.microseconds += delta;
      total += delta;
      if (inRoot) {
        const withinCurrent = within[category];
        if (withinCurrent === undefined) throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile/category');
        withinCurrent.samples += 1;
        withinCurrent.microseconds += delta;
        withinTotal += delta;
      }
    }
    if (![total, withinTotal, ...Object.values(all).flatMap((value) => [value.samples, value.microseconds]),
      ...Object.values(within).flatMap((value) => [value.samples, value.microseconds])]
      .every(Number.isSafeInteger)) throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile/attribution-overflow');
    const withinCategories = categoryIds.map((id) => ({
      id,
      sampleCount: within[id]?.samples ?? 0,
      sampledMicroseconds: within[id]?.microseconds ?? 0,
    }));
    const maximum = Math.max(...withinCategories.map((value) => value.sampledMicroseconds));
    const leaders = withinCategories.filter((value) => value.sampledMicroseconds === maximum);
    return {
      profileIndex: record.profileIndex,
      sweepOrder: record.sweepOrder,
      totalSampleCount: record.profile.samples.length,
      totalSampledMicroseconds: total,
      runtimeRootSampleCount: record.runtimeRootMembership.filter(Boolean).length,
      runtimeRootSampledMicroseconds: withinTotal,
      categories: categoryIds.map((id) => ({
        id,
        allSamples: all[id]?.samples ?? 0,
        allSampledMicroseconds: all[id]?.microseconds ?? 0,
        withinRuntimeRootSamples: within[id]?.samples ?? 0,
        withinRuntimeRootSampledMicroseconds: within[id]?.microseconds ?? 0,
      })),
      strictUniqueWithinRuntimeRootLeader: leaders.length === 1 ? leaders[0]?.id ?? null : null,
    };
  });
  const work = semanticWork['work'];
  if (!isRecord(work) || !isRecord(work['counterTotals'])
    || !isSafeNonnegativeInteger(work['counterTotals']['candidateSetExpansions'])) {
    throw new ProfileAbort('invalid-artifact-shape', 'semantic-work/candidate-set-work');
  }
  const positiveWork = work['counterTotals']['candidateSetExpansions'] > 0;
  const leaders = analyses.map((current) => current.strictUniqueWithinRuntimeRootLeader);
  const allCandidate = leaders.length === 3 && leaders.every((leader) =>
    leader === 'candidate-set-discovery');
  const recommendation = deriveNumericalBaselineProfileRecommendation(
    leaders,
    work['counterTotals']['candidateSetExpansions'],
  );
  return {
    schemaVersion: 'routelab.numerical-baseline-profile-analysis.v1',
    profileId: PROFILE_ID,
    method: 'leaf-sample-time-delta-first-match',
    timeDeltaUnit: 'microseconds',
    decisionPopulation: 'samples-with-runtime-root-on-stack',
    profiles: analyses,
    decision: {
      method: 'all-three-profiles-same-strict-unique-leader',
      candidateCategory: 'candidate-set-discovery',
      requireAllSemanticParity: true,
      candidateSetExpansions: work['counterTotals']['candidateSetExpansions'],
      positiveCandidateSetWork: positiveWork,
      allThreeProfilesHaveCandidateSetAsStrictUniqueLeader: allCandidate,
      recommendation,
      scope: 'later-proof-oriented-contract-only-no-implementation',
    },
    limitations: config.limitations,
  };
}

function sourceDescriptors(
  sources: Readonly<Record<string, Uint8Array>>,
): Readonly<Record<string, ArtifactDescriptor>> {
  return Object.freeze(Object.fromEntries(SOURCE_PATHS.map((sourcePath) => {
    const bytes = sources[sourcePath];
    if (bytes === undefined) throw new ProfileAbort('source-read-failed', sourcePath);
    return [sourcePath, Object.freeze({ path: sourcePath, bytes: bytes.byteLength, sha256: sha256(bytes) })];
  })));
}

async function readSources(
  dependencies: HistoricalNumericalProfileReadDependencies,
): Promise<Readonly<Record<string, Uint8Array>>> {
  const entries: [string, Uint8Array][] = [];
  for (const sourcePath of SOURCE_PATHS) {
    const bytes = await safeRead(dependencies.readFile, sourcePath);
    if (bytes === undefined) throw new ProfileAbort('source-read-failed', sourcePath);
    entries.push([sourcePath, bytes]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

function buildManifest(
  config: FrozenProfileConfig,
  artifacts: Readonly<Record<Exclude<ArtifactName, 'manifest.json'>, ArtifactDescriptor>>,
  sources: Readonly<Record<string, ArtifactDescriptor>>,
  recommendation: string,
): JsonRecord {
  return {
    schemaVersion: 'routelab.numerical-baseline-profile-manifest.v1',
    profileId: PROFILE_ID,
    inputBinding: {
      profileConfig: {
        path: CANONICAL_NUMERICAL_BASELINE_PROFILE_CONFIG_PATH,
        bytes: NUMERICAL_BASELINE_PROFILE_CONFIG_BYTES,
        sha256: NUMERICAL_BASELINE_PROFILE_CONFIG_SHA256,
      },
      acceptedEvidenceRevision: NUMERICAL_BASELINE_PROFILE_EVIDENCE_REVISION,
      frozenInputs: config.inputBinding,
    },
    runtime: config.runtime,
    observationProtocol: config.observationProtocol,
    attribution: config.attribution,
    sources,
    artifacts,
    counts: {
      eligibleCellCount: 414,
      totalNumericalCalls: 4_554,
      timingSampleCount: 2_070,
      cpuProfileCount: 3,
      profiledCallCount: 1_242,
    },
    recommendation,
    limitations: config.limitations,
  };
}

function createSummary(
  files: Readonly<Record<ArtifactName, string>>,
  recommendation: string,
): HistoricalNumericalProfileSummary {
  return deepFreeze({
    schemaVersion: 'routelab.numerical-baseline-profile-summary.v1',
    profileId: PROFILE_ID,
    profileConfigSha256: NUMERICAL_BASELINE_PROFILE_CONFIG_SHA256,
    eligibleCellCount: 414,
    totalNumericalCalls: 4_554,
    timingSampleCount: 2_070,
    cpuProfileCount: 3,
    semanticWorkSha256: sha256(files['semantic-work.json']),
    timingObservationsSha256: sha256(files['timing-observations.json']),
    cpuProfileObservationsSha256: sha256(files['cpu-profile-observations.json']),
    analysisSha256: sha256(files['analysis.json']),
    recommendation,
  });
}

function orders(length: number, order: SweepOrder): readonly number[] {
  const values = Array.from({ length }, (_, index) => index);
  if (order === 'reverse') values.reverse();
  return Object.freeze(values);
}

export interface FrozenObservationTimingSample {
  readonly sweep: number;
  readonly sweepOrder: SweepOrder;
  readonly order: number;
  readonly cohortIndex: number;
  readonly elapsedNanoseconds: string;
}

export interface FrozenObservationCpuSweep {
  readonly profileIndex: number;
  readonly sweepOrder: SweepOrder;
  readonly callCount: number;
  readonly rawProfile: unknown;
}

export interface FrozenObservationScheduleResult {
  readonly timingSamples: readonly FrozenObservationTimingSample[];
  readonly cpuSweeps: readonly FrozenObservationCpuSweep[];
  readonly totalCallCount: number;
}

/** Exact scheduler with injected seams; tests use tiny inert cells and never historical inputs. */
export async function executeFrozenObservationSchedule<T, R>(
  cells: readonly T[],
  prepare: (cell: T) => () => R,
  validate: (result: R, cell: T) => void,
  clock: HistoricalNumericalProfileClock,
  profiler: HistoricalNumericalProfileProfiler,
): Promise<FrozenObservationScheduleResult> {
  if (cells.length === 0) throw new ProfileAbort('cohort-mismatch', 'observation-schedule');
  let totalCallCount = 0;
  const prepareCall = (cell: T): (() => R) => {
    const call = prepare(cell);
    return () => {
      totalCallCount += 1;
      return call();
    };
  };
  const invoke = (cell: T): R => {
    const call = prepareCall(cell);
    return call();
  };
  for (const cell of cells) validate(invoke(cell), cell);
  for (const index of orders(cells.length, 'forward')) {
    const cell = cells[index];
    if (cell === undefined) throw new ProfileAbort('cohort-mismatch', 'timing-warmup');
    validate(invoke(cell), cell);
  }
  const timingSamples: FrozenObservationTimingSample[] = [];
  const timingOrders = ['forward', 'reverse', 'forward', 'reverse', 'forward'] as const;
  for (let sweep = 0; sweep < timingOrders.length; sweep += 1) {
    const sweepOrder = timingOrders[sweep];
    if (sweepOrder === undefined) throw new ProfileAbort('invalid-config-shape', 'timing-order');
    for (const cohortIndex of orders(cells.length, sweepOrder)) {
      const cell = cells[cohortIndex];
      if (cell === undefined) throw new ProfileAbort('cohort-mismatch', 'timing-sweep');
      const call = prepareCall(cell);
      const start = clock.now();
      const result = call();
      const end = clock.now();
      if (start < 0n || end < start) throw new ProfileAbort('clock-invalid', `${sweep}/${cohortIndex}`);
      validate(result, cell);
      timingSamples.push(Object.freeze({
        sweep,
        sweepOrder,
        order: timingSamples.length % cells.length,
        cohortIndex,
        elapsedNanoseconds: (end - start).toString(10),
      }));
    }
  }

  const cpuSweeps: FrozenObservationCpuSweep[] = [];
  let connected = false;
  let enabled = false;
  let recording = false;
  let primary: ProfileAbort | undefined;
  try {
    try {
      await profiler.connect();
      connected = true;
    } catch {
      throw new ProfileAbort('profiler-connect-failed', 'cpu-profiler');
    }
    try {
      await profiler.enable();
      enabled = true;
    } catch {
      throw new ProfileAbort('profiler-enable-failed', 'cpu-profiler');
    }
    try {
      await profiler.setSamplingInterval(1_000);
    } catch {
      throw new ProfileAbort('profiler-configure-failed', 'cpu-profiler');
    }
    for (const cohortIndex of orders(cells.length, 'forward')) {
      const cell = cells[cohortIndex];
      if (cell === undefined) throw new ProfileAbort('cohort-mismatch', 'profile-warmup');
      validate(invoke(cell), cell);
    }
    const profileOrders = ['forward', 'reverse', 'forward'] as const;
    for (let profileIndex = 0; profileIndex < profileOrders.length; profileIndex += 1) {
      const sweepOrder = profileOrders[profileIndex];
      if (sweepOrder === undefined) throw new ProfileAbort('invalid-config-shape', 'profile-order');
      const prepared = orders(cells.length, sweepOrder).map((cohortIndex) => {
        const cell = cells[cohortIndex];
        if (cell === undefined) throw new ProfileAbort('cohort-mismatch', `cpu-profile/${profileIndex}`);
        return Object.freeze({ cell, call: prepareCall(cell) });
      });
      try {
        await profiler.start();
        recording = true;
      } catch {
        throw new ProfileAbort('profiler-start-failed', `cpu-profile/${profileIndex}`);
      }
      const pending: { readonly cell: T; readonly result: R }[] = [];
      for (const current of prepared) {
        pending.push(Object.freeze({ cell: current.cell, result: current.call() }));
      }
      let rawProfile: unknown;
      try {
        rawProfile = await profiler.stop();
        recording = false;
      } catch {
        throw new ProfileAbort('profiler-stop-failed', `cpu-profile/${profileIndex}`);
      }
      for (const current of pending) validate(current.result, current.cell);
      cpuSweeps.push(Object.freeze({ profileIndex, sweepOrder, callCount: cells.length, rawProfile }));
    }
  } catch (error) {
    primary = error instanceof ProfileAbort
      ? error
      : new ProfileAbort('invalid-cpu-profile', 'cpu-profiler');
  } finally {
    if (recording) {
      try { await profiler.stop(); } catch { /* Preserve the first failure. */ }
    }
    if (enabled) {
      try { await profiler.disable(); } catch {
        primary ??= new ProfileAbort('profiler-disable-failed', 'cpu-profiler');
      }
    }
    if (connected) {
      try { await profiler.disconnect(); } catch {
        primary ??= new ProfileAbort('profiler-disconnect-failed', 'cpu-profiler');
      }
    }
  }
  if (primary !== undefined) throw primary;
  return deepFreeze({ timingSamples, cpuSweeps, totalCallCount });
}

export async function createHistoricalNumericalProfile(
  sourceDependencies: HistoricalNumericalProfileGenerationDependencies,
): Promise<HistoricalNumericalProfileGenerationResult> {
  const dependencies = cachedDependencies(sourceDependencies);
  try {
    if (sourceDependencies.evidenceRevision !== NUMERICAL_BASELINE_PROFILE_EVIDENCE_REVISION) {
      throw new ProfileAbort('evidence-revision-mismatch', 'evidence-revision');
    }
    const config = await readFrozenConfig(dependencies);
    await verifyBoundInputs(dependencies, config);
    const sources = sourceDescriptors(await readSources(dependencies));
    const environment = sourceDependencies.environment ?? captureEnvironment();
    if (!validateEnvironment(environment)) throw new ProfileAbort('environment-mismatch', 'environment');

    const verified = await verifySyntheticRequestCorpus(
      CANONICAL_SYNTHETIC_REQUEST_CORPUS_DIRECTORY,
      { readFile: dependencies.readFile },
    );
    if (!verified.ok) throw new ProfileAbort('corpus-invalid', `corpus/${verified.error.artifact}`);
    const baseline = await verifyHistoricalComposedSplitEvaluationWithVerifiedCorpus(
      CANONICAL_HISTORICAL_COMPOSED_SPLIT_EVALUATION_DIRECTORY,
      { readFile: dependencies.readFile },
      verified.value,
    );
    if (!baseline.ok) {
      throw new ProfileAbort('baseline-evaluation-invalid', `baseline/${baseline.error.artifact}`);
    }
    const semanticBytes = await dependencies.readFile(M7_SEMANTIC_PATH);
    const semantic = parseUtf8Json(semanticBytes);
    if (semantic === undefined) throw new ProfileAbort('invalid-semantic-results', 'semantic-results.json');
    const cells = parseExpectedCells(semantic.value);
    const requests = new Map(verified.value.corpus.requests.map((request) => [request.requestId, request]));
    const prepareCell = (cell: ExpectedCell): (() => NumericalExactInputSplitRuntimeResult) => {
      const request = requests.get(cell.requestId);
      if (request === undefined) throw new ProfileAbort('cohort-mismatch', cell.requestId);
      const runtimeRequest = buildRequest(cell, request);
      const control = Object.freeze({ workCaps: Object.freeze({ ...cell.workCaps }) });
      return () => routeExactInputSplitNumericalAnytime(
        verified.value.context,
        runtimeRequest,
        control,
      );
    };

    const clock = sourceDependencies.clock ?? Object.freeze({ now: () => process.hrtime.bigint() });
    const timingOrders = ['forward', 'reverse', 'forward', 'reverse', 'forward'] as const;
    const profiler = sourceDependencies.profiler ?? actualProfiler();
    const schedule = await executeFrozenObservationSchedule(
      cells,
      prepareCell,
      (result, cell) => { assertResultParity(result, cell); },
      clock,
      profiler,
    );
    if (schedule.totalCallCount !== 4_554) throw new ProfileAbort('observation-schedule-mismatch', 'total-calls');
    const semanticWork = buildSemanticWork(config, cells);
    const timingSamples = schedule.timingSamples.map((sample) => {
      const cell = cells[sample.cohortIndex];
      if (cell === undefined) throw new ProfileAbort('cohort-mismatch', 'timing-sample');
      return {
        ...sample,
        requestId: cell.requestId,
        profileId: cell.profileId,
        semanticHash: cell.semanticHash,
      };
    });
    const cpuRecords = schedule.cpuSweeps.map((sweep) => {
      const normalized = normalizeCpuProfile(
        sweep.rawProfile,
        sourceDependencies.repositoryRoot,
        requiredCap(config, 'maxSamplesPerProfile'),
        requiredCap(config, 'maxNodesPerProfile'),
      );
      const annotations = annotateProfile(normalized, config);
      return deepFreeze({
        profileIndex: sweep.profileIndex,
        sweepOrder: sweep.sweepOrder,
        callCount: sweep.callCount,
        profile: normalized,
        runtimeRootMembership: annotations.membership,
        leafCategories: annotations.categories,
      });
    });

    const timingDocument = {
      schemaVersion: 'routelab.numerical-baseline-profile-timing-observations.v1',
      profileId: PROFILE_ID,
      inputBinding: {
        profileConfigSha256: NUMERICAL_BASELINE_PROFILE_CONFIG_SHA256,
        semanticWorkSha256: sha256(canonicalJson(semanticWork)),
      },
      environment,
      protocol: {
        clock: 'process.hrtime.bigint',
        scope: 'routeExactInputSplitNumericalAnytime-call-only-unprofiled',
        warmupSweeps: 1,
        measuredSweeps: 5,
        sweepOrder: timingOrders,
        sampleCount: timingSamples.length,
        resultCheck: 'outside-timed-region-after-each-call',
      },
      samples: timingSamples,
    };
    const cpuDocument = {
      schemaVersion: 'routelab.numerical-baseline-profile-cpu-observations.v1',
      profileId: PROFILE_ID,
      inputBinding: {
        profileConfigSha256: NUMERICAL_BASELINE_PROFILE_CONFIG_SHA256,
        semanticWorkSha256: sha256(canonicalJson(semanticWork)),
        environmentSha256: sha256(JSON.stringify(environment)),
      },
      profiler: {
        api: 'node:inspector/promises',
        domain: 'Profiler',
        samplingIntervalMicroseconds: 1_000,
        sessionCount: 1,
        recordedProfileCount: cpuRecords.length,
        overhead: 'three-recording-windows-plus-inspector-sampling-and-normalization',
      },
      profiles: cpuRecords,
    };
    const analysis = buildAnalysis(config, semanticWork, cpuRecords);
    const semanticJson = canonicalJson(semanticWork);
    const timingJson = canonicalJson(timingDocument);
    const cpuJson = canonicalJson(cpuDocument);
    const analysisJson = canonicalJson(analysis);
    const capChecks = [
      ['semantic-work.json', semanticJson, 'maxSemanticWorkBytes'],
      ['timing-observations.json', timingJson, 'maxTimingObservationBytes'],
      ['cpu-profile-observations.json', cpuJson, 'maxCpuProfileObservationBytes'],
      ['analysis.json', analysisJson, 'maxAnalysisBytes'],
    ] as const;
    for (const [name, contents, cap] of capChecks) {
      if (Buffer.byteLength(contents, 'utf8') > requiredCap(config, cap)) {
        throw new ProfileAbort('resource-cap-exceeded', name);
      }
    }
    const artifactDescriptors = {
      'semantic-work.json': descriptor('semantic-work.json', semanticJson),
      'timing-observations.json': descriptor('timing-observations.json', timingJson),
      'cpu-profile-observations.json': descriptor('cpu-profile-observations.json', cpuJson),
      'analysis.json': descriptor('analysis.json', analysisJson),
    };
    const decision = analysis['decision'];
    if (!isRecord(decision) || typeof decision['recommendation'] !== 'string') {
      throw new ProfileAbort('invalid-artifact-shape', 'analysis/decision');
    }
    const manifestJson = canonicalJson(buildManifest(
      config,
      artifactDescriptors,
      sources,
      decision['recommendation'],
    ));
    if (Buffer.byteLength(manifestJson, 'utf8') > requiredCap(config, 'maxManifestBytes')) {
      throw new ProfileAbort('resource-cap-exceeded', 'manifest.json');
    }
    const totalBytes = [semanticJson, timingJson, cpuJson, analysisJson, manifestJson]
      .reduce((sum, current) => sum + Buffer.byteLength(current, 'utf8'), 0);
    if (totalBytes > requiredCap(config, 'maxTotalArtifactBytes')) {
      throw new ProfileAbort('resource-cap-exceeded', 'artifact-set');
    }
    const files = deepFreeze({
      'semantic-work.json': semanticJson,
      'timing-observations.json': timingJson,
      'cpu-profile-observations.json': cpuJson,
      'analysis.json': analysisJson,
      'manifest.json': manifestJson,
    });
    return Object.freeze({
      ok: true,
      value: deepFreeze({
        files,
        summary: createSummary(files, decision['recommendation']),
      }),
    });
  } catch (error) {
    if (error instanceof ProfileAbort) return failure(error.code, error.artifact);
    return failure('invalid-artifact-shape', 'generation');
  }
}

function artifactDescriptorsFromManifest(value: unknown): Readonly<Record<Exclude<ArtifactName, 'manifest.json'>, ArtifactDescriptor>> {
  if (!isRecord(value) || !isRecord(value['artifacts'])) {
    throw new ProfileAbort('invalid-artifact-shape', 'manifest.json');
  }
  const artifacts = value['artifacts'];
  const result: Partial<Record<Exclude<ArtifactName, 'manifest.json'>, ArtifactDescriptor>> = {};
  for (const name of ARTIFACT_NAMES.slice(0, -1) as readonly Exclude<ArtifactName, 'manifest.json'>[]) {
    const parsed = parseDescriptor(artifacts[name]);
    if (parsed === undefined || parsed.path !== name) {
      throw new ProfileAbort('invalid-artifact-shape', `manifest.json/${name}`);
    }
    result[name] = parsed;
  }
  return result as Readonly<Record<Exclude<ArtifactName, 'manifest.json'>, ArtifactDescriptor>>;
}

async function readDeclaredArtifact(
  directory: string,
  dependencies: HistoricalNumericalProfileReadDependencies,
  descriptor_: ArtifactDescriptor,
): Promise<{ readonly text: string; readonly value: unknown }> {
  const bytes = await safeRead(dependencies.readFile, path.join(directory, descriptor_.path));
  if (bytes === undefined) throw new ProfileAbort('artifact-read-failed', descriptor_.path);
  if (bytes.byteLength !== descriptor_.bytes) throw new ProfileAbort('artifact-size-mismatch', descriptor_.path);
  if (sha256(bytes) !== descriptor_.sha256) throw new ProfileAbort('artifact-hash-mismatch', descriptor_.path);
  const parsed = parseUtf8Json(bytes);
  if (parsed === undefined || parsed.text !== canonicalJson(parsed.value)) {
    throw new ProfileAbort('invalid-artifact-json', descriptor_.path);
  }
  return parsed;
}

function parseCpuRecords(
  config: FrozenProfileConfig,
  value: unknown,
  semanticWorkSha256: string,
  environmentSha256: string,
): readonly CpuProfileRecord[] {
  if (!isRecord(value) || !isDeepStrictEqual(Object.keys(value), [
    'schemaVersion', 'profileId', 'inputBinding', 'profiler', 'profiles',
  ]) || value['schemaVersion'] !== 'routelab.numerical-baseline-profile-cpu-observations.v1'
    || value['profileId'] !== PROFILE_ID || !isRecord(value['inputBinding'])
    || !isDeepStrictEqual(value['inputBinding'], {
      profileConfigSha256: NUMERICAL_BASELINE_PROFILE_CONFIG_SHA256,
      semanticWorkSha256,
      environmentSha256,
    }) || !isDeepStrictEqual(value['profiler'], {
      api: 'node:inspector/promises',
      domain: 'Profiler',
      samplingIntervalMicroseconds: 1_000,
      sessionCount: 1,
      recordedProfileCount: 3,
      overhead: 'three-recording-windows-plus-inspector-sampling-and-normalization',
    })
    || !Array.isArray(value['profiles']) || value['profiles'].length !== 3) {
    throw new ProfileAbort('invalid-artifact-shape', 'cpu-profile-observations.json');
  }
  const expectedOrders = ['forward', 'reverse', 'forward'] as const;
  return Object.freeze(value['profiles'].map((unknownRecord, profileIndex) => {
    if (!isRecord(unknownRecord) || unknownRecord['profileIndex'] !== profileIndex
      || unknownRecord['sweepOrder'] !== expectedOrders[profileIndex]
      || unknownRecord['callCount'] !== 414 || !Array.isArray(unknownRecord['runtimeRootMembership'])
      || !Array.isArray(unknownRecord['leafCategories'])) {
      throw new ProfileAbort('observation-schedule-mismatch', `cpu-profile/${profileIndex}`);
    }
    const profile = validateNormalizedCpuProfile(
      unknownRecord['profile'],
      requiredCap(config, 'maxSamplesPerProfile'),
      requiredCap(config, 'maxNodesPerProfile'),
    );
    const annotations = annotateProfile(profile, config);
    if (!isDeepStrictEqual(unknownRecord['runtimeRootMembership'], annotations.membership)
      || !isDeepStrictEqual(unknownRecord['leafCategories'], annotations.categories)) {
      throw new ProfileAbort('analysis-reconstruction-mismatch', `cpu-profile/${profileIndex}/annotations`);
    }
    return deepFreeze({
      profileIndex,
      sweepOrder: expectedOrders[profileIndex] as SweepOrder,
      callCount: 414,
      profile,
      runtimeRootMembership: annotations.membership,
      leafCategories: annotations.categories,
    });
  }));
}

function validateTiming(
  value: unknown,
  cells: readonly ExpectedCell[],
  semanticWorkSha256: string,
): ObservationEnvironment {
  if (!isRecord(value) || !isDeepStrictEqual(Object.keys(value), [
    'schemaVersion', 'profileId', 'inputBinding', 'environment', 'protocol', 'samples',
  ]) || value['schemaVersion'] !== 'routelab.numerical-baseline-profile-timing-observations.v1'
    || value['profileId'] !== PROFILE_ID || !isDeepStrictEqual(value['inputBinding'], {
      profileConfigSha256: NUMERICAL_BASELINE_PROFILE_CONFIG_SHA256,
      semanticWorkSha256,
    }) || !isDeepStrictEqual(value['protocol'], {
      clock: 'process.hrtime.bigint',
      scope: 'routeExactInputSplitNumericalAnytime-call-only-unprofiled',
      warmupSweeps: 1,
      measuredSweeps: 5,
      sweepOrder: ['forward', 'reverse', 'forward', 'reverse', 'forward'],
      sampleCount: 2_070,
      resultCheck: 'outside-timed-region-after-each-call',
    })
    || !validateEnvironment(value['environment']) || !Array.isArray(value['samples'])
    || value['samples'].length !== 2_070) {
    throw new ProfileAbort('invalid-artifact-shape', 'timing-observations.json');
  }
  const sweepOrders = ['forward', 'reverse', 'forward', 'reverse', 'forward'] as const;
  for (let index = 0; index < value['samples'].length; index += 1) {
    const sample: unknown = (value['samples'] as unknown[])[index];
    const sweep = Math.floor(index / cells.length);
    const order = index % cells.length;
    const cohortIndex = sweepOrders[sweep] === 'reverse' ? cells.length - order - 1 : order;
    const cell = cells[cohortIndex];
    if (!isRecord(sample) || cell === undefined || sample['sweep'] !== sweep
      || sample['sweepOrder'] !== sweepOrders[sweep] || sample['order'] !== order
      || sample['cohortIndex'] !== cohortIndex || sample['requestId'] !== cell.requestId
      || sample['profileId'] !== cell.profileId || sample['semanticHash'] !== cell.semanticHash
      || !isCanonicalNonnegativeInteger(sample['elapsedNanoseconds'])) {
      throw new ProfileAbort('observation-schedule-mismatch', `timing-observations.json/${index}`);
    }
  }
  return value['environment'];
}

export async function verifyHistoricalNumericalProfile(
  directory: string,
  sourceDependencies: HistoricalNumericalProfileReadDependencies,
): Promise<HistoricalNumericalProfileVerificationResult> {
  const dependencies = cachedDependencies(sourceDependencies);
  try {
    const manifestBytes = await safeRead(dependencies.readFile, path.join(directory, 'manifest.json'));
    if (manifestBytes === undefined) throw new ProfileAbort('artifact-read-failed', 'manifest.json');
    const parsedManifest = parseUtf8Json(manifestBytes);
    if (parsedManifest === undefined || parsedManifest.text !== canonicalJson(parsedManifest.value)
      || !isRecord(parsedManifest.value)
      || parsedManifest.value['schemaVersion'] !== 'routelab.numerical-baseline-profile-manifest.v1') {
      throw new ProfileAbort('invalid-artifact-json', 'manifest.json');
    }
    const config = await readFrozenConfig(dependencies);
    if (manifestBytes.byteLength > requiredCap(config, 'maxManifestBytes')) {
      throw new ProfileAbort('resource-cap-exceeded', 'manifest.json');
    }
    await verifyBoundInputs(dependencies, config);
    const declared = artifactDescriptorsFromManifest(parsedManifest.value);
    const declaredCaps = [
      ['semantic-work.json', 'maxSemanticWorkBytes'],
      ['timing-observations.json', 'maxTimingObservationBytes'],
      ['cpu-profile-observations.json', 'maxCpuProfileObservationBytes'],
      ['analysis.json', 'maxAnalysisBytes'],
    ] as const;
    for (const [name, cap] of declaredCaps) {
      if (declared[name].bytes > requiredCap(config, cap)) {
        throw new ProfileAbort('resource-cap-exceeded', name);
      }
    }
    const totalBytes = manifestBytes.byteLength
      + Object.values(declared).reduce((sum, current) => sum + current.bytes, 0);
    if (totalBytes > requiredCap(config, 'maxTotalArtifactBytes')) {
      throw new ProfileAbort('resource-cap-exceeded', 'artifact-set');
    }
    const semanticArtifact = await readDeclaredArtifact(directory, dependencies, declared['semantic-work.json']);
    const timingArtifact = await readDeclaredArtifact(directory, dependencies, declared['timing-observations.json']);
    const cpuArtifact = await readDeclaredArtifact(directory, dependencies, declared['cpu-profile-observations.json']);
    const analysisArtifact = await readDeclaredArtifact(directory, dependencies, declared['analysis.json']);
    const numerical = await verifyHistoricalNumericalSplitEvaluation(
      CANONICAL_HISTORICAL_NUMERICAL_SPLIT_EVALUATION_DIRECTORY,
      { readFile: dependencies.readFile },
    );
    if (!numerical.ok) {
      throw new ProfileAbort('numerical-evaluation-invalid', `numerical/${numerical.error.artifact}`);
    }
    const semanticBytes = await dependencies.readFile(M7_SEMANTIC_PATH);
    const semantic = parseUtf8Json(semanticBytes);
    if (semantic === undefined) throw new ProfileAbort('invalid-semantic-results', 'semantic-results.json');
    const cells = parseExpectedCells(semantic.value);
    const expectedSemanticWork = buildSemanticWork(config, cells);
    if (semanticArtifact.text !== canonicalJson(expectedSemanticWork)) {
      throw new ProfileAbort('semantic-reconstruction-mismatch', 'semantic-work.json');
    }
    const semanticWorkSha256 = sha256(semanticArtifact.text);
    const environment = validateTiming(timingArtifact.value, cells, semanticWorkSha256);
    const cpuRecords = parseCpuRecords(
      config,
      cpuArtifact.value,
      semanticWorkSha256,
      sha256(JSON.stringify(environment)),
    );
    const expectedAnalysis = buildAnalysis(config, expectedSemanticWork, cpuRecords);
    if (analysisArtifact.text !== canonicalJson(expectedAnalysis)) {
      throw new ProfileAbort('analysis-reconstruction-mismatch', 'analysis.json');
    }
    const sources = sourceDescriptors(await readSources(dependencies));
    const decision = expectedAnalysis['decision'];
    if (!isRecord(decision) || typeof decision['recommendation'] !== 'string') {
      throw new ProfileAbort('invalid-artifact-shape', 'analysis/decision');
    }
    const expectedManifest = buildManifest(config, declared, sources, decision['recommendation']);
    if (parsedManifest.text !== canonicalJson(expectedManifest)) {
      throw new ProfileAbort('manifest-reconstruction-mismatch', 'manifest.json');
    }
    const files = deepFreeze({
      'semantic-work.json': semanticArtifact.text,
      'timing-observations.json': timingArtifact.text,
      'cpu-profile-observations.json': cpuArtifact.text,
      'analysis.json': analysisArtifact.text,
      'manifest.json': parsedManifest.text,
    });
    return Object.freeze({ ok: true, value: createSummary(files, decision['recommendation']) });
  } catch (error) {
    if (error instanceof ProfileAbort) return failure(error.code, error.artifact);
    return failure('invalid-artifact-shape', 'verification');
  }
}

export const defaultHistoricalNumericalProfileReadDependencies = Object.freeze({
  readFile: defaultReadFile,
});
