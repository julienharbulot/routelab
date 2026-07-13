import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { REPRESENTATIVE_NUMERICAL_PROFILE_EVIDENCE_REVISION } from '../src/benchmark/representative-numerical-profile/index.ts';

type JsonRecord = Record<string, unknown>;
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const RUN_CLI = path.join(ROOT, 'cli/run-representative-numerical-profile.ts');
const VERIFY_CLI = path.join(ROOT, 'cli/verify-representative-numerical-profile.ts');

function error(value: string): JsonRecord {
  const parsed = JSON.parse(value) as JsonRecord;
  assert.equal(typeof parsed['error'], 'object');
  return parsed['error'] as JsonRecord;
}

void test('generation CLI rejects bad arguments before observation', () => {
  const result = spawnSync(process.execPath, [RUN_CLI], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(error(result.stderr)['code'], 'invalid-cli-arguments');
});

void test('generation CLI rejects an existing destination before observation', async () => {
  const destination = await mkdtemp(path.join(tmpdir(), 'routelab-rlt081-profile-conflict-'));
  try {
    const result = spawnSync(process.execPath, [RUN_CLI, destination, REPRESENTATIVE_NUMERICAL_PROFILE_EVIDENCE_REVISION],
      { cwd: ROOT, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(error(result.stderr)['code'], 'output-conflict');
  } finally { await rm(destination, { recursive: true, force: true }); }
});

void test('verification CLI accepts no arguments', () => {
  const result = spawnSync(process.execPath, [VERIFY_CLI, 'unexpected'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(error(result.stderr)['code'], 'invalid-cli-arguments');
});
