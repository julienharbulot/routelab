import {
  defaultRepresentativeBaselineDependencies,
  verifyRepresentativeNumericalBaseline,
} from '../src/benchmark/representative-numerical-baseline/index.ts';
import { createRetainedReferenceSourceReader } from '../src/verification/retained-reference-source/index.ts';

const rawArguments = process.argv.slice(2);
const arguments_ = rawArguments[0] === '--' ? rawArguments.slice(1) : rawArguments;

if (arguments_.length !== 0) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: {
      code: 'invalid-cli-arguments',
      artifact: 'arguments',
      message: 'The retained representative numerical baseline verifier accepts no arguments.',
    },
  })}\n`);
  process.exitCode = 1;
} else {
  const defaultDependencies = defaultRepresentativeBaselineDependencies();
  const result = await verifyRepresentativeNumericalBaseline(
    Object.freeze({
      ...defaultDependencies,
      readFile: createRetainedReferenceSourceReader(defaultDependencies.readFile),
    }),
  );
  if (!result.ok) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: result.error })}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${JSON.stringify(result.value.summary)}\n`);
  }
}
