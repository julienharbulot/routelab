import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export const SERVICE_FAST_INPUT_BUILTIN_RUNTIME_ALLOWLIST = Object.freeze([
  'node:crypto',
  'node:fs/promises',
  'node:path',
  'node:util',
]);

const ALLOWED_BUILTINS = new Set(SERVICE_FAST_INPUT_BUILTIN_RUNTIME_ALLOWLIST);

export const SERVICE_FAST_INPUT_PROJECT_RUNTIME_ALLOWLIST = Object.freeze([
  'cli/build-service-fast-numerical-experiment-inputs.ts',
  'src/allocation/path-shadow-price/index.ts',
  'src/allocation/service-path-shadow-price/index.ts',
  'src/benchmark/service-fast-numerical-experiment/input/build.ts',
  'src/benchmark/service-fast-numerical-experiment/input/closure-audit.ts',
  'src/benchmark/service-fast-numerical-experiment/input/codec.ts',
  'src/benchmark/service-fast-numerical-experiment/input/frozen-bindings.ts',
  'src/benchmark/service-fast-numerical-experiment/input/publication.ts',
  'src/domain/index.ts',
  'src/domain/liquidity-snapshot.ts',
  'src/pools/constant-product/index.ts',
  'src/replay/exact-input-kernel/index.ts',
  'src/replay/exact-input-split/index.ts',
  'src/router/anytime-exact-input-split/index.ts',
  'src/router/exact-input-split-session/index.ts',
  'src/router/numerical-exact-input-split/index.ts',
  'src/router/split-exact-input/objective.ts',
  'src/runtime/prepared-routing-context/index.ts',
  'src/runtime/prepared-service-routing-context/bounded-snapshot-json.ts',
  'src/runtime/prepared-service-routing-context/index.ts',
  'src/search/pool-disjoint-route-sets/index.ts',
  'src/search/service-route-discovery/index.ts',
  'src/search/shared-route-discovery/index.ts',
  'src/search/simple-paths/index.ts',
  'src/search/simple-paths/traversal.ts',
  'src/serialization/canonical-snapshot/index.ts',
]);

const ALLOWED_PROJECT_RUNTIME_PATHS = new Set(
  SERVICE_FAST_INPUT_PROJECT_RUNTIME_ALLOWLIST,
);

type TokenKind = 'identifier' | 'literal' | 'punctuator' | 'regex' | 'string';

interface Token {
  readonly kind: TokenKind;
  readonly value: string;
  readonly escaped?: boolean;
}

export interface RuntimeImportAuditOptions {
  readonly repositoryRoot: string;
  readonly expected: RuntimeImportClosureExpectation;
  readonly trackedPaths?: ReadonlySet<string>;
}

export interface RuntimeSourceDescriptor {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface RuntimeImportClosureExpectation {
  readonly entryRoots: readonly string[];
  readonly projectSources: readonly RuntimeSourceDescriptor[];
  readonly nodeBuiltins: readonly string[];
}

export interface RuntimeImportAuditResult {
  readonly files: readonly string[];
  readonly builtins: readonly string[];
}

export class RuntimeImportAuditError extends Error {
  readonly code: string;
  readonly artifact: string;

  constructor(code: string, artifact: string, message: string) {
    super(message);
    this.code = code;
    this.artifact = artifact;
  }
}

function auditFailure(code: string, artifact: string, message: string): never {
  throw new RuntimeImportAuditError(code, artifact, message);
}

function isIdentifierStart(character: string): boolean {
  return /[A-Za-z_$]/u.test(character);
}

function isIdentifierPart(character: string): boolean {
  return /[A-Za-z0-9_$]/u.test(character);
}

const REGEX_PREFIX_KEYWORDS = new Set([
  'await',
  'case',
  'delete',
  'do',
  'else',
  'extends',
  'in',
  'instanceof',
  'new',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
]);

function canStartRegex(tokens: readonly Token[]): boolean {
  const prior = tokens.at(-1);
  if (prior === undefined) return true;
  if (prior.kind === 'identifier') return REGEX_PREFIX_KEYWORDS.has(prior.value);
  if (
    prior.kind === 'literal' ||
    prior.kind === 'regex' ||
    prior.kind === 'string'
  ) {
    return false;
  }
  if (prior.value === ')' || prior.value === ']' || prior.value === '}' || prior.value === '.') {
    return false;
  }
  const beforePrior = tokens.at(-2);
  if (
    (prior.value === '+' || prior.value === '-') &&
    beforePrior?.value === prior.value
  ) {
    return false;
  }
  if (prior.value === '!' && beforePrior?.kind === 'identifier') return false;
  return true;
}

function tokenize(source: string, artifact: string): readonly Token[] {
  const tokens: Token[] = [];
  let position = 0;

  function scanString(quote: string): void {
    position += 1;
    let value = '';
    let escapedValue = false;
    while (position < source.length) {
      const character = source[position];
      if (character === undefined) break;
      if (character === quote) {
        position += 1;
        tokens.push(Object.freeze({ kind: 'string', value, escaped: escapedValue }));
        return;
      }
      if (character === '\\') {
        escapedValue = true;
        const escaped = source[position + 1];
        if (escaped === undefined || escaped === '\n' || escaped === '\r') {
          auditFailure('invalid-source-syntax', artifact, `Invalid string literal in ${artifact}.`);
        }
        value += escaped;
        position += 2;
        continue;
      }
      value += character;
      position += 1;
    }
    auditFailure('invalid-source-syntax', artifact, `Unterminated string literal in ${artifact}.`);
  }

  function scanNumber(): void {
    const start = position;
    if (
      source[position] === '0' &&
      (source[position + 1] === 'x' ||
        source[position + 1] === 'X' ||
        source[position + 1] === 'b' ||
        source[position + 1] === 'B' ||
        source[position + 1] === 'o' ||
        source[position + 1] === 'O')
    ) {
      position += 2;
      while (/[A-Fa-f0-9_]/u.test(source[position] ?? '')) position += 1;
    } else {
      while (/[0-9_]/u.test(source[position] ?? '')) position += 1;
      if (source[position] === '.' && source[position + 1] !== '.') {
        position += 1;
        while (/[0-9_]/u.test(source[position] ?? '')) position += 1;
      }
      if (source[position] === 'e' || source[position] === 'E') {
        position += 1;
        if (source[position] === '+' || source[position] === '-') position += 1;
        while (/[0-9_]/u.test(source[position] ?? '')) position += 1;
      }
    }
    if (source[position] === 'n') position += 1;
    tokens.push(Object.freeze({ kind: 'literal', value: source.slice(start, position) }));
  }

  function scanRegex(): void {
    position += 1;
    let inCharacterClass = false;
    while (position < source.length) {
      const character = source[position];
      if (character === undefined || character === '\n' || character === '\r') {
        auditFailure('invalid-source-syntax', artifact, `Unterminated regular expression in ${artifact}.`);
      }
      if (character === '\\') {
        if (source[position + 1] === undefined) {
          auditFailure('invalid-source-syntax', artifact, `Unterminated regular expression in ${artifact}.`);
        }
        position += 2;
        continue;
      }
      if (character === '[') {
        inCharacterClass = true;
        position += 1;
        continue;
      }
      if (character === ']' && inCharacterClass) {
        inCharacterClass = false;
        position += 1;
        continue;
      }
      if (character === '/' && !inCharacterClass) {
        position += 1;
        while (/[A-Za-z]/u.test(source[position] ?? '')) position += 1;
        tokens.push(Object.freeze({ kind: 'regex', value: 'regex' }));
        return;
      }
      position += 1;
    }
    auditFailure('invalid-source-syntax', artifact, `Unterminated regular expression in ${artifact}.`);
  }

  function scanTemplate(): void {
    if (tokens.at(-1)?.value === '[') {
      auditFailure(
        'computed-template-forbidden',
        artifact,
        `Computed template property is forbidden in ${artifact}.`,
      );
    }
    position += 1;
    while (position < source.length) {
      const character = source[position];
      if (character === '\\') {
        if (source[position + 1] === undefined) {
          auditFailure('invalid-source-syntax', artifact, `Unterminated template literal in ${artifact}.`);
        }
        position += 2;
      } else if (character === '`') {
        position += 1;
        tokens.push(Object.freeze({ kind: 'literal', value: 'template' }));
        return;
      } else if (character === '$' && source[position + 1] === '{') {
        position += 2;
        scanCode(true);
      } else {
        position += 1;
      }
    }
    auditFailure('invalid-source-syntax', artifact, `Unterminated template literal in ${artifact}.`);
  }

  function scanCode(templateExpression: boolean): void {
    let braceDepth = templateExpression ? 1 : 0;
    while (position < source.length) {
      const character = source[position];
      const next = source[position + 1];
      if (character === undefined) break;
      if (/\s/u.test(character)) {
        position += 1;
        continue;
      }
      if (character === '/' && next === '/') {
        position += 2;
        while (position < source.length && source[position] !== '\n') position += 1;
        continue;
      }
      if (character === '/' && next === '*') {
        position += 2;
        while (
          position < source.length &&
          !(source[position] === '*' && source[position + 1] === '/')
        ) {
          position += 1;
        }
        if (position >= source.length) {
          auditFailure('invalid-source-syntax', artifact, `Unterminated comment in ${artifact}.`);
        }
        position += 2;
        continue;
      }
      if (character === "'" || character === '"') {
        scanString(character);
        continue;
      }
      if (character === '`') {
        scanTemplate();
        continue;
      }
      if (character === '\\') {
        auditFailure(
          next === 'u' ? 'escaped-identifier-forbidden' : 'invalid-source-syntax',
          artifact,
          next === 'u'
            ? `Escaped identifier is forbidden in ${artifact}.`
            : `Invalid source escape in ${artifact}.`,
        );
      }
      if (isIdentifierStart(character)) {
        const start = position;
        position += 1;
        while (
          position < source.length &&
          isIdentifierPart(source[position] ?? '')
        ) {
          position += 1;
        }
        tokens.push(
          Object.freeze({ kind: 'identifier', value: source.slice(start, position) }),
        );
        continue;
      }
      if (/[0-9]/u.test(character)) {
        scanNumber();
        continue;
      }
      if (character === '/' && canStartRegex(tokens)) {
        scanRegex();
        continue;
      }
      if (templateExpression && character === '{') braceDepth += 1;
      if (templateExpression && character === '}') {
        braceDepth -= 1;
        position += 1;
        if (braceDepth === 0) return;
        tokens.push(Object.freeze({ kind: 'punctuator', value: '}' }));
        continue;
      }
      tokens.push(Object.freeze({ kind: 'punctuator', value: character }));
      position += 1;
    }
    if (templateExpression) {
      auditFailure('invalid-source-syntax', artifact, `Unterminated template expression in ${artifact}.`);
    }
  }

  scanCode(false);
  return Object.freeze(tokens);
}

function moduleSpecifiers(source: string, artifact: string): readonly string[] {
  const tokens = tokenize(source, artifact);
  const specifiers: string[] = [];
  const appendSpecifier = (token: Token | undefined): void => {
    if (token?.kind !== 'string') {
      auditFailure('nonliteral-import', artifact, `Module source is not literal in ${artifact}.`);
    }
    if (token.escaped === true) {
      auditFailure(
        'escaped-module-specifier',
        artifact,
        `Escaped module specifier is forbidden in ${artifact}.`,
      );
    }
    specifiers.push(token.value);
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.kind !== 'identifier') continue;
    if (token.value === 'import') {
      const next = tokens[index + 1];
      if (next?.value === '.') continue;
      if (next?.value === '(') {
        auditFailure(
          'dynamic-import-forbidden',
          artifact,
          `Dynamic import is forbidden in ${artifact}.`,
        );
      }
      if (next?.kind === 'identifier' && next.value === 'type') {
        if (tokens[index + 2]?.value === 'from') {
          auditFailure(
            'ambiguous-type-import',
            artifact,
            `Ambiguous "import type from" is forbidden in ${artifact}.`,
          );
        }
        continue;
      }
      if (next?.kind === 'string') {
        appendSpecifier(next);
        continue;
      }
      for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
        const candidate = tokens[cursor];
        if (candidate?.value === ';') break;
        if (candidate?.kind === 'identifier' && candidate.value === 'from') {
          const sourceToken = tokens[cursor + 1];
          appendSpecifier(sourceToken);
          break;
        }
      }
      continue;
    }
    if (token.value === 'export') {
      if (tokens[index + 1]?.value === 'type') continue;
      if (tokens[index + 1]?.value !== '*' && tokens[index + 1]?.value !== '{') {
        continue;
      }
      for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
        const candidate = tokens[cursor];
        if (candidate?.value === ';') break;
        if (candidate?.kind === 'identifier' && candidate.value === 'from') {
          const sourceToken = tokens[cursor + 1];
          appendSpecifier(sourceToken);
          break;
        }
      }
      continue;
    }
    if (token.value === 'require' && tokens[index + 1]?.value === '(') {
      auditFailure(
        'runtime-loader-forbidden',
        artifact,
        `Runtime require is forbidden in ${artifact}.`,
      );
    }
  }
  return Object.freeze(specifiers);
}

const FORBIDDEN_CAPABILITY_IDENTIFIERS = new Map<string, string>([
  ['eval', 'runtime-codegen-forbidden'],
  ['Function', 'runtime-codegen-forbidden'],
  ['AsyncFunction', 'runtime-codegen-forbidden'],
  ['GeneratorFunction', 'runtime-codegen-forbidden'],
  ['AsyncGeneratorFunction', 'runtime-codegen-forbidden'],
  ['WebAssembly', 'runtime-codegen-forbidden'],
  ['compileFunction', 'runtime-codegen-forbidden'],
  ['createContext', 'runtime-codegen-forbidden'],
  ['runInContext', 'runtime-codegen-forbidden'],
  ['runInNewContext', 'runtime-codegen-forbidden'],
  ['runInThisContext', 'runtime-codegen-forbidden'],
  ['Script', 'runtime-codegen-forbidden'],
  ['SourceTextModule', 'runtime-codegen-forbidden'],
  ['SyntheticModule', 'runtime-codegen-forbidden'],
  ['require', 'runtime-loader-forbidden'],
  ['getBuiltinModule', 'runtime-loader-forbidden'],
  ['createRequire', 'runtime-loader-forbidden'],
  ['dlopen', 'runtime-loader-forbidden'],
  ['_linkedBinding', 'runtime-loader-forbidden'],
  ['fetch', 'runtime-network-forbidden'],
  ['WebSocket', 'runtime-network-forbidden'],
  ['EventSource', 'runtime-network-forbidden'],
  ['XMLHttpRequest', 'runtime-network-forbidden'],
  ['WebTransport', 'runtime-network-forbidden'],
  ['BroadcastChannel', 'runtime-network-forbidden'],
  ['navigator', 'runtime-network-forbidden'],
  ['Worker', 'runtime-worker-forbidden'],
  ['SharedWorker', 'runtime-worker-forbidden'],
  ['Date', 'operational-clock-forbidden'],
  ['performance', 'operational-clock-forbidden'],
  ['Temporal', 'operational-clock-forbidden'],
  ['setTimeout', 'operational-clock-forbidden'],
  ['setInterval', 'operational-clock-forbidden'],
  ['setImmediate', 'operational-clock-forbidden'],
  ['hrtime', 'operational-clock-forbidden'],
  ['uptime', 'operational-clock-forbidden'],
  ['cpuUsage', 'runtime-profiler-forbidden'],
  ['resourceUsage', 'runtime-profiler-forbidden'],
  ['memoryUsage', 'runtime-profiler-forbidden'],
  ['measureMemory', 'runtime-profiler-forbidden'],
]);

const FORBIDDEN_REFLECTED_PROPERTIES = new Map<string, string>([
  ...FORBIDDEN_CAPABILITY_IDENTIFIERS,
  ['constructor', 'runtime-codegen-forbidden'],
  ['binding', 'runtime-loader-forbidden'],
  ['mainModule', 'runtime-loader-forbidden'],
  ['profile', 'runtime-profiler-forbidden'],
  ['profileEnd', 'runtime-profiler-forbidden'],
  ['time', 'operational-clock-forbidden'],
  ['timeEnd', 'operational-clock-forbidden'],
  ['timeLog', 'operational-clock-forbidden'],
  ['wait', 'operational-clock-forbidden'],
  ['waitAsync', 'operational-clock-forbidden'],
]);

const SAFE_PROCESS_PROPERTIES = new Set(['exitCode', 'pid', 'stderr', 'stdout']);
const SAFE_CONSOLE_PROPERTIES = new Set(['debug', 'error', 'info', 'log', 'warn']);
const FORBIDDEN_GLOBAL_OBJECTS = new Set(['global', 'globalThis', 'self']);

function isComputedPropertyOpen(tokens: readonly Token[], openBracketIndex: number): boolean {
  const owner = tokens[openBracketIndex - 1];
  return (
    owner?.kind === 'identifier' ||
    owner?.kind === 'literal' ||
    owner?.kind === 'regex' ||
    owner?.kind === 'string' ||
    owner?.value === ')' ||
    owner?.value === ']' ||
    owner?.value === '}'
  );
}

function closingBracketIndex(
  tokens: readonly Token[],
  openBracketIndex: number,
): number | undefined {
  let depth = 0;
  for (let cursor = openBracketIndex; cursor < tokens.length; cursor += 1) {
    const value = tokens[cursor]?.value;
    if (value === '[') depth += 1;
    else if (value === ']') {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return undefined;
}

function callArguments(
  tokens: readonly Token[],
  openParenthesisIndex: number,
): readonly (readonly Token[])[] | undefined {
  const argumentsList: Token[][] = [];
  let start = openParenthesisIndex + 1;
  let parentheses = 0;
  let brackets = 0;
  let braces = 0;
  for (let cursor = start; cursor < tokens.length; cursor += 1) {
    const value = tokens[cursor]?.value;
    if (value === '(') parentheses += 1;
    else if (value === ')') {
      if (parentheses === 0 && brackets === 0 && braces === 0) {
        if (cursor !== start || argumentsList.length > 0) {
          argumentsList.push(tokens.slice(start, cursor));
        }
        return Object.freeze(argumentsList.map((argument) => Object.freeze(argument)));
      }
      parentheses -= 1;
    } else if (value === '[') brackets += 1;
    else if (value === ']') brackets -= 1;
    else if (value === '{') braces += 1;
    else if (value === '}') braces -= 1;
    else if (value === ',' && parentheses === 0 && brackets === 0 && braces === 0) {
      argumentsList.push(tokens.slice(start, cursor));
      start = cursor + 1;
    }
    if (parentheses < 0 || brackets < 0 || braces < 0) return undefined;
  }
  return undefined;
}

function capabilityFailure(
  code: string,
  artifact: string,
  capability: string,
): never {
  return auditFailure(
    code,
    artifact,
    `Forbidden runtime capability ${capability} is reachable in ${artifact}.`,
  );
}

function assertDirectReflectAccess(
  tokens: readonly Token[],
  index: number,
  artifact: string,
): void {
  const method = tokens[index + 2];
  const openParenthesisIndex = index + 3;
  if (
    tokens[index + 1]?.value !== '.' ||
    method?.kind !== 'identifier' ||
    (method.value !== 'get' && method.value !== 'apply') ||
    tokens[openParenthesisIndex]?.value !== '('
  ) {
    capabilityFailure('runtime-reflection-forbidden', artifact, 'indirect Reflect access');
  }
  const argumentsList = callArguments(tokens, openParenthesisIndex);
  if (method.value === 'apply') {
    if (argumentsList?.length !== 3) {
      capabilityFailure('runtime-reflection-forbidden', artifact, 'noncanonical Reflect.apply');
    }
    return;
  }
  if (argumentsList?.length !== 2) {
    capabilityFailure('runtime-reflection-forbidden', artifact, 'noncanonical Reflect.get');
  }
  const target = argumentsList[0] ?? [];
  const property = argumentsList[1] ?? [];
  if (
    target.length !== 1 ||
    target[0]?.kind !== 'identifier' ||
    property.length !== 1 ||
    (property[0]?.kind !== 'identifier' && property[0]?.kind !== 'string')
  ) {
    capabilityFailure('runtime-reflection-forbidden', artifact, 'computed Reflect.get');
  }
  const propertyToken = property[0];
  if (propertyToken?.escaped === true) {
    capabilityFailure('escaped-computed-property', artifact, 'escaped Reflect.get property');
  }
  const propertyName = propertyToken?.value ?? '';
  const propertyCode = FORBIDDEN_REFLECTED_PROPERTIES.get(propertyName);
  if (propertyCode !== undefined) capabilityFailure(propertyCode, artifact, propertyName);
  const targetName = target[0]?.value;
  if (targetName === 'process') {
    capabilityFailure('runtime-process-access-forbidden', artifact, 'reflected process access');
  }
  if (targetName === 'console') {
    capabilityFailure('runtime-console-access-forbidden', artifact, 'reflected console access');
  }
  if (targetName !== undefined && FORBIDDEN_GLOBAL_OBJECTS.has(targetName)) {
    capabilityFailure('runtime-global-access-forbidden', artifact, `reflected ${targetName} access`);
  }
}

function assertSafeProcessAccess(
  tokens: readonly Token[],
  index: number,
  artifact: string,
): void {
  const property = tokens[index + 2];
  if (
    tokens[index + 1]?.value === '.' &&
    property?.kind === 'identifier' &&
    SAFE_PROCESS_PROPERTIES.has(property.value)
  ) {
    return;
  }
  const code =
    property?.kind === 'identifier'
      ? FORBIDDEN_REFLECTED_PROPERTIES.get(property.value)
      : undefined;
  capabilityFailure(code ?? 'runtime-process-access-forbidden', artifact, 'noncanonical process access');
}

function assertSafeConsoleAccess(
  tokens: readonly Token[],
  index: number,
  artifact: string,
): void {
  const property = tokens[index + 2];
  if (
    tokens[index + 1]?.value === '.' &&
    property?.kind === 'identifier' &&
    SAFE_CONSOLE_PROPERTIES.has(property.value)
  ) {
    return;
  }
  const code =
    property?.kind === 'identifier'
      ? FORBIDDEN_REFLECTED_PROPERTIES.get(property.value)
      : undefined;
  capabilityFailure(code ?? 'runtime-console-access-forbidden', artifact, 'noncanonical console access');
}

function assertNoDynamicRuntimeCapability(source: string, artifact: string): void {
  const tokens = tokenize(source, artifact);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const prior = tokens[index - 1]?.value;
    const openBracketIndex = index - 1;
    if (
      token?.kind === 'string' &&
      prior === '[' &&
      isComputedPropertyOpen(tokens, openBracketIndex)
    ) {
      const closeBracketIndex = closingBracketIndex(tokens, openBracketIndex);
      if (token.escaped === true) {
        capabilityFailure('escaped-computed-property', artifact, 'escaped computed property');
      }
      if (closeBracketIndex === index + 1) {
        const propertyCode = FORBIDDEN_REFLECTED_PROPERTIES.get(token.value);
        if (propertyCode !== undefined) capabilityFailure(propertyCode, artifact, token.value);
      } else if (
        closeBracketIndex === undefined ||
        tokens
          .slice(index + 1, closeBracketIndex)
          .some((candidate) => candidate.value === '+')
      ) {
        capabilityFailure('runtime-reflection-forbidden', artifact, 'concatenated computed property');
      }
    }
    if (token?.kind !== 'identifier') continue;
    const first = token.value;
    const second = tokens[index + 1]?.value;
    const third = tokens[index + 2]?.value;
    if (
      first === 'import' &&
      second === '.' &&
      third === 'meta'
    ) {
      auditFailure(
        'runtime-loader-forbidden',
        artifact,
        `import.meta loader access is forbidden in ${artifact}.`,
      );
    }
    if (first === 'Reflect') {
      assertDirectReflectAccess(tokens, index, artifact);
      continue;
    }
    if (first === 'process') {
      assertSafeProcessAccess(tokens, index, artifact);
      continue;
    }
    if (first === 'console') {
      assertSafeConsoleAccess(tokens, index, artifact);
      continue;
    }
    if (FORBIDDEN_GLOBAL_OBJECTS.has(first)) {
      capabilityFailure('runtime-global-access-forbidden', artifact, first);
    }
    const capabilityCode = FORBIDDEN_CAPABILITY_IDENTIFIERS.get(first);
    if (capabilityCode !== undefined) capabilityFailure(capabilityCode, artifact, first);
    if (
      first === 'Atomics' &&
      second === '.' &&
      (third === 'wait' || third === 'waitAsync')
    ) {
      capabilityFailure('operational-clock-forbidden', artifact, `Atomics.${third}`);
    }
    if (prior === '.' && first === 'constructor') {
      capabilityFailure('runtime-codegen-forbidden', artifact, 'constructor');
    }
  }
}

function repositoryPath(root: string, filePath: string): string {
  return path.resolve(root, filePath);
}

function posixRelative(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join('/');
}

async function assertNoSymlinkPath(root: string, absolute: string, artifact: string): Promise<void> {
  const relative = path.relative(root, absolute);
  let cursor = root;
  for (const segment of relative.split(path.sep)) {
    if (segment === '') continue;
    cursor = path.join(cursor, segment);
    const metadata = await lstat(cursor);
    if (metadata.isSymbolicLink()) {
      auditFailure('symlink-target', artifact, `Symlink target is forbidden: ${artifact}.`);
    }
  }
}

async function resolveGitDirectory(root: string): Promise<string> {
  const dotGit = path.join(root, '.git');
  const metadata = await lstat(dotGit);
  if (metadata.isDirectory()) return dotGit;
  if (!metadata.isFile()) {
    auditFailure('git-metadata-invalid', '.git', 'Repository .git metadata is invalid.');
  }
  const pointer = await readFile(dotGit, 'utf8');
  const prefix = 'gitdir: ';
  if (!pointer.startsWith(prefix)) {
    auditFailure('git-metadata-invalid', '.git', 'Repository .git pointer is invalid.');
  }
  const target = pointer.slice(prefix.length).trim();
  return path.resolve(root, target);
}

export async function readGitIndexTrackedPaths(
  repositoryRoot: string,
): Promise<ReadonlySet<string>> {
  const root = await realpath(repositoryRoot);
  const gitDirectory = await resolveGitDirectory(root);
  const bytes = Uint8Array.from(await readFile(path.join(gitDirectory, 'index')));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.byteLength < 32 ||
    new TextDecoder().decode(bytes.subarray(0, 4)) !== 'DIRC'
  ) {
    auditFailure('git-index-invalid', '.git/index', 'Git index header is invalid.');
  }
  const version = view.getUint32(4, false);
  if (version !== 2 && version !== 3) {
    auditFailure('git-index-version', '.git/index', `Unsupported Git index version ${version}.`);
  }
  const count = view.getUint32(8, false);
  const tracked = new Set<string>();
  let offset = 12;
  for (let entryIndex = 0; entryIndex < count; entryIndex += 1) {
    const entryStart = offset;
    if (offset + 62 > bytes.byteLength - 20) {
      auditFailure('git-index-invalid', '.git/index', 'Git index entry exceeds its checksum boundary.');
    }
    const flags = view.getUint16(offset + 60, false);
    const extended = (flags & 0x4000) !== 0;
    const fixedLength = extended ? 64 : 62;
    let pathEnd = offset + fixedLength;
    while (pathEnd < bytes.byteLength - 20 && bytes[pathEnd] !== 0) pathEnd += 1;
    if (pathEnd >= bytes.byteLength - 20) {
      auditFailure('git-index-invalid', '.git/index', 'Git index path is unterminated.');
    }
    const filePath = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(offset + fixedLength, pathEnd),
    );
    tracked.add(filePath);
    const entryLength = pathEnd - entryStart + 1;
    offset = entryStart + Math.ceil(entryLength / 8) * 8;
  }
  return tracked;
}

function assertAllowedProjectTarget(relativeTarget: string): void {
  if (!ALLOWED_PROJECT_RUNTIME_PATHS.has(relativeTarget)) {
    auditFailure(
      'project-runtime-not-allowlisted',
      relativeTarget,
      `Project runtime source is not in the exact input allowlist: ${relativeTarget}.`,
    );
  }
}

function sameOrderedStrings(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function assertExpectedRuntimeClosure(
  expected: RuntimeImportClosureExpectation,
): void {
  const expectedRoot = SERVICE_FAST_INPUT_PROJECT_RUNTIME_ALLOWLIST[0];
  if (
    expectedRoot === undefined ||
    !sameOrderedStrings(expected.entryRoots, [expectedRoot])
  ) {
    auditFailure(
      'runtime-closure-contract-mismatch',
      'entryRoots',
      'Runtime entry roots differ from the exact input root.',
    );
  }
  if (
    expected.projectSources.length !==
    SERVICE_FAST_INPUT_PROJECT_RUNTIME_ALLOWLIST.length
  ) {
    auditFailure(
      'runtime-closure-contract-mismatch',
      'projectSources',
      'Runtime project descriptor count differs from the exact input graph.',
    );
  }
  for (let index = 0; index < expected.projectSources.length; index += 1) {
    const descriptor = expected.projectSources[index];
    if (
      descriptor === undefined ||
      descriptor.path !== SERVICE_FAST_INPUT_PROJECT_RUNTIME_ALLOWLIST[index] ||
      !Number.isSafeInteger(descriptor.bytes) ||
      descriptor.bytes <= 0 ||
      !/^sha256:[0-9a-f]{64}$/u.test(descriptor.sha256)
    ) {
      auditFailure(
        'runtime-closure-contract-mismatch',
        `projectSources[${index}]`,
        'Runtime project descriptors are invalid, missing, duplicated, or reordered.',
      );
    }
  }
  if (
    !sameOrderedStrings(
      expected.nodeBuiltins,
      SERVICE_FAST_INPUT_BUILTIN_RUNTIME_ALLOWLIST,
    )
  ) {
    auditFailure(
      'runtime-closure-contract-mismatch',
      'nodeBuiltins',
      'Runtime built-ins differ from the exact input set.',
    );
  }
}

async function readVerifiedRuntimeSource(
  root: string,
  tracked: ReadonlySet<string>,
  descriptor: RuntimeSourceDescriptor,
): Promise<string> {
  const requested = descriptor.path;
  if (path.isAbsolute(requested)) {
    auditFailure('absolute-target', requested, `Absolute audit target is forbidden: ${requested}.`);
  }
  const absolute = repositoryPath(root, requested);
  const relative = posixRelative(root, absolute);
  if (relative === '..' || relative.startsWith('../')) {
    auditFailure('traversal-target', requested, `Audit target escapes the repository: ${requested}.`);
  }
  if (!tracked.has(relative)) {
    auditFailure('untracked-target', relative, `Runtime target is not tracked: ${relative}.`);
  }
  if (path.extname(relative) !== '.ts') {
    auditFailure('runtime-extension', relative, `Runtime source must name an explicit .ts leaf: ${relative}.`);
  }
  assertAllowedProjectTarget(relative);
  await assertNoSymlinkPath(root, absolute, relative);
  const metadata = await lstat(absolute);
  if (!metadata.isFile()) {
    auditFailure('runtime-target-not-file', relative, `Runtime target is not a regular file: ${relative}.`);
  }
  const bytes = Uint8Array.from(await readFile(absolute));
  if (bytes.byteLength !== descriptor.bytes) {
    auditFailure(
      'runtime-source-byte-mismatch',
      relative,
      `Runtime source byte count differs for ${relative}.`,
    );
  }
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (digest !== descriptor.sha256) {
    auditFailure(
      'runtime-source-hash-mismatch',
      relative,
      `Runtime source hash differs for ${relative}.`,
    );
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return auditFailure(
      'invalid-source-syntax',
      relative,
      `Runtime source is not valid UTF-8: ${relative}.`,
    );
  }
}

export async function auditRuntimeImportClosure(
  options: RuntimeImportAuditOptions,
): Promise<RuntimeImportAuditResult> {
  assertExpectedRuntimeClosure(options.expected);
  const root = await realpath(options.repositoryRoot);
  const tracked = options.trackedPaths ?? (await readGitIndexTrackedPaths(root));
  const verifiedSources = new Map<string, string>();
  for (const descriptor of options.expected.projectSources) {
    verifiedSources.set(
      descriptor.path,
      await readVerifiedRuntimeSource(root, tracked, descriptor),
    );
  }

  const pending = [...options.expected.entryRoots];
  const visited = new Set<string>();
  const builtins = new Set<string>();

  while (pending.length > 0) {
    const requested = pending.shift();
    if (requested === undefined) break;
    if (path.isAbsolute(requested)) {
      auditFailure('absolute-target', requested, `Absolute audit target is forbidden: ${requested}.`);
    }
    const absolute = repositoryPath(root, requested);
    const relative = posixRelative(root, absolute);
    if (relative === '..' || relative.startsWith('../')) {
      auditFailure('traversal-target', requested, `Audit target escapes the repository: ${requested}.`);
    }
    if (visited.has(relative)) continue;
    assertAllowedProjectTarget(relative);
    const source = verifiedSources.get(relative);
    if (source === undefined) {
      auditFailure(
        'runtime-source-descriptor-missing',
        relative,
        `Runtime target has no verified descriptor: ${relative}.`,
      );
    }
    assertNoDynamicRuntimeCapability(source, relative);
    visited.add(relative);

    for (const specifier of moduleSpecifiers(source, relative)) {
      if (specifier.startsWith('node:')) {
        if (!ALLOWED_BUILTINS.has(specifier)) {
          auditFailure('builtin-import-forbidden', relative, `Forbidden built-in import ${specifier} in ${relative}.`);
        }
        builtins.add(specifier);
        continue;
      }
      if (path.isAbsolute(specifier)) {
        auditFailure('absolute-target', relative, `Absolute import target ${specifier} is forbidden.`);
      }
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
        auditFailure('bare-import-forbidden', relative, `Bare package import ${specifier} is forbidden in ${relative}.`);
      }
      const targetAbsolute = path.resolve(path.dirname(absolute), specifier);
      const targetRelative = posixRelative(root, targetAbsolute);
      if (targetRelative === '..' || targetRelative.startsWith('../')) {
        auditFailure('traversal-target', relative, `Import target escapes the repository: ${specifier}.`);
      }
      if (!specifier.endsWith('.ts')) {
        auditFailure('nonleaf-import', relative, `Import must name an explicit .ts leaf: ${specifier}.`);
      }
      assertAllowedProjectTarget(targetRelative);
      pending.push(targetRelative);
    }
  }

  const orderedFiles = [...visited].sort();
  const expectedFiles = options.expected.projectSources
    .map(({ path: filePath }) => filePath)
    .sort();
  if (
    orderedFiles.length !== expectedFiles.length ||
    orderedFiles.some((filePath, index) => filePath !== expectedFiles[index])
  ) {
    auditFailure(
      'runtime-closure-mismatch',
      options.expected.entryRoots.join(','),
      'Reachable project runtime files differ from the exact input allowlist.',
    );
  }
  const orderedBuiltins = [...builtins].sort();
  const expectedBuiltins = [...options.expected.nodeBuiltins].sort();
  if (
    orderedBuiltins.length !== expectedBuiltins.length ||
    orderedBuiltins.some((specifier, index) => specifier !== expectedBuiltins[index])
  ) {
    auditFailure(
      'builtin-closure-mismatch',
      options.expected.entryRoots.join(','),
      'Reachable built-ins differ from the exact input allowlist.',
    );
  }

  return Object.freeze({
    files: Object.freeze(orderedFiles),
    builtins: Object.freeze(orderedBuiltins),
  });
}
