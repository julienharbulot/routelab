import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

function run(command: string, arguments_: readonly string[], cwd: string): string {
  const result = spawnSync(command, arguments_, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${arguments_.join(' ')} failed.\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
}

const consumerSource = `
import assert from 'node:assert/strict';
import { formatQuote, prepareSnapshot, quote, serializeQuote } from 'routelab-ts';
import { prepareNearIntentsFixtureAdapter, quoteNearIntentsExactInput } from 'routelab-ts/near-intents-fixture';

const snapshot = {
  snapshotId: 'demo-two-direct-pools',
  snapshotChecksum: 'sha256:15d26e434befa00d782d61ee4bf9e0fd704a83bb3b3720b89fd63ff0f7120b6f',
  pools: [
    { poolId: 'direct-0', asset0: 'A', reserve0: '100', asset1: 'B', reserve1: '100', feeChargedNumerator: '0', feeDenominator: '1' },
    { poolId: 'direct-1', asset0: 'A', reserve0: '100', asset1: 'B', reserve1: '100', feeChargedNumerator: '0', feeDenominator: '1' },
  ],
};
const prepared = prepareSnapshot(snapshot);
assert.equal(prepared.ok, true);
if (!prepared.ok) throw new Error(prepared.error.code);
const result = quote(prepared.value, {
  snapshotId: prepared.value.snapshotId,
  assetIn: 'A',
  assetOut: 'B',
  amountIn: 100n,
});
assert.equal(result.ok, true);
if (!result.ok) throw new Error(result.error.code);
assert.equal(result.value.amountOut, 66n);
assert.match(result.value.planFingerprint, /^sha256:[0-9a-f]{64}$/u);
assert.equal(serializeQuote(result.value).amountOut, '66');
assert.match(formatQuote(result.value), /A 100 -> B 66/u);
assert.equal(typeof prepareNearIntentsFixtureAdapter, 'function');
assert.equal(typeof quoteNearIntentsExactInput, 'function');
process.stdout.write('packed consumer quote: 100 -> 66\\n');
`;

const temporary = await mkdtemp(join(tmpdir(), 'routelab-package-'));
try {
  const tarball = join(temporary, 'routelab-ts-0.1.0.tgz');
  const packedOutput = run('pnpm', ['pack', '--json', '--out', tarball], ROOT);
  type Packed = {
    readonly files?: readonly { readonly path?: string }[];
  };
  const parsed = JSON.parse(packedOutput) as Packed | readonly Packed[];
  const packed: Packed | undefined = Array.isArray(parsed)
    ? (parsed as readonly Packed[])[0]
    : parsed as Packed;
  const paths: readonly string[] = packed?.files?.map(({ path }) => path ?? '') ?? [];
  assert.equal(paths.some((path) => path.endsWith('.js.map') || path.endsWith('.d.ts.map')), false);
  assert.equal(paths.some((path) => path.startsWith('src/')), false);
  assert.equal(paths.includes('dist/index.js'), true);
  assert.equal(paths.includes('dist/index.d.ts'), true);
  assert.equal(paths.includes('dist/adapters/near-intents/index.js'), true);
  assert.equal(paths.includes('DATA_NOTICE.md'), true);

  const consumer = join(temporary, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), '{"private":true,"type":"module"}\n', 'utf8');
  await writeFile(join(consumer, 'index.mjs'), consumerSource, 'utf8');
  run('pnpm', ['add', '--offline', '--ignore-scripts', tarball], consumer);
  const output = run(process.execPath, ['index.mjs'], consumer);
  assert.match(output, /packed consumer quote: 100 -> 66/u);

  const installedManifest = JSON.parse(await readFile(
    join(consumer, 'node_modules/routelab-ts/package.json'),
    'utf8',
  )) as { readonly exports?: unknown };
  assert.equal(typeof installedManifest.exports, 'object');
  process.stdout.write('Package consumer smoke passed: root and NEAR subpath imports are self-contained.\n');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
