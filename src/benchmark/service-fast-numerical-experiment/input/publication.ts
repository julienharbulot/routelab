import { createHash, randomBytes } from 'node:crypto';
import {
  link,
  lstat,
  open,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import path from 'node:path';

export interface ExclusivePublicationHandle {
  readonly write: (bytes: Uint8Array) => Promise<void>;
  readonly sync: () => Promise<void>;
  readonly close: () => Promise<void>;
}

export interface ExclusiveInputSink {
  readonly write: (bytes: Uint8Array) => Promise<void>;
}

export interface ExclusivePublicationDependencies {
  readonly openExclusive: (filePath: string) => Promise<ExclusivePublicationHandle>;
  readonly openDirectory: (directoryPath: string) => Promise<ExclusivePublicationHandle>;
  readonly lstat: (filePath: string) => Promise<void>;
  readonly link: (sourcePath: string, destinationPath: string) => Promise<void>;
  readonly unlink: (filePath: string) => Promise<void>;
  readonly uniqueSuffix: () => string;
}

export interface ExclusiveInputPublicationOptions<T> {
  readonly destinationPath: string;
  readonly maximumBytes: number;
  readonly produce: (sink: ExclusiveInputSink) => Promise<T>;
  readonly validateBeforeCommit?: (
    result: ExclusiveInputPublicationResult<T>,
  ) => Promise<void> | void;
}

export interface ExclusiveInputPublicationResult<T> {
  readonly value: T;
  readonly bytes: number;
  readonly sha256: string;
}

export class InputPublicationError extends Error {
  readonly code: string;
  readonly artifact: string;
  readonly committed: boolean;

  constructor(code: string, artifact: string, message: string, committed = false) {
    super(message);
    this.code = code;
    this.artifact = artifact;
    this.committed = committed;
  }
}

function nodeErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  return Reflect.get(error, 'code') as string | undefined;
}

function publicationError(
  code: string,
  artifact: string,
  message: string,
  committed = false,
): InputPublicationError {
  return new InputPublicationError(code, artifact, message, committed);
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(bytes, offset, bytes.byteLength - offset, null);
    if (result.bytesWritten <= 0) {
      throw new Error('Exclusive file write made no progress.');
    }
    offset += result.bytesWritten;
  }
}

function wrapFileHandle(handle: FileHandle): ExclusivePublicationHandle {
  return Object.freeze({
    write: async (bytes: Uint8Array) => writeAll(handle, bytes),
    sync: async () => handle.sync(),
    close: async () => handle.close(),
  });
}

export function defaultExclusivePublicationDependencies(): ExclusivePublicationDependencies {
  return Object.freeze({
    openExclusive: async (filePath: string) => wrapFileHandle(await open(filePath, 'wx')),
    openDirectory: async (directoryPath: string) => wrapFileHandle(await open(directoryPath, 'r')),
    lstat: async (filePath: string) => {
      await lstat(filePath);
    },
    link: async (sourcePath: string, destinationPath: string) => link(sourcePath, destinationPath),
    unlink: async (filePath: string) => unlink(filePath),
    uniqueSuffix: () => `${process.pid}-${randomBytes(12).toString('hex')}`,
  });
}

async function requireAbsent(
  dependencies: ExclusivePublicationDependencies,
  filePath: string,
  stage: 'initial' | 'final',
): Promise<void> {
  try {
    await dependencies.lstat(filePath);
  } catch (error) {
    if (nodeErrorCode(error) === 'ENOENT') return;
    throw publicationError(
      'destination-check-failed',
      filePath,
      `Could not inspect the ${stage} destination state: ${filePath}.`,
    );
  }
  throw publicationError(
    `destination-conflict-${stage}`,
    filePath,
    `Destination already exists at the ${stage} publication check: ${filePath}.`,
  );
}

async function closeIgnoringFailure(
  handle: ExclusivePublicationHandle | undefined,
): Promise<void> {
  try {
    await handle?.close();
  } catch {
    // The owned path remains the primary cleanup authority.
  }
}

export async function publishExclusiveInputArtifact<T>(
  options: ExclusiveInputPublicationOptions<T>,
  dependencies: ExclusivePublicationDependencies = defaultExclusivePublicationDependencies(),
): Promise<ExclusiveInputPublicationResult<T>> {
  if (!Number.isSafeInteger(options.maximumBytes) || options.maximumBytes <= 0) {
    throw publicationError(
      'invalid-artifact-cap',
      options.destinationPath,
      'The input artifact cap must be a positive safe integer.',
    );
  }
  const destination = path.resolve(options.destinationPath);
  const parent = path.dirname(destination);
  const baseName = path.basename(destination);
  const lockPath = path.join(parent, `.${baseName}-publication-lock`);
  const suffix = dependencies.uniqueSuffix();
  if (!/^[A-Za-z0-9-]+$/u.test(suffix)) {
    throw publicationError('invalid-staging-suffix', destination, 'The staging suffix is invalid.');
  }
  const stagingPath = path.join(parent, `.${baseName}.staging-${suffix}`);

  let lockHandle: ExclusivePublicationHandle | undefined;
  let stagingHandle: ExclusivePublicationHandle | undefined;
  let ownsLock = false;
  let ownsStaging = false;
  let committed = false;
  let bytesWritten = 0;
  const hash = createHash('sha256');

  try {
    try {
      lockHandle = await dependencies.openExclusive(lockPath);
      ownsLock = true;
    } catch (error) {
      if (nodeErrorCode(error) === 'EEXIST') {
        throw publicationError(
          'publication-lock-conflict',
          lockPath,
          `Publication lock already exists: ${lockPath}.`,
        );
      }
      throw publicationError(
        'publication-lock-failed',
        lockPath,
        `Could not acquire the publication lock: ${lockPath}.`,
      );
    }

    await requireAbsent(dependencies, destination, 'initial');
    try {
      stagingHandle = await dependencies.openExclusive(stagingPath);
      ownsStaging = true;
    } catch (error) {
      throw publicationError(
        nodeErrorCode(error) === 'EEXIST' ? 'staging-conflict' : 'staging-open-failed',
        stagingPath,
        `Could not create the exclusive staging file: ${stagingPath}.`,
      );
    }

    const value = await options.produce(
      Object.freeze({
        write: async (chunk: Uint8Array): Promise<void> => {
          const nextBytes = bytesWritten + chunk.byteLength;
          if (!Number.isSafeInteger(nextBytes) || nextBytes > options.maximumBytes) {
            throw publicationError(
              'artifact-cap-exceeded',
              destination,
              `Input artifact exceeds ${options.maximumBytes} bytes.`,
            );
          }
          await stagingHandle?.write(chunk);
          hash.update(chunk);
          bytesWritten = nextBytes;
        },
      }),
    );
    if (bytesWritten === 0) {
      throw publicationError('empty-artifact', destination, 'Input artifact must not be empty.');
    }
    const precommitResult = Object.freeze({
      value,
      bytes: bytesWritten,
      sha256: `sha256:${hash.digest('hex')}`,
    });
    await options.validateBeforeCommit?.(precommitResult);
    await stagingHandle.sync();
    await stagingHandle.close();
    stagingHandle = undefined;

    await requireAbsent(dependencies, destination, 'final');
    try {
      await dependencies.link(stagingPath, destination);
      committed = true;
    } catch (error) {
      if (nodeErrorCode(error) === 'EEXIST') {
        throw publicationError(
          'destination-conflict-final',
          destination,
          `Destination appeared before the no-overwrite link: ${destination}.`,
        );
      }
      throw publicationError(
        'publication-link-failed',
        destination,
        `Atomic no-overwrite link failed: ${destination}.`,
      );
    }

    let postCommitFailure: InputPublicationError | undefined;
    let parentHandle: ExclusivePublicationHandle | undefined;
    try {
      parentHandle = await dependencies.openDirectory(parent);
      await parentHandle.sync();
    } catch {
      postCommitFailure = publicationError(
        'postcommit-parent-sync-failed',
        destination,
        `Destination was committed but its parent directory did not sync: ${destination}.`,
        true,
      );
    } finally {
      await closeIgnoringFailure(parentHandle);
    }

    try {
      await dependencies.unlink(stagingPath);
      ownsStaging = false;
    } catch {
      postCommitFailure ??= publicationError(
        'postcommit-staging-cleanup-failed',
        stagingPath,
        `Destination was committed but staging cleanup failed: ${stagingPath}.`,
        true,
      );
    }

    await closeIgnoringFailure(lockHandle);
    lockHandle = undefined;
    try {
      await dependencies.unlink(lockPath);
      ownsLock = false;
    } catch {
      postCommitFailure ??= publicationError(
        'postcommit-lock-cleanup-failed',
        lockPath,
        `Destination was committed but lock cleanup failed: ${lockPath}.`,
        true,
      );
    }

    if (postCommitFailure !== undefined) throw postCommitFailure;
    return precommitResult;
  } catch (error) {
    if (committed) throw error;
    await closeIgnoringFailure(stagingHandle);
    stagingHandle = undefined;

    if (ownsStaging) {
      try {
        await dependencies.unlink(stagingPath);
        ownsStaging = false;
      } catch {
        await closeIgnoringFailure(lockHandle);
        throw publicationError(
          'precommit-staging-cleanup-failed',
          stagingPath,
          `Pre-commit cleanup failed; the owned lock is retained for manual review: ${lockPath}.`,
        );
      }
    }

    await closeIgnoringFailure(lockHandle);
    if (ownsLock) {
      try {
        await dependencies.unlink(lockPath);
        ownsLock = false;
      } catch {
        throw publicationError(
          'precommit-lock-cleanup-failed',
          lockPath,
          `Pre-commit lock cleanup failed: ${lockPath}.`,
        );
      }
    }
    if (error instanceof InputPublicationError) throw error;
    throw publicationError(
      'input-construction-failed',
      destination,
      error instanceof Error ? error.message : 'Input construction failed.',
    );
  }
}
