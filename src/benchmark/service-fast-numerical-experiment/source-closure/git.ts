import { spawnSync } from 'node:child_process';
import path from 'node:path';

import {
  requireSourceClosurePath,
  requireSourceClosureRevision,
  sourceClosureGitFailure,
} from './git-contract.ts';

export {
  SourceClosureGitError,
  requireSourceClosurePath,
  requireSourceClosureRevision,
} from './git-contract.ts';

const GIT_REVISION = /^[0-9a-f]{40}$/u;
const GIT_OBJECT_ID = /^[0-9a-f]{40,64}$/u;
const MAX_GIT_METADATA_BYTES = 64 * 1024 * 1024;
const FIXED_GIT_EXECUTABLE = '/usr/bin/git';
const FIXED_GIT_ENVIRONMENT = Object.freeze({
  PATH: '/usr/bin:/bin',
  LC_ALL: 'C',
  GIT_ATTR_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_NO_REPLACE_OBJECTS: '1',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
});

export interface GitIndexEntry {
  readonly mode: string;
  readonly objectId: string;
  readonly stage: number;
  readonly path: string;
}

export interface GitNameStatusEntry {
  readonly status: 'A' | 'M' | 'D' | 'T';
  readonly path: string;
}

export interface GitTreeEntry {
  readonly mode: string;
  readonly type: 'blob' | 'commit';
  readonly objectId: string;
  readonly path: string;
}

export interface GitAncestryEntry {
  readonly revision: string;
  readonly parents: readonly string[];
}

function gitFailure(code: string, artifact: string, message: string): never {
  return sourceClosureGitFailure(code, artifact, message);
}

function decodeGitUtf8(output: Uint8Array, artifact: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(output);
  } catch {
    return gitFailure('invalid-git-utf8', artifact, 'Git metadata is not canonical UTF-8.');
  }
}

function requireGitMetadataPath(
  value: string,
  code: string,
  artifact: string,
): string {
  try {
    return requireSourceClosurePath(value);
  } catch {
    return gitFailure(code, artifact, 'Git returned a noncanonical repository path.');
  }
}

function requireRepositoryRoot(repositoryRoot: string): string {
  if (!path.isAbsolute(repositoryRoot) || path.resolve(repositoryRoot) !== repositoryRoot) {
    throw new TypeError('Repository root must be an absolute normalized path.');
  }
  return repositoryRoot;
}

function runGit(
  repositoryRoot: string,
  arguments_: readonly string[],
  maximumBytes = MAX_GIT_METADATA_BYTES,
  input?: Uint8Array,
  acceptedStatuses: readonly number[] = Object.freeze([0]),
): Buffer {
  requireRepositoryRoot(repositoryRoot);
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new TypeError('Git output bound must be a positive safe integer.');
  }
  if (
    acceptedStatuses.length === 0 ||
    acceptedStatuses.some((status) => !Number.isSafeInteger(status) || status < 0)
  ) {
    throw new TypeError('Git accepted statuses must be nonnegative safe integers.');
  }
  const result = spawnSync(
    FIXED_GIT_EXECUTABLE,
    Object.freeze([
      '--no-pager',
      '--no-replace-objects',
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.untrackedCache=false',
      '-c',
      'core.hooksPath=/dev/null',
      ...arguments_,
    ]),
    {
      cwd: repositoryRoot,
      encoding: 'buffer',
      env: FIXED_GIT_ENVIRONMENT,
      input,
      maxBuffer: maximumBytes,
      shell: false,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    },
  );
  if (result.error !== undefined) {
    return gitFailure(
      'git-command-failed',
      arguments_[0] ?? 'git',
      `Bounded read-only Git command failed: ${result.error.message}`,
    );
  }
  if (result.signal !== null || result.status === null || !acceptedStatuses.includes(result.status)) {
    const detail = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8').trim()
      : '';
    return gitFailure(
      'git-command-failed',
      arguments_[0] ?? 'git',
      `Bounded read-only Git command rejected${detail.length === 0 ? '' : `: ${detail}`}.`,
    );
  }
  if (!Buffer.isBuffer(result.stdout) || result.stdout.byteLength > maximumBytes) {
    return gitFailure(
      'git-output-cap-exceeded',
      arguments_[0] ?? 'git',
      'Bounded read-only Git output exceeded its admitted size.',
    );
  }
  return result.stdout;
}

export function readGitHeadRevision(repositoryRoot: string): string {
  const output = runGit(
    repositoryRoot,
    Object.freeze(['rev-parse', '--verify', 'HEAD^{commit}']),
    256,
  );
  const decoded = decodeGitUtf8(output, 'HEAD');
  if (!GIT_REVISION.test(decoded.slice(0, -1)) || decoded.length !== 41 || !decoded.endsWith('\n')) {
    return gitFailure('invalid-head-metadata', 'HEAD', 'Git returned malformed HEAD metadata.');
  }
  return decoded.slice(0, -1);
}

export function readGitCommitParents(
  repositoryRoot: string,
  revision: string,
): readonly string[] {
  requireSourceClosureRevision(revision);
  const output = runGit(
    repositoryRoot,
    Object.freeze(['rev-list', '--parents', '-n', '1', revision]),
    512,
  );
  const decoded = decodeGitUtf8(output, revision);
  if (!decoded.endsWith('\n') || decoded.slice(0, -1).includes('\n')) {
    return gitFailure('invalid-commit-metadata', revision, 'Git returned invalid commit metadata.');
  }
  const line = decoded.slice(0, -1);
  const members = line.split(' ');
  if (members[0] !== revision || members.some((member) => !GIT_REVISION.test(member))) {
    return gitFailure('invalid-commit-metadata', revision, 'Git returned invalid commit metadata.');
  }
  return Object.freeze(members.slice(1));
}

export function readGitAncestryEntries(
  repositoryRoot: string,
  ancestorRevision: string,
  descendantRevision: string,
): readonly GitAncestryEntry[] {
  requireSourceClosureRevision(ancestorRevision);
  requireSourceClosureRevision(descendantRevision);
  const output = decodeGitUtf8(runGit(
    repositoryRoot,
    Object.freeze([
      'rev-list',
      '--ancestry-path',
      '--parents',
      `${ancestorRevision}..${descendantRevision}`,
    ]),
  ), descendantRevision);
  if (output.length === 0) return Object.freeze([]);
  if (!output.endsWith('\n')) {
    return gitFailure('invalid-ancestry-metadata', descendantRevision, 'Git ancestry output lacked its line terminator.');
  }
  const entries: GitAncestryEntry[] = [];
  const seen = new Set<string>();
  for (const line of output.slice(0, -1).split('\n')) {
    const members = line.split(' ');
    if (
      members.length === 0 ||
      members.some((member) => !GIT_REVISION.test(member)) ||
      seen.has(members[0] ?? '')
    ) {
      return gitFailure('invalid-ancestry-metadata', descendantRevision, 'Git ancestry output was malformed.');
    }
    const revision = members[0];
    if (revision === undefined) {
      return gitFailure('invalid-ancestry-metadata', descendantRevision, 'Git ancestry output omitted a revision.');
    }
    seen.add(revision);
    entries.push(Object.freeze({
      revision,
      parents: Object.freeze(members.slice(1)),
    }));
  }
  return Object.freeze(entries);
}

export function readUniqueGitDirectChildOnAncestry(
  repositoryRoot: string,
  ancestorRevision: string,
  descendantRevision: string,
): string {
  const candidates = readGitAncestryEntries(
    repositoryRoot,
    ancestorRevision,
    descendantRevision,
  ).filter((entry) => entry.parents.includes(ancestorRevision));
  if (candidates.length === 0) {
    return gitFailure(
      'ancestry-child-missing',
      ancestorRevision,
      'No direct child of the implementation/input revision exists on current HEAD ancestry.',
    );
  }
  if (candidates.length !== 1) {
    return gitFailure(
      'ancestry-child-ambiguous',
      ancestorRevision,
      'Current HEAD ancestry contains multiple direct children of the implementation/input revision.',
    );
  }
  const child = candidates[0]?.revision;
  if (child === undefined) throw new Error('Unique Git child disappeared.');
  const parents = readGitCommitParents(repositoryRoot, child);
  if (parents.length !== 1 || parents[0] !== ancestorRevision) {
    return gitFailure(
      'ancestry-child-parent-mismatch',
      child,
      'The source-closure child must have exactly the implementation/input revision as its parent.',
    );
  }
  return child;
}

export function readGitStatusPorcelain(repositoryRoot: string): Buffer {
  return runGit(
    repositoryRoot,
    Object.freeze([
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--ignore-submodules=none',
    ]),
  );
}

export function readGitIndexEntries(repositoryRoot: string): readonly GitIndexEntry[] {
  const output = runGit(
    repositoryRoot,
    Object.freeze(['ls-files', '--stage', '-z']),
  );
  const records = decodeGitUtf8(output, 'index').split('\0');
  if (records.at(-1) !== '') {
    return gitFailure('invalid-index-metadata', 'index', 'Git index output lacked its NUL terminator.');
  }
  const entries: GitIndexEntry[] = [];
  for (const record of records.slice(0, -1)) {
    const match = /^(\d{6}) ([0-9a-f]{40,64}) ([0-3])\t([\s\S]+)$/u.exec(record);
    if (match === null) {
      return gitFailure('invalid-index-metadata', 'index', 'Git index output was malformed.');
    }
    const [, mode, objectId, stageText, relativePath] = match;
    if (
      mode === undefined ||
      objectId === undefined ||
      stageText === undefined ||
      relativePath === undefined ||
      !GIT_OBJECT_ID.test(objectId)
    ) {
      return gitFailure('invalid-index-metadata', 'index', 'Git index output was incomplete.');
    }
    const canonicalPath = requireGitMetadataPath(relativePath, 'invalid-index-metadata', 'index');
    entries.push(Object.freeze({
      mode,
      objectId,
      stage: Number(stageText),
      path: canonicalPath,
    }));
  }
  return Object.freeze(entries);
}

export function assertCleanTrackedRepository(
  repositoryRoot: string,
  expectedRevision: string,
): ReadonlyMap<string, GitIndexEntry> {
  requireSourceClosureRevision(expectedRevision);
  const head = readGitHeadRevision(repositoryRoot);
  if (head !== expectedRevision) {
    return gitFailure(
      'revision-mismatch',
      expectedRevision,
      `Expected repository HEAD ${expectedRevision}, received ${head}.`,
    );
  }
  if (readGitStatusPorcelain(repositoryRoot).byteLength !== 0) {
    return gitFailure(
      'repository-state-mismatch',
      repositoryRoot,
      'Source-closure work requires a clean index and worktree with no untracked nonignored paths.',
    );
  }
  const byPath = new Map<string, GitIndexEntry>();
  for (const entry of readGitIndexEntries(repositoryRoot)) {
    if (entry.stage !== 0) {
      return gitFailure('index-conflict', entry.path, 'Source-closure work rejects non-stage-zero entries.');
    }
    if (entry.mode === '160000') {
      return gitFailure('submodule-forbidden', entry.path, 'Source-closure work rejects Git links.');
    }
    if (byPath.has(entry.path)) {
      return gitFailure('duplicate-index-path', entry.path, 'Source-closure work rejects duplicate index paths.');
    }
    byPath.set(entry.path, entry);
  }
  return byPath;
}

export function readGitBlob(
  repositoryRoot: string,
  revision: string,
  relativePath: string,
  maximumBytes: number,
): Uint8Array {
  requireSourceClosureRevision(revision);
  requireSourceClosurePath(relativePath);
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 0 ||
    maximumBytes >= Number.MAX_SAFE_INTEGER
  ) {
    return gitFailure('invalid-git-blob-bound', relativePath, 'Git blob bound cannot be incremented safely.');
  }
  const output = runGit(
    repositoryRoot,
    Object.freeze(['show', `${revision}:${relativePath}`]),
    maximumBytes + 1,
  );
  if (output.byteLength > maximumBytes) {
    return gitFailure('git-blob-cap-exceeded', relativePath, 'Git blob exceeded its admitted size.');
  }
  return Uint8Array.from(output);
}

export function readGitTreeEntries(
  repositoryRoot: string,
  revision: string,
  rootPath: string,
): readonly GitTreeEntry[] {
  requireSourceClosureRevision(revision);
  requireSourceClosurePath(rootPath);
  const output = decodeGitUtf8(runGit(
    repositoryRoot,
    Object.freeze(['ls-tree', '-r', '-z', '--full-tree', revision, '--', rootPath]),
  ), rootPath);
  const records = output.split('\0');
  if (records.at(-1) !== '') {
    return gitFailure('invalid-tree-metadata', rootPath, 'Git tree output lacked its NUL terminator.');
  }
  const entries: GitTreeEntry[] = [];
  for (const record of records.slice(0, -1)) {
    const match = /^(\d{6}) (blob|commit) ([0-9a-f]{40,64})\t([\s\S]+)$/u.exec(record);
    if (match === null) {
      return gitFailure('invalid-tree-metadata', rootPath, 'Git tree output was malformed.');
    }
    const [, mode, type, objectId, relativePath] = match;
    if (
      mode === undefined ||
      (type !== 'blob' && type !== 'commit') ||
      objectId === undefined ||
      relativePath === undefined ||
      !GIT_OBJECT_ID.test(objectId)
    ) {
      return gitFailure('invalid-tree-metadata', rootPath, 'Git tree output was incomplete.');
    }
    const canonicalPath = requireGitMetadataPath(relativePath, 'invalid-tree-metadata', rootPath);
    if (canonicalPath !== rootPath && !canonicalPath.startsWith(`${rootPath}/`)) {
      return gitFailure('tree-root-escape', canonicalPath, 'Git tree metadata escaped its requested root.');
    }
    entries.push(Object.freeze({
      mode,
      type,
      objectId,
      path: canonicalPath,
    }));
  }
  return Object.freeze(entries);
}

export function readGitFullTreeEntries(
  repositoryRoot: string,
  revision: string,
): readonly GitTreeEntry[] {
  requireSourceClosureRevision(revision);
  const output = decodeGitUtf8(runGit(
    repositoryRoot,
    Object.freeze(['ls-tree', '-r', '-z', '--full-tree', revision]),
  ), revision);
  const records = output.split('\0');
  if (records.at(-1) !== '') {
    return gitFailure('invalid-tree-metadata', revision, 'Git tree output lacked its NUL terminator.');
  }
  const entries: GitTreeEntry[] = [];
  for (const record of records.slice(0, -1)) {
    const match = /^(\d{6}) (blob|commit) ([0-9a-f]{40,64})\t([\s\S]+)$/u.exec(record);
    if (match === null) {
      return gitFailure('invalid-tree-metadata', revision, 'Git tree output was malformed.');
    }
    const [, mode, type, objectId, relativePath] = match;
    if (
      mode === undefined ||
      (type !== 'blob' && type !== 'commit') ||
      objectId === undefined ||
      relativePath === undefined ||
      !GIT_OBJECT_ID.test(objectId)
    ) {
      return gitFailure('invalid-tree-metadata', revision, 'Git tree output was incomplete.');
    }
    entries.push(Object.freeze({
      mode,
      type,
      objectId,
      path: requireGitMetadataPath(relativePath, 'invalid-tree-metadata', revision),
    }));
  }
  return Object.freeze(entries);
}

export function readGitNameStatusDiff(
  repositoryRoot: string,
  parentRevision: string,
  childRevision: string,
): readonly GitNameStatusEntry[] {
  requireSourceClosureRevision(parentRevision);
  requireSourceClosureRevision(childRevision);
  const output = decodeGitUtf8(runGit(
    repositoryRoot,
    Object.freeze([
      'diff-tree',
      '--no-commit-id',
      '--name-status',
      '--no-renames',
      '-r',
      '-z',
      parentRevision,
      childRevision,
    ]),
  ), childRevision);
  const members = output.split('\0');
  if (members.at(-1) !== '') {
    return gitFailure('invalid-diff-metadata', childRevision, 'Git diff output lacked its NUL terminator.');
  }
  const entries: GitNameStatusEntry[] = [];
  for (let index = 0; index < members.length - 1; index += 2) {
    const status = members[index];
    const relativePath = members[index + 1];
    if (
      (status !== 'A' && status !== 'M' && status !== 'D' && status !== 'T') ||
      relativePath === undefined
    ) {
      return gitFailure('invalid-diff-metadata', childRevision, 'Git diff output was malformed.');
    }
    entries.push(Object.freeze({
      status,
      path: requireGitMetadataPath(relativePath, 'invalid-diff-metadata', childRevision),
    }));
  }
  return Object.freeze(entries);
}

export function readGitIgnoredPaths(
  repositoryRoot: string,
  relativePaths: readonly string[],
): ReadonlySet<string> {
  if (relativePaths.length > 128) {
    throw new TypeError('Runtime ignored-path checks are capped at 128 paths.');
  }
  requireRepositoryRoot(repositoryRoot);
  if (relativePaths.length === 0) return new Set<string>();
  const canonical = relativePaths.map(requireSourceClosurePath);
  if (new Set(canonical).size !== canonical.length) {
    throw new TypeError('Runtime ignored-path checks require unique paths.');
  }
  const input = Buffer.from(`${canonical.join('\0')}\0`, 'utf8');
  const output = runGit(
    repositoryRoot,
    Object.freeze(['check-ignore', '--no-index', '-z', '--stdin']),
    MAX_GIT_METADATA_BYTES,
    input,
    Object.freeze([0, 1]),
  );
  const members = decodeGitUtf8(output, 'check-ignore').split('\0');
  if (members.at(-1) !== '') {
    return gitFailure('invalid-ignore-metadata', 'check-ignore', 'Ignored-path output lacked its NUL terminator.');
  }
  const ignored = new Set<string>();
  const requested = new Set(canonical);
  for (const member of members.slice(0, -1)) {
    const ignoredPath = requireGitMetadataPath(member, 'invalid-ignore-metadata', 'check-ignore');
    if (!requested.has(ignoredPath) || ignored.has(ignoredPath)) {
      return gitFailure('invalid-ignore-metadata', ignoredPath, 'Ignored-path output was not an exact unique query subset.');
    }
    ignored.add(ignoredPath);
  }
  return ignored;
}
