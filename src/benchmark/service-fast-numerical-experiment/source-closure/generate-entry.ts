import { generateServiceFastSourceClosure } from './generate.ts';
import { requireSourceClosureRevision } from './git.ts';
import {
  ServiceFastVerifierInvocationError,
  encodeProjectedServiceFastToolFailure,
} from '../tooling/tool-failure.ts';
import { serviceFastSourceClosureRepositoryRoot } from '../tooling/fixed-repository-root.ts';

const repositoryRoot = serviceFastSourceClosureRepositoryRoot(import.meta.url);

try {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length !== 1 || !/^[0-9a-f]{40}$/u.test(arguments_[0] ?? '')) {
    throw new ServiceFastVerifierInvocationError(
      'Source-closure generation requires exactly one lowercase implementation/input revision.',
    );
  }
  const revision = requireSourceClosureRevision(arguments_[0] ?? '');
  await generateServiceFastSourceClosure(repositoryRoot, revision);
} catch (error) {
  process.stderr.write(encodeProjectedServiceFastToolFailure(error, 'preflight'));
  process.exitCode = 1;
}
