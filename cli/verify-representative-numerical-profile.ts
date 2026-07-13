import { readFile } from 'node:fs/promises';

import {
  CANONICAL_REPRESENTATIVE_NUMERICAL_PROFILE_DIRECTORY,
  verifyRepresentativeNumericalProfile,
} from '../src/benchmark/representative-numerical-profile/index.ts';

const rawArguments = process.argv.slice(2);
const arguments_ = rawArguments[0] === '--' ? rawArguments.slice(1) : rawArguments;

if (arguments_.length !== 0) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: {
    code: 'invalid-cli-arguments', artifact: 'arguments',
    message: 'The retained representative numerical profile verifier accepts no arguments.',
  } })}\n`);
  process.exitCode = 1;
} else {
  const result = await verifyRepresentativeNumericalProfile(
    CANONICAL_REPRESENTATIVE_NUMERICAL_PROFILE_DIRECTORY,
    { readFile },
  );
  if (result.ok) process.stdout.write(`${JSON.stringify(result.value)}\n`);
  else {
    process.stderr.write(`${JSON.stringify({ ok: false, error: result.error })}\n`);
    process.exitCode = 1;
  }
}
