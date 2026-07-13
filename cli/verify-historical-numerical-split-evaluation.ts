import { readFile } from 'node:fs/promises';

import {
  CANONICAL_HISTORICAL_NUMERICAL_SPLIT_EVALUATION_DIRECTORY,
  verifyHistoricalNumericalSplitEvaluation,
} from '../src/benchmark/historical-numerical-split/index.ts';

const result = await verifyHistoricalNumericalSplitEvaluation(
  CANONICAL_HISTORICAL_NUMERICAL_SPLIT_EVALUATION_DIRECTORY,
  { readFile },
);

if (result.ok) {
  process.stdout.write(`${JSON.stringify(result.value)}\n`);
} else {
  process.stderr.write(`${JSON.stringify({ ok: false, error: result.error })}\n`);
  process.exitCode = 1;
}
