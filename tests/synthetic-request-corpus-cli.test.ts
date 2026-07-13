import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CLI = path.join(ROOT, 'cli/verify-synthetic-request-corpus.ts');
const SUCCESS = '{"schemaVersion":"routelab.synthetic-request-corpus-verification-summary.v1","corpusId":"ethereum-mainnet-uniswap-v2-block-19000000-core12-v1-synthetic-exhaustive-v1","datasetId":"ethereum-mainnet-uniswap-v2-block-19000000-core12-v1","snapshotId":"ethereum-mainnet-uniswap-v2-block-19000000-core12-v1","snapshotChecksum":"sha256:5d21166cf218997776efc23b203c2f70637b1fb822807fb236bfc6fd0bf3e755","artifactSha256":"sha256:c470f0a33b5d03cdd1ac8d88c92a8e2ec79b78f7d488541c0f4a321ff3e03173","requestCount":396,"amountBucketCount":3,"directRequestCount":324,"multiHopOnlyRequestCount":72,"randomness":"none"}\n';
const FAILURE = '{"ok":false,"error":{"code":"manifest-read-failed","artifact":"manifest.json","message":"Could not read the synthetic request corpus manifest."}}\n';

function run(cwd: string) {
  return spawnSync(process.execPath, [CLI], { cwd, encoding: 'utf8' });
}

void test('synthetic request corpus CLI repeats one exact offline success line', () => {
  const first = run(ROOT);
  const second = run(ROOT);
  for (const result of [first, second]) {
    assert.equal(result.status, 0);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, SUCCESS);
    assert.equal(result.stderr, '');
  }
  assert.equal(second.stdout, first.stdout);
});

void test('synthetic request corpus CLI emits one stable typed failure line', () => {
  const empty = mkdtempSync(path.join(tmpdir(), 'routelab-synthetic-corpus-cli-'));
  try {
    const result = run(empty);
    assert.equal(result.status, 1);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, FAILURE);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});
