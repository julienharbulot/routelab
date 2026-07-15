import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm, statfs, unlink } from 'node:fs/promises';
import path from 'node:path';

import type { FileHandle } from 'node:fs/promises';
import {
  ACCEPTED_PUBLICATION_LOCK_NAME,
  ACCEPTED_RETAINED_DIRECTORY,
  acceptedRetainedFileContracts,
} from './contract.ts';
import {
  acceptedRunFailure,
  appendAcceptedCleanupFailure,
  projectAcceptedRunFailure,
  type AcceptedRunFailure,
  type AcceptedRunInternalFailureCode,
} from './failure.ts';

interface PublicationStat {
  readonly dev: bigint | number;
  readonly ino: bigint | number;
  readonly size: bigint | number;
  readonly isDirectory: () => boolean;
  readonly isFile: () => boolean;
  readonly isSymbolicLink: () => boolean;
}

export interface AcceptedPreparedArtifact {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly recordCount: number | null;
}

export interface AcceptedPublicationDependencies {
  readonly lstat: typeof lstat;
  readonly mkdir: typeof mkdir;
  readonly open: typeof open;
  readonly readdir: typeof readdir;
  readonly rename: typeof rename;
  readonly rm: typeof rm;
  readonly statfs: typeof statfs;
  readonly unlink: typeof unlink;
  readonly suffix: () => string;
  readonly hashBytes: (bytes: Uint8Array) => string;
}

export interface AcceptedPublicationSession {
  readonly repositoryRoot: string;
  readonly parentPath: string;
  readonly destinationPath: string;
  readonly lockPath: string;
  readonly parentHandle: FileHandle;
  readonly lockHandle: FileHandle;
  readonly parentIdentity: PublicationStat;
  readonly lockIdentity: PublicationStat;
  readonly dependencies: AcceptedPublicationDependencies;
  released: boolean;
  committed: boolean;
}

function code(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return typeof descriptor?.value === 'string' ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function failure(
  internalCode: AcceptedRunInternalFailureCode,
  committed = false,
): never {
  throw acceptedRunFailure(internalCode, committed);
}

function sameIdentity(left: PublicationStat, right: PublicationStat): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index]);
}

function ndjsonCount(bytes: Uint8Array): number {
  let count = 0;
  for (const byte of bytes) if (byte === 0x0a) count += 1;
  return count;
}

export function defaultAcceptedPublicationDependencies(
  hashBytes: (bytes: Uint8Array) => string,
): AcceptedPublicationDependencies {
  return Object.freeze({
    lstat,
    mkdir,
    open,
    readdir,
    rename,
    rm,
    statfs,
    unlink,
    suffix: () => randomBytes(16).toString('hex'),
    hashBytes,
  });
}

async function admittedStat(
  dependencies: AcceptedPublicationDependencies,
  target: string,
): Promise<PublicationStat> {
  try {
    return await dependencies.lstat(target, { bigint: true });
  } catch {
    return failure('preflight-filesystem-admission');
  }
}

async function ensureParent(
  repositoryRoot: string,
  parentPath: string,
  dependencies: AcceptedPublicationDependencies,
): Promise<void> {
  const relative = path.relative(repositoryRoot, parentPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return failure('preflight-filesystem-admission');
  }
  let current = repositoryRoot;
  const root = await admittedStat(dependencies, current);
  if (!root.isDirectory() || root.isSymbolicLink()) {
    return failure('preflight-filesystem-admission');
  }
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let currentStat: PublicationStat;
    try {
      currentStat = await dependencies.lstat(current, { bigint: true });
    } catch (error) {
      if (code(error) !== 'ENOENT') return failure('preflight-filesystem-admission');
      try {
        await dependencies.mkdir(current, { mode: 0o700 });
        currentStat = await dependencies.lstat(current, { bigint: true });
      } catch {
        return failure('preflight-filesystem-admission');
      }
    }
    if (!currentStat.isDirectory() || currentStat.isSymbolicLink()) {
      return failure('preflight-filesystem-admission');
    }
  }
}

async function destinationAbsent(
  dependencies: AcceptedPublicationDependencies,
  destinationPath: string,
  conflictCode: 'preflight-destination-exists' | 'precommit-destination-exists',
  filesystemCode: 'preflight-filesystem-admission' | 'precommit-filesystem-admission',
): Promise<void> {
  try {
    await dependencies.lstat(destinationPath, { bigint: true });
  } catch (error) {
    if (code(error) === 'ENOENT') return;
    return failure(filesystemCode);
  }
  return failure(conflictCode);
}

async function closeQuietly(handle: FileHandle): Promise<void> {
  try {
    await handle.close();
  } catch {
    // The owning cleanup path classifies the observable failure.
  }
}

async function removeOwnedLock(session: AcceptedPublicationSession): Promise<boolean> {
  if (session.released) return true;
  try {
    const handleStat = await session.lockHandle.stat({ bigint: true }) as unknown as PublicationStat;
    const pathStat = await session.dependencies.lstat(session.lockPath, { bigint: true }) as unknown as PublicationStat;
    if (!sameIdentity(handleStat, session.lockIdentity) || !sameIdentity(pathStat, session.lockIdentity)) {
      return false;
    }
    await session.lockHandle.close();
    await session.dependencies.unlink(session.lockPath);
    await session.parentHandle.sync();
    session.released = true;
    await session.parentHandle.close();
    return true;
  } catch {
    return false;
  }
}

/** Acquire and inode-bind the fixed lock before any candidate call. @internal */
export async function admitAcceptedPublication(
  repositoryRoot: string,
  dependencies: AcceptedPublicationDependencies,
): Promise<AcceptedPublicationSession> {
  if (!path.isAbsolute(repositoryRoot) || path.resolve(repositoryRoot) !== repositoryRoot) {
    return failure('preflight-filesystem-admission');
  }
  const destinationPath = path.resolve(repositoryRoot, ACCEPTED_RETAINED_DIRECTORY);
  const parentPath = path.dirname(destinationPath);
  const lockPath = path.join(parentPath, ACCEPTED_PUBLICATION_LOCK_NAME);
  await ensureParent(repositoryRoot, parentPath, dependencies);
  let filesystem: Awaited<ReturnType<AcceptedPublicationDependencies['statfs']>>;
  try {
    filesystem = await dependencies.statfs(parentPath, { bigint: true });
  } catch {
    return failure('preflight-filesystem-admission');
  }
  if (filesystem.type !== 0xef53n) return failure('preflight-filesystem-admission');
  let parentHandle: FileHandle;
  try {
    parentHandle = await dependencies.open(parentPath, constants.O_RDONLY | constants.O_DIRECTORY);
  } catch {
    return failure('preflight-filesystem-admission');
  }
  let parentIdentity: PublicationStat;
  try {
    parentIdentity = await parentHandle.stat({ bigint: true });
    const parentPathIdentity = await dependencies.lstat(parentPath, { bigint: true });
    if (
      !sameIdentity(parentIdentity, parentPathIdentity) ||
      !parentIdentity.isDirectory() || parentIdentity.isSymbolicLink()
    ) throw new TypeError('parent identity');
    await parentHandle.sync();
  } catch {
    await closeQuietly(parentHandle);
    return failure('preflight-filesystem-admission');
  }
  let lockHandle: FileHandle;
  try {
    lockHandle = await dependencies.open(lockPath, 'wx', 0o600);
  } catch (error) {
    await closeQuietly(parentHandle);
    if (code(error) === 'EEXIST') return failure('preflight-lock-exists');
    return failure('preflight-filesystem-admission');
  }
  let lockIdentity: PublicationStat;
  let lockPathIdentity: PublicationStat;
  try {
    lockIdentity = await lockHandle.stat({ bigint: true });
    lockPathIdentity = await dependencies.lstat(lockPath, { bigint: true });
  } catch {
    await closeQuietly(lockHandle);
    await closeQuietly(parentHandle);
    throw acceptedRunFailure(
      'preflight-filesystem-admission',
      false,
      'owned-lock-cleanup-failure',
    );
  }
  const session: AcceptedPublicationSession = {
    repositoryRoot,
    parentPath,
    destinationPath,
    lockPath,
    parentHandle,
    lockHandle,
    parentIdentity,
    lockIdentity,
    dependencies,
    released: false,
    committed: false,
  };
  if (
    !sameIdentity(lockIdentity, lockPathIdentity) ||
    lockIdentity.dev !== parentIdentity.dev
  ) {
    if (!sameIdentity(lockIdentity, lockPathIdentity)) {
      await closeQuietly(lockHandle);
      await closeQuietly(parentHandle);
      throw acceptedRunFailure(
        'preflight-filesystem-admission',
        false,
        'owned-lock-cleanup-failure',
      );
    }
    if (!await removeOwnedLock(session)) {
      throw acceptedRunFailure(
        'preflight-filesystem-admission',
        false,
        'owned-lock-cleanup-failure',
      );
    }
    return failure('preflight-filesystem-admission');
  }
  try {
    await destinationAbsent(
      dependencies,
      destinationPath,
      'preflight-destination-exists',
      'preflight-filesystem-admission',
    );
  } catch (error) {
    const primary = projectAcceptedRunFailure(
      error,
      'preflight-filesystem-admission',
    );
    const removed = await removeOwnedLock(session);
    if (!removed) throw appendAcceptedCleanupFailure(primary, 'owned-lock-cleanup-failure');
    throw primary;
  }
  return session;
}

async function removeOwnedStaging(
  session: AcceptedPublicationSession,
  stagingPath: string,
  stagingIdentity: PublicationStat,
): Promise<boolean> {
  try {
    const current = await session.dependencies.lstat(stagingPath, { bigint: true }) as unknown as PublicationStat;
    if (!sameIdentity(current, stagingIdentity) || !current.isDirectory() || current.isSymbolicLink()) {
      return false;
    }
    await session.dependencies.rm(stagingPath, { recursive: true, force: false });
    await session.parentHandle.sync();
    return true;
  } catch {
    return false;
  }
}

async function rebindAcceptedLock(
  session: AcceptedPublicationSession,
): Promise<void> {
  let handleIdentity: PublicationStat;
  let pathIdentity: PublicationStat;
  try {
    handleIdentity = await session.lockHandle.stat({ bigint: true });
    pathIdentity = await session.dependencies.lstat(
      session.lockPath,
      { bigint: true },
    );
  } catch {
    return failure('precommit-filesystem-admission');
  }
  if (
    !sameIdentity(handleIdentity, session.lockIdentity) ||
    !sameIdentity(pathIdentity, session.lockIdentity) ||
    handleIdentity.dev !== session.parentIdentity.dev
  ) return failure('precommit-filesystem-admission');
}

async function rebindAcceptedStaging(
  session: AcceptedPublicationSession,
  stagingPath: string,
  stagingIdentity: PublicationStat,
  stagingHandle: FileHandle,
): Promise<void> {
  let handleIdentity: PublicationStat;
  let pathIdentity: PublicationStat;
  try {
    handleIdentity = await stagingHandle.stat({ bigint: true });
    pathIdentity = await session.dependencies.lstat(
      stagingPath,
      { bigint: true },
    );
  } catch {
    return failure('precommit-filesystem-admission');
  }
  if (
    !sameIdentity(handleIdentity, stagingIdentity) ||
    !sameIdentity(pathIdentity, stagingIdentity) ||
    !handleIdentity.isDirectory() || handleIdentity.isSymbolicLink() ||
    handleIdentity.dev !== session.parentIdentity.dev
  ) return failure('precommit-filesystem-admission');
}

async function precommitCleanup(
  session: AcceptedPublicationSession,
  stagingPath: string,
  stagingIdentity: PublicationStat,
  primary: AcceptedRunFailure,
): Promise<never> {
  const stagingRemoved = await removeOwnedStaging(session, stagingPath, stagingIdentity);
  if (!stagingRemoved) {
    throw appendAcceptedCleanupFailure(primary, 'owned-staging-cleanup-failure');
  }
  const lockRemoved = await removeOwnedLock(session);
  if (!lockRemoved) {
    throw appendAcceptedCleanupFailure(primary, 'owned-lock-cleanup-failure');
  }
  throw primary;
}

async function precommitLockCleanup(
  session: AcceptedPublicationSession,
  primary: AcceptedRunFailure,
): Promise<never> {
  if (!await removeOwnedLock(session)) {
    throw appendAcceptedCleanupFailure(primary, 'owned-lock-cleanup-failure');
  }
  throw primary;
}

async function writeArtifacts(
  session: AcceptedPublicationSession,
  stagingPath: string,
  artifacts: readonly AcceptedPreparedArtifact[],
): Promise<void> {
  for (const artifact of artifacts) {
    let handle: FileHandle;
    try {
      handle = await session.dependencies.open(path.join(stagingPath, artifact.name), 'wx', 0o600);
    } catch {
      return failure('precommit-artifact-write');
    }
    try {
      await handle.writeFile(artifact.bytes);
    } catch {
      await closeQuietly(handle);
      return failure('precommit-artifact-write');
    }
    try {
      await handle.sync();
    } catch {
      await closeQuietly(handle);
      return failure('precommit-artifact-sync');
    }
    try {
      await handle.close();
    } catch {
      return failure('precommit-artifact-sync');
    }
  }
}

async function readbackArtifacts(
  session: AcceptedPublicationSession,
  stagingPath: string,
  stagingIdentity: PublicationStat,
  artifacts: readonly AcceptedPreparedArtifact[],
): Promise<void> {
  let names: string[];
  try {
    names = await session.dependencies.readdir(stagingPath);
  } catch {
    return failure('precommit-artifact-write');
  }
  const expectedNames = artifacts.map((artifact) => artifact.name);
  if (names.length !== expectedNames.length || expectedNames.some((name) => !names.includes(name))) {
    return failure('precommit-artifact-write');
  }
  for (const artifact of artifacts) {
    const contract = acceptedRetainedFileContracts().find((entry) =>
      entry.name === artifact.name);
    if (contract === undefined) return failure('precommit-artifact-write');
    let handle: FileHandle;
    try {
      handle = await session.dependencies.open(path.join(stagingPath, artifact.name), constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat({ bigint: true }) as unknown as PublicationStat & {
        readonly isFile: () => boolean;
      };
      const pathIdentity = await session.dependencies.lstat(
        path.join(stagingPath, artifact.name),
        { bigint: true },
      );
      if (
        !sameIdentity(stat, pathIdentity) || !stat.isFile() ||
        stat.isSymbolicLink() || stat.dev !== stagingIdentity.dev ||
        stat.size !== BigInt(artifact.bytes.byteLength) ||
        stat.size > BigInt(contract.maxBytes)
      ) {
        await closeQuietly(handle);
        return failure('precommit-artifact-write');
      }
      const bytes = Uint8Array.from(await handle.readFile());
      await handle.close();
      if (
        !bytesEqual(bytes, artifact.bytes) ||
        session.dependencies.hashBytes(bytes) !== artifact.sha256 ||
        artifact.recordCount !== null && ndjsonCount(bytes) !== artifact.recordCount
      ) return failure('precommit-artifact-write');
    } catch (error) {
      throw projectAcceptedRunFailure(error, 'precommit-artifact-write');
    }
  }
}

/** Create staging only after all candidate work and atomically publish eight files. @internal */
export async function publishAcceptedArtifacts(
  session: AcceptedPublicationSession,
  artifacts: readonly AcceptedPreparedArtifact[],
): Promise<void> {
  const contracts = acceptedRetainedFileContracts();
  let artifactsAdmitted: boolean;
  try {
    const totalBytes = artifacts.reduce(
      (sum, artifact) => sum + artifact.bytes.byteLength,
      0,
    );
    artifactsAdmitted = artifacts.length === contracts.length &&
      artifacts.every((artifact, index) => {
        const contract = contracts[index];
        return contract !== undefined && artifact.name === contract.name &&
          artifact.bytes instanceof Uint8Array &&
          artifact.bytes.byteLength <= contract.maxBytes &&
          artifact.recordCount === contract.recordCount &&
          session.dependencies.hashBytes(artifact.bytes) === artifact.sha256;
      }) && Number.isSafeInteger(totalBytes) && totalBytes <= 768 * 1024 * 1024;
  } catch {
    artifactsAdmitted = false;
  }
  if (!artifactsAdmitted) {
    return precommitLockCleanup(
      session,
      acceptedRunFailure('precommit-artifact-write'),
    );
  }
  let suffix: string;
  try {
    suffix = session.dependencies.suffix();
  } catch {
    return precommitLockCleanup(
      session,
      acceptedRunFailure('precommit-artifact-write'),
    );
  }
  if (!/^[0-9a-f]{32}$/u.test(suffix)) {
    return precommitLockCleanup(
      session,
      acceptedRunFailure('precommit-filesystem-admission'),
    );
  }
  const stagingPath = path.join(
    session.parentPath,
    `.${path.basename(session.destinationPath)}.staging-${suffix}`,
  );
  try {
    await rebindAcceptedLock(session);
  } catch (error) {
    const primary = projectAcceptedRunFailure(
      error,
      'precommit-filesystem-admission',
    );
    return precommitLockCleanup(session, primary);
  }
  try {
    await session.dependencies.mkdir(stagingPath, { mode: 0o700 });
  } catch {
    return precommitLockCleanup(
      session,
      acceptedRunFailure('precommit-artifact-write'),
    );
  }
  let stagingIdentity: PublicationStat;
  try {
    stagingIdentity = await session.dependencies.lstat(stagingPath, { bigint: true });
  } catch {
    throw acceptedRunFailure(
      'precommit-artifact-write',
      false,
      'owned-staging-cleanup-failure',
    );
  }
  if (
    !stagingIdentity.isDirectory() || stagingIdentity.isSymbolicLink() ||
    stagingIdentity.dev !== session.parentIdentity.dev
  ) {
    return precommitCleanup(
      session,
      stagingPath,
      stagingIdentity,
      acceptedRunFailure('precommit-filesystem-admission'),
    );
  }
  let stagingHandle: FileHandle | undefined;
  try {
    stagingHandle = await session.dependencies.open(
      stagingPath,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    await rebindAcceptedStaging(
      session,
      stagingPath,
      stagingIdentity,
      stagingHandle,
    );
  } catch (error) {
    if (stagingHandle !== undefined) await closeQuietly(stagingHandle);
    const primary = projectAcceptedRunFailure(
      error,
      'precommit-filesystem-admission',
    );
    return precommitCleanup(session, stagingPath, stagingIdentity, primary);
  }
  const admittedStagingHandle = stagingHandle;
  try {
    await writeArtifacts(session, stagingPath, artifacts);
    try {
      await admittedStagingHandle.sync();
    } catch {
      return failure('precommit-artifact-sync');
    }
    await readbackArtifacts(session, stagingPath, stagingIdentity, artifacts);
    await rebindAcceptedStaging(
      session,
      stagingPath,
      stagingIdentity,
      admittedStagingHandle,
    );
    try {
      await admittedStagingHandle.close();
    } catch {
      return failure('precommit-artifact-sync');
    }
    await rebindAcceptedLock(session);
    await destinationAbsent(
      session.dependencies,
      session.destinationPath,
      'precommit-destination-exists',
      'precommit-filesystem-admission',
    );
    try {
      await session.dependencies.rename(stagingPath, session.destinationPath);
    } catch {
      return failure('precommit-rename');
    }
    session.committed = true;
  } catch (error) {
    await closeQuietly(admittedStagingHandle);
    const primary = projectAcceptedRunFailure(error, 'precommit-unexpected');
    return precommitCleanup(session, stagingPath, stagingIdentity, primary);
  }
  try {
    await session.parentHandle.sync();
  } catch {
    const lockRemoved = await removeOwnedLock(session);
    throw acceptedRunFailure(
      'postcommit-parent-sync',
      true,
      lockRemoved ? null : 'owned-lock-cleanup-failure',
    );
  }
  if (!await removeOwnedLock(session)) {
    throw acceptedRunFailure('cleanup-owned-lock', true);
  }
}

/** Release only the owned lock after a prepublication failure. @internal */
export async function abortAcceptedPublication(
  session: AcceptedPublicationSession,
  primary: unknown,
): Promise<never> {
  const error = projectAcceptedRunFailure(primary, 'candidate-unexpected');
  if (!await removeOwnedLock(session)) {
    throw appendAcceptedCleanupFailure(error, 'owned-lock-cleanup-failure');
  }
  throw error;
}
