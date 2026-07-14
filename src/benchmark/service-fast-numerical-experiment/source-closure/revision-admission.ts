import {
  descriptorsEqual,
  sha256Bytes,
  type FrozenServiceFastConfiguration,
  type ServiceFastSourceClosure,
  type SourceClosureDescriptor,
} from './codec.ts';
import { sourceClosureFailure } from './error.ts';
import {
  readGitBlob,
  readGitHeadRevision,
  readGitNameStatusDiff,
  readGitTreeEntries,
  readUniqueGitDirectChildOnAncestry,
  requireSourceClosurePath,
  type GitTreeEntry,
} from './git.ts';

function compareRawUtf16(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireRegularTreeEntry(entry: GitTreeEntry): void {
  if (
    entry.type !== 'blob' ||
    (entry.mode !== '100644' && entry.mode !== '100755')
  ) {
    sourceClosureFailure(
      'nonregular-revision-source',
      entry.path,
      `Revision source ${entry.path} is not a regular file.`,
    );
  }
}

export function treeEntriesForRoot(
  repositoryRoot: string,
  revision: string,
  rootPath: string,
): readonly GitTreeEntry[] {
  const entries = readGitTreeEntries(repositoryRoot, revision, rootPath);
  for (const entry of entries) {
    if (!entry.path.startsWith(`${rootPath}/`)) {
      return sourceClosureFailure(
        'implementation-root-mismatch',
        entry.path,
        `Revision source escaped implementation root ${rootPath}.`,
      );
    }
    requireRegularTreeEntry(entry);
  }
  return Object.freeze(
    [...entries].sort((left, right) => compareRawUtf16(left.path, right.path)),
  );
}

export function treeEntryForFile(
  repositoryRoot: string,
  revision: string,
  relativePath: string,
): GitTreeEntry {
  const entries = readGitTreeEntries(repositoryRoot, revision, relativePath);
  if (entries.length !== 1 || entries[0]?.path !== relativePath) {
    return sourceClosureFailure(
      'required-source-missing',
      relativePath,
      `Required revision source ${relativePath} is missing.`,
    );
  }
  const entry = entries[0];
  if (entry === undefined) throw new Error('Required tree entry disappeared.');
  requireRegularTreeEntry(entry);
  return entry;
}

export function sourcePathOrder(
  repositoryRoot: string,
  revision: string,
  config: FrozenServiceFastConfiguration,
): readonly string[] {
  const section = config.artifacts.sourceClosure;
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const rootPath of section.implementationRoots) {
    requireSourceClosurePath(rootPath);
    for (const entry of treeEntriesForRoot(repositoryRoot, revision, rootPath)) {
      if (!seen.has(entry.path)) {
        seen.add(entry.path);
        paths.push(entry.path);
      }
    }
  }
  for (const requiredFile of section.requiredFiles) {
    requireSourceClosurePath(requiredFile);
    treeEntryForFile(repositoryRoot, revision, requiredFile);
    if (!seen.has(requiredFile)) {
      seen.add(requiredFile);
      paths.push(requiredFile);
    }
  }
  if (paths.length > section.maxSourceEntries) {
    return sourceClosureFailure(
      'source-entry-cap-exceeded',
      section.path,
      'Revision source enumeration exceeds the frozen cap.',
    );
  }
  return Object.freeze(paths);
}

export function rolesForPath(
  relativePath: string,
  config: FrozenServiceFastConfiguration,
): readonly string[] {
  const section = config.artifacts.sourceClosure;
  const owned = new Set<string>();
  for (const rootPath of section.implementationRoots) {
    if (relativePath.startsWith(`${rootPath}/`)) {
      for (const role of section.sourceRoleAssignments.implementationRoots[rootPath] ?? []) {
        owned.add(role);
      }
    }
  }
  for (const role of section.sourceRoleAssignments.requiredFiles[relativePath] ?? []) {
    owned.add(role);
  }
  const roles = section.requiredRoles.filter((role) => owned.has(role));
  if (roles.length === 0) {
    return sourceClosureFailure(
      'source-role-missing',
      relativePath,
      `Revision source ${relativePath} has no frozen role.`,
    );
  }
  return Object.freeze(roles);
}

export function verifyDescriptorAtRevision(
  repositoryRoot: string,
  revision: string,
  descriptor: SourceClosureDescriptor,
): void {
  const bytes = readGitBlob(
    repositoryRoot,
    revision,
    descriptor.path,
    descriptor.bytes,
  );
  if (
    bytes.byteLength !== descriptor.bytes ||
    sha256Bytes(bytes) !== descriptor.sha256
  ) {
    sourceClosureFailure(
      'revision-descriptor-mismatch',
      descriptor.path,
      `Revision blob ${descriptor.path} does not match its descriptor.`,
    );
  }
}

export function verifyFrozenAuthoritiesAtRevision(
  repositoryRoot: string,
  revision: string,
  config: FrozenServiceFastConfiguration,
): void {
  for (const authority of Object.values(config.authorityBindings)) {
    verifyDescriptorAtRevision(repositoryRoot, revision, authority);
  }
  verifyDescriptorAtRevision(repositoryRoot, revision, config.artifactSchema);
}

export function verifyFrozenProtectedSourcesAtRevision(
  repositoryRoot: string,
  revision: string,
  config: FrozenServiceFastConfiguration,
): void {
  for (const descriptor of Object.values(config.protectedRuntimeSources)) {
    verifyDescriptorAtRevision(repositoryRoot, revision, descriptor);
  }
}

function expectedRevisionEntries(
  repositoryRoot: string,
  revision: string,
  config: FrozenServiceFastConfiguration,
): readonly { readonly path: string; readonly roles: readonly string[] }[] {
  return Object.freeze(
    sourcePathOrder(repositoryRoot, revision, config).map((relativePath) =>
      Object.freeze({
        path: relativePath,
        roles: rolesForPath(relativePath, config),
      })),
  );
}

export function compareClosureToRevision(
  repositoryRoot: string,
  closure: ServiceFastSourceClosure,
  config: FrozenServiceFastConfiguration,
): void {
  const revision = closure.implementationInputRevision;
  verifyDescriptorAtRevision(repositoryRoot, revision, closure.config);
  verifyDescriptorAtRevision(repositoryRoot, revision, closure.artifactSchema);
  verifyDescriptorAtRevision(repositoryRoot, revision, closure.inputArtifact);
  verifyFrozenAuthoritiesAtRevision(repositoryRoot, revision, config);
  verifyFrozenProtectedSourcesAtRevision(repositoryRoot, revision, config);
  const expected = expectedRevisionEntries(repositoryRoot, revision, config);
  if (closure.sources.length !== expected.length) {
    return sourceClosureFailure(
      'source-order-mismatch',
      config.artifacts.sourceClosure.path,
      'Source closure does not enumerate the exact revision sources.',
    );
  }
  for (const [index, expectedEntry] of expected.entries()) {
    const actual = closure.sources[index];
    if (
      actual === undefined ||
      actual.path !== expectedEntry.path ||
      actual.roles.length !== expectedEntry.roles.length ||
      actual.roles.some((role, roleIndex) =>
        role !== expectedEntry.roles[roleIndex])
    ) {
      return sourceClosureFailure(
        'source-order-or-role-mismatch',
        actual?.path ?? String(index),
        'Source path or role order differs from the frozen revision derivation.',
      );
    }
    verifyDescriptorAtRevision(repositoryRoot, revision, actual);
  }
  if (
    closure.protectedSources.length !==
      config.artifacts.sourceClosure.protectedPaths.length
  ) {
    return sourceClosureFailure(
      'protected-source-order-mismatch',
      config.artifacts.sourceClosure.path,
      'Protected source count is invalid.',
    );
  }
  const frozenProtected = Object.values(config.protectedRuntimeSources);
  for (const [index, protectedPath] of
    config.artifacts.sourceClosure.protectedPaths.entries()) {
    const actual = closure.protectedSources[index];
    const expectedDescriptor = frozenProtected[index];
    if (
      actual === undefined ||
      expectedDescriptor === undefined ||
      actual.path !== protectedPath ||
      !descriptorsEqual(actual, expectedDescriptor)
    ) {
      return sourceClosureFailure(
        'protected-source-order-mismatch',
        actual?.path ?? String(index),
        'Protected sources are not in frozen config order.',
      );
    }
    verifyDescriptorAtRevision(repositoryRoot, revision, expectedDescriptor);
  }
}

export function verifyCommittedClosureChild(
  repositoryRoot: string,
  closureBytes: Uint8Array,
  closure: ServiceFastSourceClosure,
  config: FrozenServiceFastConfiguration,
): string {
  const head = readGitHeadRevision(repositoryRoot);
  const child = readUniqueGitDirectChildOnAncestry(
    repositoryRoot,
    closure.implementationInputRevision,
    head,
  );
  const closurePath = config.artifacts.sourceClosure.path;
  const diff = readGitNameStatusDiff(
    repositoryRoot,
    closure.implementationInputRevision,
    child,
  );
  if (
    diff.length !== 1 ||
    diff[0]?.path !== closurePath ||
    diff[0]?.status !== 'A'
  ) {
    return sourceClosureFailure(
      'closure-child-diff-mismatch',
      child,
      'The historical source-closure child must contain only the exact added source-closure file.',
    );
  }
  const treeEntries = readGitTreeEntries(repositoryRoot, child, closurePath);
  const treeEntry = treeEntries[0];
  if (
    treeEntries.length !== 1 ||
    treeEntry?.path !== closurePath ||
    treeEntry.type !== 'blob' ||
    (treeEntry.mode !== '100644' && treeEntry.mode !== '100755')
  ) {
    return sourceClosureFailure(
      'closure-child-tree-entry-mismatch',
      closurePath,
      'The historical source-closure child must contain one regular source-closure blob.',
    );
  }
  const committedBytes = readGitBlob(
    repositoryRoot,
    child,
    closurePath,
    closureBytes.byteLength,
  );
  if (
    committedBytes.byteLength !== closureBytes.byteLength ||
    sha256Bytes(committedBytes) !== sha256Bytes(closureBytes)
  ) {
    return sourceClosureFailure(
      'closure-child-byte-mismatch',
      closurePath,
      'Historical source-closure child bytes differ from the verified closure.',
    );
  }
  return child;
}
