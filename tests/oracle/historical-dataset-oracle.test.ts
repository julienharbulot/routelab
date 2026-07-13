import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { verifyHistoricalDataset } from '../../src/verification/historical-dataset/index.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DATASET = path.join(
  ROOT,
  'datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1',
);
const EXPECTED = [
  ['policy', 'policy.json', 2794, '80c7738104050b03418064d306feab7cab8d420858c76637f95053d497233d1c'],
  ['infura-normalized', 'sources/infura-normalized.json', 15380, 'e9a01c6ae6cd7ef7d76e3aa0b4c0ddec680d5f649ecbf1f3007bc8d766e2ae88'],
  ['sqd-normalized', 'sources/sqd-normalized.json', 15377, 'c59bd6e2d777dfc7122a4522e203c21aefd607b630bc991977fa2ea0237100b6'],
  ['reconciliation', 'reconciliation.json', 565, 'ee184996130c610035df3b1b7fc7fe4eb6fc0166af5c93174102c3e0745e29ae'],
  ['snapshot', 'snapshot.json', 18502, '4c43d4920f0edb487a262f1d321ba4790d07c7563e2a3b0157c5b51122fb3478'],
  ['canonical-snapshot-content', 'canonical-snapshot-content.json', 14799, '5d21166cf218997776efc23b203c2f70637b1fb822807fb236bfc6fd0bf3e755'],
] as const;

interface SourcePair {
  pair: string;
  token0: string;
  token1: string;
  reserve0: string;
  reserve1: string;
}

interface SnapshotPool {
  poolId: string;
  asset0: string;
  reserve0: string;
  asset1: string;
  reserve1: string;
  feeChargedNumerator: string;
  feeDenominator: string;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) assertDeepFrozen(Reflect.get(value, key), seen);
}

async function bytes(relativePath: string): Promise<Uint8Array> {
  return readFile(path.join(DATASET, relativePath));
}

async function json(relativePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(new TextDecoder().decode(await bytes(relativePath))) as Record<string, unknown>;
}

void test('independently derives every curated artifact, source pair, and canonical snapshot byte', async () => {
  const manifest = await json('manifest.json');
  const artifacts = manifest['artifacts'] as Record<string, unknown>[];
  assert.equal(artifacts.length, EXPECTED.length);
  for (const [index, [expectedRole, relativePath, expectedBytes, expectedHash]] of EXPECTED.entries()) {
    const content = await bytes(relativePath);
    assert.equal(content.byteLength, expectedBytes, relativePath);
    assert.equal(sha256(content), expectedHash, relativePath);
    assert.deepEqual(artifacts[index], {
      role: expectedRole,
      path: relativePath,
      bytes: expectedBytes,
      sha256: `sha256:${expectedHash}`,
    });
  }

  const policy = await json('policy.json');
  const tokens = policy['tokens'] as Record<string, unknown>[];
  assert.equal(tokens.length, 12);
  assert.equal(tokens.length * (tokens.length - 1) / 2, 66);
  assert.equal(new Set(tokens.map((token) => token['address'])).size, 12);

  const infura = await json('sources/infura-normalized.json');
  const sqd = await json('sources/sqd-normalized.json');
  const infuraComparable = structuredClone(infura);
  const sqdComparable = structuredClone(sqd);
  delete infuraComparable['source'];
  delete sqdComparable['source'];
  assert.deepEqual(sqdComparable, infuraComparable);
  const sourcePairs = infura['pairs'] as SourcePair[];
  assert.equal(sourcePairs.length, 54);
  assert.equal(new Set(sourcePairs.map((pair) => pair.pair)).size, 54);
  assert.equal(sourcePairs.every((pair, index) => {
    return index === 0 || (sourcePairs[index - 1] as SourcePair).pair < pair.pair;
  }), true);

  const snapshot = await json('snapshot.json');
  const pools = snapshot['pools'] as SnapshotPool[];
  assert.equal(pools.length, 54);
  assert.equal(new Set(pools.flatMap((pool) => [pool.asset0, pool.asset1])).size, 12);
  assert.equal(pools.every((pool, index) => {
    const pair = sourcePairs[index];
    return pair !== undefined
      && pool.poolId === pair.pair
      && pool.asset0 === pair.token0
      && pool.reserve0 === pair.reserve0
      && pool.asset1 === pair.token1
      && pool.reserve1 === pair.reserve1
      && pool.feeChargedNumerator === '3'
      && pool.feeDenominator === '1000';
  }), true);

  const canonical = JSON.stringify({
    schemaVersion: 'routelab.snapshot.v1',
    pools: [...pools]
      .sort((left, right) => left.poolId < right.poolId ? -1 : left.poolId > right.poolId ? 1 : 0)
      .map((pool) => ({
        poolId: pool.poolId,
        asset0: pool.asset0,
        reserve0: pool.reserve0,
        asset1: pool.asset1,
        reserve1: pool.reserve1,
        feeChargedNumerator: pool.feeChargedNumerator,
        feeDenominator: pool.feeDenominator,
      })),
  });
  const trackedCanonical = new TextDecoder().decode(await bytes('canonical-snapshot-content.json'));
  assert.equal(trackedCanonical, canonical);
  assert.equal(trackedCanonical.endsWith('\n'), false);
  assert.equal(Buffer.byteLength(canonical), 14799);
  assert.equal(`sha256:${sha256(new TextEncoder().encode(canonical))}`, snapshot['snapshotChecksum']);
  assert.equal(/generatedAt|request-log|rpc-attempts|cache\/|\.env|data-acquisition\//u.test(
    JSON.stringify({ manifest, policy, infura, sqd, snapshot }),
  ), false);
});

void test('black-box verification reads once in order, freezes success, and detects independent source drift', async () => {
  const files = new Map<string, Uint8Array>();
  files.set('manifest.json', await bytes('manifest.json'));
  for (const [, relativePath] of EXPECTED) files.set(relativePath, await bytes(relativePath));
  const calls: string[] = [];
  const dependencies = {
    readFile(filePath: string): Promise<Uint8Array> {
      const relativePath = path.relative('/dataset', filePath).split(path.sep).join('/');
      calls.push(relativePath);
      const content = files.get(relativePath);
      return content === undefined
        ? Promise.reject(new Error('missing oracle file'))
        : Promise.resolve(content);
    },
  };
  const success = await verifyHistoricalDataset('/dataset', dependencies);
  assert.equal(success.ok, true);
  assert.deepEqual(calls, ['manifest.json', ...EXPECTED.map(([, relativePath]) => relativePath)]);
  assertDeepFrozen(success);

  const sqd = JSON.parse(new TextDecoder().decode(
    files.get('sources/sqd-normalized.json'),
  )) as Record<string, unknown>;
  const pairs = sqd['pairs'] as SourcePair[];
  const first = pairs[0];
  if (first === undefined) throw new Error('Expected an SQD pair.');
  first.reserve0 = (BigInt(first.reserve0) + 1n).toString(10);
  const changedSource = new TextEncoder().encode(`${JSON.stringify(sqd, undefined, 2)}\n`);
  files.set('sources/sqd-normalized.json', changedSource);
  const manifest = JSON.parse(new TextDecoder().decode(
    files.get('manifest.json'),
  )) as Record<string, unknown>;
  const artifacts = manifest['artifacts'] as Record<string, unknown>[];
  const declaration = artifacts.find((artifact) => artifact['path'] === 'sources/sqd-normalized.json');
  if (declaration === undefined) throw new Error('Expected SQD declaration.');
  declaration['bytes'] = changedSource.byteLength;
  declaration['sha256'] = `sha256:${sha256(changedSource)}`;
  files.set('manifest.json', new TextEncoder().encode(`${JSON.stringify(manifest, undefined, 2)}\n`));

  calls.splice(0);
  const mismatch = await verifyHistoricalDataset('/dataset', dependencies);
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) {
    assert.deepEqual(mismatch.error, {
      code: 'source-reconciliation-mismatch',
      artifact: 'reconciliation.json',
      message: 'The normalized sources and reconciliation declaration do not agree exactly.',
    });
  }
  assertDeepFrozen(mismatch);
});
