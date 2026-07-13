import { createHash } from 'node:crypto';
import { readFile as defaultReadFile } from 'node:fs/promises';
import { Session } from 'node:inspector/promises';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { isMainThread } from 'node:worker_threads';

import { parseLiquiditySnapshot } from '../../domain/index.ts';
import {
  routeExactInputSplitNumericalAnytime,
  type NumericalExactInputSplitRuntimeResult,
  type NumericalExactInputSplitWorkCaps,
  type NumericalExactInputSplitWorkCounters,
} from '../../router/numerical-exact-input-split/index.ts';
import {
  parseAndPrepareRoutingContext,
  type PreparedRoutingContext,
} from '../../runtime/prepared-routing-context/index.ts';
import {
  projectCanonicalSplitRouterResult,
  projectCanonicalSplitRouterWorkCounters,
} from '../../serialization/canonical-split-router-result/index.ts';
import {
  normalizeCpuProfile as normalizeHistoricalCpuProfile,
  validateNormalizedCpuProfile as validateHistoricalNormalizedCpuProfile,
} from '../historical-numerical-profile/index.ts';
import {
  REPRESENTATIVE_BASELINE_DIRECTORY,
  REPRESENTATIVE_REQUEST_CORPUS_DIRECTORY,
  REPRESENTATIVE_STRESS_SUITE_DIRECTORY,
} from '../representative-numerical-baseline/index.ts';

export const REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_PATH =
  'fixtures/m7/numerical-representative-profile/profile-config.v1.json';
export const REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_BYTES = 16_462;
export const REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_SHA256 =
  'sha256:b2ac31c4781471872110bbd2546e8681cee3a3301477db34b3931f06a8648734';
export const REPRESENTATIVE_NUMERICAL_PROFILE_EVIDENCE_REVISION =
  'fd9cadc5f9783dda0052b02d8c6316a8f47bc8e2';
export const CANONICAL_REPRESENTATIVE_NUMERICAL_PROFILE_DIRECTORY =
  'datasets/profiles/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/supported-regime-suite-v1/numerical-path-shadow-price-preacceleration-v1';

const PROFILE_ID = 'm7b-core12-supported-regime-numerical-preacceleration-profile-v1';
const EXPECTED_NODE_VERSION = 'v24.18.0';
const EXPECTED_V8_VERSION = '13.6.233.17-node.50';
const EXPECTED_UV_VERSION = '1.52.1';
const HISTORICAL_SNAPSHOT_PATH =
  'datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1/snapshot.json';
const HISTORICAL_SNAPSHOT_BINDING = Object.freeze({
  path: HISTORICAL_SNAPSHOT_PATH,
  bytes: 18_502,
  sha256: 'sha256:4c43d4920f0edb487a262f1d321ba4790d07c7563e2a3b0157c5b51122fb3478',
});
const REQUESTS_PATH = `${REPRESENTATIVE_REQUEST_CORPUS_DIRECTORY}/requests.json`;
const SEMANTIC_PATH = `${REPRESENTATIVE_BASELINE_DIRECTORY}/semantic-results.json`;
const ELIGIBILITY_PATH = `${REPRESENTATIVE_BASELINE_DIRECTORY}/eligibility.json`;
const BASELINE_SEMANTIC_BINDING = Object.freeze({
  path: SEMANTIC_PATH,
  bytes: 49_696_939,
  sha256: 'sha256:14b4fc63f3480922fad3741db0556346b982fdaf2c1ae49a51f05f22a9fb29e6',
});
const CASE_IDS = Object.freeze([
  'historical-anchor',
  'synthetic-dual-spanning-tree',
  'synthetic-reserve-compressed-1e12',
  'synthetic-reserve-amplified-1e60',
] as const);
const EXPECTED_ELIGIBLE_COUNTS = Object.freeze([396, 174, 303, 396] as const);
const EXPECTED_ORDERED_COHORT_SHA256 =
  'sha256:48f86261df3e87a2add397e3456f049640fbdfd3e964524201051b452327b5e7';
const WORK_CAPS: NumericalExactInputSplitWorkCaps = Object.freeze({
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
const ARTIFACT_NAMES = Object.freeze([
  'semantic-work.json',
  'timing-observations.json',
  'cpu-profile-observations.json',
  'analysis.json',
  'manifest.json',
] as const);
const COUNTER_FIELDS = Object.freeze([
  'directCandidates', 'directCandidateReplays', 'directCandidateRejections',
  'pathExpansions', 'bestSingleCandidateReplays', 'bestSingleCandidateRejections',
  'candidateSetExpansions', 'equalProposalReplays', 'equalProposalRejections',
  'greedyOptionReplays', 'greedyOptionRejections', 'finalAuthorizationReplays',
  'finalAuthorizationRejections', 'numericalProposals', 'numericalProposalFailures',
  'numericalIterations', 'numericalResidualReplays',
  'numericalResidualReplayRejections', 'numericalAuthorizationReplays',
  'numericalAuthorizationReplayRejections',
] as const);
const SOURCE_PATHS = Object.freeze([
  'src/benchmark/representative-numerical-profile/index.ts',
  'cli/run-representative-numerical-profile.ts',
  'cli/verify-representative-numerical-profile.ts',
  'src/benchmark/representative-numerical-baseline/index.ts',
  'src/benchmark/historical-numerical-profile/index.ts',
] as const);
const LIMITATIONS = Object.freeze([
  'One accepted historical stored-reserve anchor and three deterministic synthetic supported-regime stresses only.',
  'Raw observations include JIT, garbage collection, scheduler, native, source-map, and profiler effects.',
  'No latency guarantee, percentile, speedup, scaling, historical-demand, production, global-optimality, heuristic, shortcut, or research-equivalence claim is made.',
]);

type JsonRecord = Record<string, unknown>;
type CaseId = (typeof CASE_IDS)[number];
type ArtifactName = (typeof ARTIFACT_NAMES)[number];
type SweepOrder = 'forward' | 'reverse';
type NormalizedCpuProfile = ReturnType<typeof normalizeHistoricalCpuProfile>;

interface ArtifactDescriptor {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

interface FrozenProfileConfig extends JsonRecord {
  readonly schemaVersion: 'routelab.numerical-representative-profile-config.v1';
  readonly profileConfigId: string;
  readonly baselineBinding: JsonRecord;
  readonly executionRuntime: JsonRecord;
  readonly runtime: JsonRecord;
  readonly observationProtocol: JsonRecord;
  readonly attribution: JsonRecord;
  readonly decision: JsonRecord;
  readonly outputs: JsonRecord;
  readonly resourceCaps: JsonRecord;
  readonly claims: JsonRecord;
}

interface ExpectedCell {
  readonly caseId: CaseId;
  readonly requestId: string;
  readonly cohortIndex: number;
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly context: PreparedRoutingContext;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly amountBucket: string;
  readonly topology: string;
  readonly result: JsonRecord;
  readonly resultSha256: string;
  readonly workCaps: NumericalExactInputSplitWorkCaps;
}

interface ExpectedCohort {
  readonly caseId: CaseId;
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly cells: readonly ExpectedCell[];
}

interface PreparedInputs {
  readonly config: FrozenProfileConfig;
  readonly cohorts: readonly ExpectedCohort[];
}

interface NormalizedProfileRecord {
  readonly profileIndex: number;
  readonly caseId: CaseId;
  readonly caseProfileIndex: number;
  readonly sweepOrder: SweepOrder;
  readonly callCount: number;
  readonly profile: NormalizedCpuProfile;
  readonly leafCategories: readonly string[];
}

export interface RepresentativeProfileEnvironment extends JsonRecord {
  readonly nodeVersion: string;
  readonly v8Version: string;
  readonly uvVersion: string;
  readonly profilerApi: 'node:inspector/promises';
  readonly samplingIntervalMicroseconds: 1000;
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

export type RepresentativeNumericalProfileErrorCode =
  | 'config-read-failed' | 'config-size-mismatch' | 'config-hash-mismatch'
  | 'invalid-config-json' | 'invalid-config-shape' | 'evidence-revision-mismatch'
  | 'bound-input-read-failed' | 'bound-input-size-mismatch' | 'bound-input-hash-mismatch'
  | 'invalid-baseline-artifact' | 'cohort-mismatch' | 'environment-mismatch'
  | 'runtime-result-mismatch' | 'clock-invalid' | 'profiler-connect-failed'
  | 'profiler-enable-failed' | 'profiler-configure-failed' | 'profiler-start-failed'
  | 'profiler-stop-failed' | 'profiler-disable-failed' | 'profiler-disconnect-failed'
  | 'invalid-cpu-profile' | 'unsafe-profile-path' | 'resource-cap-exceeded'
  | 'artifact-read-failed' | 'artifact-size-mismatch' | 'artifact-hash-mismatch'
  | 'invalid-artifact-json' | 'invalid-artifact-shape'
  | 'semantic-reconstruction-mismatch' | 'observation-schedule-mismatch'
  | 'analysis-reconstruction-mismatch' | 'manifest-reconstruction-mismatch'
  | 'source-read-failed';

export interface RepresentativeNumericalProfileError {
  readonly code: RepresentativeNumericalProfileErrorCode;
  readonly artifact: string;
  readonly message: string;
}

export interface RepresentativeNumericalProfileSummary {
  readonly schemaVersion: 'routelab.numerical-representative-profile-summary.v1';
  readonly profileId: string;
  readonly profileConfigSha256: string;
  readonly eligibleCellCount: 1269;
  readonly totalNumericalCalls: 13959;
  readonly timingSampleCount: 6345;
  readonly cpuProfileCount: 12;
  readonly semanticWorkSha256: string;
  readonly timingObservationsSha256: string;
  readonly cpuProfileObservationsSha256: string;
  readonly analysisSha256: string;
  readonly recommendation: string;
}

export interface RepresentativeNumericalProfileArtifacts {
  readonly files: Readonly<Record<ArtifactName, string>>;
  readonly summary: RepresentativeNumericalProfileSummary;
}

export type RepresentativeNumericalProfileGenerationResult =
  | { readonly ok: true; readonly value: RepresentativeNumericalProfileArtifacts }
  | { readonly ok: false; readonly error: RepresentativeNumericalProfileError };
export type RepresentativeNumericalProfileVerificationResult =
  | { readonly ok: true; readonly value: RepresentativeNumericalProfileSummary }
  | { readonly ok: false; readonly error: RepresentativeNumericalProfileError };

export interface RepresentativeNumericalProfileReadDependencies {
  readonly readFile: (filePath: string) => Promise<Uint8Array>;
}

export interface RepresentativeProfileClock { readonly now: () => bigint; }
export interface RepresentativeProfileProfiler {
  readonly connect: () => void | Promise<void>;
  readonly enable: () => Promise<void>;
  readonly setSamplingInterval: (microseconds: number) => Promise<void>;
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<unknown>;
  readonly disable: () => Promise<void>;
  readonly disconnect: () => void | Promise<void>;
}

export interface RepresentativeNumericalProfileGenerationDependencies
  extends RepresentativeNumericalProfileReadDependencies {
  readonly repositoryRoot: string;
  readonly evidenceRevision: string;
  readonly clock?: RepresentativeProfileClock;
  readonly profiler?: RepresentativeProfileProfiler;
  readonly environment?: RepresentativeProfileEnvironment;
  readonly route?: typeof routeExactInputSplitNumericalAnytime;
}

class ProfileAbort extends Error {
  readonly code: RepresentativeNumericalProfileErrorCode;
  readonly artifact: string;
  constructor(code: RepresentativeNumericalProfileErrorCode, artifact: string) {
    super(`${code}: ${artifact}`);
    this.code = code;
    this.artifact = artifact;
  }
}

function failure(code: RepresentativeNumericalProfileErrorCode, artifact: string) {
  return Object.freeze({ ok: false as const, error: Object.freeze({
    code, artifact, message: `Representative numerical profile failed at ${artifact}.`,
  }) });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isSafeNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function isCanonicalNonnegativeInteger(value: unknown): value is string {
  return typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(value);
}
function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
}
function sha256(value: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
function canonicalJson(value: unknown): string { return `${JSON.stringify(value)}\n`; }
function descriptor(filePath: string, value: string | Uint8Array): ArtifactDescriptor {
  return Object.freeze({ path: filePath, bytes: typeof value === 'string' ? Buffer.byteLength(value) : value.byteLength, sha256: sha256(value) });
}
function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as JsonRecord)) deepFreeze(nested);
  return Object.freeze(value);
}
function parseJson(bytes: Uint8Array, artifact: string): { readonly text: string; readonly value: unknown } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return Object.freeze({ text, value: JSON.parse(text) as unknown });
  } catch { throw new ProfileAbort('invalid-artifact-json', artifact); }
}
async function safeRead(readFile: (filePath: string) => Promise<Uint8Array>, filePath: string): Promise<Uint8Array | undefined> {
  try { return Uint8Array.from(await readFile(filePath)); } catch { return undefined; }
}
function cachedDependencies(dependencies: RepresentativeNumericalProfileReadDependencies): RepresentativeNumericalProfileReadDependencies {
  const cache = new Map<string, Promise<Uint8Array>>();
  return Object.freeze({ readFile(filePath: string): Promise<Uint8Array> {
    let pending = cache.get(filePath);
    if (pending === undefined) {
      pending = Promise.resolve().then(() => dependencies.readFile(filePath));
      cache.set(filePath, pending);
    }
    return pending.then((bytes) => Uint8Array.from(bytes));
  } });
}

function hasConfigShape(value: unknown): value is FrozenProfileConfig {
  return isRecord(value)
    && value['schemaVersion'] === 'routelab.numerical-representative-profile-config.v1'
    && value['profileConfigId'] === 'm7b-core12-supported-regime-numerical-preacceleration-profile-v1'
    && value['acceptedBaselineRevision'] === REPRESENTATIVE_NUMERICAL_PROFILE_EVIDENCE_REVISION
    && isRecord(value['baselineBinding'])
    && value['baselineBinding']['observationAuthorizedByThisConfig'] === true
    && isRecord(value['executionRuntime']) && isRecord(value['runtime'])
    && isRecord(value['observationProtocol']) && isRecord(value['attribution'])
    && isRecord(value['decision']) && isRecord(value['outputs'])
    && isRecord(value['resourceCaps']) && isRecord(value['claims']);
}

export function validateRepresentativeProfileConfigBytes(bytes: Uint8Array): Readonly<JsonRecord> {
  if (bytes.byteLength !== REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_BYTES) throw new ProfileAbort('config-size-mismatch', REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_PATH);
  if (sha256(bytes) !== REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_SHA256) throw new ProfileAbort('config-hash-mismatch', REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_PATH);
  let parsed: { text: string; value: unknown };
  try { parsed = parseJson(bytes, REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_PATH); }
  catch { throw new ProfileAbort('invalid-config-json', REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_PATH); }
  if (!hasConfigShape(parsed.value) || parsed.text !== `${JSON.stringify(parsed.value, null, 2)}\n`) {
    throw new ProfileAbort('invalid-config-shape', REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_PATH);
  }
  return deepFreeze(parsed.value);
}

async function readConfig(dependencies: RepresentativeNumericalProfileReadDependencies): Promise<FrozenProfileConfig> {
  const bytes = await safeRead(dependencies.readFile, REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_PATH);
  if (bytes === undefined) throw new ProfileAbort('config-read-failed', REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_PATH);
  return validateRepresentativeProfileConfigBytes(bytes) as FrozenProfileConfig;
}

function collectDescriptors(value: unknown, output: ArtifactDescriptor[] = []): readonly ArtifactDescriptor[] {
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length === 3 && keys.includes('path') && keys.includes('bytes') && keys.includes('sha256')
      && typeof value['path'] === 'string' && isSafeNonnegativeInteger(value['bytes']) && isSha256(value['sha256'])) {
      output.push(Object.freeze({ path: value['path'], bytes: value['bytes'], sha256: value['sha256'] }));
    } else {
      for (const nested of Object.values(value)) collectDescriptors(nested, output);
    }
  } else if (Array.isArray(value)) {
    for (const nested of value) collectDescriptors(nested, output);
  }
  return output;
}

async function verifyBoundInputs(dependencies: RepresentativeNumericalProfileReadDependencies, config: FrozenProfileConfig): Promise<void> {
  const unique = new Map<string, ArtifactDescriptor>();
  for (const current of [...collectDescriptors(config), HISTORICAL_SNAPSHOT_BINDING]) {
    const prior = unique.get(current.path);
    if (prior !== undefined && !isDeepStrictEqual(prior, current)) throw new ProfileAbort('invalid-config-shape', current.path);
    unique.set(current.path, current);
  }
  for (const current of unique.values()) {
    const bytes = await safeRead(dependencies.readFile, current.path);
    if (bytes === undefined) throw new ProfileAbort('bound-input-read-failed', current.path);
    if (bytes.byteLength !== current.bytes) throw new ProfileAbort('bound-input-size-mismatch', current.path);
    if (sha256(bytes) !== current.sha256) throw new ProfileAbort('bound-input-hash-mismatch', current.path);
  }
}

function projectCounters(counters: NumericalExactInputSplitWorkCounters): JsonRecord {
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

function projectDiagnostic(diagnostic: Extract<NumericalExactInputSplitRuntimeResult, { status: 'success' }>['plan']['search']['numericalDiagnostics'][number]): object {
  return {
    candidateSetKey: diagnostic.candidateSetKey, routeKeys: diagnostic.routeKeys,
    status: diagnostic.status, failureCode: diagnostic.failureCode,
    converged: diagnostic.converged, completedOuterIterations: diagnostic.completedOuterIterations,
    configuredInnerIterations: diagnostic.configuredInnerIterations,
    residualUnits: diagnostic.residualUnits === null ? null : diagnostic.residualUnits.toString(10),
    counters: {
      numericalProposals: diagnostic.counters.numericalProposals,
      numericalProposalFailures: diagnostic.counters.numericalProposalFailures,
      numericalIterations: diagnostic.counters.numericalIterations,
      numericalResidualReplays: diagnostic.counters.numericalResidualReplays,
      numericalResidualReplayRejections: diagnostic.counters.numericalResidualReplayRejections,
      numericalAuthorizationReplays: diagnostic.counters.numericalAuthorizationReplays,
      numericalAuthorizationReplayRejections: diagnostic.counters.numericalAuthorizationReplayRejections,
    },
  };
}

function projectResult(result: NumericalExactInputSplitRuntimeResult): JsonRecord {
  if (result.status !== 'success') throw new ProfileAbort('runtime-result-mismatch', 'runtime/status');
  const canonical = projectCanonicalSplitRouterResult(result) as { plan: JsonRecord };
  return {
    status: 'success',
    plan: {
      receipt: canonical.plan['receipt'],
      search: {
        counters: projectCounters(result.plan.search.counters),
        termination: result.plan.search.termination,
        numericalDiagnostics: result.plan.search.numericalDiagnostics.map(projectDiagnostic),
      },
    },
  };
}

function snapshotPaths(): readonly string[] {
  return Object.freeze([
    HISTORICAL_SNAPSHOT_PATH,
    `${REPRESENTATIVE_STRESS_SUITE_DIRECTORY}/synthetic-dual-spanning-tree.snapshot.json`,
    `${REPRESENTATIVE_STRESS_SUITE_DIRECTORY}/synthetic-reserve-compressed-1e12.snapshot.json`,
    `${REPRESENTATIVE_STRESS_SUITE_DIRECTORY}/synthetic-reserve-amplified-1e60.snapshot.json`,
  ]);
}

async function prepareInputs(dependencies: RepresentativeNumericalProfileReadDependencies, config: FrozenProfileConfig): Promise<PreparedInputs> {
  const [requestsBytes, semanticBytes, eligibilityBytes, ...snapshotBytes] = await Promise.all([
    dependencies.readFile(REQUESTS_PATH), dependencies.readFile(SEMANTIC_PATH),
    dependencies.readFile(ELIGIBILITY_PATH), ...snapshotPaths().map((filePath) => dependencies.readFile(filePath)),
  ]);
  const requests = parseJson(requestsBytes, REQUESTS_PATH).value;
  const semantic = parseJson(semanticBytes, SEMANTIC_PATH).value;
  const eligibility = parseJson(eligibilityBytes, ELIGIBILITY_PATH).value;
  if (!isRecord(requests) || !Array.isArray(requests['cases']) || requests['cases'].length !== 4
    || !isRecord(semantic) || !Array.isArray(semantic['cells']) || semantic['cells'].length !== 1_584
    || !isRecord(eligibility) || !Array.isArray(eligibility['cells']) || eligibility['cells'].length !== 1_584
    || eligibility['orderedEligibleCellSha256'] !== EXPECTED_ORDERED_COHORT_SHA256) {
    throw new ProfileAbort('invalid-baseline-artifact', 'baseline/documents');
  }
  const workCaps = WORK_CAPS;
  const contexts: Array<{ snapshotId: string; snapshotChecksum: string; context: PreparedRoutingContext }> = [];
  for (let index = 0; index < snapshotBytes.length; index += 1) {
    const bytes = snapshotBytes[index];
    if (bytes === undefined) throw new ProfileAbort('invalid-baseline-artifact', `snapshot/${index}`);
    const value = parseJson(bytes, snapshotPaths()[index] ?? 'snapshot').value;
    const parsed = parseLiquiditySnapshot(value);
    const prepared = parseAndPrepareRoutingContext(value);
    if (!parsed.ok || !prepared.ok) throw new ProfileAbort('invalid-baseline-artifact', `snapshot/${index}`);
    contexts.push({ snapshotId: parsed.value.snapshotId, snapshotChecksum: parsed.value.snapshotChecksum, context: prepared.value });
  }
  const semanticCells = semantic['cells'] as JsonRecord[];
  const eligibilityCells = eligibility['cells'] as JsonRecord[];
  const requestCases = requests['cases'] as unknown[];
  const cohorts: ExpectedCohort[] = [];
  const identities: object[] = [];
  let absoluteIndex = 0;
  for (let caseIndex = 0; caseIndex < CASE_IDS.length; caseIndex += 1) {
    const caseId = CASE_IDS[caseIndex];
    const requestCase = requestCases[caseIndex];
    const context = contexts[caseIndex];
    if (caseId === undefined || context === undefined || !isRecord(requestCase)
      || requestCase['caseId'] !== caseId || !Array.isArray(requestCase['requests'])
      || requestCase['requests'].length !== 396) throw new ProfileAbort('cohort-mismatch', `case/${caseIndex}`);
    const cells: ExpectedCell[] = [];
    const caseRequests = requestCase['requests'] as unknown[];
    for (let requestIndex = 0; requestIndex < 396; requestIndex += 1, absoluteIndex += 1) {
      const request = caseRequests[requestIndex];
      const semanticCell = semanticCells[absoluteIndex];
      const eligibilityCell = eligibilityCells[absoluteIndex];
      if (!isRecord(request) || !isRecord(semanticCell) || !isRecord(eligibilityCell)
        || semanticCell['caseId'] !== caseId || eligibilityCell['caseId'] !== caseId
        || semanticCell['requestId'] !== request['requestId'] || eligibilityCell['requestId'] !== request['requestId']) {
        throw new ProfileAbort('cohort-mismatch', `${caseId}/${requestIndex}`);
      }
      if (eligibilityCell['status'] !== 'eligible') continue;
      if (typeof request['requestId'] !== 'string' || typeof request['assetIn'] !== 'string'
        || typeof request['assetOut'] !== 'string' || !isCanonicalNonnegativeInteger(request['amountIn'])
        || BigInt(request['amountIn']) <= 0n || typeof request['amountBucket'] !== 'string'
        || typeof request['topology'] !== 'string' || !isRecord(semanticCell['result'])) {
        throw new ProfileAbort('invalid-baseline-artifact', `${caseId}/${requestIndex}`);
      }
      identities.push({ caseId, requestId: request['requestId'] });
      cells.push(Object.freeze({
        caseId, requestId: request['requestId'], cohortIndex: cells.length,
        snapshotId: context.snapshotId, snapshotChecksum: context.snapshotChecksum,
        context: context.context, assetIn: request['assetIn'], assetOut: request['assetOut'],
        amountIn: BigInt(request['amountIn']), amountBucket: request['amountBucket'],
        topology: request['topology'], result: semanticCell['result'],
        resultSha256: sha256(JSON.stringify(semanticCell['result'])), workCaps,
      }));
    }
    if (cells.length !== EXPECTED_ELIGIBLE_COUNTS[caseIndex]) throw new ProfileAbort('cohort-mismatch', `${caseId}/count`);
    cohorts.push(Object.freeze({ caseId, snapshotId: context.snapshotId, snapshotChecksum: context.snapshotChecksum, cells: Object.freeze(cells) }));
  }
  if (sha256(JSON.stringify(identities)) !== EXPECTED_ORDERED_COHORT_SHA256) throw new ProfileAbort('cohort-mismatch', 'ordered-hash');
  return deepFreeze({ config, cohorts: Object.freeze(cohorts) });
}

function runtimeRequest(cell: ExpectedCell): object {
  return Object.freeze({
    snapshotId: cell.snapshotId, snapshotChecksum: cell.snapshotChecksum,
    assetIn: cell.assetIn, assetOut: cell.assetOut, amountIn: cell.amountIn,
    maxHops: 2, maxRoutes: 2, greedyParts: 16,
    numerical: Object.freeze({ outerIterations: 64, innerIterations: 64, convergenceTolerance: 2 ** -40 }),
  });
}

function prepareCell(cell: ExpectedCell, route: typeof routeExactInputSplitNumericalAnytime): (() => NumericalExactInputSplitRuntimeResult) {
  const request = runtimeRequest(cell);
  const control = Object.freeze({ workCaps: Object.freeze({ ...cell.workCaps }) });
  return () => route(cell.context, request as Parameters<typeof route>[1], control);
}

function assertParity(result: NumericalExactInputSplitRuntimeResult, cell: ExpectedCell): void {
  const projected = projectResult(result);
  if (sha256(JSON.stringify(projected)) !== cell.resultSha256 || !isDeepStrictEqual(projected, cell.result)) {
    throw new ProfileAbort('runtime-result-mismatch', `${cell.caseId}/${cell.requestId}`);
  }
}

function orders(length: number, order: SweepOrder): readonly number[] {
  const values = Array.from({ length }, (_, index) => index);
  if (order === 'reverse') values.reverse();
  return Object.freeze(values);
}

export interface RepresentativeTimingSample {
  readonly sampleIndex: number;
  readonly caseId: CaseId;
  readonly sweep: number;
  readonly sweepOrder: SweepOrder;
  readonly order: number;
  readonly cohortIndex: number;
  readonly elapsedNanoseconds: string;
}
export interface RepresentativeCpuSweep {
  readonly profileIndex: number;
  readonly caseId: CaseId;
  readonly caseProfileIndex: number;
  readonly sweepOrder: SweepOrder;
  readonly callCount: number;
  readonly rawProfile: unknown;
}
export interface RepresentativeObservationScheduleResult {
  readonly timingSamples: readonly RepresentativeTimingSample[];
  readonly cpuSweeps: readonly RepresentativeCpuSweep[];
  readonly totalCallCount: number;
}

export async function executeRepresentativeObservationSchedule<T, R>(
  cohorts: readonly Readonly<{ readonly caseId: CaseId; readonly cells: readonly T[] }>[],
  prepare: (cell: T) => () => R,
  validate: (result: R, cell: T) => void,
  clock: RepresentativeProfileClock,
  profiler: RepresentativeProfileProfiler,
): Promise<RepresentativeObservationScheduleResult> {
  if (cohorts.length !== 4 || cohorts.some((cohort) => cohort.cells.length === 0)) throw new ProfileAbort('cohort-mismatch', 'observation-schedule');
  let totalCallCount = 0;
  const call = (cell: T): R => { const prepared = prepare(cell); totalCallCount += 1; return prepared(); };
  for (const cohort of cohorts) for (const cell of cohort.cells) validate(call(cell), cell);
  const timingSamples: RepresentativeTimingSample[] = [];
  const timingOrders = ['forward', 'reverse', 'forward', 'reverse', 'forward'] as const;
  for (const cohort of cohorts) {
    for (const index of orders(cohort.cells.length, 'forward')) {
      const cell = cohort.cells[index]; if (cell === undefined) throw new ProfileAbort('cohort-mismatch', 'timing-warmup');
      validate(call(cell), cell);
    }
    for (let sweep = 0; sweep < timingOrders.length; sweep += 1) {
      const sweepOrder = timingOrders[sweep]; if (sweepOrder === undefined) throw new ProfileAbort('invalid-config-shape', 'timing-order');
      let order = 0;
      for (const cohortIndex of orders(cohort.cells.length, sweepOrder)) {
        const cell = cohort.cells[cohortIndex]; if (cell === undefined) throw new ProfileAbort('cohort-mismatch', 'timing-sweep');
        const prepared = prepare(cell);
        const start = clock.now(); totalCallCount += 1; const result = prepared(); const end = clock.now();
        if (start < 0n || end < start) throw new ProfileAbort('clock-invalid', `${cohort.caseId}/${sweep}/${cohortIndex}`);
        validate(result, cell);
        timingSamples.push(Object.freeze({ sampleIndex: timingSamples.length, caseId: cohort.caseId, sweep, sweepOrder, order, cohortIndex, elapsedNanoseconds: (end - start).toString(10) }));
        order += 1;
      }
    }
  }
  const cpuSweeps: RepresentativeCpuSweep[] = [];
  let connected = false; let enabled = false; let recording = false; let primary: ProfileAbort | undefined;
  try {
    try { await profiler.connect(); connected = true; } catch { throw new ProfileAbort('profiler-connect-failed', 'cpu-profiler'); }
    try { await profiler.enable(); enabled = true; } catch { throw new ProfileAbort('profiler-enable-failed', 'cpu-profiler'); }
    try { await profiler.setSamplingInterval(1_000); } catch { throw new ProfileAbort('profiler-configure-failed', 'cpu-profiler'); }
    const profileOrders = ['forward', 'reverse', 'forward'] as const;
    for (const cohort of cohorts) {
      for (const index of orders(cohort.cells.length, 'forward')) {
        const cell = cohort.cells[index]; if (cell === undefined) throw new ProfileAbort('cohort-mismatch', 'profiler-warmup');
        validate(call(cell), cell);
      }
      for (let caseProfileIndex = 0; caseProfileIndex < profileOrders.length; caseProfileIndex += 1) {
        const sweepOrder = profileOrders[caseProfileIndex]; if (sweepOrder === undefined) throw new ProfileAbort('invalid-config-shape', 'profile-order');
        const prepared = orders(cohort.cells.length, sweepOrder).map((index) => {
          const cell = cohort.cells[index]; if (cell === undefined) throw new ProfileAbort('cohort-mismatch', 'profile-cell');
          return Object.freeze({ cell, invoke: prepare(cell) });
        });
        try { await profiler.start(); recording = true; } catch { throw new ProfileAbort('profiler-start-failed', `cpu-profile/${cpuSweeps.length}`); }
        const pending: Array<{ cell: T; result: R }> = [];
        for (const current of prepared) { totalCallCount += 1; pending.push({ cell: current.cell, result: current.invoke() }); }
        let rawProfile: unknown;
        try { rawProfile = await profiler.stop(); recording = false; } catch { throw new ProfileAbort('profiler-stop-failed', `cpu-profile/${cpuSweeps.length}`); }
        for (const current of pending) validate(current.result, current.cell);
        cpuSweeps.push(Object.freeze({ profileIndex: cpuSweeps.length, caseId: cohort.caseId, caseProfileIndex, sweepOrder, callCount: cohort.cells.length, rawProfile }));
      }
    }
  } catch (error) {
    primary = error instanceof ProfileAbort ? error : new ProfileAbort('invalid-cpu-profile', 'cpu-profiler');
  } finally {
    if (recording) try { await profiler.stop(); } catch { /* preserve primary */ }
    if (enabled) try { await profiler.disable(); } catch { primary ??= new ProfileAbort('profiler-disable-failed', 'cpu-profiler'); }
    if (connected) try { await profiler.disconnect(); } catch { primary ??= new ProfileAbort('profiler-disconnect-failed', 'cpu-profiler'); }
  }
  if (primary !== undefined) throw primary;
  return deepFreeze({ timingSamples, cpuSweeps, totalCallCount });
}

function actualProfiler(): RepresentativeProfileProfiler {
  const session = new Session();
  return Object.freeze({
    connect(): void { session.connect(); },
    enable(): Promise<void> { return session.post('Profiler.enable'); },
    setSamplingInterval(microseconds: number): Promise<void> { return session.post('Profiler.setSamplingInterval', { interval: microseconds }); },
    start(): Promise<void> { return session.post('Profiler.start'); },
    async stop(): Promise<unknown> { return (await session.post('Profiler.stop')).profile; },
    disable(): Promise<void> { return session.post('Profiler.disable'); },
    disconnect(): void { session.disconnect(); },
  });
}

function captureEnvironment(): RepresentativeProfileEnvironment {
  const nodeOptions = process.env['NODE_OPTIONS'];
  if (process.version !== EXPECTED_NODE_VERSION || process.versions.v8 !== EXPECTED_V8_VERSION
    || process.versions.uv !== EXPECTED_UV_VERSION || process.execArgv.length !== 0
    || (nodeOptions !== undefined && nodeOptions !== '') || !isMainThread) throw new ProfileAbort('environment-mismatch', 'environment');
  const cpus = os.cpus(); const first = cpus[0];
  if (first === undefined || !isSafeNonnegativeInteger(first.speed)) throw new ProfileAbort('environment-mismatch', 'environment/cpu');
  return deepFreeze({
    nodeVersion: process.version, v8Version: process.versions.v8, uvVersion: process.versions.uv,
    profilerApi: 'node:inspector/promises', samplingIntervalMicroseconds: 1000,
    platform: process.platform, arch: process.arch, endianness: os.endianness(),
    osType: os.type(), osRelease: os.release(), cpuModel: first.model, cpuSpeedMHz: first.speed,
    logicalCpuCount: cpus.length, availableParallelism: os.availableParallelism(),
    totalMemoryBytes: os.totalmem().toString(10), execArgv: Object.freeze([...process.execArgv]),
    nodeOptionsState: nodeOptions === undefined ? 'unset' : 'empty', mainThread: true,
  });
}

function validateEnvironment(value: unknown): value is RepresentativeProfileEnvironment {
  if (!isRecord(value)) return false;
  const keys = ['nodeVersion', 'v8Version', 'uvVersion', 'profilerApi', 'samplingIntervalMicroseconds',
    'platform', 'arch', 'endianness', 'osType', 'osRelease', 'cpuModel', 'cpuSpeedMHz',
    'logicalCpuCount', 'availableParallelism', 'totalMemoryBytes', 'execArgv',
    'nodeOptionsState', 'mainThread'];
  return isDeepStrictEqual(Object.keys(value), keys)
    && value['nodeVersion'] === EXPECTED_NODE_VERSION && value['v8Version'] === EXPECTED_V8_VERSION
    && value['uvVersion'] === EXPECTED_UV_VERSION && value['profilerApi'] === 'node:inspector/promises'
    && value['samplingIntervalMicroseconds'] === 1000 && typeof value['platform'] === 'string'
    && typeof value['arch'] === 'string' && typeof value['endianness'] === 'string'
    && typeof value['osType'] === 'string' && typeof value['osRelease'] === 'string'
    && typeof value['cpuModel'] === 'string' && isSafeNonnegativeInteger(value['cpuSpeedMHz'])
    && isSafeNonnegativeInteger(value['logicalCpuCount']) && value['logicalCpuCount'] > 0
    && isSafeNonnegativeInteger(value['availableParallelism']) && value['availableParallelism'] > 0
    && isCanonicalNonnegativeInteger(value['totalMemoryBytes']) && Array.isArray(value['execArgv'])
    && value['execArgv'].length === 0 && (value['nodeOptionsState'] === 'unset' || value['nodeOptionsState'] === 'empty')
    && value['mainThread'] === true;
}

interface Category { readonly id: string; readonly functionNames?: readonly string[]; readonly paths?: readonly string[]; readonly pathPrefixes?: readonly string[]; readonly pathFunctionNames?: readonly string[]; readonly urlPrefixes?: readonly string[]; readonly fallback?: boolean; }
function categories(config: FrozenProfileConfig): readonly Category[] {
  const value = config.attribution['categories'];
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => isRecord(item) && typeof item['id'] === 'string')) throw new ProfileAbort('invalid-config-shape', 'attribution/categories');
  return (value as unknown[]).map((item) => item as Category);
}
function categoryForNode(node: NormalizedCpuProfile['nodes'][number], values: readonly Category[]): string {
  for (const category of values) {
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

function validateProfileGraph(profile: NormalizedCpuProfile): void {
  const ids = new Set(profile.nodes.map((node) => node.id));
  const indegree = new Map([...ids].map((id) => [id, 0]));
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  for (const node of profile.nodes) for (const child of node.children ?? []) {
    if (child === node.id) throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile/self-edge');
    indegree.set(child, (indegree.get(child) ?? 0) + 1);
    if ((indegree.get(child) ?? 0) > 1) throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile/multiple-parents');
  }
  const roots = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id);
  if (roots.length !== 1) throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile/root');
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile/cycle');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const child of nodes.get(id)?.children ?? []) visit(child);
    visiting.delete(id); visited.add(id);
  };
  visit(roots[0] ?? '');
  if (visited.size !== ids.size) throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile/unreachable');
  let total = 0n;
  for (const delta of profile.timeDeltas) total += BigInt(delta);
  if (total <= 0n || total > BigInt(Number.MAX_SAFE_INTEGER)) throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile/total-time');
}

function normalizeProfile(value: unknown, root: string, config: FrozenProfileConfig): NormalizedCpuProfile {
  try {
    const profile = normalizeHistoricalCpuProfile(value, root, cap(config, 'maxSamplesPerProfile'), cap(config, 'maxNodesPerProfile'));
    validateProfileGraph(profile); return profile;
  } catch (error) {
    if (error instanceof ProfileAbort) throw error;
    throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile');
  }
}

export function normalizeRepresentativeCpuProfile(
  value: unknown,
  repositoryRoot: string,
  configValue: unknown,
): NormalizedCpuProfile {
  if (!hasConfigShape(configValue)) throw new ProfileAbort('invalid-config-shape', 'cpu-profile/config');
  return normalizeProfile(value, repositoryRoot, configValue);
}
function validateNormalizedProfile(value: unknown, config: FrozenProfileConfig): NormalizedCpuProfile {
  try {
    const profile = validateHistoricalNormalizedCpuProfile(value, cap(config, 'maxSamplesPerProfile'), cap(config, 'maxNodesPerProfile'));
    validateProfileGraph(profile); return profile;
  } catch (error) {
    if (error instanceof ProfileAbort) throw error;
    throw new ProfileAbort('invalid-cpu-profile', 'cpu-profile');
  }
}
function annotate(profile: NormalizedCpuProfile, config: FrozenProfileConfig): readonly string[] {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const values = categories(config);
  return Object.freeze(profile.samples.map((sample) => {
    const node = nodes.get(sample); if (node === undefined) throw new ProfileAbort('invalid-cpu-profile', 'sample');
    return categoryForNode(node, values);
  }));
}

export function attributeRepresentativeCpuProfile(profile: NormalizedCpuProfile, configValue: unknown): readonly string[] {
  if (!hasConfigShape(configValue)) throw new ProfileAbort('invalid-config-shape', 'attribution/config');
  validateProfileGraph(profile);
  return annotate(profile, configValue);
}

function cap(config: FrozenProfileConfig, field: string): number {
  const value = config.resourceCaps[field];
  if (!isSafeNonnegativeInteger(value)) throw new ProfileAbort('invalid-config-shape', `resourceCaps/${field}`);
  return value;
}

function semanticWork(cohorts: readonly ExpectedCohort[]): JsonRecord {
  return {
    schemaVersion: 'routelab.numerical-representative-profile-semantic-work.v1', profileId: PROFILE_ID,
    inputBinding: { profileConfigSha256: REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_SHA256,
      baselineSemanticResults: BASELINE_SEMANTIC_BINDING,
      orderedEligibleCellSha256: EXPECTED_ORDERED_COHORT_SHA256 },
    schedule: { caseOrder: CASE_IDS, totalEligibleCellCount: 1269, semanticVerificationCalls: 1269 },
    cases: cohorts.map((cohort) => {
      let candidateSetExpansions = 0;
      const cells = cohort.cells.map((cell) => {
        const plan = cell.result['plan']; const search = isRecord(plan) ? plan['search'] : undefined;
        const counters = isRecord(search) ? search['counters'] : undefined;
        const diagnostics = isRecord(search) ? search['numericalDiagnostics'] : undefined;
        if (!isRecord(counters) || !Array.isArray(diagnostics) || !COUNTER_FIELDS.every((field) => isSafeNonnegativeInteger(counters[field]))) throw new ProfileAbort('invalid-baseline-artifact', `${cell.caseId}/${cell.requestId}/result`);
        candidateSetExpansions += counters['candidateSetExpansions'] as number;
        const value = {
          requestId: cell.requestId, amountBucket: cell.amountBucket, topology: cell.topology,
          resultSha256: cell.resultSha256, receiptSha256: sha256(JSON.stringify((plan as JsonRecord)['receipt'])),
          counters, termination: (search as JsonRecord)['termination'],
          numericalDiagnosticsSha256: sha256(JSON.stringify(diagnostics)),
        };
        return { ...value, semanticHash: sha256(JSON.stringify({ caseId: cell.caseId, ...value })) };
      });
      return { caseId: cohort.caseId, snapshotId: cohort.snapshotId, snapshotChecksum: cohort.snapshotChecksum,
        eligibleCellCount: cohort.cells.length, candidateSetExpansions, cells };
    }),
    allSemanticParity: true, limitations: LIMITATIONS,
  };
}

function sourceDescriptors(values: ReadonlyMap<string, Uint8Array>): object[] {
  return SOURCE_PATHS.map((filePath) => {
    const bytes = values.get(filePath); if (bytes === undefined) throw new ProfileAbort('source-read-failed', filePath);
    return descriptor(filePath, bytes);
  });
}
async function readSources(dependencies: RepresentativeNumericalProfileReadDependencies): Promise<ReadonlyMap<string, Uint8Array>> {
  const output = new Map<string, Uint8Array>();
  for (const filePath of SOURCE_PATHS) {
    const bytes = await safeRead(dependencies.readFile, filePath); if (bytes === undefined) throw new ProfileAbort('source-read-failed', filePath);
    output.set(filePath, bytes);
  }
  return output;
}

function attributionForRecord(record: NormalizedProfileRecord, config: FrozenProfileConfig): JsonRecord {
  const ids = categories(config).map(({ id }) => id);
  const totals = Object.fromEntries(ids.map((id) => [id, 0n])) as Record<string, bigint>;
  for (let index = 0; index < record.profile.samples.length; index += 1) {
    const category = record.leafCategories[index]; const delta = record.profile.timeDeltas[index];
    if (category === undefined || delta === undefined || totals[category] === undefined) throw new ProfileAbort('analysis-reconstruction-mismatch', `profile/${record.profileIndex}`);
    totals[category] += BigInt(delta);
  }
  const encoded = Object.fromEntries(ids.map((id) => [id, (totals[id] ?? 0n).toString(10)]));
  let leader: string | null = null;
  for (const id of ids) {
    if (ids.every((other) => other === id || (totals[id] ?? 0n) > (totals[other] ?? 0n))) { leader = id; break; }
  }
  return { profileIndex: record.profileIndex, caseId: record.caseId, caseProfileIndex: record.caseProfileIndex,
    sweepOrder: record.sweepOrder, sampleCount: record.profile.samples.length,
    totalSampledMicroseconds: record.profile.timeDeltas.reduce((sum, value) => sum + BigInt(value), 0n).toString(10),
    attributedMicroseconds: encoded, strictUniqueLeader: leader };
}

export function deriveRepresentativeProfileRecommendation(
  profileLeaders: readonly (string | null)[],
  candidateMicroseconds: readonly string[],
  perCaseCandidateSetExpansions: readonly number[],
  allSemanticParity: boolean,
): 'design-one-sound-candidate-set-pruning-experiment' | 'decline-sound-pruning-selection-from-this-supported-regime-suite' {
  if (profileLeaders.length !== 12 || candidateMicroseconds.length !== 12
    || perCaseCandidateSetExpansions.length !== 4 || !perCaseCandidateSetExpansions.every(isSafeNonnegativeInteger)
    || !candidateMicroseconds.every(isCanonicalNonnegativeInteger)) throw new ProfileAbort('invalid-artifact-shape', 'decision/inputs');
  return allSemanticParity && profileLeaders.every((leader) => leader === 'candidate-set-discovery')
    && candidateMicroseconds.every((value) => BigInt(value) > 0n)
    && perCaseCandidateSetExpansions.every((value) => value > 0)
    ? 'design-one-sound-candidate-set-pruning-experiment'
    : 'decline-sound-pruning-selection-from-this-supported-regime-suite';
}

function buildAnalysis(config: FrozenProfileConfig, work: JsonRecord, records: readonly NormalizedProfileRecord[]): JsonRecord {
  const attributions = records.map((record) => attributionForRecord(record, config));
  const cases = work['cases'];
  if (!Array.isArray(cases)) throw new ProfileAbort('invalid-artifact-shape', 'semantic-work/cases');
  const candidateWork = cases.map((value) => isRecord(value) && isSafeNonnegativeInteger(value['candidateSetExpansions']) ? value['candidateSetExpansions'] : -1);
  const candidateTimes = attributions.map((value) => (value['attributedMicroseconds'] as JsonRecord)['candidate-set-discovery'] as string);
  const leaders = attributions.map((value) => value['strictUniqueLeader'] as string | null);
  const recommendation = deriveRepresentativeProfileRecommendation(leaders, candidateTimes, candidateWork, work['allSemanticParity'] === true);
  return {
    schemaVersion: 'routelab.numerical-representative-profile-analysis.v1', profileId: PROFILE_ID,
    inputBinding: { profileConfigSha256: REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_SHA256 },
    method: config.decision, profiles: attributions,
    perCaseCandidateSetExpansions: Object.fromEntries(CASE_IDS.map((caseId, index) => [caseId, candidateWork[index]])),
    decision: { recommendation, positive: recommendation === 'design-one-sound-candidate-set-pruning-experiment',
      scope: config.decision['recommendationScope'] }, limitations: LIMITATIONS,
  };
}

function createSummary(files: Readonly<Record<ArtifactName, string>>, recommendation: string): RepresentativeNumericalProfileSummary {
  return deepFreeze({ schemaVersion: 'routelab.numerical-representative-profile-summary.v1', profileId: PROFILE_ID,
    profileConfigSha256: REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_SHA256, eligibleCellCount: 1269 as const,
    totalNumericalCalls: 13959 as const, timingSampleCount: 6345 as const, cpuProfileCount: 12 as const,
    semanticWorkSha256: sha256(files['semantic-work.json']), timingObservationsSha256: sha256(files['timing-observations.json']),
    cpuProfileObservationsSha256: sha256(files['cpu-profile-observations.json']), analysisSha256: sha256(files['analysis.json']), recommendation });
}

function buildManifest(config: FrozenProfileConfig, artifacts: object, sources: object[], recommendation: string): JsonRecord {
  return { schemaVersion: 'routelab.numerical-representative-profile-manifest.v1', profileId: PROFILE_ID,
    profileConfig: { path: REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_PATH, bytes: REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_BYTES, sha256: REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_SHA256 },
    acceptedBaselineRevision: REPRESENTATIVE_NUMERICAL_PROFILE_EVIDENCE_REVISION,
    sources, artifacts, counts: { eligibleCellCount: 1269, totalNumericalCalls: 13959, timingSampleCount: 6345, cpuProfileCount: 12 },
    recommendation, claims: config.claims, limitations: LIMITATIONS };
}

export async function createRepresentativeNumericalProfile(sourceDependencies: RepresentativeNumericalProfileGenerationDependencies): Promise<RepresentativeNumericalProfileGenerationResult> {
  const dependencies = cachedDependencies(sourceDependencies);
  try {
    if (sourceDependencies.evidenceRevision !== REPRESENTATIVE_NUMERICAL_PROFILE_EVIDENCE_REVISION) throw new ProfileAbort('evidence-revision-mismatch', 'evidence-revision');
    const config = await readConfig(dependencies); await verifyBoundInputs(dependencies, config);
    const environment = sourceDependencies.environment ?? captureEnvironment();
    if (!validateEnvironment(environment)) throw new ProfileAbort('environment-mismatch', 'environment');
    const inputs = await prepareInputs(dependencies, config);
    const route = sourceDependencies.route ?? routeExactInputSplitNumericalAnytime;
    const clock = sourceDependencies.clock ?? Object.freeze({ now: () => process.hrtime.bigint() });
    const profiler = sourceDependencies.profiler ?? actualProfiler();
    const schedule = await executeRepresentativeObservationSchedule(inputs.cohorts,
      (cell) => prepareCell(cell, route), (result, cell) => assertParity(result, cell), clock, profiler);
    if (schedule.totalCallCount !== 13_959 || schedule.timingSamples.length !== 6_345 || schedule.cpuSweeps.length !== 12) throw new ProfileAbort('observation-schedule-mismatch', 'counts');
    const work = semanticWork(inputs.cohorts);
    const timingSamples = schedule.timingSamples.map((sample) => {
      const cohort = inputs.cohorts.find(({ caseId }) => caseId === sample.caseId); const cell = cohort?.cells[sample.cohortIndex];
      if (cell === undefined) throw new ProfileAbort('cohort-mismatch', 'timing/cell');
      return { ...sample, requestId: cell.requestId, resultSha256: cell.resultSha256 };
    });
    const records = schedule.cpuSweeps.map((sweep): NormalizedProfileRecord => {
      const profile = normalizeProfile(sweep.rawProfile, sourceDependencies.repositoryRoot, config);
      return deepFreeze({
        profileIndex: sweep.profileIndex,
        caseId: sweep.caseId,
        caseProfileIndex: sweep.caseProfileIndex,
        sweepOrder: sweep.sweepOrder,
        callCount: sweep.callCount,
        profile,
        leafCategories: annotate(profile, config),
      });
    });
    const semanticJson = canonicalJson(work);
    const timingJson = canonicalJson({ schemaVersion: 'routelab.numerical-representative-profile-timing-observations.v1', profileId: PROFILE_ID,
      inputBinding: { profileConfigSha256: REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_SHA256, semanticWorkSha256: sha256(semanticJson) },
      environment, protocol: { clock: 'process.hrtime.bigint', scope: 'routeExactInputSplitNumericalAnytime-direct-call-only-unprofiled',
        warmupSweepsPerCase: 1, measuredSweepsPerCase: 5, sweepOrder: ['forward', 'reverse', 'forward', 'reverse', 'forward'],
        sampleCount: 6345, crossCaseElapsedComparison: 'forbidden' }, samples: timingSamples });
    const cpuJson = canonicalJson({ schemaVersion: 'routelab.numerical-representative-profile-cpu-observations.v1', profileId: PROFILE_ID,
      inputBinding: { profileConfigSha256: REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_SHA256, semanticWorkSha256: sha256(semanticJson), environmentSha256: sha256(JSON.stringify(environment)) },
      profiler: { api: 'node:inspector/promises', domain: 'Profiler', samplingIntervalMicroseconds: 1000, sessionCount: 1, recordedProfileCount: 12, population: 'all-recorded-samples-no-root-filter' },
      profiles: records });
    const analysis = buildAnalysis(config, work, records); const analysisJson = canonicalJson(analysis);
    const artifactDescriptors = {
      'semantic-work.json': descriptor('semantic-work.json', semanticJson), 'timing-observations.json': descriptor('timing-observations.json', timingJson),
      'cpu-profile-observations.json': descriptor('cpu-profile-observations.json', cpuJson), 'analysis.json': descriptor('analysis.json', analysisJson),
    };
    const sources = sourceDescriptors(await readSources(dependencies));
    const decision = analysis['decision']; if (!isRecord(decision) || typeof decision['recommendation'] !== 'string') throw new ProfileAbort('invalid-artifact-shape', 'analysis/decision');
    const manifestJson = canonicalJson(buildManifest(config, artifactDescriptors, sources, decision['recommendation']));
    const capChecks = [
      ['semantic-work.json', semanticJson, 'maxSemanticWorkBytes'], ['timing-observations.json', timingJson, 'maxTimingObservationBytes'],
      ['cpu-profile-observations.json', cpuJson, 'maxCpuProfileObservationBytes'], ['analysis.json', analysisJson, 'maxAnalysisBytes'],
      ['manifest.json', manifestJson, 'maxManifestBytes'],
    ] as const;
    for (const [name, value, field] of capChecks) if (Buffer.byteLength(value) > cap(config, field)) throw new ProfileAbort('resource-cap-exceeded', name);
    const total = capChecks.reduce((sum, [, value]) => sum + Buffer.byteLength(value), 0);
    if (total > cap(config, 'maxTotalArtifactBytes')) throw new ProfileAbort('resource-cap-exceeded', 'artifact-set');
    const files = deepFreeze({ 'semantic-work.json': semanticJson, 'timing-observations.json': timingJson,
      'cpu-profile-observations.json': cpuJson, 'analysis.json': analysisJson, 'manifest.json': manifestJson });
    return Object.freeze({ ok: true, value: deepFreeze({ files, summary: createSummary(files, decision['recommendation']) }) });
  } catch (error) {
    return error instanceof ProfileAbort ? failure(error.code, error.artifact) : failure('invalid-artifact-shape', 'generation');
  }
}

function manifestArtifacts(value: unknown): Readonly<Record<Exclude<ArtifactName, 'manifest.json'>, ArtifactDescriptor>> {
  if (!isRecord(value) || !isRecord(value['artifacts'])) throw new ProfileAbort('invalid-artifact-shape', 'manifest.json');
  const result: Partial<Record<Exclude<ArtifactName, 'manifest.json'>, ArtifactDescriptor>> = {};
  for (const name of ARTIFACT_NAMES.slice(0, -1) as readonly Exclude<ArtifactName, 'manifest.json'>[]) {
    const current = value['artifacts'][name];
    if (!isRecord(current) || current['path'] !== name || !isSafeNonnegativeInteger(current['bytes']) || !isSha256(current['sha256'])) throw new ProfileAbort('invalid-artifact-shape', `manifest/${name}`);
    result[name] = { path: name, bytes: current['bytes'], sha256: current['sha256'] };
  }
  return result as Readonly<Record<Exclude<ArtifactName, 'manifest.json'>, ArtifactDescriptor>>;
}
async function readArtifact(directory: string, dependencies: RepresentativeNumericalProfileReadDependencies, current: ArtifactDescriptor) {
  const bytes = await safeRead(dependencies.readFile, path.join(directory, current.path));
  if (bytes === undefined) throw new ProfileAbort('artifact-read-failed', current.path);
  if (bytes.byteLength !== current.bytes) throw new ProfileAbort('artifact-size-mismatch', current.path);
  if (sha256(bytes) !== current.sha256) throw new ProfileAbort('artifact-hash-mismatch', current.path);
  const parsed = parseJson(bytes, current.path); if (parsed.text !== canonicalJson(parsed.value)) throw new ProfileAbort('invalid-artifact-json', current.path);
  return parsed;
}

function validateTiming(value: unknown, cohorts: readonly ExpectedCohort[], semanticHash: string): RepresentativeProfileEnvironment {
  if (!isRecord(value) || value['schemaVersion'] !== 'routelab.numerical-representative-profile-timing-observations.v1'
    || value['profileId'] !== PROFILE_ID || !isRecord(value['inputBinding'])
    || !isDeepStrictEqual(value['inputBinding'], {
      profileConfigSha256: REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_SHA256,
      semanticWorkSha256: semanticHash,
    })
    || !isDeepStrictEqual(value['protocol'], {
      clock: 'process.hrtime.bigint',
      scope: 'routeExactInputSplitNumericalAnytime-direct-call-only-unprofiled',
      warmupSweepsPerCase: 1,
      measuredSweepsPerCase: 5,
      sweepOrder: ['forward', 'reverse', 'forward', 'reverse', 'forward'],
      sampleCount: 6345,
      crossCaseElapsedComparison: 'forbidden',
    })
    || !validateEnvironment(value['environment']) || !Array.isArray(value['samples']) || value['samples'].length !== 6_345) throw new ProfileAbort('invalid-artifact-shape', 'timing-observations.json');
  const expected: Array<{ caseId: CaseId; sweep: number; sweepOrder: SweepOrder; order: number; cohortIndex: number; requestId: string; resultSha256: string }> = [];
  const sweepOrders = ['forward', 'reverse', 'forward', 'reverse', 'forward'] as const;
  for (const cohort of cohorts) for (let sweep = 0; sweep < 5; sweep += 1) {
    const sweepOrder = sweepOrders[sweep] ?? 'forward'; let order = 0;
    for (const cohortIndex of orders(cohort.cells.length, sweepOrder)) {
      const cell = cohort.cells[cohortIndex]; if (cell === undefined) throw new ProfileAbort('cohort-mismatch', 'timing/expected');
      expected.push({ caseId: cohort.caseId, sweep, sweepOrder, order, cohortIndex, requestId: cell.requestId, resultSha256: cell.resultSha256 }); order += 1;
    }
  }
  for (let index = 0; index < expected.length; index += 1) {
    const sample = (value['samples'] as unknown[])[index]; const target = expected[index];
    if (!isRecord(sample) || target === undefined || sample['sampleIndex'] !== index
      || !Object.entries(target).every(([key, current]) => sample[key] === current)
      || !isCanonicalNonnegativeInteger(sample['elapsedNanoseconds'])) throw new ProfileAbort('observation-schedule-mismatch', `timing/${index}`);
  }
  return value['environment'];
}

function parseCpuRecords(value: unknown, config: FrozenProfileConfig, semanticHash: string, environmentHash: string): readonly NormalizedProfileRecord[] {
  if (!isRecord(value) || value['schemaVersion'] !== 'routelab.numerical-representative-profile-cpu-observations.v1'
    || value['profileId'] !== PROFILE_ID || !isRecord(value['inputBinding'])
    || !isDeepStrictEqual(value['inputBinding'], {
      profileConfigSha256: REPRESENTATIVE_NUMERICAL_PROFILE_CONFIG_SHA256,
      semanticWorkSha256: semanticHash,
      environmentSha256: environmentHash,
    })
    || !isDeepStrictEqual(value['profiler'], {
      api: 'node:inspector/promises', domain: 'Profiler', samplingIntervalMicroseconds: 1000,
      sessionCount: 1, recordedProfileCount: 12, population: 'all-recorded-samples-no-root-filter',
    }) || !Array.isArray(value['profiles'])
    || value['profiles'].length !== 12) throw new ProfileAbort('invalid-artifact-shape', 'cpu-profile-observations.json');
  return Object.freeze(value['profiles'].map((current, profileIndex): NormalizedProfileRecord => {
    if (!isRecord(current) || !isDeepStrictEqual(Object.keys(current), [
      'profileIndex', 'caseId', 'caseProfileIndex', 'sweepOrder', 'callCount', 'profile', 'leafCategories',
    ])) throw new ProfileAbort('invalid-artifact-shape', `cpu/${profileIndex}`);
    const caseIndex = Math.floor(profileIndex / 3); const caseProfileIndex = profileIndex % 3;
    const caseId = CASE_IDS[caseIndex]; const sweepOrder = (['forward', 'reverse', 'forward'] as const)[caseProfileIndex];
    const callCount = EXPECTED_ELIGIBLE_COUNTS[caseIndex];
    if (caseId === undefined || sweepOrder === undefined || callCount === undefined || current['profileIndex'] !== profileIndex
      || current['caseId'] !== caseId || current['caseProfileIndex'] !== caseProfileIndex
      || current['sweepOrder'] !== sweepOrder || current['callCount'] !== callCount
      || !Array.isArray(current['leafCategories'])) throw new ProfileAbort('observation-schedule-mismatch', `cpu/${profileIndex}`);
    const profile = validateNormalizedProfile(current['profile'], config); const leafCategories = annotate(profile, config);
    if (!isDeepStrictEqual(current['leafCategories'], leafCategories)) throw new ProfileAbort('analysis-reconstruction-mismatch', `cpu/${profileIndex}/attribution`);
    return deepFreeze({ profileIndex, caseId, caseProfileIndex, sweepOrder, callCount, profile, leafCategories });
  }));
}

export async function verifyRepresentativeNumericalProfile(directory: string, sourceDependencies: RepresentativeNumericalProfileReadDependencies): Promise<RepresentativeNumericalProfileVerificationResult> {
  const dependencies = cachedDependencies(sourceDependencies);
  try {
    const manifestBytes = await safeRead(dependencies.readFile, path.join(directory, 'manifest.json'));
    if (manifestBytes === undefined) throw new ProfileAbort('artifact-read-failed', 'manifest.json');
    const manifest = parseJson(manifestBytes, 'manifest.json'); if (manifest.text !== canonicalJson(manifest.value)) throw new ProfileAbort('invalid-artifact-json', 'manifest.json');
    const config = await readConfig(dependencies); await verifyBoundInputs(dependencies, config);
    if (manifestBytes.byteLength > cap(config, 'maxManifestBytes')) throw new ProfileAbort('resource-cap-exceeded', 'manifest.json');
    const declared = manifestArtifacts(manifest.value);
    const declaredCaps = [
      ['semantic-work.json', 'maxSemanticWorkBytes'],
      ['timing-observations.json', 'maxTimingObservationBytes'],
      ['cpu-profile-observations.json', 'maxCpuProfileObservationBytes'],
      ['analysis.json', 'maxAnalysisBytes'],
    ] as const;
    for (const [name, field] of declaredCaps) {
      if (declared[name].bytes > cap(config, field)) throw new ProfileAbort('resource-cap-exceeded', name);
    }
    const totalBytes = manifestBytes.byteLength + Object.values(declared).reduce((sum, current) => sum + current.bytes, 0);
    if (totalBytes > cap(config, 'maxTotalArtifactBytes')) throw new ProfileAbort('resource-cap-exceeded', 'artifact-set');
    const artifacts = await Promise.all([
      readArtifact(directory, dependencies, declared['semantic-work.json']), readArtifact(directory, dependencies, declared['timing-observations.json']),
      readArtifact(directory, dependencies, declared['cpu-profile-observations.json']), readArtifact(directory, dependencies, declared['analysis.json']),
    ]);
    const inputs = await prepareInputs(dependencies, config);
    for (const cohort of inputs.cohorts) for (const cell of cohort.cells) assertParity(prepareCell(cell, routeExactInputSplitNumericalAnytime)(), cell);
    const expectedWork = semanticWork(inputs.cohorts); const semanticArtifact = artifacts[0];
    if (semanticArtifact === undefined || semanticArtifact.text !== canonicalJson(expectedWork)) throw new ProfileAbort('semantic-reconstruction-mismatch', 'semantic-work.json');
    const semanticHash = sha256(semanticArtifact.text); const timingArtifact = artifacts[1];
    if (timingArtifact === undefined) throw new ProfileAbort('artifact-read-failed', 'timing-observations.json');
    const environment = validateTiming(timingArtifact.value, inputs.cohorts, semanticHash);
    const cpuArtifact = artifacts[2]; if (cpuArtifact === undefined) throw new ProfileAbort('artifact-read-failed', 'cpu-profile-observations.json');
    const records = parseCpuRecords(cpuArtifact.value, config, semanticHash, sha256(JSON.stringify(environment)));
    const expectedAnalysis = buildAnalysis(config, expectedWork, records); const analysisArtifact = artifacts[3];
    if (analysisArtifact === undefined || analysisArtifact.text !== canonicalJson(expectedAnalysis)) throw new ProfileAbort('analysis-reconstruction-mismatch', 'analysis.json');
    const decision = expectedAnalysis['decision']; if (!isRecord(decision) || typeof decision['recommendation'] !== 'string') throw new ProfileAbort('invalid-artifact-shape', 'analysis/decision');
    const expectedManifest = buildManifest(config, declared, sourceDescriptors(await readSources(dependencies)), decision['recommendation']);
    if (manifest.text !== canonicalJson(expectedManifest)) throw new ProfileAbort('manifest-reconstruction-mismatch', 'manifest.json');
    const files = deepFreeze({ 'semantic-work.json': semanticArtifact.text, 'timing-observations.json': timingArtifact.text,
      'cpu-profile-observations.json': cpuArtifact.text, 'analysis.json': analysisArtifact.text, 'manifest.json': manifest.text });
    return Object.freeze({ ok: true, value: createSummary(files, decision['recommendation']) });
  } catch (error) {
    return error instanceof ProfileAbort ? failure(error.code, error.artifact) : failure('invalid-artifact-shape', 'verification');
  }
}

export const defaultRepresentativeNumericalProfileReadDependencies = Object.freeze({ readFile: defaultReadFile });
