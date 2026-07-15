import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parseLiquiditySnapshot } from '../../domain/index.ts';
import { prepareSnapshot } from '../../index.ts';
import {
  CANONICAL_HISTORICAL_DATASET_DIRECTORY,
} from '../../verification/historical-dataset/index.ts';
import {
  CANONICAL_SYNTHETIC_REQUEST_CORPUS_DIRECTORY,
  verifySyntheticRequestCorpus,
  type SyntheticRequestCorpusVerificationSummary,
} from '../../verification/synthetic-request-corpus/index.ts';
import type { PortfolioCase } from './types.ts';

const SNAPSHOT_FILE = path.join(CANONICAL_HISTORICAL_DATASET_DIRECTORY, 'snapshot.json');

export interface HistoricalPortfolioCases {
  readonly cases: readonly PortfolioCase[];
  readonly corpus: SyntheticRequestCorpusVerificationSummary;
}

async function rootedRead(root: string, filePath: string): Promise<Uint8Array> {
  return readFile(path.isAbsolute(filePath) ? filePath : path.join(root, filePath));
}

export async function loadHistoricalPortfolioCases(
  root = process.cwd(),
): Promise<HistoricalPortfolioCases> {
  const verified = await verifySyntheticRequestCorpus(
    CANONICAL_SYNTHETIC_REQUEST_CORPUS_DIRECTORY,
    { readFile: (filePath) => rootedRead(root, filePath) },
  );
  if (!verified.ok) {
    throw new Error(
      `Retained benchmark corpus failed verification: ${verified.error.code} (${verified.error.artifact}).`,
    );
  }
  const snapshotJson = JSON.parse(
    await readFile(path.join(root, SNAPSHOT_FILE), 'utf8'),
  ) as unknown;
  const snapshot = parseLiquiditySnapshot(snapshotJson);
  const context = prepareSnapshot(snapshotJson);
  if (!snapshot.ok || !context.ok) {
    throw new Error('Retained benchmark snapshot failed preparation.');
  }
  if (
    snapshot.value.snapshotId !== verified.value.corpus.snapshotId
    || snapshot.value.snapshotChecksum !== verified.value.corpus.snapshotChecksum
  ) {
    throw new Error('Retained benchmark corpus and snapshot identity differ.');
  }

  const cases = verified.value.corpus.requests.map((request): PortfolioCase => Object.freeze({
    caseId: request.requestId,
    purpose: `synthetic ${request.amountBucket} exact-input request; ${request.topology}`,
    amountBucket: request.amountBucket,
    topology: request.topology,
    snapshot: snapshot.value,
    context: context.value,
    prepared: verified.value.context,
    request: Object.freeze({
      snapshotId: snapshot.value.snapshotId,
      assetIn: request.assetIn,
      assetOut: request.assetOut,
      amountIn: request.amountIn,
      maxHops: 2,
      maxRoutes: 2,
    }),
    expectedOutcome: 'quote',
  }));
  return Object.freeze({
    cases: Object.freeze(cases),
    corpus: verified.value.summary,
  });
}

export async function loadPortfolioCases(root = process.cwd()): Promise<readonly PortfolioCase[]> {
  return (await loadHistoricalPortfolioCases(root)).cases;
}
