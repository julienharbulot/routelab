import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { commitIsAncestor, containsSecretMarker, matchesAnyPattern } from './check-public-surface.ts';

interface EvidenceCommand { command: string; result: string }
interface EvidencePath { path: string; description: string }
type Evidence = EvidenceCommand | EvidencePath;

export interface PromotionManifest {
  id: string;
  title: string;
  date: string;
  status: string;
  implementationCommits: string[];
  problem: string;
  decision: string;
  evidence: Evidence[];
  result: string;
  limitations: string[];
  links?: Array<{ path: string; description: string }>;
}

export interface PromotionValidation {
  commitIsIntegrated: (commit: string) => boolean;
  publicPathExists: (filePath: string) => boolean;
  secretMarkerPatterns: string[];
  forbiddenPathPatterns: string[];
  allowedForbiddenPathExceptions: string[];
}

function fail(message: string): never {
  throw new Error(message);
}

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function validateText(label: string, value: unknown, validation: PromotionValidation): string {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} must be a nonempty string`);
  const forbidden = [
    /\.routelab-private/iu,
    /routelab-private/iu,
    new RegExp('-----BEGIN (?:RSA |EC |OPENSSH |DSA )?' + 'PRIVATE KEY-----', 'u'),
    /(?:^|\n)(?:user|assistant|system|developer):/iu,
    /<\|(?:im_start|im_end|endoftext)\|>/iu,
    /\b(?:employer|job application|application materials|portfolio signal|staff-level signal)\b/iu,
    /\/(?:home|Users|tmp|var|opt|root)\//u,
    /\b[A-Za-z]:[\\/]/u,
  ];
  if (
    forbidden.some((pattern) => pattern.test(value))
    || containsSecretMarker(value, validation.secretMarkerPatterns)
  ) fail(`${label} contains private or disallowed publication text`);
  return value.trim();
}

function validatePublicPath(label: string, value: unknown, validation: PromotionValidation): string {
  const checked = validateText(label, value, validation);
  const segments = checked.split('/');
  if (
    checked.startsWith('/')
    || checked.includes('\\')
    || /^[A-Za-z]:/u.test(checked)
    || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    fail(`${label} must be a normalized repository-relative path`);
  }
  const forbidden = matchesAnyPattern(checked, validation.forbiddenPathPatterns)
    && !validation.allowedForbiddenPathExceptions.includes(checked);
  if (forbidden || !validation.publicPathExists(checked)) {
    fail(`${label} must reference a tracked public path`);
  }
  return checked;
}

export function validateManifest(raw: unknown, validation: PromotionValidation): PromotionManifest {
  if (typeof raw !== 'object' || raw === null) fail('manifest must be a JSON object');
  const candidate = raw as Partial<PromotionManifest>;
  const id = validateText('id', candidate.id, validation);
  if (!/^RLT-[0-9]{3}$/u.test(id)) fail('id must use RLT-NNN format');
  const title = validateText('title', candidate.title, validation);
  const date = validateText('date', candidate.date, validation);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) fail('date must use YYYY-MM-DD');
  if (candidate.status !== 'integrated') fail('status must be integrated');
  if (!Array.isArray(candidate.implementationCommits) || candidate.implementationCommits.length === 0) {
    fail('implementationCommits must contain at least one commit');
  }
  const implementationCommits = candidate.implementationCommits.map((commit, index) => {
    const checked = validateText(`implementationCommits[${index}]`, commit, validation);
    if (!/^[0-9a-f]{7,40}$/u.test(checked)) fail(`implementationCommits[${index}] must be a 7-40 character hexadecimal commit ID`);
    if (!validation.commitIsIntegrated(checked)) {
      fail(`implementation commit is not integrated in the public HEAD: ${checked}`);
    }
    return checked;
  });
  if (!Array.isArray(candidate.evidence) || candidate.evidence.length === 0) fail('evidence must not be empty');
  const evidence = candidate.evidence.map((item, index) => {
    if (typeof item !== 'object' || item === null) fail(`evidence[${index}] must be an object`);
    if ('command' in item && 'result' in item) {
      return { command: validateText(`evidence[${index}].command`, item.command, validation), result: validateText(`evidence[${index}].result`, item.result, validation) };
    }
    if ('path' in item && 'description' in item) {
      return { path: validatePublicPath(`evidence[${index}].path`, item.path, validation), description: validateText(`evidence[${index}].description`, item.description, validation) };
    }
    return fail(`evidence[${index}] must contain command/result or path/description`);
  });
  if (!Array.isArray(candidate.limitations) || candidate.limitations.length === 0) fail('limitations must not be empty');
  const limitations = candidate.limitations.map((item, index) => validateText(`limitations[${index}]`, item, validation));
  const links = candidate.links?.map((item, index) => ({
    path: validatePublicPath(`links[${index}].path`, item.path, validation),
    description: validateText(`links[${index}].description`, item.description, validation),
  }));
  return {
    id,
    title,
    date,
    status: 'integrated',
    implementationCommits,
    problem: validateText('problem', candidate.problem, validation),
    decision: validateText('decision', candidate.decision, validation),
    evidence,
    result: validateText('result', candidate.result, validation),
    limitations,
    ...(links === undefined ? {} : { links }),
  };
}

export function renderMarkdown(manifest: PromotionManifest): string {
  const evidence = manifest.evidence.map((item) =>
    'command' in item
      ? `- \`${item.command}\` — ${item.result}`
      : `- [${item.description}](../../${item.path})`,
  );
  const links = manifest.links?.map((item) => `- [${item.description}](../../${item.path})`) ?? [];
  return `# ${manifest.title} (${manifest.id})

Date: ${manifest.date}

Status: integrated

Relevant commit(s): ${manifest.implementationCommits.map((commit) => `\`${commit}\``).join(', ')}

## Problem / why this was next

${manifest.problem}

## Decision or implementation

${manifest.decision}

## Evidence and commands

${evidence.join('\n')}

## Result

${manifest.result}

## Limitations / what remains unimplemented

${manifest.limitations.map((item) => `- ${item}`).join('\n')}

## Links to accepted public artifacts

${links.length === 0 ? '- No additional public artifacts declared.' : links.join('\n')}
`;
}

export function updateIndex(logDirectory: string): void {
  const entries = readdirSync(logDirectory)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .map((name) => {
      const text = readFileSync(path.join(logDirectory, name), 'utf8');
      const title = text.match(/^# (.+)$/mu)?.[1] ?? name;
      const date = text.match(/^Date: (.+)$/mu)?.[1] ?? 'unknown';
      return { name, title, date };
    })
    .sort((left, right) => right.date.localeCompare(left.date) || left.name.localeCompare(right.name));
  const list = entries.length === 0
    ? 'No integrated entries have been published yet.'
    : entries.map((entry) => `- ${entry.date} — [${entry.title}](./${entry.name})`).join('\n');
  writeFileSync(path.join(logDirectory, 'README.md'), `# Engineering log

This index contains concise, reviewed outcomes tied to integrated commits. Active plans, raw reports, and unpublished evidence remain outside the public repository.

<!-- entries:start -->
${list}
<!-- entries:end -->
`);
}

export function promotionWriteAction(
  existing: string | undefined,
  generated: string,
  replace: boolean,
): 'create' | 'unchanged' | 'replace' {
  if (existing === undefined) return 'create';
  if (existing === generated) return 'unchanged';
  if (!replace) fail('engineering-log entry already exists with different content; pass --replace after review');
  return 'replace';
}

function main(): void {
  const arguments_ = process.argv.slice(2);
  const replace = arguments_.includes('--replace');
  const manifestArguments = arguments_.filter((argument) => argument !== '--replace');
  if (manifestArguments.length !== 1) fail('usage: pnpm trace:promote [--replace] <reviewed-manifest.json>');
  const manifestArgument = manifestArguments[0] ?? fail('reviewed manifest is required');
  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  const policy = JSON.parse(readFileSync(path.join(root, 'config/public-surface.json'), 'utf8')) as {
    forbiddenTrackedPatterns: string[];
    allowedForbiddenPathExceptions: string[];
    secretMarkerPatterns: string[];
  };
  const publicPaths = new Set(git(root, ['ls-tree', '-r', '--name-only', 'HEAD']).split('\n').filter(Boolean));
  const sourcePath = path.resolve(manifestArgument);
  const manifest = validateManifest(JSON.parse(readFileSync(sourcePath, 'utf8')) as unknown, {
    commitIsIntegrated: (commit) => commitIsAncestor(root, commit),
    publicPathExists: (filePath) => publicPaths.has(filePath),
    secretMarkerPatterns: policy.secretMarkerPatterns,
    forbiddenPathPatterns: policy.forbiddenTrackedPatterns,
    allowedForbiddenPathExceptions: policy.allowedForbiddenPathExceptions,
  });
  const logDirectory = path.join(root, 'docs/engineering-log');
  mkdirSync(logDirectory, { recursive: true });
  const destination = path.join(logDirectory, `${manifest.id.toLowerCase()}.md`);
  const generated = renderMarkdown(manifest);
  const existing = existsSync(destination) ? readFileSync(destination, 'utf8') : undefined;
  const action = promotionWriteAction(existing, generated, replace);
  if (action !== 'unchanged') writeFileSync(destination, generated);
  updateIndex(logDirectory);
  console.log(`${action === 'unchanged' ? 'Verified' : 'Wrote'} ${path.relative(root, destination)}; source manifest was preserved.`);
}

const invokedPath = process.argv[1] === undefined ? '' : path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) main();
