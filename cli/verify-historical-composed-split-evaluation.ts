import { readFile } from 'node:fs/promises';

import {
  CANONICAL_HISTORICAL_COMPOSED_SPLIT_EVALUATION_DIRECTORY,
  verifyHistoricalComposedSplitEvaluation,
} from '../src/benchmark/historical-composed-split/index.ts';

const result = await verifyHistoricalComposedSplitEvaluation(
  CANONICAL_HISTORICAL_COMPOSED_SPLIT_EVALUATION_DIRECTORY,
  { readFile },
);

if (result.ok) {
  process.stdout.write(`${JSON.stringify(result.value)}\n`);
} else {
  process.stderr.write(`${JSON.stringify({ ok: false, error: result.error })}\n`);
  process.exitCode = 1;
}
