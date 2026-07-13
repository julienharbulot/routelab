import { readFile } from 'node:fs/promises';

import {
  CANONICAL_SYNTHETIC_REQUEST_CORPUS_DIRECTORY,
  verifySyntheticRequestCorpus,
} from '../src/verification/synthetic-request-corpus/index.ts';

const result = await verifySyntheticRequestCorpus(
  CANONICAL_SYNTHETIC_REQUEST_CORPUS_DIRECTORY,
  { readFile },
);

if (result.ok) {
  process.stdout.write(`${JSON.stringify(result.value.summary)}\n`);
} else {
  process.stderr.write(`${JSON.stringify({ ok: false, error: result.error })}\n`);
  process.exitCode = 1;
}
