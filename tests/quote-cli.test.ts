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
  'WETH',
  '--asset-out',
  'USDC',
  '--amount-in',
  '1000000000000000000',
  '--strategy',
  'best-single',
  '--effort',
  'fast',
  '--max-hops',
  '3',
  '--max-routes',
  '2',
] as const;

void test('quote CLI accepts the pnpm separator and prints help', () => {
  const result = spawnSync(process.execPath, [CLI, '--', '--help'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /Usage:\n {2}pnpm quote/u);
  assert.match(result.stdout, /--strategy <best-single\|greedy-split\|numerical-split>/u);
  assert.match(result.stdout, /--max-hops <1\.\.8>/u);
  assert.match(result.stdout, /--list-assets/u);
});

void test('quote CLI prints a readable exact route and JSON decimal strings', () => {
  const readable = spawnSync(process.execPath, [CLI, '--', ...BASE_ARGUMENTS], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(readable.status, 0);
  assert.equal(readable.stderr, '');
  assert.match(readable.stdout, /RouteLab exact-input quote/u);
  assert.match(readable.stdout, /WETH 1 -> USDC/u);
  assert.match(readable.stdout, /route 1:/u);
  assert.match(readable.stdout, /100\.00%/u);
  assert.match(readable.stdout, /exact validation: passed by fresh exact replay/u);
  assert.match(readable.stdout, /plan fingerprint: sha256:/u);
  assert.doesNotMatch(readable.stdout, /0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/u);
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
  assert.equal(parsed['assetIn'], '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
  assert.equal(typeof parsed['planFingerprint'], 'string');
  assert.equal(Object.hasOwn(parsed, 'work'), false);
  assert.equal(parsed['exactValidation'], 'passed-fresh-exact-replay');
});

void test('quote CLI lists manifest assets and retains an explicit raw display mode', () => {
  const listed = spawnSync(process.execPath, [
    CLI,
    '--',
    '--snapshot',
    'datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1/snapshot.json',
    '--list-assets',
  ], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(listed.status, 0);
  assert.equal(listed.stderr, '');
  assert.match(listed.stdout, /WETH\s+decimals=18/u);
  assert.match(listed.stdout, /USDC\s+decimals=6/u);
  assert.match(listed.stdout, /0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/u);

  const raw = spawnSync(process.execPath, [CLI, '--', ...BASE_ARGUMENTS, '--raw'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(raw.status, 0);
  assert.equal(raw.stderr, '');
  assert.match(raw.stdout, /0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2 1000000000000000000/u);
});
