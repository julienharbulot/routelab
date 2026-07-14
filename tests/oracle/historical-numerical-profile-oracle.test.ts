import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

type JsonRecord = Record<string, unknown>;

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HISTORICAL_REFERENCE_SOURCES: Readonly<Record<string, string>> = Object.freeze({
  'src/router/numerical-exact-input-split/index.ts':
    'fixtures/m7/numerical-representative-profile/provenance/numerical-exact-input-split.index.source.ts',
  'cli/verify-historical-numerical-profile.ts':
    'fixtures/m7/numerical-representative-profile/provenance/verify-historical-numerical-profile.source.ts',
  'package.json':
    'fixtures/retained-reference-source/rlt080-package.source.json',
});
const CONFIG = 'fixtures/m7/numerical-baseline-profile/profile-config.v1.json';
const ELIGIBILITY = 'fixtures/m7/numerical-historical/eligibility.v1.json';
const NUMERICAL_SEMANTIC =
  'datasets/evaluations/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/'
  + 'synthetic-exhaustive-v1/numerical-path-shadow-price-v1/semantic-results.json';
const PROFILE_DIRECTORY =
  'datasets/profiles/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/'
  + 'synthetic-exhaustive-v1/numerical-path-shadow-price-baseline-v1';
const PROFILE_ID = 'm7b-core12-synthetic-exhaustive-numerical-baseline-profile-v1';
const ACCEPTED_EVIDENCE_REVISION = '694be6f32c3aadc38f5b7f8eba68edde52e737e6';
const CONFIG_BYTES = 10_435;
const CONFIG_SHA256 =
  'sha256:894aca8f1c402a5677582f18db3d24de40f199141dca284fac75aef945438349';
const SEMANTIC_SHA256 =
  'sha256:da8aea57ea9c4ded88edc6d9b4a7e703a4a2c4d3d5953a37226e06d36e77396a';
const TIMING_SHA256 =
  'sha256:84727a7ab98e22eb83a6a55cab4384554f102a4c1ad60d6b5e364765d067346e';
const CPU_SHA256 =
  'sha256:42397d3f425f338f7aac7042e50d48d12cc4fd32c17a41b4c49368106d95e3a9';
const ANALYSIS_SHA256 =
  'sha256:4c88f87cb4bdc7dee3fddd21d984d55a3424c1549f99a7f6f4205019affc0c58';
const MANIFEST_SHA256 =
  'sha256:1e77950151bbcc5b2e3cab77156d1e9ec35289c02b6afa781feecbdb78c298b2';

const ARTIFACTS = {
  'semantic-work.json': { bytes: 413_657, sha256: SEMANTIC_SHA256 },
  'timing-observations.json': { bytes: 508_921, sha256: TIMING_SHA256 },
  'cpu-profile-observations.json': { bytes: 455_442, sha256: CPU_SHA256 },
  'analysis.json': { bytes: 8_137, sha256: ANALYSIS_SHA256 },
  'manifest.json': { bytes: 11_503, sha256: MANIFEST_SHA256 },
} as const;

const COUNTER_FIELDS = [
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
] as const;

const TIMING_SWEEP_ORDER = ['forward', 'reverse', 'forward', 'reverse', 'forward'] as const;
const CPU_SWEEP_ORDER = ['forward', 'reverse', 'forward'] as const;
const ALL_SAMPLE_LEADER_MICROSECONDS = [1_432_471, 1_374_640, 1_391_048] as const;

function absolute(relative: string): string {
  return path.join(ROOT, relative);
}

function bytes(relative: string): Buffer {
  const archived = HISTORICAL_REFERENCE_SOURCES[relative];
  const retained = archived !== undefined && existsSync(absolute(archived))
    ? archived
    : relative;
  return readFileSync(absolute(retained));
}

function text(relative: string): string {
  return bytes(relative).toString('utf8');
}

function record(value: unknown): JsonRecord {
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as JsonRecord;
}

function array(value: unknown): readonly unknown[] {
  assert.equal(Array.isArray(value), true);
  return value as readonly unknown[];
}

function string(value: unknown): string {
  assert.equal(typeof value, 'string');
  return value as string;
}

function safeInteger(value: unknown): number {
  assert.equal(typeof value, 'number');
  assert.equal(Number.isSafeInteger(value), true);
  assert.ok((value as number) >= 0);
  return value as number;
}

function nonnegativeDecimal(value: unknown): bigint {
  const raw = string(value);
  assert.match(raw, /^(?:0|[1-9][0-9]*)$/u);
  return BigInt(raw);
}

function safeNonnegativeDecimal(value: unknown): bigint {
  const parsed = nonnegativeDecimal(value);
  assert.ok(parsed <= BigInt(Number.MAX_SAFE_INTEGER));
  return parsed;
}

function signedDecimal(value: unknown): bigint {
  const raw = string(value);
  assert.match(raw, /^(?:0|-?[1-9][0-9]*)$/u);
  const parsed = BigInt(raw);
  assert.ok(parsed >= BigInt(Number.MIN_SAFE_INTEGER));
  assert.ok(parsed <= BigInt(Number.MAX_SAFE_INTEGER));
  return parsed;
}

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function assertKeys(value: JsonRecord, expected: readonly string[]): void {
  assert.deepEqual(Object.keys(value), expected);
}

function canonical(relative: string, expectedBytes: number, expectedSha256: string): JsonRecord {
  const raw = text(relative);
  assert.equal(Buffer.byteLength(raw), expectedBytes);
  assert.equal(sha256(raw), expectedSha256);
  assert.equal(raw.endsWith('\n'), true);
  assert.equal(raw.endsWith('\n\n'), false);
  const parsed = record(JSON.parse(raw) as unknown);
  assert.equal(`${JSON.stringify(parsed)}\n`, raw);
  return parsed;
}

function descriptor(relative: string): JsonRecord {
  const raw = bytes(relative);
  return {
    path: relative,
    bytes: raw.byteLength,
    sha256: sha256(raw),
  };
}

function assertBoundDescriptors(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertBoundDescriptors(item);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const current = value as JsonRecord;
  const keys = Object.keys(current);
  if (keys.length === 3 && keys[0] === 'path' && keys[1] === 'bytes' && keys[2] === 'sha256') {
    const relative = string(current['path']);
    assert.equal(path.isAbsolute(relative), false);
    assert.equal(relative.includes('\\'), false);
    assert.equal(relative.split('/').includes('..'), false);
    assert.deepEqual(current, descriptor(relative));
  }
  for (const nested of Object.values(current)) assertBoundDescriptors(nested);
}

function counterRecord(value: unknown): JsonRecord {
  const counters = record(value);
  assertKeys(counters, COUNTER_FIELDS);
  for (const field of COUNTER_FIELDS) safeInteger(counters[field]);
  return counters;
}

function reconstructSemanticWork(
  config: JsonRecord,
): { readonly value: JsonRecord; readonly cells: readonly JsonRecord[] } {
  const eligibility = record(JSON.parse(text(ELIGIBILITY)) as unknown);
  const numerical = record(JSON.parse(text(NUMERICAL_SEMANTIC)) as unknown);
  const eligibilityCells = array(eligibility['cells']).map(record);
  const numericalCells = array(numerical['cells']).map(record);
  assert.equal(eligibilityCells.length, 2_376);
  assert.equal(numericalCells.length, 2_376);

  const totals = Object.fromEntries(COUNTER_FIELDS.map((field) => [field, 0]));
  const maxima = Object.fromEntries(COUNTER_FIELDS.map((field) => [field, 0]));
  const cohort: JsonRecord[] = [];
  for (let sourceIndex = 0; sourceIndex < eligibilityCells.length; sourceIndex += 1) {
    const eligibilityCell = eligibilityCells[sourceIndex];
    const numericalCell = numericalCells[sourceIndex];
    assert.ok(eligibilityCell && numericalCell);
    const request = record(numericalCell['request']);
    const profile = record(numericalCell['profile']);
    assert.equal(eligibilityCell['requestId'], request['requestId']);
    assert.equal(eligibilityCell['profileId'], profile['profileId']);
    assert.deepEqual(numericalCell['eligibility'], eligibilityCell['status'] === 'eligible'
      ? { status: 'eligible' }
      : { status: 'ineligible', reason: eligibilityCell['reason'] });
    if (eligibilityCell['status'] !== 'eligible') continue;

    const result = record(numericalCell['result']);
    assert.equal(result['status'], 'success');
    const plan = record(result['plan']);
    const search = record(plan['search']);
    const counters = counterRecord(search['counters']);
    const diagnostics = array(search['numericalDiagnostics']);
    for (const field of COUNTER_FIELDS) {
      const count = safeInteger(counters[field]);
      totals[field] = (totals[field] ?? 0) + count;
      maxima[field] = Math.max(maxima[field] ?? 0, count);
    }
    cohort.push({
      cohortIndex: cohort.length,
      requestId: request['requestId'],
      profileId: profile['profileId'],
      semanticHash: numericalCell['semanticHash'],
      resultSha256: sha256(JSON.stringify(result)),
      counters,
      numericalDiagnosticCount: diagnostics.length,
      numericalDiagnosticsSha256: sha256(JSON.stringify(diagnostics)),
    });
  }
  assert.equal(cohort.length, 414);

  const inputBinding = record(config['inputBinding']);
  const m7 = record(inputBinding['m7NumericalEvaluation']);
  const value = {
    schemaVersion: 'routelab.numerical-baseline-profile-semantic-work.v1',
    profileId: PROFILE_ID,
    inputBinding: {
      profileConfigSha256: CONFIG_SHA256,
      acceptedEvidenceRevision: ACCEPTED_EVIDENCE_REVISION,
      numericalSemanticResults: m7['semanticResults'],
    },
    cohort: {
      order: 'eligibility-source-cell-order',
      eligibleCellCount: cohort.length,
      cells: cohort,
    },
    work: {
      kindsRemainSeparate: true,
      counterFields: COUNTER_FIELDS,
      counterTotals: totals,
      counterMaxima: maxima,
    },
  };
  return { value, cells: cohort };
}

function validateEnvironment(value: unknown): JsonRecord {
  const environment = record(value);
  assertKeys(environment, [
    'nodeVersion',
    'v8Version',
    'uvVersion',
    'platform',
    'arch',
    'endianness',
    'osType',
    'osRelease',
    'cpuModel',
    'cpuSpeedMHz',
    'logicalCpuCount',
    'availableParallelism',
    'totalMemoryBytes',
    'execArgv',
    'nodeOptionsState',
    'mainThread',
  ]);
  for (const field of [
    'nodeVersion',
    'v8Version',
    'uvVersion',
    'platform',
    'arch',
    'endianness',
    'osType',
    'osRelease',
    'cpuModel',
  ]) assert.notEqual(string(environment[field]), '');
  safeInteger(environment['cpuSpeedMHz']);
  assert.ok(safeInteger(environment['logicalCpuCount']) > 0);
  assert.ok(safeInteger(environment['availableParallelism']) > 0);
  assert.ok(nonnegativeDecimal(environment['totalMemoryBytes']) > 0n);
  assert.deepEqual(array(environment['execArgv']), []);
  assert.ok(environment['nodeOptionsState'] === 'unset' || environment['nodeOptionsState'] === 'empty');
  assert.equal(environment['mainThread'], true);
  return environment;
}

function validateTiming(
  timing: JsonRecord,
  environment: JsonRecord,
  cohort: readonly JsonRecord[],
): void {
  assertKeys(timing, [
    'schemaVersion',
    'profileId',
    'inputBinding',
    'environment',
    'protocol',
    'samples',
  ]);
  assert.equal(timing['schemaVersion'], 'routelab.numerical-baseline-profile-timing-observations.v1');
  assert.equal(timing['profileId'], PROFILE_ID);
  assert.deepEqual(timing['inputBinding'], {
    profileConfigSha256: CONFIG_SHA256,
    semanticWorkSha256: SEMANTIC_SHA256,
  });
  assert.deepEqual(timing['environment'], environment);
  assert.deepEqual(timing['protocol'], {
    clock: 'process.hrtime.bigint',
    scope: 'routeExactInputSplitNumericalAnytime-call-only-unprofiled',
    warmupSweeps: 1,
    measuredSweeps: 5,
    sweepOrder: TIMING_SWEEP_ORDER,
    sampleCount: 2_070,
    resultCheck: 'outside-timed-region-after-each-call',
  });

  const samples = array(timing['samples']).map(record);
  assert.equal(samples.length, 2_070);
  for (let sweep = 0; sweep < TIMING_SWEEP_ORDER.length; sweep += 1) {
    const order = TIMING_SWEEP_ORDER[sweep];
    assert.ok(order);
    for (let position = 0; position < cohort.length; position += 1) {
      const sample = samples[(sweep * cohort.length) + position];
      assert.ok(sample);
      assertKeys(sample, [
        'sweep',
        'sweepOrder',
        'order',
        'cohortIndex',
        'elapsedNanoseconds',
        'requestId',
        'profileId',
        'semanticHash',
      ]);
      const cohortIndex: number = order === 'forward' ? position : cohort.length - 1 - position;
      const cell: JsonRecord | undefined = cohort.at(cohortIndex);
      assert.ok(cell);
      assert.equal(sample['sweep'], sweep);
      assert.equal(sample['sweepOrder'], order);
      assert.equal(sample['order'], position);
      assert.equal(sample['cohortIndex'], cohortIndex);
      assert.ok(nonnegativeDecimal(sample['elapsedNanoseconds']) > 0n);
      assert.equal(sample['requestId'], cell['requestId']);
      assert.equal(sample['profileId'], cell['profileId']);
      assert.equal(sample['semanticHash'], cell['semanticHash']);
    }
  }
}

function safeProfileUrl(value: unknown): string {
  const url = string(value);
  assert.equal(url.includes('\\'), false);
  assert.equal(url.startsWith('/'), false);
  assert.equal(/^[A-Za-z]:/u.test(url), false);
  assert.equal(url.startsWith('file:'), false);
  assert.equal(url.split('/').includes('..'), false);
  if (url !== '' && !url.startsWith('node:')) {
    assert.match(url, /^(?:src|cli|node_modules)\//u);
  }
  return url;
}

function categoryFor(callFrame: JsonRecord, categories: readonly JsonRecord[]): string {
  const functionName = string(callFrame['functionName']);
  const url = safeProfileUrl(callFrame['url']);
  for (const category of categories) {
    const functionNames = category['functionNames'] === undefined
      ? []
      : array(category['functionNames']).map(string);
    const paths = category['paths'] === undefined ? [] : array(category['paths']).map(string);
    const pathPrefixes = category['pathPrefixes'] === undefined
      ? []
      : array(category['pathPrefixes']).map(string);
    const urlPrefixes = category['urlPrefixes'] === undefined
      ? []
      : array(category['urlPrefixes']).map(string);
    const pathFunctionNames = category['pathFunctionNames'] === undefined
      ? []
      : array(category['pathFunctionNames']).map(string);
    const matches = functionNames.includes(functionName)
      || paths.includes(url)
      || pathPrefixes.some((prefix) => url.startsWith(prefix))
      || urlPrefixes.some((prefix) => url.startsWith(prefix))
      || pathFunctionNames.includes(functionName);
    if (matches || category['fallback'] === true) return string(category['id']);
  }
  assert.fail('a frozen fallback category is required');
}

interface ReconstructedCpuProfile {
  readonly profileIndex: number;
  readonly sweepOrder: string;
  readonly totalSampleCount: number;
  readonly totalSampledMicroseconds: number;
  readonly runtimeRootSampleCount: number;
  readonly runtimeRootSampledMicroseconds: number;
  readonly categories: readonly JsonRecord[];
  readonly strictUniqueWithinRuntimeRootLeader: string | null;
  readonly allSampleLeader: string | null;
}

function uniqueLeader(
  categories: readonly JsonRecord[],
  field: 'allSampledMicroseconds' | 'withinRuntimeRootSampledMicroseconds',
): string | null {
  const maximum = Math.max(...categories.map((category) => safeInteger(category[field])));
  if (maximum === 0) return null;
  const leaders = categories.filter((category) => category[field] === maximum);
  return leaders.length === 1 ? string(leaders[0]?.['id']) : null;
}

function reconstructCpuProfile(
  retained: JsonRecord,
  categories: readonly JsonRecord[],
  runtimeRoot: JsonRecord,
  profileIndex: number,
): ReconstructedCpuProfile {
  assertKeys(retained, [
    'profileIndex',
    'sweepOrder',
    'callCount',
    'profile',
    'runtimeRootMembership',
    'leafCategories',
  ]);
  const sweepOrder = CPU_SWEEP_ORDER[profileIndex];
  assert.ok(sweepOrder);
  assert.equal(retained['profileIndex'], profileIndex);
  assert.equal(retained['sweepOrder'], sweepOrder);
  assert.equal(retained['callCount'], 414);

  const profile = record(retained['profile']);
  assertKeys(profile, ['nodes', 'startTime', 'endTime', 'samples', 'timeDeltas']);
  const startTime = safeNonnegativeDecimal(profile['startTime']);
  const endTime = safeNonnegativeDecimal(profile['endTime']);
  assert.ok(endTime > startTime);
  const nodes = array(profile['nodes']).map(record);
  const samples = array(profile['samples']);
  const timeDeltas = array(profile['timeDeltas']);
  assert.ok(nodes.length > 0 && nodes.length <= 250_000);
  assert.ok(samples.length > 0 && samples.length <= 1_000_000);
  assert.equal(samples.length, timeDeltas.length);

  const byId = new Map<string, JsonRecord>();
  const parentById = new Map<string, string>();
  for (const node of nodes) {
    const nodeKeys = Object.keys(node);
    assert.ok(nodeKeys.every((key) => [
      'id',
      'callFrame',
      'hitCount',
      'children',
      'positionTicks',
      'deoptReason',
    ].includes(key)));
    assert.deepEqual(nodeKeys.slice(0, 3), ['id', 'callFrame', 'hitCount']);
    const id = string(node['id']);
    safeNonnegativeDecimal(id);
    assert.equal(byId.has(id), false);
    byId.set(id, node);
    safeNonnegativeDecimal(node['hitCount']);
    const frame = record(node['callFrame']);
    assertKeys(frame, ['functionName', 'scriptId', 'url', 'lineNumber', 'columnNumber']);
    string(frame['functionName']);
    safeNonnegativeDecimal(frame['scriptId']);
    safeProfileUrl(frame['url']);
    signedDecimal(frame['lineNumber']);
    signedDecimal(frame['columnNumber']);
    if (node['positionTicks'] !== undefined) {
      for (const tickValue of array(node['positionTicks'])) {
        const tick = record(tickValue);
        assertKeys(tick, ['line', 'ticks']);
        safeNonnegativeDecimal(tick['line']);
        safeNonnegativeDecimal(tick['ticks']);
      }
    }
    if (node['deoptReason'] !== undefined) string(node['deoptReason']);
  }
  for (const node of nodes) {
    const parentId = string(node['id']);
    if (node['children'] === undefined) continue;
    for (const childValue of array(node['children'])) {
      const childId = string(childValue);
      safeNonnegativeDecimal(childId);
      assert.equal(byId.has(childId), true);
      assert.equal(parentById.has(childId), false);
      parentById.set(childId, parentId);
    }
  }
  const roots = nodes.filter((node) => !parentById.has(string(node['id'])));
  assert.equal(roots.length, 1);
  assert.equal(string(record(roots[0]?.['callFrame'])['functionName']), '(root)');

  const expectedLeafCategories: string[] = [];
  const expectedMembership: boolean[] = [];
  const categoryCounts = new Map<string, { count: number; microseconds: number; rootCount: number; rootMicroseconds: number }>();
  for (const category of categories) {
    categoryCounts.set(string(category['id']), {
      count: 0,
      microseconds: 0,
      rootCount: 0,
      rootMicroseconds: 0,
    });
  }
  let totalMicroseconds = 0;
  let runtimeRootSampleCount = 0;
  let runtimeRootMicroseconds = 0;
  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const sampleId = string(samples[sampleIndex]);
    safeNonnegativeDecimal(sampleId);
    const leaf = byId.get(sampleId);
    assert.ok(leaf);
    const delta = Number(safeNonnegativeDecimal(timeDeltas[sampleIndex]));
    totalMicroseconds += delta;
    const category = categoryFor(record(leaf['callFrame']), categories);
    expectedLeafCategories.push(category);

    let cursor: JsonRecord | undefined = leaf;
    let withinRoot = false;
    const seen = new Set<string>();
    while (cursor !== undefined) {
      const cursorId = string(cursor['id']);
      assert.equal(seen.has(cursorId), false);
      seen.add(cursorId);
      const frame = record(cursor['callFrame']);
      if (
        frame['functionName'] === runtimeRoot['functionName']
        && frame['url'] === runtimeRoot['path']
      ) withinRoot = true;
      const parentId = parentById.get(cursorId);
      cursor = parentId === undefined ? undefined : byId.get(parentId);
    }
    expectedMembership.push(withinRoot);
    const counts = categoryCounts.get(category);
    assert.ok(counts);
    counts.count += 1;
    counts.microseconds += delta;
    if (withinRoot) {
      counts.rootCount += 1;
      counts.rootMicroseconds += delta;
      runtimeRootSampleCount += 1;
      runtimeRootMicroseconds += delta;
    }
  }
  assert.deepEqual(retained['leafCategories'], expectedLeafCategories);
  assert.deepEqual(retained['runtimeRootMembership'], expectedMembership);

  const reconstructedCategories = categories.map((category) => {
    const id = string(category['id']);
    const counts = categoryCounts.get(id);
    assert.ok(counts);
    return {
      id,
      allSamples: counts.count,
      allSampledMicroseconds: counts.microseconds,
      withinRuntimeRootSamples: counts.rootCount,
      withinRuntimeRootSampledMicroseconds: counts.rootMicroseconds,
    };
  });
  return {
    profileIndex,
    sweepOrder,
    totalSampleCount: samples.length,
    totalSampledMicroseconds: totalMicroseconds,
    runtimeRootSampleCount,
    runtimeRootSampledMicroseconds: runtimeRootMicroseconds,
    categories: reconstructedCategories,
    strictUniqueWithinRuntimeRootLeader: uniqueLeader(
      reconstructedCategories,
      'withinRuntimeRootSampledMicroseconds',
    ),
    allSampleLeader: uniqueLeader(reconstructedCategories, 'allSampledMicroseconds'),
  };
}

function validateCpuAndReconstructAnalysis(
  cpu: JsonRecord,
  config: JsonRecord,
  environment: JsonRecord,
  semantic: JsonRecord,
): JsonRecord {
  assertKeys(cpu, ['schemaVersion', 'profileId', 'inputBinding', 'profiler', 'profiles']);
  assert.equal(cpu['schemaVersion'], 'routelab.numerical-baseline-profile-cpu-observations.v1');
  assert.equal(cpu['profileId'], PROFILE_ID);
  assert.deepEqual(cpu['inputBinding'], {
    profileConfigSha256: CONFIG_SHA256,
    semanticWorkSha256: SEMANTIC_SHA256,
    environmentSha256: sha256(JSON.stringify(environment)),
  });
  assert.deepEqual(cpu['profiler'], {
    api: 'node:inspector/promises',
    domain: 'Profiler',
    samplingIntervalMicroseconds: 1_000,
    sessionCount: 1,
    recordedProfileCount: 3,
    overhead: 'three-recording-windows-plus-inspector-sampling-and-normalization',
  });

  const attribution = record(config['attribution']);
  const categories = array(attribution['categories']).map(record);
  const runtimeRoot = record(attribution['runtimeRoot']);
  const retainedProfiles = array(cpu['profiles']).map(record);
  assert.equal(retainedProfiles.length, 3);
  const profiles = retainedProfiles.map((profile, index) =>
    reconstructCpuProfile(profile, categories, runtimeRoot, index));

  for (let index = 0; index < profiles.length; index += 1) {
    const profile = profiles[index];
    assert.ok(profile);
    assert.equal(profile.runtimeRootSampleCount, 0);
    assert.equal(profile.runtimeRootSampledMicroseconds, 0);
    assert.equal(profile.strictUniqueWithinRuntimeRootLeader, null);
    assert.equal(profile.allSampleLeader, 'path-shadow-price-core');
    const leader = profile.categories.find(({ id }) => id === 'path-shadow-price-core');
    assert.ok(leader);
    assert.equal(leader['allSampledMicroseconds'], ALL_SAMPLE_LEADER_MICROSECONDS[index]);
    const retainedNodes = array(record(retainedProfiles[index]?.['profile'])['nodes']).map(record);
    assert.equal(retainedNodes.some((node) => {
      const frame = record(node['callFrame']);
      return frame['functionName'] === runtimeRoot['functionName']
        && frame['url'] === runtimeRoot['path'];
    }), false);
    assert.equal(retainedNodes.some((node) =>
      record(node['callFrame'])['functionName'] === 'runNumericalRuntime'), true);
  }

  const work = record(semantic['work']);
  const totals = record(work['counterTotals']);
  const candidateSetExpansions = safeInteger(totals['candidateSetExpansions']);
  const decisionConfig = record(config['decision']);
  const allThreeCandidateLeaders = profiles.every(
    (profile) => profile.strictUniqueWithinRuntimeRootLeader === decisionConfig['candidateCategory'],
  );
  const recommendation = allThreeCandidateLeaders && candidateSetExpansions > 0
    ? decisionConfig['recommendation']
    : decisionConfig['decline'];
  assert.equal(recommendation, 'decline-sound-pruning-selection-from-this-profile');
  return {
    schemaVersion: 'routelab.numerical-baseline-profile-analysis.v1',
    profileId: PROFILE_ID,
    method: attribution['method'],
    timeDeltaUnit: attribution['timeDeltaUnit'],
    decisionPopulation: attribution['decisionPopulation'],
    profiles: profiles.map((profile) => ({
      profileIndex: profile.profileIndex,
      sweepOrder: profile.sweepOrder,
      totalSampleCount: profile.totalSampleCount,
      totalSampledMicroseconds: profile.totalSampledMicroseconds,
      runtimeRootSampleCount: profile.runtimeRootSampleCount,
      runtimeRootSampledMicroseconds: profile.runtimeRootSampledMicroseconds,
      categories: profile.categories,
      strictUniqueWithinRuntimeRootLeader: profile.strictUniqueWithinRuntimeRootLeader,
    })),
    decision: {
      method: decisionConfig['method'],
      candidateCategory: decisionConfig['candidateCategory'],
      requireAllSemanticParity: decisionConfig['requireAllSemanticParity'],
      candidateSetExpansions,
      positiveCandidateSetWork: candidateSetExpansions > 0,
      allThreeProfilesHaveCandidateSetAsStrictUniqueLeader: allThreeCandidateLeaders,
      recommendation,
      scope: decisionConfig['recommendationScope'],
    },
    limitations: config['limitations'],
  };
}

function expectedManifest(
  config: JsonRecord,
  analysis: JsonRecord,
): JsonRecord {
  const runtime = record(config['runtime']);
  const sources = Object.fromEntries([
    'src/benchmark/historical-numerical-profile/index.ts',
    'cli/run-historical-numerical-profile.ts',
    'cli/verify-historical-numerical-profile.ts',
    'package.json',
  ].map((relative) => [relative, descriptor(relative)]));
  const artifacts = Object.fromEntries([
    'semantic-work.json',
    'timing-observations.json',
    'cpu-profile-observations.json',
    'analysis.json',
  ].map((name) => {
    const retained = ARTIFACTS[name as keyof typeof ARTIFACTS];
    return [name, { path: name, bytes: retained.bytes, sha256: retained.sha256 }];
  }));
  return {
    schemaVersion: 'routelab.numerical-baseline-profile-manifest.v1',
    profileId: PROFILE_ID,
    inputBinding: {
      profileConfig: { path: CONFIG, bytes: CONFIG_BYTES, sha256: CONFIG_SHA256 },
      acceptedEvidenceRevision: ACCEPTED_EVIDENCE_REVISION,
      frozenInputs: config['inputBinding'],
    },
    runtime,
    observationProtocol: config['observationProtocol'],
    attribution: config['attribution'],
    sources,
    artifacts,
    counts: {
      eligibleCellCount: 414,
      totalNumericalCalls: 4_554,
      timingSampleCount: 2_070,
      cpuProfileCount: 3,
      profiledCallCount: 1_242,
    },
    recommendation: record(analysis['decision'])['recommendation'],
    limitations: config['limitations'],
  };
}

void test('independently reconstructs the retained historical numerical baseline profile', () => {
  const config = canonical(CONFIG, CONFIG_BYTES, CONFIG_SHA256);
  assert.equal(config['schemaVersion'], 'routelab.numerical-baseline-profile-config.v1');
  assert.equal(
    config['profileConfigId'],
    'm7b-core12-synthetic-exhaustive-numerical-baseline-profile-config-v1',
  );
  assertBoundDescriptors(config);
  const runtime = record(config['runtime']);
  assert.equal(runtime['acceptedEvidenceRevision'], ACCEPTED_EVIDENCE_REVISION);
  assert.equal(runtime['entryPoint'], 'routeExactInputSplitNumericalAnytime');
  const cohortConfig = record(config['cohort']);
  assert.equal(cohortConfig['eligibilityCellCount'], 2_376);
  assert.equal(cohortConfig['eligibleCellCount'], 414);

  const semantic = canonical(
    `${PROFILE_DIRECTORY}/semantic-work.json`,
    ARTIFACTS['semantic-work.json'].bytes,
    ARTIFACTS['semantic-work.json'].sha256,
  );
  const reconstructedSemantic = reconstructSemanticWork(config);
  assert.equal(`${JSON.stringify(reconstructedSemantic.value)}\n`, text(`${PROFILE_DIRECTORY}/semantic-work.json`));
  assert.deepEqual(semantic, reconstructedSemantic.value);

  const timing = canonical(
    `${PROFILE_DIRECTORY}/timing-observations.json`,
    ARTIFACTS['timing-observations.json'].bytes,
    ARTIFACTS['timing-observations.json'].sha256,
  );
  const environment = validateEnvironment(timing['environment']);
  validateTiming(timing, environment, reconstructedSemantic.cells);

  const cpu = canonical(
    `${PROFILE_DIRECTORY}/cpu-profile-observations.json`,
    ARTIFACTS['cpu-profile-observations.json'].bytes,
    ARTIFACTS['cpu-profile-observations.json'].sha256,
  );
  const reconstructedAnalysis = validateCpuAndReconstructAnalysis(cpu, config, environment, semantic);
  const analysis = canonical(
    `${PROFILE_DIRECTORY}/analysis.json`,
    ARTIFACTS['analysis.json'].bytes,
    ARTIFACTS['analysis.json'].sha256,
  );
  assert.equal(`${JSON.stringify(reconstructedAnalysis)}\n`, text(`${PROFILE_DIRECTORY}/analysis.json`));
  assert.deepEqual(analysis, reconstructedAnalysis);

  const manifest = canonical(
    `${PROFILE_DIRECTORY}/manifest.json`,
    ARTIFACTS['manifest.json'].bytes,
    ARTIFACTS['manifest.json'].sha256,
  );
  const reconstructedManifest = expectedManifest(config, reconstructedAnalysis);
  assert.equal(`${JSON.stringify(reconstructedManifest)}\n`, text(`${PROFILE_DIRECTORY}/manifest.json`));
  assert.deepEqual(manifest, reconstructedManifest);
  assertBoundDescriptors(manifest['inputBinding']);
  assertBoundDescriptors(manifest['sources']);

  const artifactNames = Object.keys(ARTIFACTS);
  assert.deepEqual(artifactNames, [
    'semantic-work.json',
    'timing-observations.json',
    'cpu-profile-observations.json',
    'analysis.json',
    'manifest.json',
  ]);
});
