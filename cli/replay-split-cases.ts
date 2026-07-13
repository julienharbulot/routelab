import { readdir, readFile } from 'node:fs/promises';

import {
  verifyOfflineSplitRouterCases,
  type OfflineSplitCaseVerificationDependencies,
} from '../src/verification/offline-split-router-cases/index.ts';

const USAGE = 'Usage: pnpm replay:split-cases [--cases <directory>]';
const DEFAULT_CASE_DIRECTORY = 'fixtures/pre-m6/split-router-cases';

function parseCaseDirectory(arguments_: readonly string[]):
  | { readonly kind: 'run'; readonly directory: string }
  | { readonly kind: 'help' }
  | { readonly kind: 'invalid' } {
  if (arguments_.length === 0) return { kind: 'run', directory: DEFAULT_CASE_DIRECTORY };
  if (arguments_.includes('--help')) {
    return arguments_.length === 1 ? { kind: 'help' } : { kind: 'invalid' };
  }
  if (
    arguments_.length === 2 &&
    arguments_[0] === '--cases' &&
    arguments_[1] !== undefined &&
    arguments_[1].length > 0 &&
    !arguments_[1].startsWith('--')
  ) {
    return { kind: 'run', directory: arguments_[1] };
  }
  return { kind: 'invalid' };
}

const parsedArguments = parseCaseDirectory(process.argv.slice(2));
if (parsedArguments.kind === 'help') {
  process.stdout.write(`${USAGE}\n`);
} else if (parsedArguments.kind === 'invalid') {
  process.stderr.write(`${USAGE}\n`);
  process.exitCode = 1;
} else {
  const dependencies: OfflineSplitCaseVerificationDependencies = {
    async readDirectory(directory) {
      const entries = await readdir(directory, { withFileTypes: true });
      return entries.map((entry) => ({ name: entry.name, isFile: entry.isFile() }));
    },
    async readFile(path) {
      return readFile(path, 'utf8');
    },
  };
  const result = await verifyOfflineSplitRouterCases(
    parsedArguments.directory,
    dependencies,
  );
  if (!result.ok) {
    process.stderr.write(`split case replay failed: ${result.error.code}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${result.value.canonicalJson}\n`);
  }
}
