import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CLI = path.join(ROOT, 'cli/verify-historical-dataset.ts');
const SUCCESS = '{"schemaVersion":"routelab.dataset-verification-summary.v1","datasetId":"ethereum-mainnet-uniswap-v2-block-19000000-core12-v1","snapshotId":"ethereum-mainnet-uniswap-v2-block-19000000-core12-v1","snapshotChecksum":"sha256:5d21166cf218997776efc23b203c2f70637b1fb822807fb236bfc6fd0bf3e755","artifactCount":6,"poolCount":54,"assetCount":12,"sourcePairCount":54,"exactReconciliation":true}\n';
const FAILURE = '{"ok":false,"error":{"code":"manifest-read-failed","artifact":"manifest.json","message":"Could not read the dataset manifest."}}\n';

function run(cwd: string) {
  return spawnSync(process.execPath, [CLI], { cwd, encoding: 'utf8' });
}

void test('historical dataset CLI repeats one exact offline success line', () => {
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

void test('historical dataset CLI emits one stable typed failure line from a missing dataset cwd', () => {
  const empty = mkdtempSync(path.join(tmpdir(), 'routelab-historical-cli-'));
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
