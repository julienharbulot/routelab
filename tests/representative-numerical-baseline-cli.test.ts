import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

type JsonRecord = Record<string, unknown>;
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const RUN_CLI = path.join(ROOT, 'cli/run-representative-numerical-baseline.ts');
const VERIFY_CLI = path.join(ROOT, 'cli/verify-representative-numerical-baseline.ts');

function parseError(value: string): JsonRecord {
  assert.equal(value.endsWith('\n'), true);
  const parsed = JSON.parse(value) as JsonRecord;
  assert.equal(typeof parsed['error'], 'object');
  return parsed['error'] as JsonRecord;
}

void test('generation CLI accepts no arguments', () => {
  const result = spawnSync(process.execPath, [RUN_CLI, 'unexpected'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(parseError(result.stderr)['code'], 'invalid-cli-arguments');
});

void test('generation CLI rejects retained destinations before baseline execution', () => {
  const result = spawnSync(process.execPath, [RUN_CLI], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(parseError(result.stderr)['code'], 'output-conflict');
});

void test('verification CLI accepts no arguments', () => {
  const result = spawnSync(process.execPath, [VERIFY_CLI, 'unexpected'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(parseError(result.stderr)['code'], 'invalid-cli-arguments');
});
