import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  SERVICE_FAST_MAXIMUM_DIRECTORY_BYTES,
  SERVICE_FAST_RETAINED_DIRECTORY,
  serviceFastRetainedFileContracts,
} from '../contract.ts';
import type { ArtifactDescriptor } from '../types.ts';

const READ_CHUNK_BYTES = 64 * 1024;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

export class BoundedFileError extends Error {
  readonly code: 'shape' | 'cap' | 'identity';

  constructor(code: 'shape' | 'cap' | 'identity') {
    super(code);
    this.code = code;
  }
}

function canonicalRoot(repositoryRoot: string): string {
  if (!path.isAbsolute(repositoryRoot) || path.resolve(repositoryRoot) !== repositoryRoot) {
    throw new BoundedFileError('identity');
  }
  return repositoryRoot;
}

function canonicalRelativePath(relativePath: string): string {
  if (
    relativePath.length === 0 ||
    relativePath.includes('\\') ||
    relativePath.includes('\0') ||
    path.posix.isAbsolute(relativePath) ||
    path.posix.normalize(relativePath) !== relativePath ||
    relativePath.split('/').some((segment) =>
      segment.length === 0 || segment === '.' || segment === '..')
  ) {
    throw new BoundedFileError('identity');
  }
  return relativePath;
}

function boundedMaximum(maximumBytes: number): number {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new BoundedFileError('cap');
  }
  return maximumBytes;
}

async function requireCanonicalParents(
  repositoryRoot: string,
  relativePath: string,
): Promise<void> {
  const rootReal = await realpath(repositoryRoot);
  if (rootReal !== repositoryRoot) throw new BoundedFileError('identity');
  const segments = relativePath.split('/');
  let cursor = repositoryRoot;
  for (const segment of segments.slice(0, -1)) {
    cursor = path.join(cursor, segment);
    const statistics = await lstat(cursor);
    if (!statistics.isDirectory() || statistics.isSymbolicLink()) {
      throw new BoundedFileError('identity');
    }
  }
}

function descriptorsEqual(
  left: ArtifactDescriptor,
  right: ArtifactDescriptor,
): boolean {
  return left.path === right.path &&
    left.bytes === right.bytes &&
    left.sha256 === right.sha256;
}

export type BoundedChunkVisitor = (
  chunk: Uint8Array,
) => void | Promise<void>;

export async function scanBoundedRegularFile(
  repositoryRoot: string,
  relativePathValue: string,
  maximumBytesValue: number,
  visitor?: BoundedChunkVisitor,
  expected?: ArtifactDescriptor,
): Promise<ArtifactDescriptor> {
  const root = canonicalRoot(repositoryRoot);
  const relativePath = canonicalRelativePath(relativePathValue);
  const maximumBytes = boundedMaximum(maximumBytesValue);
  if (expected !== undefined) {
    if (
      expected.path !== relativePath ||
      !Number.isSafeInteger(expected.bytes) ||
      expected.bytes <= 0 ||
      expected.bytes > maximumBytes ||
      !SHA256.test(expected.sha256)
    ) {
      throw new BoundedFileError('identity');
    }
  }
  await requireCanonicalParents(root, relativePath);
  const absolutePath = path.join(root, relativePath);
  const handle = await open(
    absolutePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const [handleStatistics, pathStatistics] = await Promise.all([
      handle.stat(),
      lstat(absolutePath),
    ]);
    if (
      !handleStatistics.isFile() ||
      !pathStatistics.isFile() ||
      pathStatistics.isSymbolicLink() ||
      handleStatistics.dev !== pathStatistics.dev ||
      handleStatistics.ino !== pathStatistics.ino ||
      handleStatistics.size !== pathStatistics.size ||
      !Number.isSafeInteger(handleStatistics.size) ||
      handleStatistics.size <= 0
    ) {
      throw new BoundedFileError('shape');
    }
    if (handleStatistics.size > maximumBytes) throw new BoundedFileError('cap');

    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    let position = 0;
    while (position < handleStatistics.size) {
      const requested = Math.min(buffer.byteLength, handleStatistics.size - position);
      const result = await handle.read(buffer, 0, requested, position);
      if (result.bytesRead <= 0 || result.bytesRead > requested) {
        throw new BoundedFileError('shape');
      }
      const chunk = Uint8Array.from(buffer.subarray(0, result.bytesRead));
      hash.update(chunk);
      if (visitor !== undefined) await visitor(chunk);
      position += result.bytesRead;
    }
    const finalStatistics = await handle.stat();
    if (
      finalStatistics.dev !== handleStatistics.dev ||
      finalStatistics.ino !== handleStatistics.ino ||
      finalStatistics.size !== handleStatistics.size
    ) {
      throw new BoundedFileError('identity');
    }
    const descriptor = Object.freeze({
      path: relativePath,
      bytes: position,
      sha256: `sha256:${hash.digest('hex')}`,
    });
    if (expected !== undefined && !descriptorsEqual(descriptor, expected)) {
      throw new BoundedFileError('identity');
    }
    return descriptor;
  } finally {
    await handle.close();
  }
}

export async function readBoundedRegularFile(
  repositoryRoot: string,
  relativePath: string,
  maximumBytes: number,
  expected?: ArtifactDescriptor,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  await scanBoundedRegularFile(
    repositoryRoot,
    relativePath,
    maximumBytes,
    (chunk) => {
      chunks.push(chunk);
      total += chunk.byteLength;
    },
    expected,
  );
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function admitRetainedArtifactFiles(
  repositoryRoot: string,
): Promise<ReadonlyMap<string, ArtifactDescriptor>> {
  const expectedNames = serviceFastRetainedFileContracts().map(({ name }) => name);
  const descriptors = new Map<string, ArtifactDescriptor>();
  let directoryBytes = 0;
  for (const contract of serviceFastRetainedFileContracts()) {
    const relativePath = `${SERVICE_FAST_RETAINED_DIRECTORY}/${contract.name}`;
    const descriptor = await scanBoundedRegularFile(
      repositoryRoot,
      relativePath,
      contract.maxBytes,
    );
    directoryBytes += descriptor.bytes;
    if (!Number.isSafeInteger(directoryBytes) ||
      directoryBytes > SERVICE_FAST_MAXIMUM_DIRECTORY_BYTES) {
      throw new BoundedFileError('cap');
    }
    descriptors.set(contract.name, descriptor);
  }
  const directory = await opendir(
    path.join(canonicalRoot(repositoryRoot), SERVICE_FAST_RETAINED_DIRECTORY),
  );
  const actualNames: string[] = [];
  for await (const entry of directory) {
    if (
      actualNames.length >= expectedNames.length ||
      !entry.isFile() ||
      entry.isSymbolicLink()
    ) {
      throw new BoundedFileError('shape');
    }
    actualNames.push(entry.name);
  }
  actualNames.sort();
  const sortedExpectedNames = [...expectedNames].sort();
  if (
    actualNames.length !== sortedExpectedNames.length ||
    actualNames.some((name, index) => name !== sortedExpectedNames[index])
  ) {
    throw new BoundedFileError('shape');
  }
  return descriptors;
}
