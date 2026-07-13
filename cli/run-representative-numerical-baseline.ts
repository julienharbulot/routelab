import { access } from 'node:fs/promises';

import {
  createRepresentativeNumericalBaseline,
  defaultRepresentativeBaselineDependencies,
  REPRESENTATIVE_BASELINE_DIRECTORY,
  REPRESENTATIVE_REQUEST_CORPUS_DIRECTORY,
  REPRESENTATIVE_STRESS_SUITE_DIRECTORY,
  writeRepresentativeNumericalBaseline,
} from '../src/benchmark/representative-numerical-baseline/index.ts';

const rawArguments = process.argv.slice(2);
const arguments_ = rawArguments[0] === '--' ? rawArguments.slice(1) : rawArguments;

async function exists(target: string): Promise<boolean> {
  try { await access(target); return true; } catch { return false; }
}

if (arguments_.length !== 0) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: {
      code: 'invalid-cli-arguments',
      artifact: 'arguments',
      message: 'The representative numerical baseline generator accepts no arguments and writes only its frozen canonical directories.',
    },
  })}\n`);
  process.exitCode = 1;
} else if (await Promise.all([
  REPRESENTATIVE_STRESS_SUITE_DIRECTORY,
  REPRESENTATIVE_REQUEST_CORPUS_DIRECTORY,
  REPRESENTATIVE_BASELINE_DIRECTORY,
].map(exists)).then((results) => results.some(Boolean))) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: {
      code: 'output-conflict',
      artifact: 'canonical-output-directories',
      message: 'At least one frozen canonical output directory already exists; no baseline call was started.',
    },
  })}\n`);
  process.exitCode = 1;
} else {
  const result = await createRepresentativeNumericalBaseline(
    defaultRepresentativeBaselineDependencies(),
  );
  if (!result.ok) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: result.error })}\n`);
    process.exitCode = 1;
  } else {
    try {
      await writeRepresentativeNumericalBaseline(result.value);
      process.stdout.write(`${JSON.stringify(result.value.summary)}\n`);
    } catch (error) {
      process.stderr.write(`${JSON.stringify({
        ok: false,
        error: {
          code: 'artifact-write-failed',
          artifact: 'canonical-output-directories',
          message: error instanceof Error ? error.message : 'Could not atomically create the representative baseline artifacts.',
        },
      })}\n`);
      process.exitCode = 1;
    }
  }
}
