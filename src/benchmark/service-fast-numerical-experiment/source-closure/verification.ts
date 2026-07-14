import {
  SERVICE_FAST_CONFIG_BYTES,
  SERVICE_FAST_CONFIG_PATH,
  SERVICE_FAST_MAX_BOUND_SOURCE_BYTES,
  decodeServiceFastSourceClosure,
  parseFrozenServiceFastConfiguration,
  sha256Bytes,
  type FrozenServiceFastConfiguration,
  type ServiceFastSourceClosure,
  type SourceClosureDescriptor,
} from './codec.ts';
import {
  ServiceFastSourceClosureError,
  sourceClosureFailure,
} from './error.ts';
import {
  assertCleanTrackedRepository,
  readGitBlob,
  readGitHeadRevision,
  requireSourceClosureRevision,
} from './git.ts';
import {
  compareClosureToRevision,
  verifyCommittedClosureChild,
} from './revision-admission.ts';
import {
  SERVICE_FAST_REVIEWED_INPUT_BINDING_PATH,
  decodeReviewedInputBindingSource,
  requireReviewedInputBinding,
} from './reviewed-input-binding.ts';
import {
  ServiceFastBoundedIdentityReadError,
  readBoundedIdentityFile,
} from '../tooling/bounded-identity-reader.ts';

const FROZEN_SOURCE_CLOSURE_MAX_BYTES = 1_048_576;

export { ServiceFastSourceClosureError } from './error.ts';

export interface VerifiedServiceFastSourceClosure {
  readonly closure: ServiceFastSourceClosure;
  readonly config: FrozenServiceFastConfiguration;
  readonly bytes: Uint8Array;
}

async function readExecutableDescriptor(
  repositoryRoot: string,
  descriptor: SourceClosureDescriptor,
  failureCode: string,
): Promise<Uint8Array> {
  try {
    const bytes = await readBoundedIdentityFile({
      repositoryRoot,
      relativePath: descriptor.path,
      maximumBytes: SERVICE_FAST_MAX_BOUND_SOURCE_BYTES,
      expectedBytes: descriptor.bytes,
    });
    if (sha256Bytes(bytes) !== descriptor.sha256) {
      return sourceClosureFailure(
        failureCode,
        descriptor.path,
        `Execution filesystem source ${descriptor.path} differs from its closure descriptor.`,
      );
    }
    return bytes;
  } catch (error) {
    if (error instanceof ServiceFastSourceClosureError) throw error;
    if (error instanceof ServiceFastBoundedIdentityReadError) {
      return sourceClosureFailure(
        error.code === 'bounded-file-symlink-forbidden'
          ? 'symlink-source-forbidden'
          : failureCode,
        descriptor.path,
        `Execution filesystem source ${descriptor.path} failed bounded identity admission.`,
      );
    }
    throw error;
  }
}

export function verifyDurableServiceFastSourceClosure(
  repositoryRoot: string,
  closureBytes: Uint8Array,
): VerifiedServiceFastSourceClosure {
  if (closureBytes.byteLength > FROZEN_SOURCE_CLOSURE_MAX_BYTES) {
    return sourceClosureFailure(
      'source-closure-cap-exceeded',
      'source closure',
      'Source closure bytes exceed the frozen 1 MiB cap.',
    );
  }
  let preliminary: unknown;
  try {
    preliminary = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(closureBytes),
    );
  } catch {
    return sourceClosureFailure(
      'invalid-source-closure-json',
      'source closure',
      'Source closure is not valid UTF-8 JSON.',
    );
  }
  if (typeof preliminary !== 'object' || preliminary === null) {
    return sourceClosureFailure(
      'invalid-source-closure-json',
      'source closure',
      'Source closure root is invalid.',
    );
  }
  const revision = (preliminary as Record<string, unknown>)[
    'implementationInputRevision'
  ];
  if (typeof revision !== 'string') {
    return sourceClosureFailure(
      'revision-mismatch',
      'source closure',
      'Source closure revision is missing.',
    );
  }
  try {
    requireSourceClosureRevision(revision);
  } catch {
    return sourceClosureFailure(
      'revision-mismatch',
      'source closure',
      'Source closure revision is not canonical.',
    );
  }
  const configBytes = readGitBlob(
    repositoryRoot,
    revision,
    SERVICE_FAST_CONFIG_PATH,
    SERVICE_FAST_CONFIG_BYTES,
  );
  const config = parseFrozenServiceFastConfiguration(configBytes);
  const closure = decodeServiceFastSourceClosure(closureBytes, config);
  const reviewedBindingBytes = readGitBlob(
    repositoryRoot,
    revision,
    SERVICE_FAST_REVIEWED_INPUT_BINDING_PATH,
    SERVICE_FAST_MAX_BOUND_SOURCE_BYTES,
  );
  requireReviewedInputBinding(
    decodeReviewedInputBindingSource(reviewedBindingBytes),
    closure.inputArtifact,
  );
  compareClosureToRevision(repositoryRoot, closure, config);
  verifyCommittedClosureChild(repositoryRoot, closureBytes, closure, config);
  return Object.freeze({
    closure,
    config,
    bytes: Uint8Array.from(closureBytes),
  });
}

export async function verifyExecutableServiceFastSourceClosure(
  repositoryRoot: string,
  closureBytes: Uint8Array,
): Promise<VerifiedServiceFastSourceClosure> {
  const durable = verifyDurableServiceFastSourceClosure(
    repositoryRoot,
    closureBytes,
  );
  const head = readGitHeadRevision(repositoryRoot);
  const closureChild = verifyCommittedClosureChild(
    repositoryRoot,
    closureBytes,
    durable.closure,
    durable.config,
  );
  if (head !== closureChild) {
    return sourceClosureFailure(
      'execution-revision-mismatch',
      head,
      'Execution HEAD is not the exact one-child source-closure commit.',
    );
  }
  assertCleanTrackedRepository(repositoryRoot, head);
  const closureDescriptor: SourceClosureDescriptor = Object.freeze({
    path: durable.config.artifacts.sourceClosure.path,
    bytes: closureBytes.byteLength,
    sha256: sha256Bytes(closureBytes),
  });
  await readExecutableDescriptor(
    repositoryRoot,
    closureDescriptor,
    'execution-closure-byte-mismatch',
  );
  for (const descriptor of [
    ...durable.closure.sources,
    ...durable.closure.protectedSources,
  ]) {
    await readExecutableDescriptor(
      repositoryRoot,
      descriptor,
      'execution-source-descriptor-mismatch',
    );
  }
  return durable;
}
