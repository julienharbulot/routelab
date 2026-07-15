import { readFile } from 'node:fs/promises';

import { prepareSnapshot, quote } from '../src/index.ts';

const smoke = process.argv.slice(2).includes('--smoke');
const snapshot = JSON.parse(await readFile(
  'datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1/snapshot.json',
  'utf8',
)) as unknown;
interface RetainedRequest {
  readonly requestId: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: string;
}

const corpus = JSON.parse(await readFile(
  'datasets/requests/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/synthetic-exhaustive-v1/requests.json',
  'utf8',
)) as {
  readonly requests?: readonly RetainedRequest[];
};
const prepared = prepareSnapshot(snapshot);
if (!prepared.ok || corpus.requests === undefined) {
  throw new Error('Could not prepare the retained extended benchmark inputs.');
}
const requests: readonly (RetainedRequest | undefined)[] = smoke
  ? [corpus.requests[0], corpus.requests[Math.floor(corpus.requests.length / 2)], corpus.requests.at(-1)]
  : corpus.requests;
let quotes = 0;
let noRoutes = 0;
for (const request of requests) {
  if (request === undefined || !/^(?:0|[1-9][0-9]*)$/u.test(request.amountIn)) {
    throw new Error('Extended benchmark encountered an invalid retained request.');
  }
  for (const strategy of ['best-single', 'greedy-split', 'numerical-split'] as const) {
    const result = quote(prepared.value, {
      snapshotId: prepared.value.snapshotId,
      assetIn: request.assetIn,
      assetOut: request.assetOut,
      amountIn: BigInt(request.amountIn),
      maxHops: 2,
      maxRoutes: 2,
    }, { strategy, effort: 'fast' });
    if (result.ok) quotes += 1;
    else if (result.error.code === 'no-route') noRoutes += 1;
    else throw new Error(`${request.requestId}/${strategy} failed: ${result.error.code}.`);
  }
}
process.stdout.write(`${JSON.stringify({
  schemaVersion: 'routelab.extended-benchmark-summary.v1',
  mode: smoke ? 'smoke' : 'full',
  retainedRequestCount: requests.length,
  strategyCount: 3,
  quotes,
  noRoutes,
  claim: 'retained synthetic corpus; not representative demand',
})}\n`);
