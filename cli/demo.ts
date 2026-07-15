import { readFile } from 'node:fs/promises';

import {
  formatQuote,
  prepareSnapshot,
  quote,
  type AssetDisplayMetadata,
  type QuoteRequest,
  type RoutingContext,
  type ValidatedQuote,
} from '../src/index.ts';

const splitSnapshot = {
  snapshotId: 'demo-two-direct-pools',
  snapshotChecksum: 'sha256:15d26e434befa00d782d61ee4bf9e0fd704a83bb3b3720b89fd63ff0f7120b6f',
  pools: [
    {
      poolId: 'direct-0', asset0: 'A', reserve0: '100', asset1: 'B', reserve1: '100',
      feeChargedNumerator: '0', feeDenominator: '1',
    },
    {
      poolId: 'direct-1', asset0: 'A', reserve0: '100', asset1: 'B', reserve1: '100',
      feeChargedNumerator: '0', feeDenominator: '1',
    },
  ],
};

function context(input: unknown): RoutingContext {
  const prepared = prepareSnapshot(input);
  if (!prepared.ok) throw new Error(`Demo snapshot failed: ${prepared.error.code}.`);
  return prepared.value;
}

function exactQuote(prepared: RoutingContext, request: QuoteRequest): ValidatedQuote {
  const result = quote(prepared, request);
  if (!result.ok) throw new Error(`Demo quote failed: ${result.error.code}.`);
  return result.value;
}

function render(
  title: string,
  value: ValidatedQuote,
  bestSingle: bigint,
  assetMetadata?: Readonly<Record<string, AssetDisplayMetadata>>,
): string {
  return [
    title,
    '-'.repeat(title.length),
    formatQuote(value, {
      bestSingleAmountOut: bestSingle,
      ...(assetMetadata === undefined ? {} : { assetMetadata }),
    }),
    'authorization: fresh exact bigint replay passed',
    `plan fingerprint: ${value.planFingerprint}`,
  ].join('\n');
}

const smallContext = context(splitSnapshot);
const smallRequest = {
  snapshotId: smallContext.snapshotId,
  assetIn: 'A',
  assetOut: 'B',
  amountIn: 100n,
  maxHops: 1,
  maxRoutes: 2,
};
const small = exactQuote(smallContext, smallRequest);
const smallSingle = quote(smallContext, smallRequest, { strategy: 'best-single' });
if (!smallSingle.ok) throw new Error('Demo best-single quote failed.');

const historicalRaw = JSON.parse(await readFile(
  'datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1/snapshot.json',
  'utf8',
)) as unknown;
const historicalManifest = JSON.parse(await readFile(
  'datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1/manifest.json',
  'utf8',
)) as { readonly selectedTokens: readonly {
  readonly address: string;
  readonly symbol: string;
  readonly decimals: number;
}[] };
const historicalMetadata = Object.freeze(Object.fromEntries(
  historicalManifest.selectedTokens.map(({ address, symbol, decimals }) => [
    address,
    Object.freeze({ symbol, decimals }),
  ]),
));
const historicalContext = context(historicalRaw);
const historicalRequest = {
  snapshotId: historicalContext.snapshotId,
  assetIn: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  assetOut: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  amountIn: 1_000_000_000_000_000_000n,
  maxHops: 3,
  maxRoutes: 3,
};
const historical = exactQuote(historicalContext, historicalRequest);
const historicalSingle = quote(historicalContext, historicalRequest, { strategy: 'best-single' });
if (!historicalSingle.ok) throw new Error('Historical best-single quote failed.');

process.stdout.write(`${render('Small split fixture', small, smallSingle.value.amountOut)}\n\n`);
process.stdout.write(`${render(
  'Retained historical snapshot',
  historical,
  historicalSingle.value.amountOut,
  historicalMetadata,
)}\n`);
process.stdout.write('\nLimits: immutable offline snapshots; no transaction submission, signing, custody, or settlement.\n');
