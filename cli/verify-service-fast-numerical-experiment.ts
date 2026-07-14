import {
  defaultFixedChildDispatchDependencies,
  dispatchServiceFastVerifierChild,
} from '../src/benchmark/service-fast-numerical-experiment/tooling/dispatcher.ts';
import { authenticateServiceFastDurableVerifierBeforeDispatch } from '../src/benchmark/service-fast-numerical-experiment/tooling/durable-verifier-bootstrap.ts';
import { encodeProjectedServiceFastToolFailure } from '../src/benchmark/service-fast-numerical-experiment/tooling/tool-failure.ts';
import { serviceFastVerifierRepositoryRoot } from '../src/benchmark/service-fast-numerical-experiment/tooling/fixed-repository-root.ts';

const repositoryRoot = serviceFastVerifierRepositoryRoot(import.meta.url);

try {
  const result = await dispatchServiceFastVerifierChild(
    process.argv.slice(2),
    repositoryRoot,
    defaultFixedChildDispatchDependencies(
      authenticateServiceFastDurableVerifierBeforeDispatch,
    ),
  );
  if (result.signal !== null) {
    process.exitCode = 1;
    process.kill(process.pid, result.signal);
  } else {
    process.exitCode = result.status ?? 1;
  }
} catch (error) {
  process.stderr.write(encodeProjectedServiceFastToolFailure(error, 'invocation'));
  process.exitCode = 1;
}
