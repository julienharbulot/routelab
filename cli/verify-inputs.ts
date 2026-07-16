import { generatePortfolioRequests } from '../src/benchmark/portfolio/generate-cases.ts';
import { loadPortfolioInputs } from '../src/benchmark/portfolio/input-manifest.ts';

const inputs = await loadPortfolioInputs();
const corpus = generatePortfolioRequests(inputs.datasetId, inputs.snapshot, inputs.assets);
process.stdout.write(`${JSON.stringify({ ...inputs.summary, corpus: corpus.summary })}\n`);
