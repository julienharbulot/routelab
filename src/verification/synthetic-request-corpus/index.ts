import { createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { parseLiquiditySnapshot, type LiquiditySnapshot } from '../../domain/index.ts';
import type { PreparedRoutingContext } from '../../runtime/prepared-routing-context/index.ts';
import {
  CANONICAL_HISTORICAL_DATASET_DIRECTORY,
  verifyHistoricalDataset,
} from '../historical-dataset/index.ts';

export const CANONICAL_SYNTHETIC_REQUEST_CORPUS_DIRECTORY =
  'datasets/requests/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/synthetic-exhaustive-v1';

const CORPUS_ID =
  'ethereum-mainnet-uniswap-v2-block-19000000-core12-v1-synthetic-exhaustive-v1';
const DATASET_ID = 'ethereum-mainnet-uniswap-v2-block-19000000-core12-v1';
const POLICY_SHA256 =
  'sha256:80c7738104050b03418064d306feab7cab8d420858c76637f95053d497233d1c';
const SNAPSHOT_CHECKSUM =
  'sha256:5d21166cf218997776efc23b203c2f70637b1fb822807fb236bfc6fd0bf3e755';
const REQUESTS_SHA256 =
  'sha256:c470f0a33b5d03cdd1ac8d88c92a8e2ec79b78f7d488541c0f4a321ff3e03173';

const EXPECTED_SOURCE_DATASET = Object.freeze({
  datasetId: DATASET_ID,
  policySha256: POLICY_SHA256,
  snapshotId: DATASET_ID,
  snapshotChecksum: SNAPSHOT_CHECKSUM,
});

const EXPECTED_AMOUNT_BUCKETS = Object.freeze([
  Object.freeze({
    id: 'max-reserve-1-in-100000',
    numerator: '1',
    denominator: '100000',
  }),
  Object.freeze({
    id: 'max-reserve-1-in-10000',
    numerator: '1',
    denominator: '10000',
  }),
  Object.freeze({
    id: 'max-reserve-1-in-1000',
    numerator: '1',
    denominator: '1000',
  }),
]);

const EXPECTED_DERIVATION = Object.freeze({
  selectionMode: 'exhaustive-ordered-distinct-asset-pairs',
  randomness: 'none',
  assetOrder: 'raw-utf16-address-ascending',
  pairOrder: 'asset-in-then-asset-out-then-amount-bucket',
  amountOrder: Object.freeze(EXPECTED_AMOUNT_BUCKETS.map((bucket) => bucket.id)),
  reserveStatistic: 'maximum-positive-incident-reserve-for-input-asset',
  amountFormula: 'max(1,floor(maximumIncidentReserve*numerator/denominator))',
  amountBuckets: EXPECTED_AMOUNT_BUCKETS,
  topologyClassification: 'undirected-stored-pair-adjacency-only',
});

const EXPECTED_ARTIFACT = Object.freeze({
  path: 'requests.json',
  bytes: 99_301,
  sha256: REQUESTS_SHA256,
});

const EXPECTED_COUNTS = Object.freeze({
  assetCount: 12,
  poolCount: 54,
  orderedPairCount: 132,
  requestCount: 396,
  amountBucketCounts: Object.freeze({
    'max-reserve-1-in-100000': 132,
    'max-reserve-1-in-10000': 132,
    'max-reserve-1-in-1000': 132,
  }),
  topologyCounts: Object.freeze({
    'direct-edge-present': 324,
    'direct-edge-absent-common-neighbor-present': 72,
  }),
});

const EXPECTED_LIMITATIONS = Object.freeze([
  'This exhaustive grid covers only ordered distinct pairs from one frozen 12-asset allowlist at one block and venue.',
  "Amounts are exact fractions of each input asset's maximum incident stored reserve; they are not equal-value trades, historical orders, or a representative market distribution.",
  'Maximum-reserve anchors can be hub- or outlier-biased and are immutable for this corpus version.',
  'The graph is connected with diameter two, so this corpus contains no disconnected or deeper-topology request.',
  'Runtime parameters, work caps, router results, routes, allocations, timing, environment metadata, and performance or optimality conclusions are excluded.',
]);

export interface SyntheticRequestCorpusVerifierDependencies {
  readonly readFile: (path: string) => Promise<Uint8Array>;
}

export type SyntheticRequestAmountBucket =
  | 'max-reserve-1-in-100000'
  | 'max-reserve-1-in-10000'
  | 'max-reserve-1-in-1000';

export type SyntheticRequestTopology =
  | 'direct-edge-present'
  | 'direct-edge-absent-common-neighbor-present';

export interface SyntheticExactInputRequest {
  readonly requestId: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountBucket: SyntheticRequestAmountBucket;
  readonly amountIn: bigint;
  readonly topology: SyntheticRequestTopology;
}

export interface VerifiedSyntheticRequestCorpus {
  readonly corpusId: string;
  readonly datasetId: string;
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly requests: readonly SyntheticExactInputRequest[];
}

export type SyntheticRequestCorpusVerificationErrorCode =
  | 'manifest-read-failed'
  | 'invalid-manifest-json'
  | 'invalid-manifest-shape'
  | 'historical-dataset-invalid'
  | 'requests-read-failed'
  | 'requests-size-mismatch'
  | 'requests-hash-mismatch'
  | 'invalid-requests-json'
  | 'invalid-requests-shape'
  | 'corpus-derivation-mismatch'
  | 'manifest-metadata-mismatch';

export interface SyntheticRequestCorpusVerificationError {
  readonly code: SyntheticRequestCorpusVerificationErrorCode;
  readonly artifact: string;
  readonly message: string;
}

export interface SyntheticRequestCorpusVerificationSummary {
  readonly schemaVersion: 'routelab.synthetic-request-corpus-verification-summary.v1';
  readonly corpusId: string;
  readonly datasetId: string;
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly artifactSha256: string;
  readonly requestCount: number;
  readonly amountBucketCount: number;
  readonly directRequestCount: number;
  readonly multiHopOnlyRequestCount: number;
  readonly randomness: 'none';
}

export type SyntheticRequestCorpusVerificationResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly context: PreparedRoutingContext;
        readonly corpus: VerifiedSyntheticRequestCorpus;
        readonly summary: SyntheticRequestCorpusVerificationSummary;
      };
    }
  | { readonly ok: false; readonly error: SyntheticRequestCorpusVerificationError };

interface SourceDatasetBinding {
  readonly datasetId: string;
  readonly policySha256: string;
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
}

interface AmountBucketDefinition {
  readonly id: string;
  readonly numerator: string;
  readonly denominator: string;
}

interface DerivationContract {
  readonly selectionMode: string;
  readonly randomness: string;
  readonly assetOrder: string;
  readonly pairOrder: string;
  readonly amountOrder: readonly string[];
  readonly reserveStatistic: string;
  readonly amountFormula: string;
  readonly amountBuckets: readonly AmountBucketDefinition[];
  readonly topologyClassification: string;
}

interface CorpusArtifact {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

interface CorpusCounts {
  readonly assetCount: number;
  readonly poolCount: number;
  readonly orderedPairCount: number;
  readonly requestCount: number;
  readonly amountBucketCounts: Readonly<Record<string, number>>;
  readonly topologyCounts: Readonly<Record<string, number>>;
}

interface CorpusManifest {
  readonly schemaVersion: string;
  readonly corpusId: string;
  readonly sourceDataset: SourceDatasetBinding;
  readonly derivation: DerivationContract;
  readonly artifact: CorpusArtifact;
  readonly counts: CorpusCounts;
  readonly limitations: readonly string[];
}

interface SerializedSyntheticRequest {
  readonly requestId: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountBucket: SyntheticRequestAmountBucket;
  readonly amountIn: string;
  readonly topology: SyntheticRequestTopology;
}

interface SerializedCorpus {
  readonly schemaVersion: string;
  readonly corpusId: string;
  readonly sourceDataset: SourceDatasetBinding;
  readonly derivation: DerivationContract;
  readonly requests: readonly SerializedSyntheticRequest[];
}

function failure(
  code: SyntheticRequestCorpusVerificationErrorCode,
  artifact: string,
  message: string,
): SyntheticRequestCorpusVerificationResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, artifact, message }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isCanonicalPositiveDecimal(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]*$/u.test(value);
}

function isHexAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-f]{40}$/u.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function isSafeArtifactPath(value: string): boolean {
  return value.length > 0
    && !path.isAbsolute(value)
    && !value.includes('\\')
    && value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function parseSourceDataset(value: unknown): SourceDatasetBinding | undefined {
  if (!isRecord(value) || !hasExactKeys(
    value,
    ['datasetId', 'policySha256', 'snapshotId', 'snapshotChecksum'],
  )) return undefined;
  if (
    !isNonemptyString(value['datasetId'])
    || !isSha256(value['policySha256'])
    || !isNonemptyString(value['snapshotId'])
    || !isSha256(value['snapshotChecksum'])
  ) return undefined;
  return Object.freeze({
    datasetId: value['datasetId'],
    policySha256: value['policySha256'],
    snapshotId: value['snapshotId'],
    snapshotChecksum: value['snapshotChecksum'],
  });
}

function parseDerivation(value: unknown): DerivationContract | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    'selectionMode',
    'randomness',
    'assetOrder',
    'pairOrder',
    'amountOrder',
    'reserveStatistic',
    'amountFormula',
    'amountBuckets',
    'topologyClassification',
  ])) return undefined;
  if (
    !isNonemptyString(value['selectionMode'])
    || !isNonemptyString(value['randomness'])
    || !isNonemptyString(value['assetOrder'])
    || !isNonemptyString(value['pairOrder'])
    || !Array.isArray(value['amountOrder'])
    || value['amountOrder'].length === 0
    || !value['amountOrder'].every(isNonemptyString)
    || new Set(value['amountOrder']).size !== value['amountOrder'].length
    || !isNonemptyString(value['reserveStatistic'])
    || !isNonemptyString(value['amountFormula'])
    || !Array.isArray(value['amountBuckets'])
    || value['amountBuckets'].length === 0
    || !isNonemptyString(value['topologyClassification'])
  ) return undefined;
  const amountBuckets: AmountBucketDefinition[] = [];
  for (const bucket of value['amountBuckets']) {
    if (!isRecord(bucket) || !hasExactKeys(bucket, ['id', 'numerator', 'denominator'])) {
      return undefined;
    }
    if (
      !isNonemptyString(bucket['id'])
      || !isCanonicalPositiveDecimal(bucket['numerator'])
      || !isCanonicalPositiveDecimal(bucket['denominator'])
    ) return undefined;
    amountBuckets.push(Object.freeze({
      id: bucket['id'],
      numerator: bucket['numerator'],
      denominator: bucket['denominator'],
    }));
  }
  if (new Set(amountBuckets.map((bucket) => bucket.id)).size !== amountBuckets.length) {
    return undefined;
  }
  return Object.freeze({
    selectionMode: value['selectionMode'],
    randomness: value['randomness'],
    assetOrder: value['assetOrder'],
    pairOrder: value['pairOrder'],
    amountOrder: Object.freeze([...value['amountOrder']]),
    reserveStatistic: value['reserveStatistic'],
    amountFormula: value['amountFormula'],
    amountBuckets: Object.freeze(amountBuckets),
    topologyClassification: value['topologyClassification'],
  });
}

function parseCountRecord(
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, number>> | undefined {
  if (!isRecord(value) || !hasExactKeys(value, keys)) return undefined;
  const parsed: Record<string, number> = {};
  for (const key of keys) {
    const count = value[key];
    if (!isSafeNonnegativeInteger(count)) return undefined;
    parsed[key] = count;
  }
  return Object.freeze(parsed);
}

function parseManifest(value: unknown): CorpusManifest | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schemaVersion',
    'corpusId',
    'sourceDataset',
    'derivation',
    'artifact',
    'counts',
    'limitations',
  ])) return undefined;
  const sourceDataset = parseSourceDataset(value['sourceDataset']);
  const derivation = parseDerivation(value['derivation']);
  if (!isRecord(value['artifact']) || !hasExactKeys(value['artifact'], ['path', 'bytes', 'sha256'])) {
    return undefined;
  }
  const artifactPath = value['artifact']['path'];
  if (
    !isNonemptyString(artifactPath)
    || !isSafeArtifactPath(artifactPath)
    || artifactPath !== 'requests.json'
    || !isSafeNonnegativeInteger(value['artifact']['bytes'])
    || !isSha256(value['artifact']['sha256'])
  ) return undefined;
  if (!isRecord(value['counts']) || !hasExactKeys(value['counts'], [
    'assetCount',
    'poolCount',
    'orderedPairCount',
    'requestCount',
    'amountBucketCounts',
    'topologyCounts',
  ])) return undefined;
  const amountBucketCounts = parseCountRecord(
    value['counts']['amountBucketCounts'],
    ['max-reserve-1-in-100000', 'max-reserve-1-in-10000', 'max-reserve-1-in-1000'],
  );
  const topologyCounts = parseCountRecord(
    value['counts']['topologyCounts'],
    ['direct-edge-present', 'direct-edge-absent-common-neighbor-present'],
  );
  if (
    !isNonemptyString(value['schemaVersion'])
    || !isNonemptyString(value['corpusId'])
    || sourceDataset === undefined
    || derivation === undefined
    || !isSafeNonnegativeInteger(value['counts']['assetCount'])
    || !isSafeNonnegativeInteger(value['counts']['poolCount'])
    || !isSafeNonnegativeInteger(value['counts']['orderedPairCount'])
    || !isSafeNonnegativeInteger(value['counts']['requestCount'])
    || amountBucketCounts === undefined
    || topologyCounts === undefined
    || !Array.isArray(value['limitations'])
    || value['limitations'].length === 0
    || !value['limitations'].every(isNonemptyString)
  ) return undefined;
  return Object.freeze({
    schemaVersion: value['schemaVersion'],
    corpusId: value['corpusId'],
    sourceDataset,
    derivation,
    artifact: Object.freeze({
      path: artifactPath,
      bytes: value['artifact']['bytes'],
      sha256: value['artifact']['sha256'],
    }),
    counts: Object.freeze({
      assetCount: value['counts']['assetCount'],
      poolCount: value['counts']['poolCount'],
      orderedPairCount: value['counts']['orderedPairCount'],
      requestCount: value['counts']['requestCount'],
      amountBucketCounts,
      topologyCounts,
    }),
    limitations: Object.freeze([...value['limitations']]),
  });
}

function isAmountBucket(value: unknown): value is SyntheticRequestAmountBucket {
  return value === 'max-reserve-1-in-100000'
    || value === 'max-reserve-1-in-10000'
    || value === 'max-reserve-1-in-1000';
}

function isTopology(value: unknown): value is SyntheticRequestTopology {
  return value === 'direct-edge-present'
    || value === 'direct-edge-absent-common-neighbor-present';
}

function parseCorpus(value: unknown): SerializedCorpus | undefined {
  if (!isRecord(value) || !hasExactKeys(
    value,
    ['schemaVersion', 'corpusId', 'sourceDataset', 'derivation', 'requests'],
  )) return undefined;
  const sourceDataset = parseSourceDataset(value['sourceDataset']);
  const derivation = parseDerivation(value['derivation']);
  if (
    !isNonemptyString(value['schemaVersion'])
    || !isNonemptyString(value['corpusId'])
    || sourceDataset === undefined
    || derivation === undefined
    || !Array.isArray(value['requests'])
  ) return undefined;
  const requests: SerializedSyntheticRequest[] = [];
  const ids = new Set<string>();
  const tuples = new Set<string>();
  for (const request of value['requests']) {
    if (!isRecord(request) || !hasExactKeys(request, [
      'requestId',
      'assetIn',
      'assetOut',
      'amountBucket',
      'amountIn',
      'topology',
    ])) return undefined;
    if (
      typeof request['requestId'] !== 'string'
      || !/^request-[0-9]{4}$/u.test(request['requestId'])
      || !isHexAddress(request['assetIn'])
      || !isHexAddress(request['assetOut'])
      || request['assetIn'] === request['assetOut']
      || !isAmountBucket(request['amountBucket'])
      || !isCanonicalPositiveDecimal(request['amountIn'])
      || !isTopology(request['topology'])
    ) return undefined;
    const tuple = `${request['assetIn']}\u0000${request['assetOut']}\u0000${request['amountBucket']}`;
    if (ids.has(request['requestId']) || tuples.has(tuple)) return undefined;
    ids.add(request['requestId']);
    tuples.add(tuple);
    requests.push(Object.freeze({
      requestId: request['requestId'],
      assetIn: request['assetIn'],
      assetOut: request['assetOut'],
      amountBucket: request['amountBucket'],
      amountIn: request['amountIn'],
      topology: request['topology'],
    }));
  }
  return Object.freeze({
    schemaVersion: value['schemaVersion'],
    corpusId: value['corpusId'],
    sourceDataset,
    derivation,
    requests: Object.freeze(requests),
  });
}

function parseJsonBytes(
  bytes: Uint8Array,
): { readonly ok: true; readonly text: string; readonly value: unknown } | { readonly ok: false } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return Object.freeze({ ok: true, text, value: JSON.parse(text) as unknown });
  } catch {
    return Object.freeze({ ok: false });
  }
}

function extractPolicyAssets(value: unknown): readonly string[] | undefined {
  if (!isRecord(value) || !Array.isArray(value['tokens']) || value['tokens'].length === 0) {
    return undefined;
  }
  const assets: string[] = [];
  for (const token of value['tokens']) {
    if (
      !isRecord(token)
      || !hasExactKeys(token, ['symbol', 'address', 'decimals'])
      || !isNonemptyString(token['symbol'])
      || !isHexAddress(token['address'])
      || !isSafeNonnegativeInteger(token['decimals'])
    ) return undefined;
    assets.push(token['address']);
  }
  if (new Set(assets).size !== assets.length) return undefined;
  return Object.freeze(assets);
}

function assetsInSnapshot(snapshot: LiquiditySnapshot): ReadonlySet<string> {
  const assets = new Set<string>();
  for (const pool of snapshot.pools) {
    assets.add(pool.asset0);
    assets.add(pool.asset1);
  }
  return assets;
}

function compareRawUtf16(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function deriveSerializedCorpus(
  snapshot: LiquiditySnapshot,
  policyAssets: readonly string[],
): SerializedCorpus | undefined {
  const snapshotAssets = assetsInSnapshot(snapshot);
  if (
    snapshotAssets.size !== policyAssets.length
    || policyAssets.some((asset) => !snapshotAssets.has(asset))
  ) return undefined;
  const assets = [...policyAssets].sort(compareRawUtf16);
  const adjacency = new Map<string, Set<string>>(
    assets.map((asset) => [asset, new Set<string>()]),
  );
  const maximumReserve = new Map<string, bigint>(assets.map((asset) => [asset, 0n]));
  for (const pool of snapshot.pools) {
    adjacency.get(pool.asset0)?.add(pool.asset1);
    adjacency.get(pool.asset1)?.add(pool.asset0);
    if (pool.reserve0 > (maximumReserve.get(pool.asset0) ?? 0n)) {
      maximumReserve.set(pool.asset0, pool.reserve0);
    }
    if (pool.reserve1 > (maximumReserve.get(pool.asset1) ?? 0n)) {
      maximumReserve.set(pool.asset1, pool.reserve1);
    }
  }
  const requests: SerializedSyntheticRequest[] = [];
  for (const assetIn of assets) {
    for (const assetOut of assets) {
      if (assetIn === assetOut) continue;
      const inputNeighbors = adjacency.get(assetIn);
      const outputNeighbors = adjacency.get(assetOut);
      if (inputNeighbors === undefined || outputNeighbors === undefined) return undefined;
      const direct = inputNeighbors.has(assetOut);
      let commonNeighbor = false;
      if (!direct) {
        for (const asset of inputNeighbors) {
          if (outputNeighbors.has(asset)) {
            commonNeighbor = true;
            break;
          }
        }
      }
      if (!direct && !commonNeighbor) return undefined;
      const reserve = maximumReserve.get(assetIn);
      if (reserve === undefined || reserve <= 0n) return undefined;
      for (const bucket of EXPECTED_AMOUNT_BUCKETS) {
        const derived = reserve * BigInt(bucket.numerator) / BigInt(bucket.denominator);
        requests.push(Object.freeze({
          requestId: `request-${String(requests.length + 1).padStart(4, '0')}`,
          assetIn,
          assetOut,
          amountBucket: bucket.id,
          amountIn: (derived > 0n ? derived : 1n).toString(10),
          topology: direct
            ? 'direct-edge-present'
            : 'direct-edge-absent-common-neighbor-present',
        }));
      }
    }
  }
  return Object.freeze({
    schemaVersion: 'routelab.synthetic-request-corpus.v1',
    corpusId: CORPUS_ID,
    sourceDataset: EXPECTED_SOURCE_DATASET,
    derivation: EXPECTED_DERIVATION,
    requests: Object.freeze(requests),
  });
}

function manifestMetadataMatches(manifest: CorpusManifest): boolean {
  return manifest.schemaVersion === 'routelab.synthetic-request-corpus-manifest.v1'
    && manifest.corpusId === CORPUS_ID
    && isDeepStrictEqual(manifest.sourceDataset, EXPECTED_SOURCE_DATASET)
    && isDeepStrictEqual(manifest.derivation, EXPECTED_DERIVATION)
    && isDeepStrictEqual(manifest.artifact, EXPECTED_ARTIFACT)
    && isDeepStrictEqual(manifest.counts, EXPECTED_COUNTS)
    && isDeepStrictEqual(manifest.limitations, EXPECTED_LIMITATIONS);
}

async function readBytes(
  readFile: (filePath: string) => Promise<Uint8Array>,
  filePath: string,
): Promise<Uint8Array | undefined> {
  try {
    return Uint8Array.from(await readFile(filePath));
  } catch {
    return undefined;
  }
}

export async function verifySyntheticRequestCorpus(
  directory: string,
  dependencies: SyntheticRequestCorpusVerifierDependencies,
): Promise<SyntheticRequestCorpusVerificationResult> {
  let sourceReadFile: (filePath: string) => Promise<Uint8Array>;
  try {
    sourceReadFile = dependencies.readFile;
  } catch {
    return failure(
      'manifest-read-failed',
      'manifest.json',
      'Could not read the synthetic request corpus manifest.',
    );
  }

  const cache = new Map<string, Uint8Array>();
  const cachedReadFile = async (filePath: string): Promise<Uint8Array> => {
    const cached = cache.get(filePath);
    if (cached !== undefined) return Uint8Array.from(cached);
    const bytes = Uint8Array.from(await sourceReadFile(filePath));
    cache.set(filePath, bytes);
    return Uint8Array.from(bytes);
  };

  const manifestBytes = await readBytes(cachedReadFile, path.join(directory, 'manifest.json'));
  if (manifestBytes === undefined) {
    return failure(
      'manifest-read-failed',
      'manifest.json',
      'Could not read the synthetic request corpus manifest.',
    );
  }
  const manifestJson = parseJsonBytes(manifestBytes);
  if (!manifestJson.ok) {
    return failure(
      'invalid-manifest-json',
      'manifest.json',
      'The synthetic request corpus manifest is not valid UTF-8 JSON.',
    );
  }
  const manifest = parseManifest(manifestJson.value);
  if (manifest === undefined) {
    return failure(
      'invalid-manifest-shape',
      'manifest.json',
      'The synthetic request corpus manifest does not match its strict schema.',
    );
  }

  const historical = await verifyHistoricalDataset(
    CANONICAL_HISTORICAL_DATASET_DIRECTORY,
    { readFile: cachedReadFile },
  );
  if (!historical.ok) {
    return failure(
      'historical-dataset-invalid',
      `historical-dataset/${historical.error.artifact}`,
      'The canonical historical dataset did not pass complete offline verification.',
    );
  }

  const policyPath = path.join(CANONICAL_HISTORICAL_DATASET_DIRECTORY, 'policy.json');
  const snapshotPath = path.join(CANONICAL_HISTORICAL_DATASET_DIRECTORY, 'snapshot.json');
  const cachedPolicy = cache.get(policyPath);
  const cachedSnapshot = cache.get(snapshotPath);
  const policyJson = cachedPolicy === undefined ? undefined : parseJsonBytes(cachedPolicy);
  const snapshotJson = cachedSnapshot === undefined ? undefined : parseJsonBytes(cachedSnapshot);
  const policyAssets = policyJson?.ok === true ? extractPolicyAssets(policyJson.value) : undefined;
  const parsedSnapshot = snapshotJson?.ok === true
    ? parseLiquiditySnapshot(snapshotJson.value)
    : undefined;
  if (policyAssets === undefined || parsedSnapshot === undefined || !parsedSnapshot.ok) {
    return failure(
      'historical-dataset-invalid',
      'historical-dataset',
      'The verified historical inputs could not be reused for corpus derivation.',
    );
  }

  const requestsBytes = await readBytes(
    cachedReadFile,
    path.join(directory, manifest.artifact.path),
  );
  if (requestsBytes === undefined) {
    return failure(
      'requests-read-failed',
      manifest.artifact.path,
      'Could not read the declared synthetic request corpus artifact.',
    );
  }
  if (requestsBytes.byteLength !== manifest.artifact.bytes) {
    return failure(
      'requests-size-mismatch',
      manifest.artifact.path,
      'The synthetic request corpus byte length does not match the manifest.',
    );
  }
  const actualSha256 = `sha256:${createHash('sha256').update(requestsBytes).digest('hex')}`;
  if (actualSha256 !== manifest.artifact.sha256) {
    return failure(
      'requests-hash-mismatch',
      manifest.artifact.path,
      'The synthetic request corpus SHA-256 does not match the manifest.',
    );
  }
  const requestsJson = parseJsonBytes(requestsBytes);
  if (!requestsJson.ok) {
    return failure(
      'invalid-requests-json',
      manifest.artifact.path,
      'The synthetic request corpus is not valid UTF-8 JSON.',
    );
  }
  const parsedCorpus = parseCorpus(requestsJson.value);
  if (parsedCorpus === undefined) {
    return failure(
      'invalid-requests-shape',
      manifest.artifact.path,
      'The synthetic request corpus does not match its strict schema.',
    );
  }

  const expectedCorpus = deriveSerializedCorpus(parsedSnapshot.value, policyAssets);
  if (
    expectedCorpus === undefined
    || requestsJson.text !== JSON.stringify(expectedCorpus)
    || !isDeepStrictEqual(parsedCorpus, expectedCorpus)
  ) {
    return failure(
      'corpus-derivation-mismatch',
      manifest.artifact.path,
      'The synthetic requests do not match the frozen result-blind derivation.',
    );
  }
  if (!manifestMetadataMatches(manifest)) {
    return failure(
      'manifest-metadata-mismatch',
      'manifest.json',
      'The corpus manifest metadata does not match the frozen canonical corpus.',
    );
  }

  const requests = Object.freeze(expectedCorpus.requests.map((request) => Object.freeze({
    requestId: request.requestId,
    assetIn: request.assetIn,
    assetOut: request.assetOut,
    amountBucket: request.amountBucket,
    amountIn: BigInt(request.amountIn),
    topology: request.topology,
  })));
  const corpus: VerifiedSyntheticRequestCorpus = Object.freeze({
    corpusId: CORPUS_ID,
    datasetId: DATASET_ID,
    snapshotId: DATASET_ID,
    snapshotChecksum: SNAPSHOT_CHECKSUM,
    requests,
  });
  const summary: SyntheticRequestCorpusVerificationSummary = Object.freeze({
    schemaVersion: 'routelab.synthetic-request-corpus-verification-summary.v1',
    corpusId: CORPUS_ID,
    datasetId: DATASET_ID,
    snapshotId: DATASET_ID,
    snapshotChecksum: SNAPSHOT_CHECKSUM,
    artifactSha256: REQUESTS_SHA256,
    requestCount: requests.length,
    amountBucketCount: EXPECTED_AMOUNT_BUCKETS.length,
    directRequestCount: EXPECTED_COUNTS.topologyCounts['direct-edge-present'],
    multiHopOnlyRequestCount:
      EXPECTED_COUNTS.topologyCounts['direct-edge-absent-common-neighbor-present'],
    randomness: 'none',
  });
  return Object.freeze({
    ok: true,
    value: Object.freeze({ context: historical.value.context, corpus, summary }),
  });
}
