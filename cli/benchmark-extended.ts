import { loadHistoricalPortfolioCases } from '../src/benchmark/portfolio/cases.ts';
import { quote } from '../src/index.ts';

const smoke = process.argv.slice(2).includes('--smoke');
const loaded = await loadHistoricalPortfolioCases();
const requests = smoke
  ? [loaded.cases[0], loaded.cases[Math.floor(loaded.cases.length / 2)], loaded.cases.at(-1)]
  : loaded.cases;
let quotes = 0;
let noRoutes = 0;
for (const request of requests) {
  if (request === undefined) {
    throw new Error('Extended benchmark encountered an invalid retained request.');
  }
  for (const strategy of ['best-single', 'greedy-split', 'numerical-split'] as const) {
    const result = quote(request.context, request.request, { strategy, effort: 'fast' });
    if (result.ok) quotes += 1;
    else if (result.error.code === 'no-route') noRoutes += 1;
    else throw new Error(`${request.caseId}/${strategy} failed: ${result.error.code}.`);
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
