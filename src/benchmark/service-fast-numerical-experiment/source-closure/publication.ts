import { randomBytes } from 'node:crypto';
import {
  link,
  lstat,
  open,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import path from 'node:path';

import { SourceClosurePublicationError } from './publication-error.ts';

export {
  SERVICE_FAST_SOURCE_CLOSURE_PUBLICATION_ERROR_CODES,
  SourceClosurePublicationError,
} from './publication-error.ts';

export interface ClosurePublicationStat {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly regularFile: boolean;
}

export interface ClosurePublicationHandle {
  readonly write: (bytes: Uint8Array) => Promise<void>;
  readonly readExact: (bytes: number) => Promise<Uint8Array>;
  readonly stat: () => Promise<ClosurePublicationStat>;
  readonly sync: () => Promise<void>;
  readonly close: () => Promise<void>;
}

export interface ClosurePublicationDependencies {
  readonly openExclusive: (filePath: string) => Promise<ClosurePublicationHandle>;
  readonly openDirectory: (directoryPath: string) => Promise<ClosurePublicationHandle>;
  readonly lstat: (filePath: string) => Promise<ClosurePublicationStat>;
  readonly link: (sourcePath: string, destinationPath: string) => Promise<void>;
  readonly unlink: (filePath: string) => Promise<void>;
  readonly uniqueSuffix: () => string;
}

export interface ClosurePublicationResult {
  readonly path: string;
  readonly bytes: number;
}

function publicationFailure(
  code: string,
  artifact: string,
  message: string,
  committed = false,
): SourceClosurePublicationError {
  return new SourceClosurePublicationError(code, artifact, message, committed);
}

function withPublicationDisposition(
  error: SourceClosurePublicationError,
  committed: boolean,
  secondaryCleanupCode: string | null = error.secondaryCleanupCode,
): SourceClosurePublicationError {
  return new SourceClosurePublicationError(
    error.code,
    error.artifact,
    error.message,
    committed,
    secondaryCleanupCode,
  );
}

function nodeErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor !== undefined && Object.hasOwn(descriptor, 'value') &&
      typeof descriptor.value === 'string'
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(bytes, offset, bytes.byteLength - offset, null);
    if (result.bytesWritten <= 0) throw new Error('Source-closure write made no progress.');
    offset += result.bytesWritten;
  }
}

async function readExact(handle: FileHandle, byteLength: number): Promise<Uint8Array> {
  const buffer = Buffer.alloc(byteLength + 1);
  let offset = 0;
  while (offset < buffer.byteLength) {
    const result = await handle.read(buffer, offset, buffer.byteLength - offset, offset);
    if (result.bytesRead === 0) break;
    offset += result.bytesRead;
  }
  return Uint8Array.from(buffer.subarray(0, offset));
}

function projectStat(value: BigIntStats): ClosurePublicationStat {
  return Object.freeze({
    dev: value.dev,
    ino: value.ino,
    size: value.size,
    regularFile: value.isFile(),
  });
}

function wrapHandle(handle: FileHandle): ClosurePublicationHandle {
  return Object.freeze({
    write: async (bytes: Uint8Array) => writeAll(handle, bytes),
    readExact: async (bytes: number) => readExact(handle, bytes),
    stat: async () => projectStat(await handle.stat({ bigint: true })),
    sync: async () => handle.sync(),
    close: async () => handle.close(),
  });
}

export function defaultClosurePublicationDependencies(): ClosurePublicationDependencies {
  return Object.freeze({
    openExclusive: async (filePath: string) => wrapHandle(await open(filePath, 'wx+', 0o600)),
    openDirectory: async (directoryPath: string) => wrapHandle(await open(directoryPath, 'r')),
    lstat: async (filePath: string) => projectStat(await lstat(filePath, { bigint: true })),
    link: async (sourcePath: string, destinationPath: string) => link(sourcePath, destinationPath),
    unlink: async (filePath: string) => unlink(filePath),
    uniqueSuffix: () => `${process.pid}-${randomBytes(12).toString('hex')}`,
  });
}

function sameIdentity(
  left: ClosurePublicationStat,
  right: ClosurePublicationStat,
): boolean {
  return left.regularFile && right.regularFile && left.dev === right.dev && left.ino === right.ino;
}

async function requireAbsent(
  dependencies: ClosurePublicationDependencies,
  destinationPath: string,
  phase: 'initial' | 'final',
): Promise<void> {
  try {
    await dependencies.lstat(destinationPath);
  } catch (error) {
    if (nodeErrorCode(error) === 'ENOENT') return;
    throw publicationFailure(
      'destination-inspection-failure',
      destinationPath,
      `Could not inspect the ${phase} source-closure destination.`,
    );
  }
  throw publicationFailure(
    `${phase}-destination-conflict`,
    destinationPath,
    `The ${phase} source-closure destination already exists.`,
  );
}

async function closeIgnoringFailure(
  handle: ClosurePublicationHandle | undefined,
): Promise<void> {
  try {
    await handle?.close();
  } catch {
    // Ownership-safe path cleanup remains authoritative.
  }
}

async function closeForCleanup(
  handle: ClosurePublicationHandle | undefined,
): Promise<boolean> {
  if (handle === undefined) return false;
  try {
    await handle.close();
    return false;
  } catch {
    return true;
  }
}

async function closeProjectingFailure(
  handle: ClosurePublicationHandle | undefined,
  code: string,
  artifact: string,
  message: string,
  committed: boolean,
): Promise<SourceClosurePublicationError | undefined> {
  if (handle === undefined) return undefined;
  try {
    await handle.close();
    return undefined;
  } catch {
    return publicationFailure(code, artifact, message, committed);
  }
}

async function unlinkOwnedPath(
  dependencies: ClosurePublicationDependencies,
  filePath: string,
  identity: ClosurePublicationStat,
): Promise<boolean> {
  let current: ClosurePublicationStat;
  try {
    current = await dependencies.lstat(filePath);
  } catch (error) {
    return nodeErrorCode(error) === 'ENOENT';
  }
  if (!sameIdentity(identity, current)) return false;
  try {
    await dependencies.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

async function rollbackProvisionalDestination(
  dependencies: ClosurePublicationDependencies,
  destinationPath: string,
  parentPath: string,
  identity: ClosurePublicationStat,
): Promise<boolean> {
  let current: ClosurePublicationStat;
  try {
    current = await dependencies.lstat(destinationPath);
  } catch {
    return false;
  }
  if (!sameIdentity(identity, current)) return false;
  try {
    await dependencies.unlink(destinationPath);
  } catch {
    return false;
  }

  let parentHandle: ClosurePublicationHandle | undefined;
  try {
    parentHandle = await dependencies.openDirectory(parentPath);
    await parentHandle.sync();
    await parentHandle.close();
    parentHandle = undefined;
  } catch {
    await closeIgnoringFailure(parentHandle);
    return false;
  }

  try {
    await dependencies.lstat(destinationPath);
  } catch (error) {
    return nodeErrorCode(error) === 'ENOENT';
  }
  return false;
}

export async function publishCanonicalSourceClosure(
  destinationPath: string,
  bytes: Uint8Array,
  maximumBytes: number,
  dependencies: ClosurePublicationDependencies = defaultClosurePublicationDependencies(),
): Promise<ClosurePublicationResult> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new TypeError('Source-closure publication cap must be a positive safe integer.');
  }
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
    throw publicationFailure(
      'source-closure-cap-exceeded',
      destinationPath,
      'Source-closure bytes violate the frozen cap.',
    );
  }
  const destination = path.resolve(destinationPath);
  const parent = path.dirname(destination);
  const baseName = path.basename(destination);
  const suffix = dependencies.uniqueSuffix();
  if (!/^[A-Za-z0-9-]+$/u.test(suffix)) {
    throw publicationFailure('invalid-temp-suffix', destination, 'The source-closure temp suffix is invalid.');
  }
  const tempPath = path.join(parent, `.${baseName}.tmp-${suffix}`);
  let handle: ClosurePublicationHandle | undefined;
  let identity: ClosurePublicationStat | undefined;
  let tempCreated = false;
  let linkCreated = false;
  let committed = false;
  try {
    await requireAbsent(dependencies, destination, 'initial');
    try {
      handle = await dependencies.openExclusive(tempPath);
      tempCreated = true;
    } catch (error) {
      throw publicationFailure(
        nodeErrorCode(error) === 'EEXIST' ? 'temp-path-conflict' : 'temp-open-failure',
        tempPath,
        'Could not create the exclusive source-closure temp file.',
      );
    }
    let pathIdentity: ClosurePublicationStat;
    try {
      identity = await handle.stat();
      pathIdentity = await dependencies.lstat(tempPath);
    } catch {
      throw publicationFailure('temp-identity-mismatch', tempPath, 'The owned temp identity could not be established.');
    }
    if (!sameIdentity(identity, pathIdentity)) {
      throw publicationFailure('temp-identity-mismatch', tempPath, 'The owned temp path does not match its open handle.');
    }
    try {
      await handle.write(bytes);
    } catch {
      throw publicationFailure('temp-write-failure', tempPath, 'The owned source-closure temp write failed.');
    }
    try {
      await handle.sync();
    } catch {
      throw publicationFailure('temp-sync-failure', tempPath, 'The owned source-closure temp sync failed.');
    }
    let stagedBytes: Uint8Array;
    try {
      stagedBytes = await handle.readExact(bytes.byteLength);
    } catch {
      throw publicationFailure('temp-readback-failure', tempPath, 'The synced source-closure temp readback failed.');
    }
    if (
      stagedBytes.byteLength !== bytes.byteLength ||
      stagedBytes.some((byte, index) => byte !== bytes[index])
    ) {
      throw publicationFailure('temp-readback-mismatch', tempPath, 'The synced source-closure temp bytes failed exact readback.');
    }
    await requireAbsent(dependencies, destination, 'final');
    let preLinkHandleIdentity: ClosurePublicationStat;
    let preLinkPathIdentity: ClosurePublicationStat;
    try {
      preLinkHandleIdentity = await handle.stat();
      preLinkPathIdentity = await dependencies.lstat(tempPath);
    } catch {
      throw publicationFailure('temp-identity-mismatch', tempPath, 'The owned temp identity could not be re-established before publication.');
    }
    if (
      !sameIdentity(identity, preLinkHandleIdentity) ||
      !sameIdentity(identity, preLinkPathIdentity) ||
      preLinkHandleIdentity.size !== BigInt(bytes.byteLength) ||
      preLinkPathIdentity.size !== BigInt(bytes.byteLength)
    ) {
      throw publicationFailure('temp-identity-mismatch', tempPath, 'The owned temp identity changed before publication.');
    }
    try {
      await dependencies.link(tempPath, destination);
      linkCreated = true;
    } catch (error) {
      throw publicationFailure(
        nodeErrorCode(error) === 'EEXIST' ? 'final-destination-conflict' : 'source-closure-link-failure',
        destination,
        'The exclusive no-overwrite source-closure link failed.',
      );
    }
    try {
      const postLinkHandleIdentity = await handle.stat();
      const postLinkPathIdentity = await dependencies.lstat(tempPath);
      const provisionalDestinationIdentity = await dependencies.lstat(destination);
      if (
        !sameIdentity(identity, postLinkHandleIdentity) ||
        !sameIdentity(identity, postLinkPathIdentity) ||
        !sameIdentity(identity, provisionalDestinationIdentity) ||
        postLinkHandleIdentity.size !== BigInt(bytes.byteLength) ||
        postLinkPathIdentity.size !== BigInt(bytes.byteLength) ||
        provisionalDestinationIdentity.size !== BigInt(bytes.byteLength)
      ) {
        throw new Error('Postlink identity admission failed.');
      }
    } catch {
      throw publicationFailure(
        'postlink-identity-mismatch',
        destination,
        'The temp handle, temp path, and destination do not share the owned inode after publication.',
      );
    }
    committed = true;
    const fileCloseFailure = await closeProjectingFailure(
      handle,
      'postcommit-file-close-failure',
      destination,
      'The source closure was committed but its synced file handle did not close.',
      true,
    );
    handle = undefined;

    let postCommitFailure = fileCloseFailure;
    let parentHandle: ClosurePublicationHandle | undefined;
    try {
      parentHandle = await dependencies.openDirectory(parent);
      await parentHandle.sync();
    } catch {
      postCommitFailure ??= publicationFailure(
        'postcommit-parent-sync-failure',
        destination,
        'The source closure was committed but its parent directory did not sync.',
        true,
      );
    } finally {
      const handleToClose = parentHandle;
      parentHandle = undefined;
      const closeFailure = await closeProjectingFailure(
        handleToClose,
        'postcommit-parent-close-failure',
        destination,
        'The source closure was committed but its synced parent directory did not close.',
        true,
      );
      postCommitFailure ??= closeFailure;
    }

    if (!(await unlinkOwnedPath(dependencies, tempPath, identity))) {
      if (postCommitFailure === undefined) {
        postCommitFailure = publicationFailure(
          'postcommit-owned-temp-cleanup-failure',
          tempPath,
          'The source closure was committed but its owned temp path could not be cleaned safely.',
          true,
        );
      } else {
        postCommitFailure = withPublicationDisposition(
          postCommitFailure,
          true,
          'postcommit-owned-temp-cleanup-failure',
        );
      }
    } else {
      parentHandle = undefined;
      try {
        parentHandle = await dependencies.openDirectory(parent);
        await parentHandle.sync();
      } catch {
        postCommitFailure ??= publicationFailure(
          'postcommit-temp-unlink-sync-failure',
          destination,
          'The source closure was committed but temp cleanup did not sync.',
          true,
        );
      } finally {
        const handleToClose = parentHandle;
        parentHandle = undefined;
        const closeFailure = await closeProjectingFailure(
          handleToClose,
          'postcommit-cleanup-parent-close-failure',
          destination,
          'The source closure was committed but its cleanup parent directory did not close.',
          true,
        );
        postCommitFailure ??= closeFailure;
      }
    }
    if (postCommitFailure !== undefined) throw postCommitFailure;
    return Object.freeze({ path: destination, bytes: bytes.byteLength });
  } catch (error) {
    if (committed) throw error;
    let primaryFailure = error instanceof SourceClosurePublicationError
      ? error
      : publicationFailure(
        'source-closure-publication-failure',
        destination,
        'Source-closure publication failed with an unclassified internal exception.',
      );
    if (linkCreated) {
      if (
        identity === undefined ||
        !(await rollbackProvisionalDestination(
          dependencies,
          destination,
          parent,
          identity,
        ))
      ) {
        primaryFailure = withPublicationDisposition(
          primaryFailure,
          true,
          'provisional-destination-cleanup-failure',
        );
      }
    }
    const tempCloseFailed = await closeForCleanup(handle);
    const tempUnlinkFailed = tempCreated && (
      identity === undefined ||
      !(await unlinkOwnedPath(dependencies, tempPath, identity))
    );
    const tempCleanupFailed = tempCloseFailed || tempUnlinkFailed;
    if (tempCleanupFailed) {
      primaryFailure = withPublicationDisposition(
        primaryFailure,
        primaryFailure.committed,
        primaryFailure.secondaryCleanupCode ?? 'precommit-owned-temp-cleanup-failure',
      );
    }
    throw primaryFailure;
  }
}
