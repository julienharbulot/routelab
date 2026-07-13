import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

type JsonRecord = Record<string, unknown>;

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const RUN_CLI = path.join(ROOT, 'cli/run-historical-composed-split-evaluation.ts');
const VERIFY_CLI = path.join(ROOT, 'cli/verify-historical-composed-split-evaluation.ts');
const DATASET = 'datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1';
const CORPUS =
  'datasets/requests/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/synthetic-exhaustive-v1';
const EVALUATION =
  'datasets/evaluations/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/synthetic-exhaustive-v1/composed-two-hop-pair-v3';
const CONFIG = 'fixtures/m6/composed-historical/comparison-config.v3.json';
const OBSERVATION_CONFIG = 'fixtures/m6/composed-historical/observation-config.v2.json';
const REVISION = 'f98dddbd748c08594c7f0de0e9b457fe69417dd5';
const SEMANTIC_HASH =
  'sha256:28fafa1c27fe3c685756b25566ebcc357512b3d35acfdcf06afa01304cb9546e';
const OBSERVATION_CONFIG_HASH =
  'sha256:6e1c5e315efd532f25f8c0fa601d29889452f1324978f7ce507b4c992ddb6d84';

function record(value: unknown): JsonRecord {
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as JsonRecord;
}

function parseLine(value: string): JsonRecord {
  assert.equal(value.endsWith('\n'), true);
  assert.equal(value.trim().includes('\n'), false);
  return record(JSON.parse(value) as unknown);
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function copyRelative(root: string, relative: string): Promise<void> {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(ROOT, relative), target);
}

async function copyGenerationInputs(root: string): Promise<void> {
  await Promise.all([
    CONFIG,
    OBSERVATION_CONFIG,
    path.join(CORPUS, 'manifest.json'),
    path.join(CORPUS, 'requests.json'),
    ...[
      'manifest.json', 'policy.json', 'sources/infura-normalized.json',
      'sources/sqd-normalized.json', 'reconciliation.json', 'snapshot.json',
      'canonical-snapshot-content.json',
    ].map((name) => path.join(DATASET, name)),
  ].map((relative) => copyRelative(root, relative)));
}

void test('verification CLI succeeds deterministically and reports typed failure without OS text', async () => {
  const success = spawnSync(process.execPath, [VERIFY_CLI], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  assert.equal(success.status, 0, success.stderr);
  assert.equal(success.stderr, '');
  const summary = parseLine(success.stdout);
  assert.equal(summary['semanticResultsSha256'], SEMANTIC_HASH);
  assert.equal(summary['semanticCellCount'], 2_376);
  assert.equal(summary['observationSampleCount'], 11_880);

  const temporary = await mkdtemp(path.join(tmpdir(), 'routelab-rlt064-verify-'));
  try {
    const manifest = path.join(temporary, EVALUATION, 'manifest.json');
    await mkdir(path.dirname(manifest), { recursive: true });
    await writeFile(manifest, '{}', 'utf8');
    const failure = spawnSync(process.execPath, [VERIFY_CLI], {
      cwd: temporary,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    assert.equal(failure.status, 1);
    assert.equal(failure.stdout, '');
    assert.deepEqual(parseLine(failure.stderr), {
      ok: false,
      error: {
        code: 'invalid-manifest-shape',
        artifact: 'manifest.json',
        message: 'Historical composed evaluation failed at manifest.json.',
      },
    });
    assert.doesNotMatch(failure.stderr, /ENOENT|\/tmp\/|node:|Error:/u);

    await rm(temporary, { recursive: true, force: true });
    await mkdir(temporary, { recursive: true });
    await copyGenerationInputs(temporary);
    const semanticRelative = path.join(EVALUATION, 'semantic-results.json');
    const manifestRelative = path.join(EVALUATION, 'manifest.json');
    const changedSemantic = record(JSON.parse(
      await readFile(path.join(ROOT, semanticRelative), 'utf8'),
    ) as unknown);
    const cells = changedSemantic['cells'];
    assert.ok(Array.isArray(cells));
    record(cells[0])['semanticHash'] = `sha256:${'0'.repeat(64)}`;
    const changedSemanticText = JSON.stringify(changedSemantic);
    const changedManifest = record(JSON.parse(
      await readFile(path.join(ROOT, manifestRelative), 'utf8'),
    ) as unknown);
    const semanticDescriptor = record(record(changedManifest['artifacts'])['semanticResults']);
    semanticDescriptor['bytes'] = Buffer.byteLength(changedSemanticText);
    semanticDescriptor['sha256'] = sha256(changedSemanticText);
    await mkdir(path.join(temporary, EVALUATION), { recursive: true });
    await writeFile(path.join(temporary, semanticRelative), changedSemanticText, 'utf8');
    await writeFile(path.join(temporary, manifestRelative), JSON.stringify(changedManifest), 'utf8');
    const precedence = spawnSync(process.execPath, [VERIFY_CLI], {
      cwd: temporary,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    assert.equal(precedence.status, 1);
    assert.equal(record(parseLine(precedence.stderr)['error'])['code'], 'semantic-replay-mismatch');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test('generation CLI rejects invalid arguments before creating output', () => {
  const output = path.join(tmpdir(), 'routelab-rlt064-should-not-exist');
  const failure = spawnSync(process.execPath, [RUN_CLI, output, 'not-a-revision'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  assert.equal(failure.status, 1);
  assert.equal(failure.stdout, '');
  const result = parseLine(failure.stderr);
  assert.equal(record(result['error'])['code'], 'invalid-cli-arguments');
});

void test('generation CLI reproduces semantic bytes and a verifiable fresh observation set', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'routelab-rlt064-generate-'));
  try {
    await copyGenerationInputs(temporary);
    const output = path.join(temporary, EVALUATION);
    const generated = spawnSync(process.execPath, [RUN_CLI, output, REVISION], {
      cwd: temporary,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    assert.equal(generated.status, 0, generated.stderr);
    assert.equal(generated.stderr, '');
    const metadata = parseLine(generated.stdout);
    assert.deepEqual(Object.keys(metadata), [
      'schemaVersion', 'evaluationId', 'runtimeRevision', 'comparisonConfigSha256',
      'observationConfigSha256', 'semanticResultsSha256', 'requestCount', 'profileCount',
      'semanticCellCount', 'observationSampleCount',
    ]);
    assert.equal(metadata['semanticResultsSha256'], SEMANTIC_HASH);
    assert.equal(metadata['observationConfigSha256'], OBSERVATION_CONFIG_HASH);
    assert.equal(Object.hasOwn(metadata, 'observationsSha256'), false);

    assert.deepEqual((await readdir(output)).sort(), [
      'manifest.json', 'observations.json', 'semantic-results.json',
    ]);
    const generatedSemantic = await readFile(path.join(output, 'semantic-results.json'), 'utf8');
    const persistedSemantic = await readFile(path.join(ROOT, EVALUATION, 'semantic-results.json'), 'utf8');
    assert.equal(generatedSemantic, persistedSemantic);
    const generatedObservations = await readFile(path.join(output, 'observations.json'), 'utf8');
    const persistedObservations = await readFile(path.join(ROOT, EVALUATION, 'observations.json'), 'utf8');
    assert.notEqual(generatedObservations, persistedObservations);
    const observationDocument = record(JSON.parse(generatedObservations) as unknown);
    const observationBinding = record(observationDocument['inputBinding']);
    assert.equal(observationBinding['observationConfigSha256'], OBSERVATION_CONFIG_HASH);
    assert.equal(observationBinding['semanticResultsSha256'], SEMANTIC_HASH);
    const manifest = record(JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8')) as unknown);
    const artifacts = record(manifest['artifacts']);
    assert.equal(record(artifacts['semanticResults'])['sha256'], SEMANTIC_HASH);
    assert.equal(record(artifacts['observations'])['sha256'], sha256(generatedObservations));

    const verified = spawnSync(process.execPath, [VERIFY_CLI], {
      cwd: temporary,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    assert.equal(verified.status, 0, verified.stderr);
    assert.equal(parseLine(verified.stdout)['semanticResultsSha256'], SEMANTIC_HASH);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
