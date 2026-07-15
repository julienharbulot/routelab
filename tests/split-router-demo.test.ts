import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DEMO = fileURLToPath(new URL('../cli/demo.ts', import.meta.url));

void test('demo prints deterministic small-split and historical exact quotes', () => {
  const first = spawnSync(process.execPath, [DEMO], { cwd: ROOT, encoding: 'utf8' });
  const second = spawnSync(process.execPath, [DEMO], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(first.status, 0);
  assert.equal(first.stderr, '');
  assert.equal(second.stdout, first.stdout);
  assert.match(first.stdout, /Small split fixture/u);
  assert.match(first.stdout, /A 100 -> B 66/u);
  assert.match(first.stdout, /route 1: input 50, output 33/u);
  assert.match(first.stdout, /best single: 50/u);
  assert.match(first.stdout, /exact improvement: 16/u);
  assert.match(first.stdout, /Retained historical snapshot/u);
  assert.match(first.stdout, /ethereum-mainnet-uniswap-v2-block-19000000-core12-v1/u);
  assert.match(first.stdout, /authorization: fresh exact bigint replay passed/u);
  assert.match(first.stdout, /no transaction submission, signing, custody, or settlement/u);
});
