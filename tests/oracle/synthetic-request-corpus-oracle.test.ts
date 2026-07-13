import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  verifySyntheticRequestCorpus,
  type SyntheticExactInputRequest,
} from '../../src/verification/synthetic-request-corpus/index.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DATASET = 'datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1';
const CORPUS =
  'datasets/requests/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/synthetic-exhaustive-v1';
const CORPUS_ID =
  'ethereum-mainnet-uniswap-v2-block-19000000-core12-v1-synthetic-exhaustive-v1';
const DATASET_ID = 'ethereum-mainnet-uniswap-v2-block-19000000-core12-v1';
const POLICY_HASH =
  'sha256:80c7738104050b03418064d306feab7cab8d420858c76637f95053d497233d1c';
const SNAPSHOT_HASH =
  'sha256:5d21166cf218997776efc23b203c2f70637b1fb822807fb236bfc6fd0bf3e755';
const CORPUS_HASH =
  'sha256:c470f0a33b5d03cdd1ac8d88c92a8e2ec79b78f7d488541c0f4a321ff3e03173';

interface JsonPool {
  readonly asset0: string;
  readonly reserve0: string;
  readonly asset1: string;
  readonly reserve1: string;
}

interface JsonSnapshot {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly pools: readonly JsonPool[];
}

interface JsonPolicy {
  readonly tokens: readonly { readonly address: string }[];
}

function parse(filePath: string): unknown {
  return JSON.parse(readFileSync(path.join(ROOT, filePath), 'utf8')) as unknown;
}

function rawCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function independentlyDerive() {
  const snapshot = parse(path.join(DATASET, 'snapshot.json')) as JsonSnapshot;
  const policy = parse(path.join(DATASET, 'policy.json')) as JsonPolicy;
  const assets = policy.tokens.map(({ address }) => address).sort(rawCompare);
  assert.equal(new Set(assets).size, 12);

  const adjacency = new Map(assets.map((asset) => [asset, new Set<string>()]));
  const maximumReserve = new Map(assets.map((asset) => [asset, 0n]));
  const undirectedPairs = new Set<string>();
  for (const pool of snapshot.pools) {
    const pair = [pool.asset0, pool.asset1].sort(rawCompare).join(':');
    assert.equal(undirectedPairs.has(pair), false);
    undirectedPairs.add(pair);
    adjacency.get(pool.asset0)?.add(pool.asset1);
    adjacency.get(pool.asset1)?.add(pool.asset0);
    const reserve0 = BigInt(pool.reserve0);
    const reserve1 = BigInt(pool.reserve1);
    assert.equal(reserve0 > 0n, true);
    assert.equal(reserve1 > 0n, true);
    if (reserve0 > (maximumReserve.get(pool.asset0) ?? 0n)) {
      maximumReserve.set(pool.asset0, reserve0);
    }
    if (reserve1 > (maximumReserve.get(pool.asset1) ?? 0n)) {
      maximumReserve.set(pool.asset1, reserve1);
    }
  }
  assert.equal(snapshot.pools.length, 54);
  assert.equal(undirectedPairs.size, 54);

  const sourceDataset = {
    datasetId: DATASET_ID,
    policySha256: POLICY_HASH,
    snapshotId: DATASET_ID,
    snapshotChecksum: SNAPSHOT_HASH,
  };
  const amountBuckets = [
    { id: 'max-reserve-1-in-100000', numerator: '1', denominator: '100000' },
    { id: 'max-reserve-1-in-10000', numerator: '1', denominator: '10000' },
    { id: 'max-reserve-1-in-1000', numerator: '1', denominator: '1000' },
  ] as const;
  const derivation = {
    selectionMode: 'exhaustive-ordered-distinct-asset-pairs',
    randomness: 'none',
    assetOrder: 'raw-utf16-address-ascending',
    pairOrder: 'asset-in-then-asset-out-then-amount-bucket',
    amountOrder: amountBuckets.map(({ id }) => id),
    reserveStatistic: 'maximum-positive-incident-reserve-for-input-asset',
    amountFormula: 'max(1,floor(maximumIncidentReserve*numerator/denominator))',
    amountBuckets,
    topologyClassification: 'undirected-stored-pair-adjacency-only',
  };

  const requests: Array<{
    requestId: string;
    assetIn: string;
    assetOut: string;
    amountBucket: string;
    amountIn: string;
    topology: string;
  }> = [];
  let directPairs = 0;
  let noDirectPairs = 0;
  const commonNeighborCounts = new Map<number, number>();
  for (const assetIn of assets) {
    for (const assetOut of assets) {
      if (assetIn === assetOut) continue;
      const inputNeighbors = adjacency.get(assetIn);
      const outputNeighbors = adjacency.get(assetOut);
      assert.ok(inputNeighbors);
      assert.ok(outputNeighbors);
      const direct = inputNeighbors.has(assetOut);
      const commonNeighbors = [...inputNeighbors].filter((asset) => outputNeighbors.has(asset));
      if (direct) {
        directPairs += 1;
      } else {
        noDirectPairs += 1;
        assert.ok(commonNeighbors.length === 5 || commonNeighbors.length === 6);
        commonNeighborCounts.set(
          commonNeighbors.length,
          (commonNeighborCounts.get(commonNeighbors.length) ?? 0) + 1,
        );
      }
      const reserve = maximumReserve.get(assetIn);
      assert.ok(reserve);
      for (const bucket of amountBuckets) {
        const derived = reserve * BigInt(bucket.numerator) / BigInt(bucket.denominator);
        requests.push({
          requestId: `request-${String(requests.length + 1).padStart(4, '0')}`,
          assetIn,
          assetOut,
          amountBucket: bucket.id,
          amountIn: (derived > 0n ? derived : 1n).toString(10),
          topology: direct
            ? 'direct-edge-present'
            : 'direct-edge-absent-common-neighbor-present',
        });
      }
    }
  }
  assert.equal(directPairs, 108);
  assert.equal(noDirectPairs, 24);
  assert.deepEqual([...commonNeighborCounts.entries()].sort(), [[5, 14], [6, 10]]);
  assert.equal(requests.length, 396);
  return {
    snapshot,
    sourceDataset,
    derivation,
    requests,
    text: JSON.stringify({
      schemaVersion: 'routelab.synthetic-request-corpus.v1',
      corpusId: CORPUS_ID,
      sourceDataset,
      derivation,
      requests,
    }),
  };
}

void test('independently derives every synthetic request, canonical byte, hash, and stratum', () => {
  const expected = independentlyDerive();
  const actual = readFileSync(path.join(ROOT, CORPUS, 'requests.json'));
  assert.equal(actual.byteLength, 99_301);
  assert.equal(actual.at(-1), 0x7d);
  assert.equal(actual.includes(0x0a), false);
  assert.equal(actual.toString('utf8'), expected.text);
  assert.equal(
    `sha256:${createHash('sha256').update(actual).digest('hex')}`,
    CORPUS_HASH,
  );
  assert.deepEqual(expected.requests[0], {
    requestId: 'request-0001',
    assetIn: '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e',
    assetOut: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
    amountBucket: 'max-reserve-1-in-100000',
    amountIn: '269808139664661',
    topology: 'direct-edge-present',
  });
  assert.deepEqual(expected.requests.at(-1), {
    requestId: 'request-0396',
    assetIn: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    assetOut: '0xd533a949740bb3306d119cc777fa900ba034cd52',
    amountBucket: 'max-reserve-1-in-1000',
    amountIn: '75619326628',
    topology: 'direct-edge-present',
  });
  assert.equal(
    expected.requests.filter(({ topology }) => topology === 'direct-edge-present').length,
    324,
  );
  assert.equal(
    expected.requests.filter(
      ({ topology }) => topology === 'direct-edge-absent-common-neighbor-present',
    ).length,
    72,
  );
  for (const bucket of expected.derivation.amountOrder) {
    assert.equal(expected.requests.filter(({ amountBucket }) => amountBucket === bucket).length, 132);
  }

  const manifest = parse(path.join(CORPUS, 'manifest.json')) as Record<string, unknown>;
  assert.deepEqual(manifest['sourceDataset'], expected.sourceDataset);
  assert.deepEqual(manifest['derivation'], expected.derivation);
  assert.deepEqual(manifest['artifact'], {
    path: 'requests.json',
    bytes: 99_301,
    sha256: CORPUS_HASH,
  });
});

void test('black-box verification matches the independent corpus with one defensive read', async () => {
  const expected = independentlyDerive();
  const reads = new Map<string, number>();
  const result = await verifySyntheticRequestCorpus(CORPUS, {
    readFile: (filePath) => new Promise<Uint8Array>((resolve, reject) => {
      reads.set(filePath, (reads.get(filePath) ?? 0) + 1);
      readFile(path.join(ROOT, filePath), (error, bytes) => {
        if (error) reject(error);
        else resolve(Uint8Array.from(bytes));
      });
    }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal([...reads.values()].every((count) => count === 1), true);
  assert.equal(reads.size, 9);
  assert.equal(result.value.corpus.requests.length, expected.requests.length);
  for (let index = 0; index < expected.requests.length; index += 1) {
    const actualRequest: SyntheticExactInputRequest | undefined =
      result.value.corpus.requests[index];
    const oracle = expected.requests[index];
    assert.ok(actualRequest);
    assert.ok(oracle);
    assert.deepEqual(actualRequest, {
      requestId: oracle.requestId,
      assetIn: oracle.assetIn,
      assetOut: oracle.assetOut,
      amountBucket: oracle.amountBucket,
      amountIn: BigInt(oracle.amountIn),
      topology: oracle.topology,
    });
    assert.equal(Object.isFrozen(actualRequest), true);
  }
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.corpus), true);
  assert.equal(Object.isFrozen(result.value.corpus.requests), true);
  assert.equal(Object.isFrozen(result.value.summary), true);
});
