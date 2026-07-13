import { readFile } from 'node:fs/promises';

import {
  CANONICAL_HISTORICAL_DATASET_DIRECTORY,
  verifyHistoricalDataset,
} from '../src/verification/historical-dataset/index.ts';

const result = await verifyHistoricalDataset(
  CANONICAL_HISTORICAL_DATASET_DIRECTORY,
  { readFile },
);

if (result.ok) {
  process.stdout.write(`${JSON.stringify(result.value.summary)}\n`);
} else {
  process.stderr.write(`${JSON.stringify({ ok: false, error: result.error })}\n`);
  process.exitCode = 1;
}
