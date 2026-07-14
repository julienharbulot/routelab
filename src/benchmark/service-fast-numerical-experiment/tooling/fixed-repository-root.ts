import { fileURLToPath } from 'node:url';
import path from 'node:path';

function normalizedRoot(moduleUrl: string, relativeRoot: string): string {
  return path.resolve(fileURLToPath(new URL(relativeRoot, moduleUrl)));
}

export function serviceFastVerifierRepositoryRoot(moduleUrl: string): string {
  return normalizedRoot(moduleUrl, '../');
}

export function serviceFastSourceClosureRepositoryRoot(moduleUrl: string): string {
  return normalizedRoot(moduleUrl, '../../../../');
}
