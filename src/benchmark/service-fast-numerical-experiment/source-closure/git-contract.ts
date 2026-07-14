const GIT_REVISION = /^[0-9a-f]{40}$/u;

export class SourceClosureGitError extends Error {
  readonly code: string;
  readonly artifact: string;
  readonly toolFailureFamily = 'repository';

  constructor(code: string, artifact: string, message: string) {
    super(message);
    this.code = code;
    this.artifact = artifact;
  }
}

export function sourceClosureGitFailure(
  code: string,
  artifact: string,
  message: string,
): never {
  throw new SourceClosureGitError(code, artifact, message);
}

export function requireSourceClosureRevision(revision: string): string {
  if (!GIT_REVISION.test(revision)) {
    throw new TypeError(
      'Revision must be exactly 40 lowercase hexadecimal characters.',
    );
  }
  return revision;
}

export function requireSourceClosurePath(relativePath: string): string {
  if (
    relativePath.length === 0 ||
    relativePath.startsWith('/') ||
    relativePath.includes('\\') ||
    relativePath.includes('\0') ||
    relativePath.split('/').some((segment) =>
      segment === '' || segment === '.' || segment === '..')
  ) {
    throw new TypeError(`Invalid canonical repository path: ${relativePath}.`);
  }
  return relativePath;
}
