import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CLI = fileURLToPath(new URL('../cli/quote.ts', import.meta.url));
const BASE_ARGUMENTS = [
  '--snapshot',
  'datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1/snapshot.json',
  '--asset-in',
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  '--asset-out',
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  '--amount-in',
  '1000000000000000000',
  '--strategy',
  'best-single',
  '--effort',
  'fast',
] as const;

void test('quote CLI accepts the pnpm separator and prints help', () => {
  const result = spawnSync(process.execPath, [CLI, '--', '--help'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /Usage: pnpm quote/u);
  assert.match(result.stdout, /--strategy <best-single\|greedy-split\|numerical-split>/u);
});

void test('quote CLI prints a readable exact route and JSON decimal strings', () => {
  const readable = spawnSync(process.execPath, [CLI, '--', ...BASE_ARGUMENTS], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(readable.status, 0);
  assert.equal(readable.stderr, '');
  assert.match(readable.stdout, /RouteLab exact-input quote/u);
  assert.match(readable.stdout, /route 1:/u);
  assert.match(readable.stdout, /exact validation: passed by fresh exact replay/u);
  assert.equal(readable.stdout.trim().split('\n').length < 35, true);

  const json = spawnSync(process.execPath, [CLI, '--', ...BASE_ARGUMENTS, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(json.status, 0);
  assert.equal(json.stderr, '');
  const parsed = JSON.parse(json.stdout) as Record<string, unknown>;
  assert.equal(parsed['schemaVersion'], 'routelab.quote.v1');
  assert.equal(parsed['amountIn'], '1000000000000000000');
  assert.equal(typeof parsed['amountOut'], 'string');
  assert.equal(parsed['exactValidation'], 'passed-fresh-exact-replay');
});
