import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import path from 'node:path';

import {
  ServiceFastVerifierDispatchError,
  ServiceFastVerifierInvocationError,
} from './tool-failure.ts';
import {
  SERVICE_FAST_ARTIFACT_VERIFIER_HELPER,
  SERVICE_FAST_SOURCE_CLOSURE_GENERATOR_HELPER,
} from './dispatch-contract.ts';

export { ServiceFastVerifierInvocationError } from './tool-failure.ts';

export {
  SERVICE_FAST_ARTIFACT_VERIFIER_HELPER,
  SERVICE_FAST_SOURCE_CLOSURE_GENERATOR_HELPER,
} from './dispatch-contract.ts';

const LOWERCASE_GIT_REVISION = /^[0-9a-f]{40}$/u;

export interface ServiceFastVerifierChildInvocation {
  readonly mode: 'durable-verification' | 'source-closure-generation';
  readonly helperPath: string;
  readonly childArguments: readonly string[];
}

export interface FixedChildResult {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error?: Error;
}

export interface FixedChildDispatchDependencies {
  readonly execPath: string;
  readonly execArgv: readonly string[];
  readonly nodeOptions: string | undefined;
  readonly authenticateDurableVerifier: (repositoryRoot: string) => Promise<void>;
  readonly spawn: (
    executable: string,
    arguments_: readonly string[],
    options: SpawnSyncOptions,
  ) => FixedChildResult;
}

export interface FixedChildDispatchResult {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
}

function invalidInvocation(message: string): never {
  throw new ServiceFastVerifierInvocationError(message);
}

export function parseServiceFastVerifierInvocation(
  arguments_: readonly string[],
): ServiceFastVerifierChildInvocation {
  if (arguments_.length === 0) {
    return Object.freeze({
      mode: 'durable-verification' as const,
      helperPath: SERVICE_FAST_ARTIFACT_VERIFIER_HELPER,
      childArguments: Object.freeze([]),
    });
  }
  if (
    arguments_.length === 2 &&
    arguments_[0] === '--generate-source-closure' &&
    LOWERCASE_GIT_REVISION.test(arguments_[1] ?? '')
  ) {
    return Object.freeze({
      mode: 'source-closure-generation' as const,
      helperPath: SERVICE_FAST_SOURCE_CLOSURE_GENERATOR_HELPER,
      childArguments: Object.freeze([arguments_[1] as string]),
    });
  }
  return invalidInvocation(
    'Usage: node cli/verify-service-fast-numerical-experiment.ts ' +
      '[--generate-source-closure <lowercase-40-hex-revision>]',
  );
}

export function defaultFixedChildDispatchDependencies(
  authenticateDurableVerifier: (repositoryRoot: string) => Promise<void>,
): FixedChildDispatchDependencies {
  return Object.freeze({
    execPath: process.execPath,
    execArgv: Object.freeze([...process.execArgv]),
    nodeOptions: process.env['NODE_OPTIONS'],
    authenticateDurableVerifier,
    spawn: (
      executable: string,
      arguments_: readonly string[],
      options: SpawnSyncOptions,
    ) => spawnSync(executable, [...arguments_], options),
  });
}

export async function dispatchServiceFastVerifierChild(
  arguments_: readonly string[],
  repositoryRoot: string,
  dependencies: FixedChildDispatchDependencies,
): Promise<FixedChildDispatchResult> {
  const invocation = parseServiceFastVerifierInvocation(arguments_);
  if (!path.isAbsolute(repositoryRoot) || path.resolve(repositoryRoot) !== repositoryRoot) {
    throw new TypeError('The fixed repository root must be an absolute normalized path.');
  }
  if (dependencies.execPath !== process.execPath) {
    throw new TypeError('The fixed dispatcher executable must be process.execPath.');
  }
  if (dependencies.execArgv.length !== 0) {
    return invalidInvocation('The fixed verifier dispatcher rejects inherited Node arguments.');
  }
  if (dependencies.nodeOptions !== undefined && dependencies.nodeOptions !== '') {
    return invalidInvocation('The fixed verifier dispatcher rejects nonempty NODE_OPTIONS.');
  }
  if (invocation.mode === 'durable-verification') {
    await dependencies.authenticateDurableVerifier(repositoryRoot);
  }
  const helperPath = path.join(repositoryRoot, invocation.helperPath);
  const result = dependencies.spawn(
    dependencies.execPath,
    Object.freeze([helperPath, ...invocation.childArguments]),
    Object.freeze({
      cwd: repositoryRoot,
      stdio: 'inherit',
      shell: false,
    }),
  );
  if (result.error !== undefined) {
    throw new ServiceFastVerifierDispatchError('The fixed verifier helper could not be launched.');
  }
  if (result.signal !== null) {
    if (result.status !== null) {
      throw new Error('The fixed verifier helper returned both an exit status and signal.');
    }
    return Object.freeze({ status: null, signal: result.signal });
  }
  if (!Number.isSafeInteger(result.status) || (result.status ?? -1) < 0) {
    throw new Error('The fixed verifier helper returned no valid exit status.');
  }
  return Object.freeze({ status: result.status, signal: null });
}
