import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

type JsonRecord = Record<string, unknown>;

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const RUN_CLI = path.join(ROOT, 'cli/run-historical-numerical-split-evaluation.ts');
const VERIFY_CLI = path.join(ROOT, 'cli/verify-historical-numerical-split-evaluation.ts');
const DATASET = 'datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1';
const CORPUS =
  'datasets/requests/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/synthetic-exhaustive-v1';
const BASELINE =
  'datasets/evaluations/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/synthetic-exhaustive-v1/composed-two-hop-pair-v3';
const EVALUATION =
  'datasets/evaluations/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/synthetic-exhaustive-v1/numerical-path-shadow-price-v1';
const INPUTS = [
  'fixtures/m7/numerical-historical/comparison-config.v1.json',
  'fixtures/m7/numerical-historical/eligibility.v1.json',
  'fixtures/m7/numerical-historical/forced-failure-evidence.v1.json',
  'tests/oracle/numerical-exact-input-split-runtime-oracle.test.ts',
  'fixtures/m6/composed-historical/comparison-config.v3.json',
  'fixtures/m6/composed-historical/observation-config.v2.json',
  path.join(CORPUS, 'manifest.json'),
  path.join(CORPUS, 'requests.json'),
  ...['manifest.json', 'semantic-results.json', 'observations.json'].map((name) =>
    path.join(BASELINE, name)),
  ...[
    'manifest.json', 'policy.json', 'sources/infura-normalized.json',
    'sources/sqd-normalized.json', 'reconciliation.json', 'snapshot.json',
    'canonical-snapshot-content.json',
  ].map((name) => path.join(DATASET, name)),
] as const;

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

async function copyInputs(root: string): Promise<void> {
  await Promise.all(INPUTS.map(async (relative) => {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(ROOT, relative), target);
  }));
}

void test('generation and verification CLIs reproduce one deterministic semantic artifact set', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'routelab-rlt074-cli-'));
  try {
    await copyInputs(temporary);
    const generated = spawnSync(process.execPath, [RUN_CLI, EVALUATION], {
      cwd: temporary,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    });
    assert.equal(generated.status, 0, generated.stderr);
    assert.equal(generated.stderr, '');
    const generationSummary = parseLine(generated.stdout);
    assert.equal(generationSummary['eligibleCellCount'], 414);
    assert.equal(generationSummary['mode'], 'primary');
    assert.deepEqual((await readdir(path.join(temporary, EVALUATION))).sort(), [
      'manifest.json', 'semantic-results.json',
    ]);

    const semanticBefore = await readFile(path.join(temporary, EVALUATION, 'semantic-results.json'));
    const verified = spawnSync(process.execPath, [VERIFY_CLI], {
      cwd: temporary,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    });
    assert.equal(verified.status, 0, verified.stderr);
    assert.equal(verified.stderr, '');
    const verificationSummary = parseLine(verified.stdout);
    assert.equal(verificationSummary['semanticResultsSha256'], generationSummary['semanticResultsSha256']);
    assert.equal(verificationSummary['strictlyImprovedRequestCount'], 307);
    assert.deepEqual(
      await readFile(path.join(temporary, EVALUATION, 'semantic-results.json')),
      semanticBefore,
    );

    const conflict = spawnSync(process.execPath, [RUN_CLI, EVALUATION], {
      cwd: temporary,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    });
    assert.equal(conflict.status, 1);
    assert.equal(conflict.stdout, '');
    assert.equal(record(parseLine(conflict.stderr)['error'])['code'], 'output-conflict');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test('generation CLI rejects invalid arguments without creating output', () => {
  const result = spawnSync(process.execPath, [RUN_CLI], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(record(parseLine(result.stderr)['error'])['code'], 'invalid-cli-arguments');
});
