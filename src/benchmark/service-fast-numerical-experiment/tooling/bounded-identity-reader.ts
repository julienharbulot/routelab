import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export interface BoundedIdentityReadOptions {
  readonly repositoryRoot: string;
  readonly relativePath: string;
  readonly maximumBytes: number;
  readonly expectedBytes?: number;
}

export class ServiceFastBoundedIdentityReadError extends Error {
  readonly code:
    | 'bounded-file-admission-failure'
    | 'bounded-file-identity-mismatch'
    | 'bounded-file-symlink-forbidden';
  readonly artifact: string;

  constructor(
    code: ServiceFastBoundedIdentityReadError['code'],
    artifact: string,
    message: string,
  ) {
    super(message);
    this.code = code;
    this.artifact = artifact;
  }
}

function readFailure(
  code: ServiceFastBoundedIdentityReadError['code'],
  artifact: string,
  message: string,
): never {
  throw new ServiceFastBoundedIdentityReadError(code, artifact, message);
}

function requireCanonicalOptions(options: BoundedIdentityReadOptions): void {
  if (
    !path.isAbsolute(options.repositoryRoot) ||
    path.resolve(options.repositoryRoot) !== options.repositoryRoot ||
    options.relativePath.length === 0 ||
    options.relativePath.includes('\\') ||
    options.relativePath.includes('\0') ||
    path.posix.isAbsolute(options.relativePath) ||
    path.posix.normalize(options.relativePath) !== options.relativePath ||
    options.relativePath.split('/').some((segment) =>
      segment === '' || segment === '.' || segment === '..') ||
    !Number.isSafeInteger(options.maximumBytes) ||
    options.maximumBytes <= 0 ||
    (options.expectedBytes !== undefined &&
      (!Number.isSafeInteger(options.expectedBytes) ||
        options.expectedBytes < 0 ||
        options.expectedBytes > options.maximumBytes))
  ) {
    throw new TypeError('Bounded identity reads require canonical paths and safe byte bounds.');
  }
}

export async function readBoundedIdentityFile(
  options: BoundedIdentityReadOptions,
): Promise<Uint8Array> {
  requireCanonicalOptions(options);
  const absolutePath = path.join(options.repositoryRoot, options.relativePath);
  try {
    const rootReal = await realpath(options.repositoryRoot);
    if (rootReal !== options.repositoryRoot) {
      return readFailure(
        'bounded-file-admission-failure',
        options.relativePath,
        'Repository root is not its canonical real path.',
      );
    }
    let cursor = options.repositoryRoot;
    for (const segment of options.relativePath.split('/')) {
      cursor = path.join(cursor, segment);
      const component = await lstat(cursor, { bigint: true });
      if (component.isSymbolicLink()) {
        return readFailure(
          'bounded-file-symlink-forbidden',
          options.relativePath,
          'Bounded file path contains a symbolic link.',
        );
      }
    }
    const targetReal = await realpath(absolutePath);
    const before = await lstat(absolutePath, { bigint: true });
    if (
      targetReal !== path.join(rootReal, options.relativePath)
    ) {
      return readFailure(
        'bounded-file-symlink-forbidden',
        options.relativePath,
        'Bounded file target does not resolve to its canonical path.',
      );
    }
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.size < 0n ||
      before.size > BigInt(options.maximumBytes) ||
      (options.expectedBytes !== undefined &&
        before.size !== BigInt(options.expectedBytes))
    ) {
      return readFailure(
        'bounded-file-admission-failure',
        options.relativePath,
        'File identity or pre-allocation byte size is not admitted.',
      );
    }
    const bytes = Uint8Array.from(await readFile(absolutePath));
    const after = await lstat(absolutePath, { bigint: true });
    if (
      bytes.byteLength !== Number(before.size) ||
      bytes.byteLength > options.maximumBytes ||
      (options.expectedBytes !== undefined &&
        bytes.byteLength !== options.expectedBytes) ||
      !after.isFile() ||
      after.isSymbolicLink() ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size
    ) {
      return readFailure(
        'bounded-file-identity-mismatch',
        options.relativePath,
        'File identity changed during its bounded read.',
      );
    }
    return bytes;
  } catch (error) {
    if (error instanceof ServiceFastBoundedIdentityReadError) throw error;
    return readFailure(
      'bounded-file-admission-failure',
      options.relativePath,
      'Could not inspect the bounded file.',
    );
  }
}
