import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parseLiquiditySnapshot, type LiquiditySnapshot } from '../../domain/index.ts';
import {
  parseAndPrepareRoutingContext,
  type PreparedRoutingContext,
} from '../../runtime/prepared-routing-context/index.ts';
import { serializeCanonicalSnapshotContent } from '../../serialization/canonical-snapshot/index.ts';
import { prepareSnapshot, type RoutingContext } from '../../index.ts';

export const PORTFOLIO_INPUT_DIRECTORY =
  'datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1';

const DATASET_ID = 'ethereum-mainnet-uniswap-v2-block-19000000-core12-v1';
const SNAPSHOT_CHECKSUM =
  'sha256:5d21166cf218997776efc23b203c2f70637b1fb822807fb236bfc6fd0bf3e755';
const EXPECTED_CHAIN = {
  chainId: '1',
  number: '19000000',
  hash: '0xcf384012b91b081230cdf17a3f7dd370d8e67056058af6b272b3d54aa2714fac',
  parentHash: '0x759e27a5069535949f0a7247ebc999367dbd77964d77ed004ffc8db3d4940248',
  timestamp: '1705173443',
} as const;
const EXPECTED_TOKENS = [
  ['WETH', '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', 18],
  ['USDC', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 6],
  ['USDT', '0xdac17f958d2ee523a2206206994597c13d831ec7', 6],
  ['DAI', '0x6b175474e89094c44da98b954eedeac495271d0f', 18],
  ['WBTC', '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', 8],
  ['UNI', '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', 18],
  ['LINK', '0x514910771af9ca656af840dff83e8264ecf986ca', 18],
  ['AAVE', '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', 18],
  ['MKR', '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2', 18],
  ['COMP', '0xc00e94cb662c3520282e6f5717214004a7f26888', 18],
  ['CRV', '0xd533a949740bb3306d119cc777fa900ba034cd52', 18],
  ['YFI', '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e', 18],
] as const;

interface Token { readonly symbol: string; readonly address: string; readonly decimals: number }
interface Artifact { readonly role: string; readonly path: string; readonly bytes: number; readonly sha256: string }

export interface PortfolioInputs {
  readonly datasetId: string;
  readonly snapshot: LiquiditySnapshot;
  readonly context: RoutingContext;
  readonly prepared: PreparedRoutingContext;
  readonly assets: readonly string[];
  readonly summary: {
    readonly schemaVersion: 'routelab.portfolio-input-verification.v1';
    readonly datasetId: string;
    readonly snapshotId: string;
    readonly snapshotChecksum: string;
    readonly blockNumber: '19000000';
    readonly blockHash: string;
    readonly artifactCount: number;
    readonly poolCount: number;
    readonly assetCount: number;
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactJson(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} does not match the retained release input.`);
  }
}

function parseTokens(value: unknown): readonly Token[] {
  if (!Array.isArray(value)) throw new Error('selectedTokens must be an array.');
  return value.map((entry, index) => {
    const token = record(entry, `selectedTokens[${index}]`);
    if (
      typeof token['symbol'] !== 'string'
      || typeof token['address'] !== 'string'
      || typeof token['decimals'] !== 'number'
    ) throw new Error(`selectedTokens[${index}] is invalid.`);
    return { symbol: token['symbol'], address: token['address'], decimals: token['decimals'] };
  });
}

function parseArtifacts(value: unknown): readonly Artifact[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('artifacts must be nonempty.');
  const artifacts = value.map((entry, index) => {
    const artifact = record(entry, `artifacts[${index}]`);
    const file = artifact['path'];
    if (
      typeof artifact['role'] !== 'string'
      || typeof file !== 'string'
      || path.isAbsolute(file)
      || file.split('/').some((part) => part === '' || part === '.' || part === '..')
      || !Number.isSafeInteger(artifact['bytes'])
      || typeof artifact['sha256'] !== 'string'
      || !/^sha256:[0-9a-f]{64}$/u.test(artifact['sha256'])
    ) throw new Error(`artifacts[${index}] is invalid.`);
    return {
      role: artifact['role'], path: file, bytes: artifact['bytes'] as number,
      sha256: artifact['sha256'],
    };
  });
  if (new Set(artifacts.map((value) => value.role)).size !== artifacts.length) {
    throw new Error('artifact roles must be unique.');
  }
  return artifacts;
}

export async function loadPortfolioInputs(root = process.cwd()): Promise<PortfolioInputs> {
  const directory = path.join(root, PORTFOLIO_INPUT_DIRECTORY);
  const manifest = record(JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')) as unknown, 'manifest');
  if (manifest['schemaVersion'] !== 'routelab.dataset-manifest.v1' || manifest['datasetId'] !== DATASET_ID) {
    throw new Error('Dataset manifest identity is invalid.');
  }
  exactJson(manifest['chain'], EXPECTED_CHAIN, 'Block identity');
  const tokens = parseTokens(manifest['selectedTokens']);
  exactJson(tokens.map((token) => [token.symbol, token.address, token.decimals]), EXPECTED_TOKENS, 'Token metadata');

  const snapshotMetadata = record(manifest['snapshot'], 'snapshot metadata');
  exactJson(
    [snapshotMetadata['snapshotId'], snapshotMetadata['snapshotChecksum'], snapshotMetadata['poolCount'], snapshotMetadata['assetCount']],
    [DATASET_ID, SNAPSHOT_CHECKSUM, 54, 12],
    'Snapshot metadata',
  );

  const artifacts = parseArtifacts(manifest['artifacts']);
  const retained = new Map<string, Uint8Array>();
  for (const artifact of artifacts) {
    const bytes = await readFile(path.join(directory, artifact.path));
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (bytes.byteLength !== artifact.bytes || digest !== artifact.sha256) {
      throw new Error(`Retained file hash mismatch: ${artifact.path}.`);
    }
    retained.set(artifact.role, bytes);
  }

  const snapshotBytes = retained.get('snapshot');
  const canonicalBytes = retained.get('canonical-snapshot-content');
  if (snapshotBytes === undefined || canonicalBytes === undefined) {
    throw new Error('Snapshot artifacts are missing.');
  }
  const snapshotInput = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(snapshotBytes)) as unknown;
  const parsed = parseLiquiditySnapshot(snapshotInput);
  const prepared = parseAndPrepareRoutingContext(snapshotInput);
  const context = prepareSnapshot(snapshotInput);
  if (!parsed.ok || !prepared.ok || !context.ok) throw new Error('Retained snapshot is invalid.');
  if (
    parsed.value.snapshotId !== DATASET_ID
    || parsed.value.snapshotChecksum !== SNAPSHOT_CHECKSUM
    || parsed.value.pools.length !== 54
  ) throw new Error('Retained snapshot identity or pool count changed.');
  const assets = [...new Set(parsed.value.pools.flatMap((pool) => [pool.asset0, pool.asset1]))].sort();
  const expectedAssets = tokens.map((token) => token.address).sort();
  exactJson(assets, expectedAssets, 'Snapshot assets');
  if (new TextDecoder().decode(canonicalBytes) !== serializeCanonicalSnapshotContent(parsed.value)) {
    throw new Error('Canonical snapshot content does not match the snapshot.');
  }

  return Object.freeze({
    datasetId: DATASET_ID,
    snapshot: parsed.value,
    context: context.value,
    prepared: prepared.value,
    assets: Object.freeze(assets),
    summary: Object.freeze({
      schemaVersion: 'routelab.portfolio-input-verification.v1',
      datasetId: DATASET_ID,
      snapshotId: DATASET_ID,
      snapshotChecksum: SNAPSHOT_CHECKSUM,
      blockNumber: '19000000',
      blockHash: EXPECTED_CHAIN.hash,
      artifactCount: artifacts.length,
      poolCount: parsed.value.pools.length,
      assetCount: assets.length,
    }),
  });
}
