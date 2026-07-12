import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type CheckSource = 'index' | 'head';

export interface SizeBudget {
  name: string;
  paths: string[];
  maxBytes: number;
}

export interface PublicSurfacePolicy {
  forbiddenTrackedPatterns: string[];
  allowedForbiddenPathExceptions: string[];
  allowedTopLevelFiles: string[];
  allowedTrackedRoots: string[];
  allowedTrackedPaths: string[];
  allowedPublicAgentPaths: string[];
  requiredTrackedPaths: string[];
  secretMarkerPatterns: string[];
  secretScanExclusions: string[];
  engineeringLogDirectory: string;
  engineeringLogIndex: string;
  engineeringLogRequiredFields: string[];
  processSizeBudgets: SizeBudget[];
  processSizeAllowlist: string[];
}

export interface SnapshotFile {
  objectId: string;
  content: Buffer;
}

export interface GitSnapshot {
  label: string;
  files: Map<string, SnapshotFile>;
}

function escapeRegexCharacter(character: string): string {
  return /[\\^$.*+?()[\]{}|]/u.test(character) ? `\\${character}` : character;
}

export function globToRegExp(pattern: string): RegExp {
  let expression = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern.charAt(index);
    if (character === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        expression += '(?:.*/)?';
        index += 2;
      } else {
        expression += '.*';
        index += 1;
      }
    } else if (character === '*') {
      expression += '[^/]*';
    } else if (character === '?') {
      expression += '[^/]';
    } else {
      expression += escapeRegexCharacter(character);
    }
  }
  return new RegExp(`${expression}$`, 'u');
}

export function matchesAnyPattern(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(filePath));
}

export function containsSecretMarker(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => new RegExp(pattern, 'u').test(text));
}

function gitText(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function gitBuffer(root: string, args: string[]): Buffer {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: 32 * 1024 * 1024,
  });
}

function parseNullRecords(output: Buffer): string[] {
  return output.toString('utf8').split('\0').filter((record) => record !== '');
}

function readBlob(root: string, objectId: string, cache: Map<string, Buffer>): Buffer {
  const cached = cache.get(objectId);
  if (cached !== undefined) return cached;
  const content = gitBuffer(root, ['cat-file', 'blob', objectId]);
  cache.set(objectId, content);
  return content;
}

function loadIndexSnapshot(root: string, cache: Map<string, Buffer>): GitSnapshot {
  const output = gitBuffer(root, [
    'ls-files',
    '-z',
    '--format=%(objectmode)%x09%(objectname)%x09%(stage)%x09%(path)',
  ]);
  const files = new Map<string, SnapshotFile>();
  for (const record of parseNullRecords(output)) {
    const [mode = '', objectId = '', stage = '', ...pathParts] = record.split('\t');
    const filePath = pathParts.join('\t');
    if (stage !== '0') throw new Error(`${filePath}: unmerged index entry at stage ${stage}`);
    const content = mode === '160000' ? Buffer.alloc(0) : readBlob(root, objectId, cache);
    files.set(filePath, { objectId, content });
  }
  return { label: 'index', files };
}

function loadTreeSnapshot(root: string, ref: string, cache: Map<string, Buffer>): GitSnapshot {
  const output = gitBuffer(root, ['ls-tree', '-r', '-z', '--full-tree', ref]);
  const files = new Map<string, SnapshotFile>();
  for (const record of parseNullRecords(output)) {
    const tab = record.indexOf('\t');
    const metadata = record.slice(0, tab).split(' ');
    const filePath = record.slice(tab + 1);
    const objectType = metadata[1] ?? '';
    const objectId = metadata[2] ?? '';
    const content = objectType === 'blob' ? readBlob(root, objectId, cache) : Buffer.alloc(0);
    files.set(filePath, { objectId, content });
  }
  return { label: ref, files };
}

export function loadSnapshot(root: string, source: CheckSource): GitSnapshot {
  const cache = new Map<string, Buffer>();
  return source === 'index' ? loadIndexSnapshot(root, cache) : loadTreeSnapshot(root, 'HEAD', cache);
}

export function findTrackedPathViolations(
  trackedFiles: string[],
  policy: Pick<
    PublicSurfacePolicy,
    | 'forbiddenTrackedPatterns'
    | 'allowedForbiddenPathExceptions'
    | 'allowedTopLevelFiles'
    | 'allowedTrackedRoots'
    | 'allowedTrackedPaths'
    | 'allowedPublicAgentPaths'
  >,
): string[] {
  const errors: string[] = [];
  for (const filePath of trackedFiles) {
    const isException = policy.allowedForbiddenPathExceptions.includes(filePath);
    const forbiddenPattern = policy.forbiddenTrackedPatterns.find((pattern) =>
      globToRegExp(pattern).test(filePath),
    );
    if (forbiddenPattern !== undefined && !isException) {
      errors.push(`${filePath}: tracked path is forbidden by ${forbiddenPattern}`);
    }
    const slash = filePath.indexOf('/');
    if (slash === -1) {
      if (!policy.allowedTopLevelFiles.includes(filePath)) {
        errors.push(`${filePath}: top-level file is not in allowedTopLevelFiles`);
      }
    } else {
      const root = `${filePath.slice(0, slash)}/`;
      const explicitlyAllowed = matchesAnyPattern(filePath, policy.allowedTrackedPaths);
      if (!policy.allowedTrackedRoots.includes(root) && !explicitlyAllowed) {
        errors.push(`${filePath}: tracked root ${root} is not allowed and path is not in allowedTrackedPaths`);
      }
    }
    if (filePath.startsWith('.codex/') && !policy.allowedPublicAgentPaths.includes(filePath)) {
      errors.push(`${filePath}: .codex path is not in allowedPublicAgentPaths`);
    }
  }
  return errors;
}

type PolicyRecord = Record<string, unknown>;

function requireStringArray(raw: PolicyRecord, field: keyof PublicSurfacePolicy, label: string): string[] {
  const value = raw[field];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error(`${label}: config/public-surface.json field ${field} must be an array of strings`);
  }
  return value;
}

function requireString(raw: PolicyRecord, field: keyof PublicSurfacePolicy, label: string): string {
  const value = raw[field];
  if (typeof value !== 'string') {
    throw new Error(`${label}: config/public-surface.json field ${field} must be a string`);
  }
  return value;
}

function requireSizeBudgets(raw: PolicyRecord, label: string): SizeBudget[] {
  const value = raw['processSizeBudgets'];
  if (!Array.isArray(value) || !value.every((entry) => {
    if (typeof entry !== 'object' || entry === null) return false;
    const budget = entry as Record<string, unknown>;
    return typeof budget['name'] === 'string'
      && Array.isArray(budget['paths'])
      && budget['paths'].every((item) => typeof item === 'string')
      && typeof budget['maxBytes'] === 'number'
      && Number.isSafeInteger(budget['maxBytes'])
      && budget['maxBytes'] >= 0;
  })) {
    throw new Error(`${label}: config/public-surface.json field processSizeBudgets must contain valid size budgets`);
  }
  return value as SizeBudget[];
}

function strictVersionTwoPolicy(raw: PolicyRecord, label: string): PublicSurfacePolicy {
  return {
    forbiddenTrackedPatterns: requireStringArray(raw, 'forbiddenTrackedPatterns', label),
    allowedForbiddenPathExceptions: requireStringArray(raw, 'allowedForbiddenPathExceptions', label),
    allowedTopLevelFiles: requireStringArray(raw, 'allowedTopLevelFiles', label),
    allowedTrackedRoots: requireStringArray(raw, 'allowedTrackedRoots', label),
    allowedTrackedPaths: [],
    allowedPublicAgentPaths: requireStringArray(raw, 'allowedPublicAgentPaths', label),
    requiredTrackedPaths: requireStringArray(raw, 'requiredTrackedPaths', label),
    secretMarkerPatterns: requireStringArray(raw, 'secretMarkerPatterns', label),
    secretScanExclusions: requireStringArray(raw, 'secretScanExclusions', label),
    engineeringLogDirectory: requireString(raw, 'engineeringLogDirectory', label),
    engineeringLogIndex: requireString(raw, 'engineeringLogIndex', label),
    engineeringLogRequiredFields: requireStringArray(raw, 'engineeringLogRequiredFields', label),
    processSizeBudgets: requireSizeBudgets(raw, label),
    processSizeAllowlist: requireStringArray(raw, 'processSizeAllowlist', label),
  };
}

function legacyVersionOnePolicy(raw: PolicyRecord, snapshot: GitSnapshot): PublicSurfacePolicy {
  const label = snapshot.label;
  const paths = [...snapshot.files.keys()];
  const inferredTopLevel = paths.filter((filePath) => !filePath.includes('/'));
  const inferredRoots = [...new Set(
    paths
      .filter((filePath) => filePath.includes('/'))
      .map((filePath) => `${filePath.slice(0, filePath.indexOf('/'))}/`),
  )];
  return {
    forbiddenTrackedPatterns: requireStringArray(raw, 'forbiddenTrackedPatterns', label),
    allowedForbiddenPathExceptions: [],
    allowedTopLevelFiles: inferredTopLevel,
    allowedTrackedRoots: inferredRoots,
    allowedTrackedPaths: [],
    allowedPublicAgentPaths: requireStringArray(raw, 'allowedPublicAgentPaths', label),
    requiredTrackedPaths: [],
    secretMarkerPatterns: requireStringArray(raw, 'secretMarkerPatterns', label),
    secretScanExclusions: requireStringArray(raw, 'secretScanExclusions', label),
    engineeringLogDirectory: requireString(raw, 'engineeringLogDirectory', label),
    engineeringLogIndex: requireString(raw, 'engineeringLogIndex', label),
    engineeringLogRequiredFields: requireStringArray(raw, 'engineeringLogRequiredFields', label),
    processSizeBudgets: requireSizeBudgets(raw, label),
    processSizeAllowlist: requireStringArray(raw, 'processSizeAllowlist', label),
  };
}

function policyFromSnapshot(snapshot: GitSnapshot): PublicSurfacePolicy {
  const policyFile = snapshot.files.get('config/public-surface.json');
  if (policyFile === undefined) throw new Error(`${snapshot.label}: config/public-surface.json is missing`);
  const parsed: unknown = JSON.parse(policyFile.content.toString('utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${snapshot.label}: config/public-surface.json must contain a JSON object`);
  }
  const raw = parsed as PolicyRecord;
  if (raw['schemaVersion'] === 1) return legacyVersionOnePolicy(raw, snapshot);
  if (raw['schemaVersion'] === 2) return strictVersionTwoPolicy(raw, snapshot.label);
  if (raw['schemaVersion'] === 3) {
    return {
      ...strictVersionTwoPolicy(raw, snapshot.label),
      allowedTrackedPaths: requireStringArray(raw, 'allowedTrackedPaths', snapshot.label),
    };
  }
  throw new Error(`${snapshot.label}: config/public-surface.json has unsupported or missing schemaVersion`);
}

export function findMissingRequiredPaths(
  files: string[],
  policy: Pick<PublicSurfacePolicy, 'requiredTrackedPaths' | 'processSizeBudgets'>,
): string[] {
  const tracked = new Set(files);
  const required = new Set([
    ...policy.requiredTrackedPaths,
    ...policy.processSizeBudgets.flatMap((budget) => budget.paths),
  ]);
  return [...required]
    .filter((filePath) => !tracked.has(filePath))
    .map((filePath) => `${filePath}: required tracked path is missing`);
}

function verifySecretMarkers(snapshot: GitSnapshot, policy: PublicSurfacePolicy): string[] {
  const errors: string[] = [];
  for (const [filePath, file] of snapshot.files) {
    if (matchesAnyPattern(filePath, policy.secretScanExclusions) || file.content.includes(0)) continue;
    if (containsSecretMarker(file.content.toString('utf8'), policy.secretMarkerPatterns)) {
      errors.push(`${filePath}: contains an obvious secret marker; remove it and rotate any real credential`);
    }
  }
  return errors;
}

function verifySizeBudgets(snapshot: GitSnapshot, policy: PublicSurfacePolicy): string[] {
  const errors: string[] = [];
  const allowlisted = new Set(policy.processSizeAllowlist);
  for (const budget of policy.processSizeBudgets) {
    const measuredPaths = budget.paths.filter((filePath) =>
      snapshot.files.has(filePath) && !allowlisted.has(filePath),
    );
    const bytes = measuredPaths.reduce(
      (sum, filePath) => sum + (snapshot.files.get(filePath)?.content.length ?? 0),
      0,
    );
    if (bytes > budget.maxBytes) {
      errors.push(`${measuredPaths.join(', ')}: ${budget.name} is ${bytes} bytes; limit is ${budget.maxBytes}`);
    }
  }
  return errors;
}

function declaredCommits(markdown: string): string[] {
  const line = markdown.split('\n').find((candidate) => candidate.startsWith('Relevant commit(s):'));
  return line?.match(/\b[0-9a-f]{7,40}\b/gu) ?? [];
}

export function commitIsAncestor(root: string, commit: string, descendant = 'HEAD'): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, descendant], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function verifyEngineeringLogs(root: string, snapshot: GitSnapshot, policy: PublicSurfacePolicy): string[] {
  const prefix = `${policy.engineeringLogDirectory}/`;
  const logs = [...snapshot.files.keys()].filter(
    (filePath) => filePath.startsWith(prefix)
      && filePath.endsWith('.md')
      && filePath !== policy.engineeringLogIndex,
  );
  const errors: string[] = [];
  for (const filePath of logs) {
    const markdown = snapshot.files.get(filePath)?.content.toString('utf8') ?? '';
    for (const field of policy.engineeringLogRequiredFields) {
      if (!markdown.includes(field)) errors.push(`${filePath}: missing required field or heading ${field}`);
    }
    const commits = declaredCommits(markdown);
    if (commits.length === 0) {
      errors.push(`${filePath}: Relevant commit(s) must declare at least one integrated commit`);
    }
    for (const commit of commits) {
      if (!commitIsAncestor(root, commit)) {
        errors.push(`${filePath}: declared commit ${commit} is not an ancestor of HEAD`);
      }
    }
  }
  return errors;
}

function checkSnapshot(root: string, snapshot: GitSnapshot, policy: PublicSurfacePolicy): string[] {
  const files = [...snapshot.files.keys()];
  return [
    ...findTrackedPathViolations(files, policy),
    ...findMissingRequiredPaths(files, policy),
    ...verifySecretMarkers(snapshot, policy),
    ...verifySizeBudgets(snapshot, policy),
    ...verifyEngineeringLogs(root, snapshot, policy),
  ];
}

export function runCheck(root: string, source: CheckSource = 'index'): string[] {
  const snapshot = loadSnapshot(root, source);
  return checkSnapshot(root, snapshot, policyFromSnapshot(snapshot));
}

export function runHistoryCheck(root: string): string[] {
  const cache = new Map<string, Buffer>();
  const policySnapshot = loadIndexSnapshot(root, cache);
  const policy = policyFromSnapshot(policySnapshot);
  const commits = gitText(root, ['rev-list', '--all']).split('\n').filter(Boolean);
  const errors = new Map<string, { count: number; example: string }>();
  for (const commit of commits) {
    const snapshot = loadTreeSnapshot(root, commit, cache);
    for (const error of [
      ...findTrackedPathViolations([...snapshot.files.keys()], policy),
      ...verifySecretMarkers(snapshot, policy),
    ]) {
      const existing = errors.get(error);
      errors.set(error, {
        count: (existing?.count ?? 0) + 1,
        example: existing?.example ?? commit.slice(0, 12),
      });
    }
  }
  return [...errors].map(
    ([error, detail]) => `${error} (reachable in ${detail.count} commit${detail.count === 1 ? '' : 's'}; example ${detail.example})`,
  );
}

function repositoryRoot(): string {
  return gitText(process.cwd(), ['rev-parse', '--show-toplevel']);
}

function main(): void {
  const mode = process.argv[2] ?? '--index';
  const root = repositoryRoot();
  const history = mode === '--history';
  if (!history && mode !== '--index' && mode !== '--head') {
    throw new Error('usage: check-public-surface.ts [--index|--head|--history]');
  }
  const errors = history ? runHistoryCheck(root) : runCheck(root, mode === '--head' ? 'head' : 'index');
  const label = history ? 'history' : mode.slice(2);
  if (errors.length > 0) {
    console.error(`Public-surface ${label} check failed:`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`Public-surface ${label} check passed.`);
  }
}

const invokedPath = process.argv[1] === undefined ? '' : path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) main();
