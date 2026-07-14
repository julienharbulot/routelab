import { readFile } from 'node:fs/promises';

import {
  CANONICAL_HISTORICAL_NUMERICAL_BASELINE_PROFILE_DIRECTORY,
  verifyHistoricalNumericalProfile,
} from '../src/benchmark/historical-numerical-profile/index.ts';

const rawArguments = process.argv.slice(2);
const arguments_ = rawArguments[0] === '--' ? rawArguments.slice(1) : rawArguments;

if (arguments_.length !== 0) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: {
      code: 'invalid-cli-arguments',
      artifact: 'arguments',
      message: 'The retained numerical baseline profile verifier accepts no arguments.',
    },
  })}\n`);
  process.exitCode = 1;
} else {
  const result = await verifyHistoricalNumericalProfile(
    CANONICAL_HISTORICAL_NUMERICAL_BASELINE_PROFILE_DIRECTORY,
    { readFile },
  );
  if (result.ok) {
    process.stdout.write(`${JSON.stringify(result.value)}\n`);
  } else {
    process.stderr.write(`${JSON.stringify({ ok: false, error: result.error })}\n`);
    process.exitCode = 1;
  }
}
