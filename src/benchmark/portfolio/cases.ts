import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  parseLiquiditySnapshot,
  type ConstantProductPool,
  type LiquiditySnapshot,
} from '../../domain/index.ts';
import { prepareSnapshot, type RoutingContext } from '../../index.ts';
import {
  prepareRoutingContext,
  type PreparedRoutingContext,
} from '../../runtime/prepared-routing-context/index.ts';
import { computeCanonicalSnapshotChecksum } from '../../serialization/canonical-snapshot/index.ts';
import type { PortfolioCase } from './types.ts';

const HISTORICAL_SNAPSHOT = path.join(
  'datasets',
  'ethereum-mainnet',
  'uniswap-v2',
  'block-19000000',
  'core12-v1',
  'snapshot.json',
);
const HISTORICAL_REQUESTS = path.join(
  'datasets',
  'requests',
  'ethereum-mainnet-uniswap-v2',
  'block-19000000',
  'core12-v1',
  'synthetic-exhaustive-v1',
  'requests.json',
);

interface CaseSnapshot {
  readonly snapshot: LiquiditySnapshot;
  readonly context: RoutingContext;
  readonly prepared: PreparedRoutingContext;
}

interface HistoricalRequest {
  readonly requestId: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: string;
  readonly topology: string;
}

function pool(
  poolId: string,
  asset0: string,
  reserve0: bigint,
  asset1: string,
  reserve1: bigint,
  feeChargedNumerator = 0n,
  feeDenominator = 1n,
): ConstantProductPool {
  return Object.freeze({
    poolId,
    asset0,
    reserve0,
    asset1,
    reserve1,
    feeChargedNumerator,
    feeDenominator,
  });
}

function wire(snapshot: LiquiditySnapshot): unknown {
  return {
    snapshotId: snapshot.snapshotId,
    snapshotChecksum: snapshot.snapshotChecksum,
    pools: snapshot.pools.map((value) => ({
      poolId: value.poolId,
      asset0: value.asset0,
      reserve0: value.reserve0.toString(10),
      asset1: value.asset1,
      reserve1: value.reserve1.toString(10),
      feeChargedNumerator: value.feeChargedNumerator.toString(10),
      feeDenominator: value.feeDenominator.toString(10),
    })),
  };
}

function prepare(snapshot: LiquiditySnapshot): CaseSnapshot {
  const publicResult = prepareSnapshot(wire(snapshot));
  const internalResult = prepareRoutingContext(snapshot);
  if (!publicResult.ok || !internalResult.ok) {
    throw new Error(`Benchmark snapshot ${snapshot.snapshotId} failed preparation.`);
  }
  return Object.freeze({
    snapshot,
    context: publicResult.value,
    prepared: internalResult.value,
  });
}

function synthetic(snapshotId: string, pools: readonly ConstantProductPool[]): CaseSnapshot {
  const provisional: LiquiditySnapshot = Object.freeze({
    snapshotId,
    snapshotChecksum: 'pending',
    pools: Object.freeze([...pools]),
  });
  return prepare(Object.freeze({
    ...provisional,
    snapshotChecksum: computeCanonicalSnapshotChecksum(provisional),
  }));
}

function benchmarkCase(
  source: CaseSnapshot,
  caseId: string,
  purpose: string,
  assetIn: string,
  assetOut: string,
  amountIn: bigint,
  maxHops: number,
  maxRoutes: number,
  expectedOutcome: 'quote' | 'no-route' = 'quote',
): PortfolioCase {
  return Object.freeze({
    caseId,
    purpose,
    ...source,
    request: Object.freeze({
      snapshotId: source.snapshot.snapshotId,
      assetIn,
      assetOut,
      amountIn,
      maxHops,
      maxRoutes,
    }),
    expectedOutcome,
  });
}

function syntheticCases(): readonly PortfolioCase[] {
  const direct = synthetic('portfolio-direct', [
    pool('direct-ab', 'A', 1_000n, 'B', 1_000n, 3n, 1_000n),
  ]);
  const twoHop = synthetic('portfolio-two-hop', [
    pool('direct-ac', 'A', 1_000n, 'C', 1_000n),
    pool('hop-ab', 'A', 1_000n, 'B', 2_000n),
    pool('hop-bc', 'B', 2_000n, 'C', 2_000n),
  ]);
  const split = synthetic('portfolio-split', [
    pool('split-left', 'A', 100n, 'B', 100n),
    pool('split-right', 'A', 100n, 'B', 100n),
  ]);
  const asymmetric = synthetic('portfolio-asymmetric-split', [
    pool('asymmetric-left', 'A', 100n, 'B', 150n),
    pool('asymmetric-right', 'A', 300n, 'B', 300n),
  ]);
  const fee = synthetic('portfolio-fee', [
    pool('zero-fee', 'A', 1_000n, 'B', 1_000n),
    pool('high-fee', 'A', 1_000n, 'B', 1_000n, 90n, 100n),
  ]);
  const shallow = synthetic('portfolio-shallow', [
    pool('shallow-ab', 'A', 25n, 'B', 1_000n),
    pool('deep-ab', 'A', 2_000n, 'B', 2_000n),
  ]);
  const rounding = synthetic('portfolio-rounding', [
    pool('rounding-ab', 'A', 1n, 'B', 3n, 1n, 2n),
  ]);
  const disconnected = synthetic('portfolio-disconnected', [
    pool('component-ab', 'A', 1_000n, 'B', 1_000n),
    pool('component-cd', 'C', 1_000n, 'D', 1_000n),
  ]);

  return Object.freeze([
    benchmarkCase(direct, 'direct-standard', 'direct route baseline', 'A', 'B', 100n, 2, 2),
    benchmarkCase(direct, 'direct-tiny', 'small direct input and integer rounding', 'A', 'B', 2n, 2, 2),
    benchmarkCase(direct, 'direct-large', 'large direct input with price impact', 'A', 'B', 500n, 2, 2),
    benchmarkCase(direct, 'direct-reverse', 'reverse stored-pool direction', 'B', 'A', 100n, 2, 2),
    benchmarkCase(twoHop, 'two-hop-wins', 'two-hop route beats direct', 'A', 'C', 100n, 2, 2),
    benchmarkCase(twoHop, 'two-hop-small', 'two-hop behavior on a small input', 'A', 'C', 10n, 2, 2),
    benchmarkCase(twoHop, 'two-hop-large', 'two-hop price impact on a large input', 'A', 'C', 500n, 2, 2),
    benchmarkCase(twoHop, 'two-hop-reverse', 'reverse two-hop discovery', 'C', 'A', 100n, 2, 2),
    benchmarkCase(split, 'split-standard', 'equal pool-disjoint split beats single', 'A', 'B', 100n, 1, 2),
    benchmarkCase(split, 'split-small', 'split reconstruction on a small input', 'A', 'B', 20n, 1, 2),
    benchmarkCase(split, 'split-large', 'split behavior under large price impact', 'A', 'B', 1_000n, 1, 2),
    benchmarkCase(asymmetric, 'split-asymmetric', 'allocator handles unequal route depth', 'A', 'B', 100n, 1, 2),
    benchmarkCase(fee, 'fee-path-loses', 'high-fee route loses to zero-fee route', 'A', 'B', 100n, 1, 2),
    benchmarkCase(fee, 'fee-path-large', 'fee comparison under larger input', 'A', 'B', 500n, 1, 2),
    benchmarkCase(shallow, 'shallow-small', 'shallow liquidity can win for a small input', 'A', 'B', 10n, 1, 2),
    benchmarkCase(shallow, 'shallow-impact', 'shallow liquidity loses as impact grows', 'A', 'B', 100n, 1, 2),
    benchmarkCase(rounding, 'single-division-rounding', 'one-unit exact rounding case', 'A', 'B', 1n, 1, 1),
    benchmarkCase(disconnected, 'no-route', 'disconnected assets return no route', 'A', 'D', 100n, 2, 2, 'no-route'),
  ]);
}

async function historicalCases(root: string): Promise<readonly PortfolioCase[]> {
  const snapshotRaw = JSON.parse(await readFile(path.join(root, HISTORICAL_SNAPSHOT), 'utf8')) as unknown;
  const parsed = parseLiquiditySnapshot(snapshotRaw);
  if (!parsed.ok) throw new Error('Retained benchmark snapshot did not parse.');
  const source = prepare(parsed.value);
  const corpus = JSON.parse(await readFile(path.join(root, HISTORICAL_REQUESTS), 'utf8')) as {
    readonly requests?: readonly HistoricalRequest[];
  };
  if (!Array.isArray(corpus.requests)) throw new Error('Retained request corpus did not parse.');
  const selections = [
    ['request-0001', 'retained direct-edge small request'],
    ['request-0018', 'retained two-hop-only larger request'],
    ['request-0052', 'retained direct-edge token request'],
    ['request-0118', 'retained LINK-to-USDC request'],
    ['request-0235', 'retained USDC-to-UNI request'],
    ['request-0396', 'retained USDT-to-CRV larger request'],
  ] as const;
  return Object.freeze(selections.map(([requestId, purpose]) => {
    const request = corpus.requests?.find((value) => value.requestId === requestId);
    if (request === undefined || !/^(?:0|[1-9][0-9]*)$/u.test(request.amountIn)) {
      throw new Error(`Missing retained request ${requestId}.`);
    }
    return benchmarkCase(
      source,
      `historical-${requestId}`,
      purpose,
      request.assetIn,
      request.assetOut,
      BigInt(request.amountIn),
      2,
      2,
    );
  }));
}

export async function loadPortfolioCases(root = process.cwd()): Promise<readonly PortfolioCase[]> {
  return Object.freeze([...syntheticCases(), ...await historicalCases(root)]);
}
