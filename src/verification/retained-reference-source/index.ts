export type RetainedReferenceSourceReadFile = (
  filePath: string,
) => Promise<Uint8Array>;

const RETAINED_REFERENCE_SOURCE_PATHS: Readonly<Record<string, string>> =
  Object.freeze({
    'src/router/numerical-exact-input-split/index.ts':
      'fixtures/m7/numerical-representative-profile/provenance/numerical-exact-input-split.index.source.ts',
    'cli/verify-historical-numerical-profile.ts':
      'fixtures/m7/numerical-representative-profile/provenance/verify-historical-numerical-profile.source.ts',
    'cli/verify-representative-numerical-profile.ts':
      'fixtures/m7/numerical-representative-profile/provenance/verify-representative-numerical-profile.source.ts',
  });

export function resolveRetainedReferenceSourcePath(filePath: string): string {
  return Object.hasOwn(RETAINED_REFERENCE_SOURCE_PATHS, filePath)
    ? RETAINED_REFERENCE_SOURCE_PATHS[filePath]!
    : filePath;
}

export function createRetainedReferenceSourceReader(
  readFile: RetainedReferenceSourceReadFile,
): RetainedReferenceSourceReadFile {
  return async (filePath: string): Promise<Uint8Array> => {
    const sourceReadFile = readFile;
    return sourceReadFile(resolveRetainedReferenceSourcePath(filePath));
  };
}
