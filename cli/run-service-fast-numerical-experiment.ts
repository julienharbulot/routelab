import {
  acceptedRunFailure,
  encodeAcceptedRunFailure,
} from '../src/benchmark/service-fast-numerical-experiment/accepted-run/failure.ts';
import { runAcceptedExperiment } from '../src/benchmark/service-fast-numerical-experiment/accepted-run/run.ts';
import { serviceFastVerifierRepositoryRoot } from '../src/benchmark/service-fast-numerical-experiment/tooling/fixed-repository-root.ts';

const repositoryRoot = serviceFastVerifierRepositoryRoot(import.meta.url);

try {
  if (process.argv.length !== 2) {
    throw acceptedRunFailure('invocation-argument-count');
  }
  await runAcceptedExperiment(repositoryRoot);
} catch (error) {
  process.stderr.write(encodeAcceptedRunFailure(error, 'invocation'));
  process.exitCode = 1;
}
