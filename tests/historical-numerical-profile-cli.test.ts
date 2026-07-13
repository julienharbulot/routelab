import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  NUMERICAL_BASELINE_PROFILE_EVIDENCE_REVISION,
  verifyHistoricalNumericalProfile,
} from '../src/benchmark/historical-numerical-profile/index.ts';

type JsonRecord = Record<string, unknown>;
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const RUN_CLI = path.join(ROOT, 'cli/run-historical-numerical-profile.ts');
const VERIFY_CLI = path.join(ROOT, 'cli/verify-historical-numerical-profile.ts');

function parseError(value: string): JsonRecord {
  assert.equal(value.endsWith('\n'), true);
  const parsed = JSON.parse(value) as JsonRecord;
  assert.equal(typeof parsed['error'], 'object');
  return parsed['error'] as JsonRecord;
}

void test('generation CLI rejects bad arguments before any observation', () => {
  const result = spawnSync(process.execPath, [RUN_CLI], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(parseError(result.stderr)['code'], 'invalid-cli-arguments');
});

void test('generation CLI rejects an existing destination before any observation', async () => {
  const target = await mkdtemp(path.join(tmpdir(), 'routelab-rlt080-conflict-'));
  try {
    const result = spawnSync(process.execPath, [RUN_CLI, target, NUMERICAL_BASELINE_PROFILE_EVIDENCE_REVISION], {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024,
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(parseError(result.stderr)['code'], 'output-conflict');
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

void test('verification CLI accepts no arguments', () => {
  const result = spawnSync(process.execPath, [VERIFY_CLI, 'unexpected'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(parseError(result.stderr)['code'], 'invalid-cli-arguments');
});

void test('verifier rejects a declared artifact hash tamper before numerical replay', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'routelab-rlt080-verify-tamper-'));
  try {
    const emptySha = `sha256:${'0'.repeat(64)}`;
    const manifest = {
      schemaVersion: 'routelab.numerical-baseline-profile-manifest.v1',
      artifacts: {
        'semantic-work.json': { path: 'semantic-work.json', bytes: 3, sha256: emptySha },
        'timing-observations.json': { path: 'timing-observations.json', bytes: 0, sha256: emptySha },
        'cpu-profile-observations.json': { path: 'cpu-profile-observations.json', bytes: 0, sha256: emptySha },
        'analysis.json': { path: 'analysis.json', bytes: 0, sha256: emptySha },
      },
    };
    await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
    await writeFile(path.join(output, 'semantic-work.json'), '{}\n');
    let numericalArtifactRead = false;
    const result = await verifyHistoricalNumericalProfile(output, {
      async readFile(filePath: string): Promise<Uint8Array> {
        if (filePath.includes('numerical-path-shadow-price-v1/semantic-results.json')) {
          numericalArtifactRead = true;
        }
        return readFile(filePath);
      },
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error('Expected a verifier failure.');
    assert.equal(result.error.code, 'artifact-hash-mismatch');
    assert.equal(result.error.artifact, 'semantic-work.json');
    assert.equal(numericalArtifactRead, true, 'bound input bytes are hashed before output integrity');
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
