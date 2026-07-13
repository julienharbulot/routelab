import {
  defaultRepresentativeBaselineDependencies,
  verifyRepresentativeNumericalBaseline,
} from '../src/benchmark/representative-numerical-baseline/index.ts';

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
  const result = await verifyRepresentativeNumericalBaseline(
    defaultRepresentativeBaselineDependencies(),
  );
  if (!result.ok) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: result.error })}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${JSON.stringify(result.value.summary)}\n`);
  }
}
