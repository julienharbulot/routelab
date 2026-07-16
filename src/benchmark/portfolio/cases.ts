import { generatePortfolioRequests, type GeneratedCorpus } from './generate-cases.ts';
import { loadPortfolioInputs } from './input-manifest.ts';
import type { PortfolioCase } from './types.ts';

export interface HistoricalPortfolioCases {
  readonly cases: readonly PortfolioCase[];
  readonly corpus: GeneratedCorpus['summary'];
}

export async function loadHistoricalPortfolioCases(
  root = process.cwd(),
): Promise<HistoricalPortfolioCases> {
  const inputs = await loadPortfolioInputs(root);
  const generated = generatePortfolioRequests(inputs.datasetId, inputs.snapshot, inputs.assets);

  const cases = generated.requests.map((request): PortfolioCase => Object.freeze({
    caseId: request.requestId,
    purpose: `synthetic ${request.amountBucket} exact-input request; ${request.topology}`,
    amountBucket: request.amountBucket,
    topology: request.topology,
    snapshot: inputs.snapshot,
    context: inputs.context,
    prepared: inputs.prepared,
    request: Object.freeze({
      snapshotId: inputs.snapshot.snapshotId,
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
    corpus: generated.summary,
  });
}

export async function loadPortfolioCases(root = process.cwd()): Promise<readonly PortfolioCase[]> {
  return (await loadHistoricalPortfolioCases(root)).cases;
}
