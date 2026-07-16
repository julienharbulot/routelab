import { createHash } from 'node:crypto';

import type { LiquiditySnapshot } from '../../domain/index.ts';

export type SyntheticRequestAmountBucket =
  | 'max-reserve-1-in-100000'
  | 'max-reserve-1-in-10000'
  | 'max-reserve-1-in-1000';
export type SyntheticRequestTopology =
  | 'direct-edge-present'
  | 'direct-edge-absent-common-neighbor-present';

export interface GeneratedRequest {
  readonly requestId: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountBucket: SyntheticRequestAmountBucket;
  readonly amountIn: bigint;
  readonly topology: SyntheticRequestTopology;
}

export interface GeneratedCorpus {
  readonly requests: readonly GeneratedRequest[];
  readonly summary: {
    readonly schemaVersion: 'routelab.generated-benchmark-corpus.v2';
    readonly corpusId: string;
    readonly datasetId: string;
    readonly snapshotId: string;
    readonly snapshotChecksum: string;
    readonly corpusDigest: string;
    readonly requestCount: number;
    readonly amountBucketCount: 3;
    readonly directRequestCount: number;
    readonly multiHopOnlyRequestCount: number;
    readonly randomness: 'none';
  };
}

const CORPUS_ID =
  'ethereum-mainnet-uniswap-v2-block-19000000-core12-v1-synthetic-exhaustive-v1';
const BUCKETS = [
  ['max-reserve-1-in-100000', 100_000n],
  ['max-reserve-1-in-10000', 10_000n],
  ['max-reserve-1-in-1000', 1_000n],
] as const satisfies readonly (readonly [SyntheticRequestAmountBucket, bigint])[];

export function generatePortfolioRequests(
  datasetId: string,
  snapshot: LiquiditySnapshot,
  sourceAssets: readonly string[],
): GeneratedCorpus {
  const assets = [...sourceAssets].sort();
  const adjacency = new Map(assets.map((asset) => [asset, new Set<string>()]));
  const maximumReserve = new Map(assets.map((asset) => [asset, 0n]));
  for (const pool of snapshot.pools) {
    adjacency.get(pool.asset0)?.add(pool.asset1);
    adjacency.get(pool.asset1)?.add(pool.asset0);
    maximumReserve.set(pool.asset0, pool.reserve0 > (maximumReserve.get(pool.asset0) ?? 0n)
      ? pool.reserve0 : (maximumReserve.get(pool.asset0) ?? 0n));
    maximumReserve.set(pool.asset1, pool.reserve1 > (maximumReserve.get(pool.asset1) ?? 0n)
      ? pool.reserve1 : (maximumReserve.get(pool.asset1) ?? 0n));
  }

  const requests: GeneratedRequest[] = [];
  for (const assetIn of assets) for (const assetOut of assets) {
    if (assetIn === assetOut) continue;
    const inputNeighbors = adjacency.get(assetIn);
    const outputNeighbors = adjacency.get(assetOut);
    const reserve = maximumReserve.get(assetIn);
    if (inputNeighbors === undefined || outputNeighbors === undefined || reserve === undefined || reserve <= 0n) {
      throw new Error('Retained snapshot cannot produce the benchmark corpus.');
    }
    const direct = inputNeighbors.has(assetOut);
    const commonNeighbor = [...inputNeighbors].some((asset) => outputNeighbors.has(asset));
    if (!direct && !commonNeighbor) throw new Error('Retained asset pair is not reachable within two hops.');
    for (const [amountBucket, denominator] of BUCKETS) {
      const derived = reserve / denominator;
      requests.push(Object.freeze({
        requestId: `request-${String(requests.length + 1).padStart(4, '0')}`,
        assetIn,
        assetOut,
        amountBucket,
        amountIn: derived > 0n ? derived : 1n,
        topology: direct ? 'direct-edge-present' : 'direct-edge-absent-common-neighbor-present',
      }));
    }
  }
  const serialized = requests.map((request) => ({ ...request, amountIn: request.amountIn.toString(10) }));
  const corpusDigest = `sha256:${createHash('sha256').update(JSON.stringify({
    schemaVersion: 'routelab.generated-benchmark-corpus.v2', requests: serialized,
  })).digest('hex')}`;
  const directRequestCount = requests.filter((request) => request.topology === 'direct-edge-present').length;
  return Object.freeze({
    requests: Object.freeze(requests),
    summary: Object.freeze({
      schemaVersion: 'routelab.generated-benchmark-corpus.v2',
      corpusId: CORPUS_ID,
      datasetId,
      snapshotId: snapshot.snapshotId,
      snapshotChecksum: snapshot.snapshotChecksum,
      corpusDigest,
      requestCount: requests.length,
      amountBucketCount: 3,
      directRequestCount,
      multiHopOnlyRequestCount: requests.length - directRequestCount,
      randomness: 'none',
    }),
  });
}
