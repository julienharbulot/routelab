import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  CANONICAL_HISTORICAL_COMPARISON_CONFIG_PATH,
  CANONICAL_HISTORICAL_COMPOSED_SPLIT_EVALUATION_DIRECTORY,
  CANONICAL_HISTORICAL_OBSERVATION_CONFIG_PATH,
  createHistoricalComposedSplitEvaluation,
  verifyHistoricalComposedSplitEvaluation,
  type HistoricalEvaluationArtifacts,
  type HistoricalEvaluationErrorCode,
} from '../src/benchmark/historical-composed-split/index.ts';
import { CANONICAL_SYNTHETIC_REQUEST_CORPUS_DIRECTORY } from '../src/verification/synthetic-request-corpus/index.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const HISTORICAL_DIRECTORY =
  'datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1';
const CORPUS_DIRECTORY = CANONICAL_SYNTHETIC_REQUEST_CORPUS_DIRECTORY;
const EVALUATION_DIRECTORY = CANONICAL_HISTORICAL_COMPOSED_SPLIT_EVALUATION_DIRECTORY;
const REVISION = 'f98dddbd748c08594c7f0de0e9b457fe69417dd5';
const CONFIG_SHA256 =
  'sha256:4e4d1bdfe47016d23510adbc4ed8107854b5bbf0dec99f3fb88d920d7a403473';
const OBSERVATION_CONFIG_SHA256 =
  'sha256:6e1c5e315efd532f25f8c0fa601d29889452f1324978f7ce507b4c992ddb6d84';
const INPUT_FILES = [
  CANONICAL_HISTORICAL_COMPARISON_CONFIG_PATH,
  CANONICAL_HISTORICAL_OBSERVATION_CONFIG_PATH,
  path.join(CORPUS_DIRECTORY, 'manifest.json'),
  path.join(CORPUS_DIRECTORY, 'requests.json'),
  ...[
    'manifest.json',
    'policy.json',
    'sources/infura-normalized.json',
    'sources/sqd-normalized.json',
    'reconciliation.json',
    'snapshot.json',
    'canonical-snapshot-content.json',
  ].map((relative) => path.join(HISTORICAL_DIRECTORY, relative)),
] as const;

type Files = Map<string, Uint8Array>;
type JsonRecord = Record<string, unknown>;

function canonicalInputFiles(): Files {
  return new Map(INPUT_FILES.map((relative) => [
    relative,
    Uint8Array.from(readFileSync(path.join(ROOT, relative))),
  ]));
}

function reader(files: Files) {
  return (filePath: string): Promise<Uint8Array> => {
    const bytes = files.get(filePath);
    if (bytes === undefined) throw new Error('unavailable test artifact');
    return Promise.resolve(Uint8Array.from(bytes));
  };
}

function parseRecord(json: string): JsonRecord {
  const value: unknown = JSON.parse(json);
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as JsonRecord;
}

function record(value: unknown): JsonRecord {
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as JsonRecord;
}

function array(value: unknown): readonly unknown[] {
  assert.ok(Array.isArray(value));
  return value;
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

let clockCalls = 0;
let clockValue = 0n;
const generatedPromise = createHistoricalComposedSplitEvaluation({
  readFile: reader(canonicalInputFiles()),
  nowNanoseconds: () => {
    const current = clockValue;
    clockValue += 10n;
    clockCalls += 1;
    return current;
  },
  environment: {
    nodeVersion: 'v24.13.0-test',
    platform: 'test-platform',
    arch: 'test-arch',
    osRelease: 'test-release',
    cpuModel: 'test-cpu',
    logicalCpuCount: 4,
  },
  runtimeRevision: REVISION,
});

async function generatedArtifacts(): Promise<HistoricalEvaluationArtifacts> {
  const result = await generatedPromise;
  if (!result.ok) assert.fail(result.error.code);
  assert.equal(result.ok, true);
  return result.value;
}

function persistedFiles(artifacts: HistoricalEvaluationArtifacts): Files {
  const files = canonicalInputFiles();
  const encoder = new TextEncoder();
  files.set(path.join(EVALUATION_DIRECTORY, 'manifest.json'), encoder.encode(artifacts.manifestJson));
  files.set(
    path.join(EVALUATION_DIRECTORY, 'semantic-results.json'),
    encoder.encode(artifacts.semanticResultsJson),
  );
  files.set(
    path.join(EVALUATION_DIRECTORY, 'observations.json'),
    encoder.encode(artifacts.observationsJson),
  );
  return files;
}

async function expectCode(files: Files, expected: HistoricalEvaluationErrorCode): Promise<void> {
  const result = await verifyHistoricalComposedSplitEvaluation(EVALUATION_DIRECTORY, {
    readFile: reader(files),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, expected);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.error), true);
  assert.doesNotMatch(result.error.message, /unavailable test artifact/u);
}

void test('freezes separate semantic and observation configuration identities', () => {
  const comparison = readFileSync(path.join(ROOT, CANONICAL_HISTORICAL_COMPARISON_CONFIG_PATH));
  assert.equal(comparison.byteLength, 2_528);
  assert.equal(`sha256:${createHash('sha256').update(comparison).digest('hex')}`, CONFIG_SHA256);
  assert.notEqual(comparison.at(-1), 0x0a);
  assert.equal(comparison.includes('sampleSweeps'), false);
  assert.equal(comparison.includes('timingScope'), false);
  assert.equal(comparison.includes('Limitations'), false);

  const observation = readFileSync(path.join(ROOT, CANONICAL_HISTORICAL_OBSERVATION_CONFIG_PATH));
  assert.equal(observation.byteLength, 1_060);
  assert.equal(
    `sha256:${createHash('sha256').update(observation).digest('hex')}`,
    OBSERVATION_CONFIG_SHA256,
  );
  assert.notEqual(observation.at(-1), 0x0a);
});

void test('generates the complete semantic and separately timed schedules', async () => {
  const artifacts = await generatedArtifacts();
  const semantic = parseRecord(artifacts.semanticResultsJson);
  const observations = parseRecord(artifacts.observationsJson);
  const manifest = parseRecord(artifacts.manifestJson);
  const cells = array(semantic['cells']);
  const samples = array(record(observations['measurement'])['samples']);

  assert.equal(cells.length, 2_376);
  assert.equal(samples.length, 11_880);
  assert.equal(clockCalls, 23_760);
  assert.deepEqual(
    cells.slice(0, 6).map((cell) => record(cell)['profileId']),
    ['fraction-0', 'fraction-1-16', 'fraction-1-8', 'fraction-1-4', 'fraction-1-2', 'structural-complete'],
  );
  assert.equal(record(cells[0])['requestId'], 'request-0001');
  assert.equal(record(cells[5])['requestId'], 'request-0001');
  assert.equal(record(cells[6])['requestId'], 'request-0002');
  assert.equal(record(samples[0])['elapsedNanoseconds'], '10');
  assert.equal(record(samples[2_375])['requestId'], record(cells[2_375])['requestId']);
  assert.equal(record(samples[2_376])['requestId'], record(cells[2_375])['requestId']);
  assert.equal(record(samples[4_751])['requestId'], record(cells[0])['requestId']);

  const semanticSummary = record(semantic['summary']);
  const profiles = array(semanticSummary['profileSummaries']);
  const terminal = record(profiles.at(-1));
  assert.deepEqual(terminal['terminationCounts'], { complete: 396, workLimit: 0 });
  for (const comparison of array(semanticSummary['adjacentComparisons'])) {
    assert.equal(record(comparison)['noLongerPlanned'], 0);
    assert.equal(record(comparison)['regressed'], 0);
  }
  assert.equal(Object.hasOwn(semantic, 'runtime'), false);
  assert.equal(Object.hasOwn(semantic, 'measurement'), false);
  assert.equal(artifacts.semanticResultsJson.includes(REVISION), false);
  assert.equal(artifacts.semanticResultsJson.includes(OBSERVATION_CONFIG_SHA256), false);
  assert.equal(artifacts.semanticResultsJson.includes('sampleSweeps'), false);
  assert.equal(record(record(observations['runtime']))['runtimeRevision'], REVISION);
  assert.equal(record(manifest['runtime'])['implementationRevision'], REVISION);
  assert.equal(
    record(record(manifest['artifacts'])['semanticResults'])['sha256'],
    sha256(artifacts.semanticResultsJson),
  );
  assert.equal(
    record(record(manifest['artifacts'])['observations'])['sha256'],
    sha256(artifacts.observationsJson),
  );
  assert.equal(Object.isFrozen(artifacts), true);
  assert.equal(Object.isFrozen(artifacts.summary), true);
  assert.equal(Object.isFrozen(artifacts.summary.profileSummaries), true);
});

void test('freshly replays semantic bytes and applies verifier error precedence', async () => {
  const artifacts = await generatedArtifacts();
  const canonical = persistedFiles(artifacts);
  const verified = await verifyHistoricalComposedSplitEvaluation(EVALUATION_DIRECTORY, {
    readFile: reader(canonical),
  });
  assert.equal(verified.ok, true);
  if (verified.ok) {
    assert.equal(verified.value.semanticResultsSha256, sha256(artifacts.semanticResultsJson));
    assert.equal(verified.value.observationsSha256, sha256(artifacts.observationsJson));
  }

  const missingManifest = new Map(canonical);
  missingManifest.delete(path.join(EVALUATION_DIRECTORY, 'manifest.json'));
  await expectCode(missingManifest, 'manifest-read-failed');

  const changedObservations = new Map(canonical);
  const observationsPath = path.join(EVALUATION_DIRECTORY, 'observations.json');
  const observationsBytes = changedObservations.get(observationsPath);
  assert.ok(observationsBytes);
  changedObservations.set(observationsPath, Uint8Array.from([...observationsBytes, 0x20]));
  await expectCode(changedObservations, 'observations-size-mismatch');

  const semanticBeforeObservations = new Map(canonical);
  const semanticPath = path.join(EVALUATION_DIRECTORY, 'semantic-results.json');
  const changedSemantic = parseRecord(artifacts.semanticResultsJson);
  record(array(changedSemantic['cells'])[0])['semanticHash'] = `sha256:${'0'.repeat(64)}`;
  const changedSemanticJson = JSON.stringify(changedSemantic);
  semanticBeforeObservations.set(semanticPath, new TextEncoder().encode(changedSemanticJson));
  semanticBeforeObservations.delete(observationsPath);
  const precedenceManifest = parseRecord(artifacts.manifestJson);
  const semanticDescriptor = record(record(precedenceManifest['artifacts'])['semanticResults']);
  semanticDescriptor['bytes'] = Buffer.byteLength(changedSemanticJson);
  semanticDescriptor['sha256'] = sha256(changedSemanticJson);
  semanticBeforeObservations.set(
    path.join(EVALUATION_DIRECTORY, 'manifest.json'),
    new TextEncoder().encode(JSON.stringify(precedenceManifest)),
  );
  await expectCode(semanticBeforeObservations, 'semantic-replay-mismatch');

  const changedManifest = new Map(canonical);
  const manifestPath = path.join(EVALUATION_DIRECTORY, 'manifest.json');
  const manifest = parseRecord(artifacts.manifestJson);
  record(manifest['counts'])['requestCount'] = 395;
  changedManifest.set(manifestPath, new TextEncoder().encode(JSON.stringify(manifest)));
  await expectCode(changedManifest, 'manifest-metadata-mismatch');
});
