import { createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { parseLiquiditySnapshot, type LiquiditySnapshot } from '../../domain/index.ts';
import {
  parseAndPrepareRoutingContext,
} from '../../runtime/prepared-routing-context/index.ts';
import {
  serializeCanonicalSnapshotContent,
} from '../../serialization/canonical-snapshot/index.ts';

export const CANONICAL_HISTORICAL_DATASET_DIRECTORY =
  'datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1';

const DATASET_ID = 'ethereum-mainnet-uniswap-v2-block-19000000-core12-v1';
const POLICY_SHA256 =
  'sha256:80c7738104050b03418064d306feab7cab8d420858c76637f95053d497233d1c';
const SNAPSHOT_CHECKSUM =
  'sha256:5d21166cf218997776efc23b203c2f70637b1fb822807fb236bfc6fd0bf3e755';
const SELECTION_POLICY =
  'For every unordered pair of the frozen token allowlist, include the canonical Uniswap V2 factory pair if it existed at the target block; retain every discovered pair in source evidence and include only positive-reserve pairs in the RouteLab snapshot.';
const TOKEN_BEHAVIOR_POLICY =
  'Stored-reserve benchmark only. No selected token is treated as fee-on-transfer or rebasing. Blacklist, pause, custody, proxy-upgrade, and live transfer feasibility are outside the offline pool-state model and are recorded limitations.';

const EXPECTED_CHAIN = Object.freeze({
  chainId: '1',
  number: '19000000',
  hash: '0xcf384012b91b081230cdf17a3f7dd370d8e67056058af6b272b3d54aa2714fac',
  parentHash: '0x759e27a5069535949f0a7247ebc999367dbd77964d77ed004ffc8db3d4940248',
  timestamp: '1705173443',
});

const EXPECTED_VENUE = Object.freeze({
  protocol: 'uniswap-v2',
  factoryAddress: '0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f',
  factoryDeploymentBlock: '10000835',
  pairCreatedTopic: '0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9',
  syncTopic: '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1',
  feeChargedNumerator: '3',
  feeDenominator: '1000',
});

const EXPECTED_TOKENS: readonly SelectedToken[] = Object.freeze([
  Object.freeze({ symbol: 'WETH', address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', decimals: 18 }),
  Object.freeze({ symbol: 'USDC', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6 }),
  Object.freeze({ symbol: 'USDT', address: '0xdac17f958d2ee523a2206206994597c13d831ec7', decimals: 6 }),
  Object.freeze({ symbol: 'DAI', address: '0x6b175474e89094c44da98b954eedeac495271d0f', decimals: 18 }),
  Object.freeze({ symbol: 'WBTC', address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', decimals: 8 }),
  Object.freeze({ symbol: 'UNI', address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', decimals: 18 }),
  Object.freeze({ symbol: 'LINK', address: '0x514910771af9ca656af840dff83e8264ecf986ca', decimals: 18 }),
  Object.freeze({ symbol: 'AAVE', address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', decimals: 18 }),
  Object.freeze({ symbol: 'MKR', address: '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2', decimals: 18 }),
  Object.freeze({ symbol: 'COMP', address: '0xc00e94cb662c3520282e6f5717214004a7f26888', decimals: 18 }),
  Object.freeze({ symbol: 'CRV', address: '0xd533a949740bb3306d119cc777fa900ba034cd52', decimals: 18 }),
  Object.freeze({ symbol: 'YFI', address: '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e', decimals: 18 }),
]);

const EXPECTED_ARTIFACTS = Object.freeze([
  Object.freeze({
    role: 'policy',
    path: 'policy.json',
    bytes: 2794,
    sha256: POLICY_SHA256,
  }),
  Object.freeze({
    role: 'infura-normalized',
    path: 'sources/infura-normalized.json',
    bytes: 15380,
    sha256: 'sha256:e9a01c6ae6cd7ef7d76e3aa0b4c0ddec680d5f649ecbf1f3007bc8d766e2ae88',
  }),
  Object.freeze({
    role: 'sqd-normalized',
    path: 'sources/sqd-normalized.json',
    bytes: 15377,
    sha256: 'sha256:c59bd6e2d777dfc7122a4522e203c21aefd607b630bc991977fa2ea0237100b6',
  }),
  Object.freeze({
    role: 'reconciliation',
    path: 'reconciliation.json',
    bytes: 565,
    sha256: 'sha256:ee184996130c610035df3b1b7fc7fe4eb6fc0166af5c93174102c3e0745e29ae',
  }),
  Object.freeze({
    role: 'snapshot',
    path: 'snapshot.json',
    bytes: 18502,
    sha256: 'sha256:4c43d4920f0edb487a262f1d321ba4790d07c7563e2a3b0157c5b51122fb3478',
  }),
  Object.freeze({
    role: 'canonical-snapshot-content',
    path: 'canonical-snapshot-content.json',
    bytes: 14799,
    sha256: SNAPSHOT_CHECKSUM,
  }),
]);

const EXPECTED_PUBLICATION = Object.freeze({
  artifactClass: 'curated-normalized-historical-facts-and-project-metadata',
  rawProviderMaterial: 'excluded-no-redistribution-grant-assumed',
  licenseGrant: 'none-by-this-manifest',
  termsReferences: Object.freeze([
    Object.freeze({
      role: 'infura-offering-terms',
      url: 'https://consensys.io/terms-of-use',
    }),
    Object.freeze({
      role: 'uniswap-v2-source-license',
      url: 'https://github.com/Uniswap/v2-core/blob/master/LICENSE',
    }),
  ]),
});

const EXPECTED_ACQUISITION = Object.freeze({
  canonicalAssertion: 'Ethereum mainnet contract state at the frozen block hash',
  primary: 'Infura archive-backed EIP-1898 direct state calls',
  verification: 'SQD Portal finalized PairCreated/Sync event values at Infura-supplied event locations',
  exactReconciliationRequired: true,
  limitation: 'SQD did not independently discover the latest relevant event location for each accepted field.',
});

const EXPECTED_LIMITATIONS = Object.freeze([
  'This is a frozen allowlist subset of canonical Uniswap V2 stored reserves, not the complete Ethereum liquidity universe.',
  'The data does not represent historical user order flow; any workload derived from it must be described as synthetic and versioned separately.',
  'Token transfer behavior, transaction simulation or submission, custody, live execution, future state, and unrestricted routing optimality are outside this dataset contract.',
  'SQD verified event values at Infura-supplied event locations and did not independently discover the latest relevant location for every accepted field.',
  'Raw provider material is excluded because this project does not assume a redistribution grant; this manifest grants no license and is not legal advice.',
]);

const EXPECTED_RECONCILIATION_SOURCES = Object.freeze([
  'infura-direct-state',
  'sqd-finalized-event-values-at-infura-location-hints',
]);

const EXPECTED_CHECKED_FIELDS = Object.freeze([
  'datasetId',
  'policySha256',
  'selectedTokenSymbols',
  'block',
  'factoryAddress',
  'complete pair set',
  'token0',
  'token1',
  'reserve0',
  'reserve1',
]);

import type {
  DatasetManifest,
  DatasetPolicy,
  HistoricalDatasetVerificationErrorCode,
  HistoricalDatasetVerificationResult,
  HistoricalDatasetVerificationSummary,
  HistoricalDatasetVerifierDependencies,
  ManifestArtifact,
  NormalizedSource,
  Reconciliation,
  SelectedToken,
  SourcePair,
} from './types.ts';

export type {
  HistoricalDatasetVerificationError,
  HistoricalDatasetVerificationErrorCode,
  HistoricalDatasetVerificationResult,
  HistoricalDatasetVerificationSummary,
  HistoricalDatasetVerifierDependencies,
} from './types.ts';

function failure(
  code: HistoricalDatasetVerificationErrorCode,
  artifact: string,
  message: string,
): HistoricalDatasetVerificationResult {
  const error = Object.freeze({ code, artifact, message });
  return Object.freeze({ ok: false, error });
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

function isCanonicalUnsignedDecimal(value: unknown, positive = false): value is string {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value)) return false;
  return !positive || value !== '0';
}

function isHex(value: unknown, digits: number): value is string {
  return typeof value === 'string' && new RegExp(`^0x[0-9a-f]{${digits}}$`, 'u').test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function isStringArray(value: unknown, nonempty = false): value is readonly string[] {
  return Array.isArray(value)
    && (!nonempty || value.length > 0)
    && value.every(isNonemptyString);
}

function hasNoDuplicates(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function isRawUtf16Ascending(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined || previous >= current) return false;
  }
  return true;
}

function parseJson(bytes: Uint8Array): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

function isSafeArtifactPath(value: string): boolean {
  return value.length > 0
    && !path.isAbsolute(value)
    && !value.includes('\\')
    && value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function parseSelectedTokens(value: unknown): readonly SelectedToken[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const tokens: SelectedToken[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !hasExactKeys(entry, ['symbol', 'address', 'decimals'])) return undefined;
    if (
      !isNonemptyString(entry['symbol'])
      || !isHex(entry['address'], 40)
      || !isSafeNonnegativeInteger(entry['decimals'])
      || entry['decimals'] > 255
    ) return undefined;
    tokens.push(Object.freeze({
      symbol: entry['symbol'],
      address: entry['address'],
      decimals: entry['decimals'],
    }));
  }
  if (
    !hasNoDuplicates(tokens.map((token) => token['symbol']))
    || !hasNoDuplicates(tokens.map((token) => token['address']))
  ) return undefined;
  return Object.freeze(tokens);
}

function validChain(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && hasExactKeys(value, ['chainId', 'number', 'hash', 'parentHash', 'timestamp'])
    && isCanonicalUnsignedDecimal(value['chainId'], true)
    && isCanonicalUnsignedDecimal(value['number'], true)
    && isHex(value['hash'], 64)
    && isHex(value['parentHash'], 64)
    && isCanonicalUnsignedDecimal(value['timestamp'], true);
}

function validPolicyBlock(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && hasExactKeys(value, ['number', 'hash', 'parentHash', 'timestamp'])
    && isCanonicalUnsignedDecimal(value['number'], true)
    && isHex(value['hash'], 64)
    && isHex(value['parentHash'], 64)
    && isCanonicalUnsignedDecimal(value['timestamp'], true);
}

function validVenue(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && hasExactKeys(value, [
      'protocol',
      'factoryAddress',
      'factoryDeploymentBlock',
      'pairCreatedTopic',
      'syncTopic',
      'feeChargedNumerator',
      'feeDenominator',
    ])
    && isNonemptyString(value['protocol'])
    && isHex(value['factoryAddress'], 40)
    && isCanonicalUnsignedDecimal(value['factoryDeploymentBlock'], true)
    && isHex(value['pairCreatedTopic'], 64)
    && isHex(value['syncTopic'], 64)
    && isCanonicalUnsignedDecimal(value['feeChargedNumerator'])
    && isCanonicalUnsignedDecimal(value['feeDenominator'], true);
}

function parseManifest(value: unknown): DatasetManifest | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schemaVersion',
    'datasetId',
    'policySha256',
    'publication',
    'chain',
    'venue',
    'selectionPolicy',
    'tokenBehaviorPolicy',
    'selectedTokens',
    'acquisition',
    'snapshot',
    'artifacts',
    'limitations',
  ])) return undefined;
  if (
    value['schemaVersion'] !== 'routelab.dataset-manifest.v1'
    || !isNonemptyString(value['datasetId'])
    || !isSha256(value['policySha256'])
    || !isRecord(value['publication'])
    || !hasExactKeys(value['publication'], [
      'artifactClass',
      'rawProviderMaterial',
      'licenseGrant',
      'termsReferences',
    ])
    || !isNonemptyString(value['publication']['artifactClass'])
    || !isNonemptyString(value['publication']['rawProviderMaterial'])
    || !isNonemptyString(value['publication']['licenseGrant'])
    || !Array.isArray(value['publication']['termsReferences'])
    || value['publication']['termsReferences'].length === 0
    || !value['publication']['termsReferences'].every((reference) => isRecord(reference)
      && hasExactKeys(reference, ['role', 'url'])
      && isNonemptyString(reference['role'])
      && isNonemptyString(reference['url']))
    || !validChain(value['chain'])
    || !validVenue(value['venue'])
    || !isNonemptyString(value['selectionPolicy'])
    || !isNonemptyString(value['tokenBehaviorPolicy'])
  ) return undefined;
  const selectedTokens = parseSelectedTokens(value['selectedTokens']);
  if (selectedTokens === undefined) return undefined;
  if (
    !isRecord(value['acquisition'])
    || !hasExactKeys(value['acquisition'], [
      'canonicalAssertion',
      'primary',
      'verification',
      'exactReconciliationRequired',
      'limitation',
    ])
    || !isNonemptyString(value['acquisition']['canonicalAssertion'])
    || !isNonemptyString(value['acquisition']['primary'])
    || !isNonemptyString(value['acquisition']['verification'])
    || typeof value['acquisition']['exactReconciliationRequired'] !== 'boolean'
    || !isNonemptyString(value['acquisition']['limitation'])
    || !isRecord(value['snapshot'])
    || !hasExactKeys(value['snapshot'], [
      'schemaVersion',
      'snapshotId',
      'snapshotChecksum',
      'poolCount',
      'assetCount',
      'path',
      'canonicalContentPath',
    ])
    || value['snapshot']['schemaVersion'] !== 'routelab.snapshot.v1'
    || !isNonemptyString(value['snapshot']['snapshotId'])
    || !isSha256(value['snapshot']['snapshotChecksum'])
    || !isSafeNonnegativeInteger(value['snapshot']['poolCount'])
    || !isSafeNonnegativeInteger(value['snapshot']['assetCount'])
    || !isNonemptyString(value['snapshot']['path'])
    || !isSafeArtifactPath(value['snapshot']['path'])
    || !isNonemptyString(value['snapshot']['canonicalContentPath'])
    || !isSafeArtifactPath(value['snapshot']['canonicalContentPath'])
    || !Array.isArray(value['artifacts'])
    || value['artifacts'].length !== 6
  ) return undefined;
  const artifacts: ManifestArtifact[] = [];
  for (const artifact of value['artifacts']) {
    if (
      !isRecord(artifact)
      || !hasExactKeys(artifact, ['role', 'path', 'bytes', 'sha256'])
      || !isNonemptyString(artifact['role'])
      || !isNonemptyString(artifact['path'])
      || !isSafeArtifactPath(artifact['path'])
      || !isSafeNonnegativeInteger(artifact['bytes'])
      || !isSha256(artifact['sha256'])
    ) return undefined;
    artifacts.push(Object.freeze({
      role: artifact['role'],
      path: artifact['path'],
      bytes: artifact['bytes'],
      sha256: artifact['sha256'],
    }));
  }
  if (
    !hasNoDuplicates(artifacts.map((artifact) => artifact['role']))
    || !hasNoDuplicates(artifacts.map((artifact) => artifact.path))
    || !artifacts.every((artifact, index) => {
      const expected = EXPECTED_ARTIFACTS[index];
      return expected !== undefined
        && artifact['role'] === expected['role']
        && artifact.path === expected.path;
    })
    || !isStringArray(value['limitations'], true)
  ) return undefined;
  return Object.freeze({
    schemaVersion: value['schemaVersion'],
    datasetId: value['datasetId'],
    policySha256: value['policySha256'],
    publication: value['publication'],
    chain: value['chain'],
    venue: value['venue'],
    selectionPolicy: value['selectionPolicy'],
    tokenBehaviorPolicy: value['tokenBehaviorPolicy'],
    selectedTokens,
    acquisition: value['acquisition'],
    snapshot: value['snapshot'],
    artifacts: Object.freeze(artifacts),
    limitations: Object.freeze([...value['limitations']]),
  });
}

function parsePolicy(value: unknown): DatasetPolicy | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schemaVersion',
    'datasetId',
    'chainId',
    'block',
    'venue',
    'selectionPolicy',
    'tokenBehaviorPolicy',
    'tokens',
  ])) return undefined;
  const tokens = parseSelectedTokens(value['tokens']);
  if (
    value['schemaVersion'] !== 'routelab.data-acquisition-policy.v1'
    || !isNonemptyString(value['datasetId'])
    || !isCanonicalUnsignedDecimal(value['chainId'], true)
    || !validPolicyBlock(value['block'])
    || !validVenue(value['venue'])
    || !isNonemptyString(value['selectionPolicy'])
    || !isNonemptyString(value['tokenBehaviorPolicy'])
    || tokens === undefined
  ) return undefined;
  return Object.freeze({
    schemaVersion: value['schemaVersion'],
    datasetId: value['datasetId'],
    chainId: value['chainId'],
    block: value['block'],
    venue: value['venue'],
    selectionPolicy: value['selectionPolicy'],
    tokenBehaviorPolicy: value['tokenBehaviorPolicy'],
    tokens,
  });
}

function parseNormalizedSource(value: unknown, expectedSource: string): NormalizedSource | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schemaVersion',
    'datasetId',
    'source',
    'policySha256',
    'selectedTokenSymbols',
    'block',
    'factoryAddress',
    'pairs',
  ])) return undefined;
  if (
    value['schemaVersion'] !== 'routelab.uniswap-v2-source.v1'
    || !isNonemptyString(value['datasetId'])
    || value['source'] !== expectedSource
    || !isSha256(value['policySha256'])
    || !isStringArray(value['selectedTokenSymbols'], true)
    || !hasNoDuplicates(value['selectedTokenSymbols'])
    || !validPolicyBlock(value['block'])
    || !isHex(value['factoryAddress'], 40)
    || !Array.isArray(value['pairs'])
    || value['pairs'].length === 0
  ) return undefined;
  const pairs: SourcePair[] = [];
  for (const pair of value['pairs']) {
    if (
      !isRecord(pair)
      || !hasExactKeys(pair, ['pair', 'token0', 'token1', 'reserve0', 'reserve1'])
      || !isHex(pair['pair'], 40)
      || !isHex(pair['token0'], 40)
      || !isHex(pair['token1'], 40)
      || pair['token0'] >= pair['token1']
      || !isCanonicalUnsignedDecimal(pair['reserve0'], true)
      || !isCanonicalUnsignedDecimal(pair['reserve1'], true)
    ) return undefined;
    pairs.push(Object.freeze({
      pair: pair['pair'],
      token0: pair['token0'],
      token1: pair['token1'],
      reserve0: pair['reserve0'],
      reserve1: pair['reserve1'],
    }));
  }
  const pairIds = pairs.map((pair) => pair['pair']);
  const tokenPairs = pairs.map((pair) => `${pair['token0']}:${pair['token1']}`);
  if (!hasNoDuplicates(pairIds) || !hasNoDuplicates(tokenPairs) || !isRawUtf16Ascending(pairIds)) {
    return undefined;
  }
  return Object.freeze({
    schemaVersion: value['schemaVersion'],
    datasetId: value['datasetId'],
    source: value['source'],
    policySha256: value['policySha256'],
    selectedTokenSymbols: Object.freeze([...value['selectedTokenSymbols']]),
    block: value['block'],
    factoryAddress: value['factoryAddress'],
    pairs: Object.freeze(pairs),
  });
}

function parseReconciliation(value: unknown): Reconciliation | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schemaVersion',
    'datasetId',
    'exactMatch',
    'comparedSources',
    'checkedFields',
    'comparedPairCount',
    'includedPositiveReservePairCount',
    'differences',
  ])) return undefined;
  if (
    value['schemaVersion'] !== 'routelab.source-reconciliation.v1'
    || !isNonemptyString(value['datasetId'])
    || typeof value['exactMatch'] !== 'boolean'
    || !isStringArray(value['comparedSources'], true)
    || !hasNoDuplicates(value['comparedSources'])
    || !isStringArray(value['checkedFields'], true)
    || !hasNoDuplicates(value['checkedFields'])
    || !isSafeNonnegativeInteger(value['comparedPairCount'])
    || !isSafeNonnegativeInteger(value['includedPositiveReservePairCount'])
    || !isStringArray(value['differences'])
  ) return undefined;
  return Object.freeze({
    schemaVersion: value['schemaVersion'],
    datasetId: value['datasetId'],
    exactMatch: value['exactMatch'],
    comparedSources: Object.freeze([...value['comparedSources']]),
    checkedFields: Object.freeze([...value['checkedFields']]),
    comparedPairCount: value['comparedPairCount'],
    includedPositiveReservePairCount: value['includedPositiveReservePairCount'],
    differences: Object.freeze([...value['differences']]),
  });
}

function equalNormalizedSources(left: NormalizedSource, right: NormalizedSource): boolean {
  return left['schemaVersion'] === right['schemaVersion']
    && left['datasetId'] === right['datasetId']
    && left['policySha256'] === right['policySha256']
    && isDeepStrictEqual(left['selectedTokenSymbols'], right['selectedTokenSymbols'])
    && isDeepStrictEqual(left['block'], right['block'])
    && left['factoryAddress'] === right['factoryAddress']
    && isDeepStrictEqual(left['pairs'], right['pairs']);
}

function assetsIn(snapshot: LiquiditySnapshot): ReadonlySet<string> {
  const assets = new Set<string>();
  for (const pool of snapshot.pools) {
    assets.add(pool.asset0);
    assets.add(pool.asset1);
  }
  return assets;
}

function snapshotMatchesSource(snapshot: LiquiditySnapshot, source: NormalizedSource): boolean {
  if (snapshot.pools.length !== source['pairs'].length) return false;
  return snapshot.pools.every((pool, index) => {
    const pair = source['pairs'][index];
    return pair !== undefined
      && pool.poolId === pair['pair']
      && pool.asset0 === pair['token0']
      && pool['reserve0'].toString(10) === pair['reserve0']
      && pool.asset1 === pair['token1']
      && pool['reserve1'].toString(10) === pair['reserve1']
      && pool['feeChargedNumerator'].toString(10) === EXPECTED_VENUE['feeChargedNumerator']
      && pool['feeDenominator'].toString(10) === EXPECTED_VENUE['feeDenominator'];
  });
}

function metadataMatches(
  manifest: DatasetManifest,
  policy: DatasetPolicy,
  infura: NormalizedSource,
  sqd: NormalizedSource,
  reconciliation: Reconciliation,
  snapshot: LiquiditySnapshot,
): boolean {
  const manifestSnapshot = manifest['snapshot'];
  const manifestAcquisition = manifest['acquisition'];
  const manifestPublication = manifest['publication'];
  const manifestChain = manifest['chain'];
  const policyChain = { chainId: policy['chainId'], ...policy['block'] };
  const expectedSymbols = EXPECTED_TOKENS.map((token) => token['symbol']);
  return manifest['datasetId'] === DATASET_ID
    && manifest['policySha256'] === POLICY_SHA256
    && manifest['selectionPolicy'] === SELECTION_POLICY
    && manifest['tokenBehaviorPolicy'] === TOKEN_BEHAVIOR_POLICY
    && isDeepStrictEqual(manifest['selectedTokens'], EXPECTED_TOKENS)
    && isDeepStrictEqual(manifest['artifacts'], EXPECTED_ARTIFACTS)
    && isDeepStrictEqual(manifestChain, EXPECTED_CHAIN)
    && isDeepStrictEqual(manifest['venue'], EXPECTED_VENUE)
    && isDeepStrictEqual(manifestPublication, EXPECTED_PUBLICATION)
    && isDeepStrictEqual(manifestAcquisition, EXPECTED_ACQUISITION)
    && isDeepStrictEqual(manifest['limitations'], EXPECTED_LIMITATIONS)
    && manifestSnapshot['schemaVersion'] === 'routelab.snapshot.v1'
    && manifestSnapshot['snapshotId'] === DATASET_ID
    && manifestSnapshot['snapshotChecksum'] === SNAPSHOT_CHECKSUM
    && manifestSnapshot['poolCount'] === 54
    && manifestSnapshot['assetCount'] === 12
    && manifestSnapshot['path'] === 'snapshot.json'
    && manifestSnapshot['canonicalContentPath'] === 'canonical-snapshot-content.json'
    && policy['datasetId'] === DATASET_ID
    && isDeepStrictEqual(policyChain, EXPECTED_CHAIN)
    && isDeepStrictEqual(policy['venue'], EXPECTED_VENUE)
    && policy['selectionPolicy'] === SELECTION_POLICY
    && policy['tokenBehaviorPolicy'] === TOKEN_BEHAVIOR_POLICY
    && isDeepStrictEqual(policy['tokens'], EXPECTED_TOKENS)
    && infura['datasetId'] === DATASET_ID
    && sqd['datasetId'] === DATASET_ID
    && infura['policySha256'] === POLICY_SHA256
    && sqd['policySha256'] === POLICY_SHA256
    && isDeepStrictEqual(infura['selectedTokenSymbols'], expectedSymbols)
    && isDeepStrictEqual(sqd['selectedTokenSymbols'], expectedSymbols)
    && isDeepStrictEqual({ chainId: policy['chainId'], ...infura['block'] }, EXPECTED_CHAIN)
    && isDeepStrictEqual({ chainId: policy['chainId'], ...sqd['block'] }, EXPECTED_CHAIN)
    && infura['factoryAddress'] === EXPECTED_VENUE['factoryAddress']
    && sqd['factoryAddress'] === EXPECTED_VENUE['factoryAddress']
    && reconciliation['datasetId'] === DATASET_ID
    && snapshot['snapshotId'] === DATASET_ID
    && snapshot['snapshotChecksum'] === SNAPSHOT_CHECKSUM
    && snapshot.pools.length === 54
    && assetsIn(snapshot).size === 12
    && snapshotMatchesSource(snapshot, infura);
}

async function readBytes(
  readFile: (path: string) => Promise<Uint8Array>,
  filePath: string,
): Promise<Uint8Array | undefined> {
  try {
    const bytes = await readFile(filePath);
    return Uint8Array.from(bytes);
  } catch {
    return undefined;
  }
}

export async function verifyHistoricalDataset(
  directory: string,
  dependencies: HistoricalDatasetVerifierDependencies,
): Promise<HistoricalDatasetVerificationResult> {
  let readFile: (path: string) => Promise<Uint8Array>;
  try {
    readFile = dependencies.readFile;
  } catch {
    return failure('manifest-read-failed', 'manifest.json', 'Could not read the dataset manifest.');
  }

  const manifestBytes = await readBytes(readFile, path.join(directory, 'manifest.json'));
  if (manifestBytes === undefined) {
    return failure('manifest-read-failed', 'manifest.json', 'Could not read the dataset manifest.');
  }
  const manifestJson = parseJson(manifestBytes);
  if (!manifestJson.ok) {
    return failure('invalid-manifest-json', 'manifest.json', 'The dataset manifest is not valid UTF-8 JSON.');
  }
  const manifest = parseManifest(manifestJson.value);
  if (manifest === undefined) {
    return failure('invalid-manifest-shape', 'manifest.json', 'The dataset manifest does not match its strict schema.');
  }

  const artifactBytes = new Map<string, Uint8Array>();
  for (const artifact of manifest['artifacts']) {
    const bytes = await readBytes(readFile, path.join(directory, artifact.path));
    if (bytes === undefined) {
      return failure('artifact-read-failed', artifact.path, 'Could not read a declared dataset artifact.');
    }
    if (bytes.byteLength !== artifact['bytes']) {
      return failure('artifact-size-mismatch', artifact.path, 'A dataset artifact byte length does not match the manifest.');
    }
    const sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (sha256 !== artifact['sha256']) {
      return failure('artifact-hash-mismatch', artifact.path, 'A dataset artifact SHA-256 does not match the manifest.');
    }
    artifactBytes.set(artifact['role'], bytes);
  }

  const policyJson = parseJson(artifactBytes.get('policy') ?? new Uint8Array());
  const policy = policyJson.ok ? parsePolicy(policyJson.value) : undefined;
  if (policy === undefined) {
    return failure('invalid-policy', 'policy.json', 'The dataset policy does not match its strict schema.');
  }

  const infuraJson = parseJson(artifactBytes.get('infura-normalized') ?? new Uint8Array());
  const infura = infuraJson.ok ? parseNormalizedSource(infuraJson.value, 'infura') : undefined;
  if (infura === undefined) {
    return failure('invalid-source-dataset', 'sources/infura-normalized.json', 'The Infura normalized source does not match its strict schema.');
  }
  const sqdJson = parseJson(artifactBytes.get('sqd-normalized') ?? new Uint8Array());
  const sqd = sqdJson.ok ? parseNormalizedSource(sqdJson.value, 'sqd') : undefined;
  if (sqd === undefined) {
    return failure('invalid-source-dataset', 'sources/sqd-normalized.json', 'The SQD normalized source does not match its strict schema.');
  }

  const reconciliationJson = parseJson(artifactBytes.get('reconciliation') ?? new Uint8Array());
  const reconciliation = reconciliationJson.ok
    ? parseReconciliation(reconciliationJson.value)
    : undefined;
  if (reconciliation === undefined) {
    return failure('invalid-reconciliation', 'reconciliation.json', 'The reconciliation record does not match its strict schema.');
  }

  if (
    !equalNormalizedSources(infura, sqd)
    || reconciliation['exactMatch'] !== true
    || reconciliation['differences'].length !== 0
    || reconciliation['comparedPairCount'] !== infura['pairs'].length
    || reconciliation['includedPositiveReservePairCount'] !== infura['pairs'].length
    || !isDeepStrictEqual(reconciliation['comparedSources'], EXPECTED_RECONCILIATION_SOURCES)
    || !isDeepStrictEqual(reconciliation['checkedFields'], EXPECTED_CHECKED_FIELDS)
  ) {
    return failure('source-reconciliation-mismatch', 'reconciliation.json', 'The normalized sources and reconciliation declaration do not agree exactly.');
  }

  const snapshotBytes = artifactBytes.get('snapshot') ?? new Uint8Array();
  const snapshotJson = parseJson(snapshotBytes);
  if (!snapshotJson.ok) {
    return failure('invalid-snapshot', 'snapshot.json', 'The snapshot is not valid UTF-8 JSON.');
  }
  const parsedSnapshot = parseLiquiditySnapshot(snapshotJson.value);
  if (!parsedSnapshot.ok) {
    return failure('invalid-snapshot', 'snapshot.json', 'The snapshot does not match the strict RouteLab domain schema.');
  }
  if (!isRawUtf16Ascending(parsedSnapshot.value.pools.map((pool) => pool.poolId))) {
    return failure('snapshot-order-mismatch', 'snapshot.json', 'Snapshot pools are not in ascending raw UTF-16 pool-ID order.');
  }

  const canonicalBytes = artifactBytes.get('canonical-snapshot-content') ?? new Uint8Array();
  let canonicalText: string;
  try {
    canonicalText = new TextDecoder('utf-8', { fatal: true }).decode(canonicalBytes);
  } catch {
    return failure('canonical-content-mismatch', 'canonical-snapshot-content.json', 'Canonical snapshot content is not valid UTF-8.');
  }
  if (canonicalText !== serializeCanonicalSnapshotContent(parsedSnapshot.value)) {
    return failure('canonical-content-mismatch', 'canonical-snapshot-content.json', 'Canonical snapshot content does not match the parsed snapshot.');
  }

  const prepared = parseAndPrepareRoutingContext(snapshotJson.value);
  if (!prepared.ok) {
    return failure('snapshot-preparation-failed', 'snapshot.json', 'The snapshot did not pass checksum verification and routing-context preparation.');
  }

  if (!metadataMatches(manifest, policy, infura, sqd, reconciliation, parsedSnapshot.value)) {
    return failure('manifest-metadata-mismatch', 'manifest.json', 'Dataset metadata does not match the frozen canonical import.');
  }

  const summary: HistoricalDatasetVerificationSummary = Object.freeze({
    schemaVersion: 'routelab.dataset-verification-summary.v1',
    datasetId: manifest['datasetId'],
    snapshotId: parsedSnapshot.value['snapshotId'],
    snapshotChecksum: parsedSnapshot.value['snapshotChecksum'],
    artifactCount: 6,
    poolCount: parsedSnapshot.value.pools.length,
    assetCount: assetsIn(parsedSnapshot.value).size,
    sourcePairCount: infura['pairs'].length,
    exactReconciliation: true,
  });
  const value = Object.freeze({ context: prepared.value, summary });
  return Object.freeze({ ok: true, value });
}
