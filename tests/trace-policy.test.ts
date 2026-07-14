import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  containsSecretMarker,
  commitIsAncestor,
  findMissingRequiredPaths,
  findTrackedPathViolations,
  globToRegExp,
  runCheck,
  runHistoryCheck,
  TRACE_GIT_COMMAND_MAX_BUFFER_BYTES,
  type PublicSurfacePolicy,
} from '../scripts/trace/check-public-surface.ts';
import { promotionWriteAction, renderMarkdown, validateManifest } from '../scripts/trace/promote.ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryPolicy = JSON.parse(
  readFileSync(path.join(repositoryRoot, 'config/public-surface.json'), 'utf8'),
) as PublicSurfacePolicy;

void test('trace blob capacity exceeds every retained experiment file cap', () => {
  const experimentConfig = JSON.parse(
    readFileSync(
      path.join(
        repositoryRoot,
        'fixtures/m7c/service-fast-numerical/experiment-config.v1.json',
      ),
      'utf8',
    ),
  ) as { readonly artifacts: { readonly files: readonly { readonly maxBytes: number }[] } };
  const maximumRetainedFileBytes = Math.max(
    ...experimentConfig.artifacts.files.map((file) => file.maxBytes),
  );
  assert.ok(TRACE_GIT_COMMAND_MAX_BUFFER_BYTES > maximumRetainedFileBytes);
});

const pathPolicy = {
  forbiddenTrackedPatterns: [
    '.routelab-private/**',
    'data-acquisition/**',
    'docs/research-papers/**',
    '**/transcripts/**',
    '**/*.zip',
    '**/*.tar*',
    '.env.*',
  ],
  allowedForbiddenPathExceptions: ['.env.example'],
  allowedTopLevelFiles: ['.env.example', 'README.md'],
  allowedTrackedRoots: ['src/'],
  allowedTrackedPaths: [
    '.codex/config.toml',
    '.codex/agents/builder.toml',
    '.codex/agents/oracle.toml',
    '.codex/agents/reviewer.toml',
    'docs/invariants.md',
  ],
  allowedPublicAgentPaths: [
    '.codex/config.toml',
    '.codex/agents/builder.toml',
    '.codex/agents/oracle.toml',
    '.codex/agents/reviewer.toml',
  ],
};

const promotionValidation = {
  commitIsIntegrated: () => true,
  publicPathExists: (filePath: string) => [
    '.env.example',
    'docs/invariants.md',
    'fixtures/m0/README.md',
  ].includes(filePath),
  secretMarkerPatterns: [
    'ghp_[A-Za-z0-9]{20,}',
  ],
  forbiddenPathPatterns: pathPolicy.forbiddenTrackedPatterns,
  allowedForbiddenPathExceptions: pathPolicy.allowedForbiddenPathExceptions,
};

const minimalPolicy: PublicSurfacePolicy = {
  forbiddenTrackedPatterns: ['docs/research-papers/**'],
  allowedForbiddenPathExceptions: [],
  allowedTopLevelFiles: ['public.txt'],
  allowedTrackedRoots: ['config/', 'docs/'],
  allowedTrackedPaths: [],
  allowedPublicAgentPaths: [],
  requiredTrackedPaths: [],
  secretMarkerPatterns: ['ghp_[A-Za-z0-9]{20,}'],
  secretScanExclusions: ['config/public-surface.json'],
  engineeringLogDirectory: 'docs/engineering-log',
  engineeringLogIndex: 'docs/engineering-log/README.md',
  engineeringLogRequiredFields: [],
  processSizeBudgets: [],
  processSizeAllowlist: [],
};

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function temporaryRepository(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'routelab-trace-'));
  git(root, ['init', '-q']);
  mkdirSync(path.join(root, 'config'), { recursive: true });
  writeFileSync(path.join(root, 'config/public-surface.json'), `${JSON.stringify({ schemaVersion: 3, ...minimalPolicy })}\n`);
  return root;
}

function commitAll(root: string, message: string): void {
  git(root, ['add', '.']);
  git(root, ['-c', 'user.name=Trace Test', '-c', 'user.email=trace@example.invalid', 'commit', '-qm', message]);
}

void test('forbidden private paths are rejected with path-specific errors', () => {
  const errors = findTrackedPathViolations([
    '.routelab-private/CONTROL.md',
    'data-acquisition/.env',
    'src/router.ts',
  ], pathPolicy);
  assert.deepEqual(errors, [
    '.routelab-private/CONTROL.md: tracked path is forbidden by .routelab-private/**',
    '.routelab-private/CONTROL.md: tracked root .routelab-private/ is not allowed and path is not in allowedTrackedPaths',
    'data-acquisition/.env: tracked path is forbidden by data-acquisition/**',
    'data-acquisition/.env: tracked root data-acquisition/ is not allowed and path is not in allowedTrackedPaths',
  ]);
});

void test('only curated paths are allowed beneath process-sensitive roots', () => {
  const curated = [
    '.agent/PLANS.md',
    '.codex/config.toml',
    'tasks/TASK_TEMPLATE.md',
    'tasks/examples/RLT-011-exact-pool-math.md',
    'docs/invariants.md',
    'docs/engineering-log/rlt-003.md',
    'docs/adr/accepted/0001.md',
    'docs/experiments/published/baseline.md',
  ];
  assert.deepEqual(findTrackedPathViolations(curated, repositoryPolicy), []);
});

void test('active tasks, plans, reviews, reports, and unpublished evidence are rejected', () => {
  const operational = [
    '.agent/RLT-010-active-plan.md',
    'tasks/RLT-010.md',
    'docs/execplans/RLT-010.md',
    'docs/reviews/RLT-010.md',
    'docs/reports/RLT-010.md',
    'docs/evidence/unpublished-results.md',
  ];
  const errors = findTrackedPathViolations(operational, repositoryPolicy);
  for (const filePath of operational) {
    assert.equal(
      errors.some((error) => error.startsWith(`${filePath}: tracked root `)),
      true,
      `${filePath} must be rejected`,
    );
  }
});

void test('classification rejects nested papers, unexpected roots, transcripts, and archives', () => {
  const files = [
    'docs/research-papers/archive/paper.pdf',
    'notes/session-transcript.md',
    'docs/transcripts/session.md',
    'routelab-full.zip',
    'docs/archive.tarball',
  ];
  const errors = findTrackedPathViolations(files, pathPolicy);
  assert.equal(errors.some((error) => error.includes('docs/research-papers/**')), true);
  assert.equal(errors.some((error) => error.includes('tracked root notes/')), true);
  assert.equal(errors.some((error) => error.includes('**/transcripts/**')), true);
  assert.equal(errors.some((error) => error.includes('**/*.zip')), true);
  assert.equal(errors.some((error) => error.includes('**/*.tar*')), true);
});

void test('.env.example is the only explicit environment-file exception', () => {
  assert.deepEqual(findTrackedPathViolations(['.env.example'], pathPolicy), []);
  assert.equal(findTrackedPathViolations(['.env.local'], pathPolicy).length > 0, true);
});

void test('recursive paper-cache pattern crosses directories', () => {
  const pattern = globToRegExp('docs/research-papers/**');
  assert.equal(pattern.test('docs/research-papers/paper.pdf'), true);
  assert.equal(pattern.test('docs/research-papers/archive/paper.pdf'), true);
});

void test('required tracked paths fail when a governed file is absent', () => {
  assert.deepEqual(
    findMissingRequiredPaths(['AGENTS.md'], {
      requiredTrackedPaths: ['AGENTS.md', 'STATUS.md'],
      processSizeBudgets: [],
    }),
    ['STATUS.md: required tracked path is missing'],
  );
});

void test('budget-governed paths are required even without duplicate configuration', () => {
  assert.deepEqual(
    findMissingRequiredPaths([], {
      requiredTrackedPaths: [],
      processSizeBudgets: [{ name: 'contract', paths: ['AGENTS.md'], maxBytes: 100 }],
    }),
    ['AGENTS.md: required tracked path is missing'],
  );
});

void test('index check reads the staged blob rather than harmless working-tree content', () => {
  const root = temporaryRepository();
  const marker = `ghp_${'a'.repeat(20)}`;
  writeFileSync(path.join(root, 'public.txt'), marker);
  git(root, ['add', '.']);
  writeFileSync(path.join(root, 'public.txt'), 'harmless working tree\n');
  const errors = runCheck(root, 'index');
  assert.equal(errors.some((error) => error.startsWith('public.txt: contains an obvious secret marker')), true);
});

void test('index check accepts staged public blobs above the former subprocess buffer', () => {
  const root = temporaryRepository();
  mkdirSync(path.join(root, 'docs'), { recursive: true });
  writeFileSync(path.join(root, 'docs/large-evidence.json'), Buffer.alloc(32 * 1024 * 1024 + 1, 0x61));
  git(root, ['add', '.']);
  assert.deepEqual(runCheck(root, 'index'), []);
});

void test('schema version 3 rejects a staged policy with a missing enforcement field', () => {
  const root = temporaryRepository();
  const incomplete = { schemaVersion: 3, ...minimalPolicy } as Record<string, unknown>;
  delete incomplete['allowedTrackedPaths'];
  writeFileSync(path.join(root, 'config/public-surface.json'), `${JSON.stringify(incomplete)}\n`);
  git(root, ['add', '.']);
  assert.throws(
    () => runCheck(root, 'index'),
    /field allowedTrackedPaths must be an array of strings/u,
  );
});

void test('HEAD check reads committed blobs rather than working-tree content', () => {
  const root = temporaryRepository();
  writeFileSync(path.join(root, 'public.txt'), `ghp_${'b'.repeat(20)}`);
  commitAll(root, 'marker');
  writeFileSync(path.join(root, 'public.txt'), 'harmless working tree\n');
  const errors = runCheck(root, 'head');
  assert.equal(errors.some((error) => error.startsWith('public.txt: contains an obvious secret marker')), true);
});

void test('history check finds forbidden paths removed from HEAD', () => {
  const root = temporaryRepository();
  mkdirSync(path.join(root, 'docs/research-papers/archive'), { recursive: true });
  writeFileSync(path.join(root, 'docs/research-papers/archive/paper.pdf'), 'not really a PDF');
  commitAll(root, 'add paper');
  git(root, ['rm', '-q', 'docs/research-papers/archive/paper.pdf']);
  git(root, ['-c', 'user.name=Trace Test', '-c', 'user.email=trace@example.invalid', 'commit', '-qm', 'remove paper']);
  const errors = runHistoryCheck(root);
  assert.equal(errors.some((error) => error.includes('docs/research-papers/archive/paper.pdf')), true);
});

void test('integration ancestry uses real Git reachability', () => {
  const root = temporaryRepository();
  writeFileSync(path.join(root, 'public.txt'), 'base\n');
  commitAll(root, 'base');
  const base = git(root, ['rev-parse', 'HEAD']);
  git(root, ['checkout', '-qb', 'side']);
  writeFileSync(path.join(root, 'public.txt'), 'side\n');
  commitAll(root, 'side');
  const side = git(root, ['rev-parse', 'HEAD']);
  git(root, ['checkout', '-q', '-']);
  writeFileSync(path.join(root, 'public.txt'), 'head\n');
  commitAll(root, 'head');
  assert.equal(commitIsAncestor(root, base), true);
  assert.equal(commitIsAncestor(root, side), false);
});

void test('promotion manifests render deterministic required sections', () => {
  const manifest = validateManifest(
    {
      id: 'RLT-003',
      title: 'Freeze exact semantics',
      date: '2026-07-12',
      status: 'integrated',
      implementationCommits: ['5912631'],
      problem: 'Financial code needs an accepted arithmetic contract.',
      decision: 'Use exact integer values and a single final floor.',
      evidence: [{ command: 'pnpm test', result: 'passed' }],
      result: 'The contract and fixtures are reproducible.',
      limitations: ['No pool implementation exists.'],
      links: [{ path: 'docs/invariants.md', description: 'Accepted invariants' }],
    },
    promotionValidation,
  );
  const first = renderMarkdown(manifest);
  const second = renderMarkdown(manifest);
  assert.equal(first, second);
  assert.match(first, /Status: integrated/u);
  assert.match(first, /## Limitations \/ what remains unimplemented/u);
});

void test('promotion rejects non-integrated, non-ancestor, and private content', () => {
  const base = {
    id: 'RLT-003',
    title: 'Semantics',
    date: '2026-07-12',
    implementationCommits: ['5912631'],
    problem: 'Required contract.',
    decision: 'Accepted exact rules.',
    evidence: [{ command: 'pnpm test', result: 'passed' }],
    result: 'Recorded.',
    limitations: ['No router.'],
  };
  assert.throws(() => validateManifest({ ...base, status: 'review' }, promotionValidation), /status must be integrated/u);
  assert.throws(
    () => validateManifest({ ...base, status: 'integrated' }, { ...promotionValidation, commitIsIntegrated: () => false }),
    /is not integrated in the public HEAD/u,
  );
  assert.throws(
    () => validateManifest({ ...base, status: 'integrated', problem: 'See .routelab-private notes.' }, promotionValidation),
    /contains private or disallowed publication text/u,
  );
});

void test('promotion requires --replace for different existing content', () => {
  assert.equal(promotionWriteAction(undefined, 'new', false), 'create');
  assert.equal(promotionWriteAction('same', 'same', false), 'unchanged');
  assert.throws(() => promotionWriteAction('old', 'new', false), /pass --replace after review/u);
  assert.equal(promotionWriteAction('old', 'new', true), 'replace');
});

void test('promotion honors the public .env.example exception', () => {
  const manifest = validateManifest({
    id: 'RLT-004',
    title: 'Document environment variables',
    date: '2026-07-12',
    status: 'integrated',
    implementationCommits: ['5912631'],
    problem: 'Public setup needs variable names without values.',
    decision: 'Publish a credential-free example.',
    evidence: [{ path: '.env.example', description: 'Environment example' }],
    result: 'Names are documented without credentials.',
    limitations: ['No runtime values are included.'],
  }, promotionValidation);
  assert.equal('path' in manifest.evidence[0]!, true);
});

void test('common secret-token prefixes are detected conservatively', () => {
  const patterns = [
    'glpat-[A-Za-z0-9_-]{20,}',
    'xox[baprs]-[A-Za-z0-9-]{10,}',
    'npm_[A-Za-z0-9]{20,}',
    'sk_live_[A-Za-z0-9]{20,}',
  ];
  assert.equal(containsSecretMarker(`glpat-${'a'.repeat(20)}`, patterns), true);
  assert.equal(containsSecretMarker(`xoxb-${'a'.repeat(20)}`, patterns), true);
  assert.equal(containsSecretMarker(`npm_${'a'.repeat(20)}`, patterns), true);
  assert.equal(containsSecretMarker(`sk_live_${'a'.repeat(20)}`, patterns), true);
  assert.equal(containsSecretMarker('ordinary-public-text', patterns), false);
});
