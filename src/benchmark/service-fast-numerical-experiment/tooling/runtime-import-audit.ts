import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  SERVICE_FAST_ARTIFACT_VERIFIER_HELPER,
  SERVICE_FAST_SOURCE_CLOSURE_GENERATOR_HELPER,
} from './dispatch-contract.ts';
import {
  ServiceFastBoundedIdentityReadError,
  readBoundedIdentityFile,
} from './bounded-identity-reader.ts';

const FIXED_DISPATCH_SOURCE =
  'src/benchmark/service-fast-numerical-experiment/tooling/dispatcher.ts';
const FIXED_DISPATCH_CONTRACT_SOURCE =
  'src/benchmark/service-fast-numerical-experiment/tooling/dispatch-contract.ts';
const BOUNDED_GIT_SOURCE =
  'src/benchmark/service-fast-numerical-experiment/source-closure/git.ts';
const SOURCE_CLOSURE_CODEC_SOURCE =
  'src/benchmark/service-fast-numerical-experiment/source-closure/codec.ts';
const INPUT_CLOSURE_AUDIT_SOURCE =
  'src/benchmark/service-fast-numerical-experiment/input/closure-audit.ts';
const ANYTIME_EXACT_INPUT_SPLIT_SOURCE =
  'src/router/anytime-exact-input-split/index.ts';
const EXACT_INPUT_SPLIT_SESSION_SOURCE =
  'src/router/exact-input-split-session/index.ts';
const NUMERICAL_EXACT_INPUT_SPLIT_SOURCE =
  'src/router/numerical-exact-input-split/index.ts';
const PREPARED_ROUTING_CONTEXT_SOURCE =
  'src/runtime/prepared-routing-context/index.ts';
const BOUNDED_SNAPSHOT_JSON_SOURCE =
  'src/runtime/prepared-service-routing-context/bounded-snapshot-json.ts';
const DURABLE_BOUNDED_FILE_SOURCE =
  'src/benchmark/service-fast-numerical-experiment/artifact-verifier/io/bounded-file.ts';
const DURABLE_ENTRY_SOURCE = SERVICE_FAST_ARTIFACT_VERIFIER_HELPER;
const DURABLE_HOST_ADMISSION_SOURCE =
  'src/benchmark/service-fast-numerical-experiment/artifact-verifier/host-admission.ts';
const SOURCE_CLOSURE_GENERATION_ENTRY_SOURCE =
  'src/benchmark/service-fast-numerical-experiment/source-closure/generate-entry.ts';
const SOURCE_CLOSURE_PUBLICATION_SOURCE =
  'src/benchmark/service-fast-numerical-experiment/source-closure/publication.ts';
const VERIFIER_CLI_SOURCE = 'cli/verify-service-fast-numerical-experiment.ts';
const ACCEPTED_RUN_CLOCK_SOURCE =
  'src/benchmark/service-fast-numerical-experiment/accepted-run/clock.ts';
const ACCEPTED_RUN_ENVIRONMENT_SOURCE =
  'src/benchmark/service-fast-numerical-experiment/accepted-run/environment.ts';
const ACCEPTED_RUN_PUBLICATION_SOURCE =
  'src/benchmark/service-fast-numerical-experiment/accepted-run/publication.ts';

const INPUT_CLOSURE_AUDIT_CONSTRUCTOR_CONTEXTS = Object.freeze([
  "['constructor', 'runtime-codegen-forbidden']",
  "first === 'constructor'",
  "capabilityFailure('runtime-codegen-forbidden', artifact, 'constructor')",
]);
const INPUT_CLOSURE_AUDIT_REVIEWED_BYTES = 35_956;
const INPUT_CLOSURE_AUDIT_REVIEWED_SHA256 =
  'a9edcbae67ce58a4d45c252b3729eea90b2e409ae4f565656f5abfae733c7120';

const FORBIDDEN_BUILTINS = new Set([
  'node:cluster',
  'node:dgram',
  'node:dns',
  'node:http',
  'node:http2',
  'node:https',
  'node:inspector',
  'node:module',
  'node:net',
  'node:perf_hooks',
  'node:repl',
  'node:tls',
  'node:vm',
]);

export const SERVICE_FAST_NO_ARGUMENT_PARENT_RUNTIME_PATHS = Object.freeze([
  'cli/verify-service-fast-numerical-experiment.ts',
  'src/benchmark/service-fast-numerical-experiment/source-closure/codec.ts',
  'src/benchmark/service-fast-numerical-experiment/source-closure/error.ts',
  'src/benchmark/service-fast-numerical-experiment/source-closure/git-contract.ts',
  'src/benchmark/service-fast-numerical-experiment/source-closure/git.ts',
  'src/benchmark/service-fast-numerical-experiment/source-closure/publication-error.ts',
  'src/benchmark/service-fast-numerical-experiment/source-closure/reviewed-input-binding.ts',
  'src/benchmark/service-fast-numerical-experiment/source-closure/revision-admission.ts',
  'src/benchmark/service-fast-numerical-experiment/source-closure/verification.ts',
  'src/benchmark/service-fast-numerical-experiment/tooling/bounded-identity-reader.ts',
  'src/benchmark/service-fast-numerical-experiment/tooling/dispatch-contract.ts',
  'src/benchmark/service-fast-numerical-experiment/tooling/dispatcher.ts',
  'src/benchmark/service-fast-numerical-experiment/tooling/durable-runtime-profile.ts',
  'src/benchmark/service-fast-numerical-experiment/tooling/durable-verifier-bootstrap.ts',
  'src/benchmark/service-fast-numerical-experiment/tooling/fixed-repository-root.ts',
  'src/benchmark/service-fast-numerical-experiment/tooling/runtime-import-audit.ts',
  'src/benchmark/service-fast-numerical-experiment/tooling/tool-failure.ts',
]);

export const SERVICE_FAST_GENERATION_CHILD_RUNTIME_PATHS = Object.freeze([
  'src/benchmark/service-fast-numerical-experiment/source-closure/codec.ts',
  'src/benchmark/service-fast-numerical-experiment/source-closure/error.ts',
  'src/benchmark/service-fast-numerical-experiment/source-closure/generate-entry.ts',
  'src/benchmark/service-fast-numerical-experiment/source-closure/generate.ts',
  'src/benchmark/service-fast-numerical-experiment/source-closure/git-contract.ts',
  'src/benchmark/service-fast-numerical-experiment/source-closure/git.ts',
  'src/benchmark/service-fast-numerical-experiment/source-closure/publication-error.ts',
  'src/benchmark/service-fast-numerical-experiment/source-closure/publication.ts',
  'src/benchmark/service-fast-numerical-experiment/source-closure/reviewed-input-binding.ts',
  'src/benchmark/service-fast-numerical-experiment/source-closure/revision-admission.ts',
  'src/benchmark/service-fast-numerical-experiment/tooling/bounded-identity-reader.ts',
  'src/benchmark/service-fast-numerical-experiment/tooling/dispatch-contract.ts',
  'src/benchmark/service-fast-numerical-experiment/tooling/fixed-repository-root.ts',
  'src/benchmark/service-fast-numerical-experiment/tooling/readme-template.ts',
  'src/benchmark/service-fast-numerical-experiment/tooling/runtime-import-audit.ts',
  'src/benchmark/service-fast-numerical-experiment/tooling/size-admission.ts',
  'src/benchmark/service-fast-numerical-experiment/tooling/tool-failure.ts',
]);

export const SERVICE_FAST_NO_ARGUMENT_PARENT_RUNTIME_BUILTINS = Object.freeze([
  'node:child_process',
  'node:crypto',
  'node:fs/promises',
  'node:path',
  'node:url',
]);

export const SERVICE_FAST_GENERATION_CHILD_RUNTIME_BUILTINS = Object.freeze([
  'node:child_process',
  'node:crypto',
  'node:fs/promises',
  'node:path',
  'node:url',
]);

export interface RuntimeProjectDescriptor {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface RuntimePathCapability {
  readonly path: string;
  readonly builtins: readonly string[];
  readonly capabilities: readonly (
    | 'bounded-git-metadata'
    | 'fixed-child-dispatch'
    | 'hash'
    | 'read-only-filesystem'
    | 'source-closure-publication'
    | 'fixed-repository-root'
    | 'operational-clock'
    | 'runtime-environment'
    | 'accepted-publication'
  )[];
}

export interface RuntimeImportAuditProfile {
  readonly profileId: string;
  readonly entryRoots: readonly string[];
  readonly projectSources: readonly RuntimeProjectDescriptor[];
  readonly nodeBuiltins: readonly string[];
  readonly pathCapabilities: readonly RuntimePathCapability[];
}

export interface RuntimeImportAuditOptions {
  readonly repositoryRoot: string;
  readonly profile: RuntimeImportAuditProfile;
  readonly trackedPaths: ReadonlySet<string>;
  readonly ignoredPaths?: ReadonlySet<string>;
}

export interface RuntimeImportAuditResult {
  readonly projectSources: readonly string[];
  readonly nodeBuiltins: readonly string[];
}

export class ServiceFastRuntimeImportAuditError extends Error {
  readonly code: string;
  readonly artifact: string;
  readonly toolFailureFamily = 'runtime-import';

  constructor(code: string, artifact: string, message: string) {
    super(message);
    this.code = code;
    this.artifact = artifact;
  }
}

function auditFailure(code: string, artifact: string, message: string): never {
  throw new ServiceFastRuntimeImportAuditError(code, artifact, message);
}

function compareRawUtf16(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalRuntimePath(value: string): string {
  if (
    value.length === 0 ||
    value.includes('\\') ||
    value.includes('\0') ||
    path.posix.isAbsolute(value) ||
    path.posix.normalize(value) !== value ||
    value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    return auditFailure('invalid-runtime-path', value, `Invalid runtime path ${value}.`);
  }
  return value;
}

type RuntimeSlashMode = 'ambiguous' | 'division' | 'regex';

interface RuntimeLexicalState {
  slashMode: RuntimeSlashMode;
  pendingControlParenthesis: string | null;
  readonly parenthesisContexts: (string | null)[];
  propertyIdentifierExpected: boolean;
  restrictedStatement: 'break' | 'continue' | 'debugger' | null;
  forBindingExpected: boolean;
}

const RUNTIME_REGEX_PREFIX_KEYWORDS = new Set([
  'await',
  'case',
  'delete',
  'default',
  'do',
  'else',
  'extends',
  'in',
  'instanceof',
  'new',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
]);
const RUNTIME_CONTROL_PARENTHESIS_KEYWORDS = new Set([
  'catch',
  'for',
  'if',
  'switch',
  'while',
  'with',
]);
const RUNTIME_MULTI_CHARACTER_PUNCTUATORS = Object.freeze([
  '>>>=',
  '===',
  '!==',
  '>>>',
  '**=',
  '&&=',
  '||=',
  '??=',
  '<<=',
  '>>=',
  '...',
  '=>',
  '==',
  '!=',
  '<=',
  '>=',
  '++',
  '--',
  '&&',
  '||',
  '??',
  '**',
  '<<',
  '>>',
  '+=',
  '-=',
  '*=',
  '%=',
  '&=',
  '|=',
  '^=',
  '?.',
]);

function createRuntimeLexicalState(): RuntimeLexicalState {
  return {
    slashMode: 'regex',
    pendingControlParenthesis: null,
    parenthesisContexts: [],
    propertyIdentifierExpected: false,
    restrictedStatement: null,
    forBindingExpected: false,
  };
}

function isRuntimeIdentifierStart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z_$]/u.test(character);
}

function isRuntimeIdentifierPart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_$]/u.test(character);
}

function runtimeIdentifierEnd(source: string, start: number): number {
  let end = start + 1;
  while (isRuntimeIdentifierPart(source[end])) end += 1;
  return end;
}

function runtimePunctuatorAt(source: string, index: number): string | null {
  for (const punctuator of RUNTIME_MULTI_CHARACTER_PUNCTUATORS) {
    if (source.startsWith(punctuator, index)) return punctuator;
  }
  const character = source[index];
  return character !== undefined && /[()[\]{};,.?:~!%^&*+\-=|<>]/u.test(character)
    ? character
    : null;
}

function noteRuntimeExpressionEnd(state: RuntimeLexicalState): void {
  state.slashMode = 'division';
  state.pendingControlParenthesis = null;
  state.propertyIdentifierExpected = false;
  state.restrictedStatement = null;
  state.forBindingExpected = false;
}

function noteRuntimeExpressionPrefix(state: RuntimeLexicalState): void {
  state.slashMode = 'regex';
  state.pendingControlParenthesis = null;
  state.propertyIdentifierExpected = false;
  state.restrictedStatement = null;
  state.forBindingExpected = false;
}

function noteRuntimeLineTerminator(state: RuntimeLexicalState): void {
  if (state.restrictedStatement !== null) {
    state.slashMode = 'regex';
    state.restrictedStatement = null;
    state.forBindingExpected = false;
  }
}

function noteRuntimeIdentifier(
  state: RuntimeLexicalState,
  identifier: string,
): void {
  const priorMode = state.slashMode;
  const restrictedStatement = state.restrictedStatement;
  if (state.propertyIdentifierExpected) {
    noteRuntimeExpressionEnd(state);
    return;
  }
  if (restrictedStatement === 'break' || restrictedStatement === 'continue') {
    state.slashMode = 'ambiguous';
    state.pendingControlParenthesis = null;
    state.propertyIdentifierExpected = false;
    state.forBindingExpected = false;
    return;
  }
  if (
    identifier === 'break' ||
    identifier === 'continue' ||
    identifier === 'debugger'
  ) {
    state.slashMode = 'ambiguous';
    state.pendingControlParenthesis = null;
    state.propertyIdentifierExpected = false;
    state.restrictedStatement = identifier;
    state.forBindingExpected = false;
    return;
  }
  if (
    state.pendingControlParenthesis === 'for' &&
    identifier === 'await'
  ) {
    state.slashMode = 'regex';
    state.propertyIdentifierExpected = false;
    return;
  }
  if (RUNTIME_CONTROL_PARENTHESIS_KEYWORDS.has(identifier)) {
    state.slashMode = 'regex';
    state.pendingControlParenthesis = identifier;
    state.propertyIdentifierExpected = false;
    return;
  }
  const forContext = state.parenthesisContexts.at(-1) === 'for';
  if (
    forContext &&
    (identifier === 'const' || identifier === 'let' || identifier === 'var')
  ) {
    state.slashMode = 'regex';
    state.pendingControlParenthesis = null;
    state.propertyIdentifierExpected = false;
    state.restrictedStatement = null;
    state.forBindingExpected = true;
    return;
  }
  if (forContext && state.forBindingExpected) {
    state.slashMode = 'division';
    state.pendingControlParenthesis = null;
    state.propertyIdentifierExpected = false;
    state.restrictedStatement = null;
    state.forBindingExpected = false;
    return;
  }
  if (identifier === 'of' && forContext) {
    state.slashMode = priorMode === 'division'
      ? 'regex'
      : priorMode === 'regex'
        ? 'division'
        : 'ambiguous';
  } else {
    state.slashMode = RUNTIME_REGEX_PREFIX_KEYWORDS.has(identifier)
      ? 'regex'
      : 'division';
  }
  state.pendingControlParenthesis = null;
  state.propertyIdentifierExpected = false;
  state.restrictedStatement = null;
  state.forBindingExpected = false;
}

function noteRuntimePunctuator(
  state: RuntimeLexicalState,
  punctuator: string,
): void {
  const priorMode = state.slashMode;
  const controlParenthesis = state.pendingControlParenthesis;
  state.pendingControlParenthesis = null;
  state.propertyIdentifierExpected = false;
  state.restrictedStatement = null;
  state.forBindingExpected = false;
  if (punctuator === '(') {
    state.parenthesisContexts.push(controlParenthesis);
    state.slashMode = 'regex';
    return;
  }
  if (punctuator === ')') {
    const context = state.parenthesisContexts.pop();
    state.slashMode = context !== undefined && context !== null
      ? 'regex'
      : context === null
        ? 'division'
        : 'ambiguous';
    return;
  }
  if (punctuator === '.' || punctuator === '?.') {
    state.slashMode = 'ambiguous';
    state.propertyIdentifierExpected = true;
    return;
  }
  if (punctuator === ']') {
    state.slashMode = 'division';
    return;
  }
  if (punctuator === '}') {
    state.slashMode = 'ambiguous';
    return;
  }
  if (punctuator === '>' || punctuator === '>>' || punctuator === '>>>') {
    state.slashMode = 'ambiguous';
    return;
  }
  if (punctuator === '++' || punctuator === '--') {
    state.slashMode = priorMode;
    return;
  }
  if (punctuator === '!') {
    state.slashMode = priorMode === 'division' ? 'division' : priorMode;
    return;
  }
  if (punctuator === '...') {
    state.slashMode = 'regex';
    return;
  }
  state.slashMode = 'regex';
}

function runtimeRegularExpressionEnd(
  source: string,
  start: number,
  artifact: string,
): number {
  let index = start + 1;
  let inClass = false;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      if (source[index + 1] === undefined) {
        return auditFailure('invalid-source-syntax', artifact, 'Unterminated regular expression.');
      }
      index += 2;
      continue;
    }
    if (character === '[') inClass = true;
    else if (character === ']' && inClass) inClass = false;
    else if (character === '/' && !inClass) {
      index += 1;
      while (/[A-Za-z]/u.test(source[index] ?? '')) index += 1;
      return index;
    }
    if (character === '\n' || character === '\r') {
      return auditFailure('invalid-source-syntax', artifact, 'Unterminated regular expression.');
    }
    index += 1;
  }
  return auditFailure('invalid-source-syntax', artifact, 'Unterminated regular expression.');
}

function requireUnambiguousSlash(
  state: RuntimeLexicalState,
  artifact: string,
): void {
  if (state.slashMode === 'ambiguous') {
    auditFailure(
      'invalid-source-syntax',
      artifact,
      `Ambiguous regular-expression or division slash in ${artifact}.`,
    );
  }
}

interface RuntimeRegexSourceEvidence {
  readonly start: number;
  readonly end: number;
  readonly value: string | null;
}

interface RuntimeLiteralEvidence {
  readonly staticTemplateValues: string[];
  readonly regexSources: RuntimeRegexSourceEvidence[];
}

interface StaticTemplateDecodeResult {
  readonly end: number;
  readonly value: string | null;
}

function quotedLiteralEnd(source: string, start: number): number | null {
  const quote = source[start];
  if (quote !== '"' && quote !== "'") return null;
  let index = start + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      if (source[index + 1] === undefined) return null;
      index += 2;
      continue;
    }
    index += 1;
    if (character === quote) return index;
    if (character === '\n' || character === '\r') return null;
  }
  return null;
}

function templateInterpolationEnd(source: string, start: number): number | null {
  let depth = 1;
  let index = start;
  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    if (character === '/' && next === '/') {
      index += 2;
      while (
        index < source.length &&
        source[index] !== '\n' &&
        source[index] !== '\r'
      ) {
        index += 1;
      }
      continue;
    }
    if (character === '/' && next === '*') {
      index += 2;
      while (
        index < source.length &&
        !(source[index] === '*' && source[index + 1] === '/')
      ) {
        index += 1;
      }
      if (index >= source.length) return null;
      index += 2;
      continue;
    }
    if (character === '"' || character === "'") {
      const end = quotedLiteralEnd(source, index);
      if (end === null) return null;
      index = end;
      continue;
    }
    if (character === '`') {
      const nested = decodeStaticTemplateAt(source, index);
      if (nested.end <= index) return null;
      index = nested.end;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  return null;
}

function removeStaticExpressionComments(source: string): string | null {
  let result = '';
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    if (character === '"' || character === "'") {
      const end = quotedLiteralEnd(source, index);
      if (end === null) return null;
      result += source.slice(index, end);
      index = end;
      continue;
    }
    if (character === '`') {
      const template = decodeStaticTemplateAt(source, index);
      if (template.end <= index) return null;
      result += source.slice(index, template.end);
      index = template.end;
      continue;
    }
    if (character === '/' && next === '/') {
      index += 2;
      while (
        index < source.length &&
        source[index] !== '\n' &&
        source[index] !== '\r'
      ) {
        index += 1;
      }
      result += ' ';
      continue;
    }
    if (character === '/' && next === '*') {
      index += 2;
      while (
        index < source.length &&
        !(source[index] === '*' && source[index + 1] === '/')
      ) {
        index += 1;
      }
      if (index >= source.length) return null;
      index += 2;
      result += ' ';
      continue;
    }
    result += character;
    index += 1;
  }
  return result;
}

function staticRegexLiteralEnd(source: string, start: number): number | null {
  if (source[start] !== '/') return null;
  let index = start + 1;
  let inClass = false;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      if (source[index + 1] === undefined) return null;
      index += 2;
      continue;
    }
    if (character === '[') inClass = true;
    else if (character === ']' && inClass) inClass = false;
    else if (character === '/' && !inClass) {
      index += 1;
      while (/[A-Za-z]/u.test(source[index] ?? '')) index += 1;
      return index;
    }
    if (character === '\n' || character === '\r') return null;
    index += 1;
  }
  return null;
}

function matchingStaticOuterParenthesis(source: string): number | null {
  if (source[0] !== '(') return null;
  let depth = 0;
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === '"' || character === "'") {
      const end = quotedLiteralEnd(source, index);
      if (end === null) return null;
      index = end;
      continue;
    }
    if (character === '`') {
      const template = decodeStaticTemplateAt(source, index);
      if (template.end <= index) return null;
      index = template.end;
      continue;
    }
    if (character === '/') {
      const regexEnd = staticRegexLiteralEnd(source, index);
      if (regexEnd !== null) {
        index = regexEnd;
        continue;
      }
    }
    if (character === '(') depth += 1;
    if (character === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  return null;
}

function splitTopLevelStaticAddition(source: string): readonly string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === '"' || character === "'") {
      const end = quotedLiteralEnd(source, index);
      if (end === null) return null;
      index = end;
      continue;
    }
    if (character === '`') {
      const template = decodeStaticTemplateAt(source, index);
      if (template.end <= index) return null;
      index = template.end;
      continue;
    }
    if (character === '/') {
      const regexEnd = staticRegexLiteralEnd(source, index);
      if (regexEnd !== null) {
        index = regexEnd;
        continue;
      }
    }
    if (character === '(') depth += 1;
    if (character === ')') {
      depth -= 1;
      if (depth < 0) return null;
    }
    if (
      character === '+' &&
      depth === 0 &&
      source[index - 1] !== '+' &&
      source[index + 1] !== '+' &&
      source[index + 1] !== '='
    ) {
      parts.push(source.slice(start, index));
      start = index + 1;
      if (parts.length > 16) return null;
    }
    index += 1;
  }
  if (depth !== 0 || parts.length === 0) return null;
  parts.push(source.slice(start));
  return Object.freeze(parts);
}

function decodeExactRegexSourceExpression(source: string): string | null {
  const regexEnd = staticRegexLiteralEnd(source, 0);
  if (regexEnd === null) return null;
  let propertyStart = regexEnd;
  while (/\s/u.test(source[propertyStart] ?? '')) propertyStart += 1;
  if (source.slice(propertyStart) !== '.source') return null;
  const pattern = runtimeRegexPattern(source, 0);
  return pattern === null ? null : decodeStaticLiteralEscapes(pattern);
}

function decodeExactStaticExpression(source: string): string | null {
  const commentFree = removeStaticExpressionComments(source);
  if (commentFree === null) return null;
  let expression = commentFree.trim();
  let outerClose = matchingStaticOuterParenthesis(expression);
  while (outerClose === expression.length - 1) {
    expression = expression.slice(1, -1).trim();
    outerClose = matchingStaticOuterParenthesis(expression);
  }
  const addition = splitTopLevelStaticAddition(expression);
  if (addition !== null) {
    let joined = '';
    for (const part of addition) {
      const value = decodeExactStaticExpression(part);
      if (value === null) return null;
      joined += value;
    }
    return joined;
  }
  if (expression.startsWith('`')) {
    const decoded = decodeStaticTemplateAt(expression, 0);
    return decoded.end === expression.length ? decoded.value : null;
  }
  if (expression.startsWith('/')) {
    return decodeExactRegexSourceExpression(expression);
  }
  const end = quotedLiteralEnd(expression, 0);
  if (end !== expression.length) return null;
  return decodeStaticLiteralEscapes(expression.slice(1, -1));
}

function decodeStaticTemplateAt(
  source: string,
  start: number,
): StaticTemplateDecodeResult {
  if (source[start] !== '`') return { end: start, value: null };
  let index = start + 1;
  let rawSegment = '';
  let value: string | null = '';
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      if (source[index + 1] === undefined) return { end: source.length, value: null };
      rawSegment += source.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (character === '`') {
      const decodedSegment = decodeStaticLiteralEscapes(rawSegment);
      value = value === null || decodedSegment === null
        ? null
        : value + decodedSegment;
      return { end: index + 1, value };
    }
    if (character === '$' && source[index + 1] === '{') {
      const decodedSegment = decodeStaticLiteralEscapes(rawSegment);
      value = value === null || decodedSegment === null
        ? null
        : value + decodedSegment;
      const expressionStart = index + 2;
      const expressionEnd = templateInterpolationEnd(source, expressionStart);
      if (expressionEnd === null) return { end: source.length, value: null };
      const expressionValue = decodeExactStaticExpression(
        source.slice(expressionStart, expressionEnd),
      );
      value = value === null || expressionValue === null
        ? null
        : value + expressionValue;
      index = expressionEnd + 1;
      rawSegment = '';
      continue;
    }
    rawSegment += character;
    index += 1;
  }
  return { end: source.length, value: null };
}

function runtimeRegexPattern(
  source: string,
  start: number,
): string | null {
  let index = start + 1;
  let inClass = false;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      if (source[index + 1] === undefined) return null;
      index += 2;
      continue;
    }
    if (character === '[') inClass = true;
    else if (character === ']' && inClass) inClass = false;
    else if (character === '/' && !inClass) {
      return source.slice(start + 1, index);
    }
    index += 1;
  }
  return null;
}

function maskComments(
  source: string,
  artifact: string,
  evidence?: RuntimeLiteralEvidence,
): string {
  const state = createRuntimeLexicalState();
  const output = source.split('');
  let index = 0;

  function maskRange(start: number, end: number): void {
    for (let cursor = start; cursor < end; cursor += 1) {
      const character = source[cursor];
      output[cursor] = character === '\n' || character === '\r'
        ? character
        : ' ';
    }
  }

  function skipQuoted(quote: '"' | "'"): void {
    index += 1;
    while (index < source.length) {
      const character = source[index];
      if (character === '\\') {
        if (source[index + 1] === undefined) {
          return auditFailure('invalid-source-syntax', artifact, 'Unterminated escape sequence.');
        }
        index += source[index + 1] === '\r' && source[index + 2] === '\n'
          ? 3
          : 2;
        continue;
      }
      index += 1;
      if (character === quote) return;
      if (character === '\n' || character === '\r') {
        return auditFailure('invalid-source-syntax', artifact, 'Unterminated string literal.');
      }
    }
    return auditFailure('invalid-source-syntax', artifact, 'Unterminated string literal.');
  }

  function scanTemplate(): void {
    const templateStart = index;
    const staticTemplate = decodeStaticTemplateAt(source, templateStart);
    if (staticTemplate.value !== null) {
      evidence?.staticTemplateValues.push(staticTemplate.value);
    }
    let rawStart = index;
    let interpolated = false;
    index += 1;
    while (index < source.length) {
      const character = source[index];
      if (character === '\\') {
        if (source[index + 1] === undefined) {
          return auditFailure('invalid-source-syntax', artifact, 'Unterminated template escape sequence.');
        }
        index += 2;
        continue;
      }
      if (character === '`') {
        index += 1;
        if (interpolated) maskRange(rawStart, index);
        return;
      }
      if (character === '$' && source[index + 1] === '{') {
        interpolated = true;
        maskRange(rawStart, index + 2);
        index += 2;
        noteRuntimeExpressionPrefix(state);
        scanCode(true);
        rawStart = index;
        continue;
      }
      index += 1;
    }
    maskRange(templateStart, index);
    return auditFailure('invalid-source-syntax', artifact, 'Unterminated template literal.');
  }

  function scanCode(templateExpression: boolean): void {
    let braceDepth = templateExpression ? 1 : 0;
    while (index < source.length) {
      const character = source[index];
      const next = source[index + 1];
      if (character === '\n' || character === '\r') {
        index += 1;
        noteRuntimeLineTerminator(state);
        continue;
      }
      if (character === '/' && next === '/') {
        const start = index;
        index += 2;
        while (index < source.length && source[index] !== '\n') index += 1;
        maskRange(start, index);
        continue;
      }
      if (character === '/' && next === '*') {
        const start = index;
        index += 2;
        while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
          if (source[index] === '\n' || source[index] === '\r') {
            noteRuntimeLineTerminator(state);
          }
          index += 1;
        }
        if (index >= source.length) {
          return auditFailure('invalid-source-syntax', artifact, 'Unterminated block comment.');
        }
        index += 2;
        maskRange(start, index);
        continue;
      }
      if (character === '"' || character === "'") {
        skipQuoted(character);
        noteRuntimeExpressionEnd(state);
        continue;
      }
      if (character === '`') {
        scanTemplate();
        noteRuntimeExpressionEnd(state);
        continue;
      }
      if (character === '/') {
        requireUnambiguousSlash(state, artifact);
        if (state.slashMode === 'regex') {
          const start = index;
          index = runtimeRegularExpressionEnd(source, index, artifact);
          let sourcePropertyEnd = index;
          while (/\s/u.test(source[sourcePropertyEnd] ?? '')) {
            sourcePropertyEnd += 1;
          }
          if (
            source.startsWith('.source', sourcePropertyEnd) &&
            !isRuntimeIdentifierPart(source[sourcePropertyEnd + 7])
          ) {
            const pattern = runtimeRegexPattern(source, start);
            evidence?.regexSources.push(Object.freeze({
              start,
              end: sourcePropertyEnd + 7,
              value: pattern === null
                ? null
                : decodeStaticLiteralEscapes(pattern),
            }));
          }
          maskRange(start, index);
          noteRuntimeExpressionEnd(state);
          continue;
        }
        index += 1;
        noteRuntimeExpressionPrefix(state);
        continue;
      }
      if (templateExpression && character === '{') braceDepth += 1;
      if (templateExpression && character === '}') {
        braceDepth -= 1;
        if (braceDepth === 0) {
          maskRange(index, index + 1);
          index += 1;
          return;
        }
      }
      if (isRuntimeIdentifierStart(character)) {
        const end = runtimeIdentifierEnd(source, index);
        noteRuntimeIdentifier(state, source.slice(index, end));
        index = end;
        continue;
      }
      if (character !== undefined && /[0-9]/u.test(character)) {
        index += 1;
        noteRuntimeExpressionEnd(state);
        continue;
      }
      const punctuator = runtimePunctuatorAt(source, index);
      if (punctuator !== null) {
        index += punctuator.length;
        noteRuntimePunctuator(state, punctuator);
        continue;
      }
      index += 1;
      if (character !== undefined && !/\s/u.test(character)) {
        state.slashMode = 'ambiguous';
        state.pendingControlParenthesis = null;
        state.propertyIdentifierExpected = false;
        state.restrictedStatement = null;
        state.forBindingExpected = false;
      }
    }
    if (templateExpression) {
      return auditFailure('invalid-source-syntax', artifact, 'Unterminated template interpolation.');
    }
  }

  scanCode(false);
  return output.join('');
}

function maskNonExecutableSource(source: string, artifact: string): string {
  const state = createRuntimeLexicalState();
  const output: string[] = source.split('').map((character) =>
    character === '\n' || character === '\r' ? character : ' ');
  let index = 0;

  function skipQuoted(quote: '"' | "'"): void {
    index += 1;
    while (index < source.length) {
      const character = source[index];
      if (character === '\\') {
        if (source[index + 1] === undefined) {
          return auditFailure('invalid-source-syntax', artifact, 'Unterminated escape sequence.');
        }
        index += source[index + 1] === '\r' && source[index + 2] === '\n'
          ? 3
          : 2;
        continue;
      }
      index += 1;
      if (character === quote) return;
      if (character === '\n' || character === '\r') {
        return auditFailure('invalid-source-syntax', artifact, 'Unterminated string literal.');
      }
    }
    return auditFailure('invalid-source-syntax', artifact, 'Unterminated string literal.');
  }

  function skipTemplate(): void {
    index += 1;
    while (index < source.length) {
      const character = source[index];
      if (character === '\\') {
        if (source[index + 1] === undefined) {
          return auditFailure('invalid-source-syntax', artifact, 'Unterminated template escape sequence.');
        }
        index += 2;
        continue;
      }
      if (character === '`') {
        index += 1;
        return;
      }
      if (character === '$' && source[index + 1] === '{') {
        index += 2;
        noteRuntimeExpressionPrefix(state);
        scanCode(true);
        continue;
      }
      index += 1;
    }
    return auditFailure('invalid-source-syntax', artifact, 'Unterminated template literal.');
  }

  function scanCode(templateExpression: boolean): void {
    let braceDepth = templateExpression ? 1 : 0;
    while (index < source.length) {
      const character = source[index];
      const next = source[index + 1];
      if (character === '\n' || character === '\r') {
        index += 1;
        noteRuntimeLineTerminator(state);
        continue;
      }
      if (character === '/' && next === '/') {
        index += 2;
        while (index < source.length && source[index] !== '\n') index += 1;
        continue;
      }
      if (character === '/' && next === '*') {
        index += 2;
        while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
          if (source[index] === '\n' || source[index] === '\r') {
            noteRuntimeLineTerminator(state);
          }
          index += 1;
        }
        if (index >= source.length) {
          return auditFailure('invalid-source-syntax', artifact, 'Unterminated block comment.');
        }
        index += 2;
        continue;
      }
      if (character === '"' || character === "'") {
        skipQuoted(character);
        noteRuntimeExpressionEnd(state);
        continue;
      }
      if (character === '`') {
        skipTemplate();
        noteRuntimeExpressionEnd(state);
        continue;
      }
      if (character === '/') {
        requireUnambiguousSlash(state, artifact);
        if (state.slashMode === 'regex') {
          index = runtimeRegularExpressionEnd(source, index, artifact);
          noteRuntimeExpressionEnd(state);
          continue;
        }
        output[index] = character;
        index += 1;
        noteRuntimeExpressionPrefix(state);
        continue;
      }
      if (templateExpression && character === '{') braceDepth += 1;
      if (templateExpression && character === '}') {
        braceDepth -= 1;
        if (braceDepth === 0) {
          index += 1;
          return;
        }
      }
      if (isRuntimeIdentifierStart(character)) {
        const end = runtimeIdentifierEnd(source, index);
        const identifier = source.slice(index, end);
        for (let cursor = index; cursor < end; cursor += 1) {
          output[cursor] = source[cursor] ?? ' ';
        }
        index = end;
        noteRuntimeIdentifier(state, identifier);
        continue;
      }
      if (character !== undefined && /[0-9]/u.test(character)) {
        output[index] = character;
        index += 1;
        noteRuntimeExpressionEnd(state);
        continue;
      }
      const punctuator = runtimePunctuatorAt(source, index);
      if (punctuator !== null) {
        for (let cursor = index; cursor < index + punctuator.length; cursor += 1) {
          output[cursor] = source[cursor] ?? ' ';
        }
        index += punctuator.length;
        noteRuntimePunctuator(state, punctuator);
        continue;
      }
      output[index] = character ?? ' ';
      index += 1;
      if (character !== undefined && !/\s/u.test(character)) {
        state.slashMode = 'ambiguous';
        state.pendingControlParenthesis = null;
        state.propertyIdentifierExpected = false;
        state.restrictedStatement = null;
        state.forBindingExpected = false;
      }
    }
    if (templateExpression) {
      return auditFailure('invalid-source-syntax', artifact, 'Unterminated template interpolation.');
    }
  }

  scanCode(false);
  return output.join('');
}

interface StaticImport {
  readonly specifier: string;
  readonly typeOnly: boolean;
  readonly importClause: string | null;
}

function staticImports(source: string, artifact: string): readonly StaticImport[] {
  const masked = maskComments(source, artifact);
  const executable = maskNonExecutableSource(source, artifact);
  if (/\bimport\s*\(/u.test(executable)) {
    return auditFailure('dynamic-loader-forbidden', artifact, `Dynamic import is forbidden in ${artifact}.`);
  }
  const imports: StaticImport[] = [];
  for (const match of executable.matchAll(/\b(import|export)\b/gu)) {
    const keyword = match[1];
    const position = match.index;
    if (keyword === undefined || position === undefined) continue;
    const remainder = masked.slice(position);
    if (keyword === 'import') {
      if (/^import\s*\./u.test(remainder)) continue;
      const sideEffect = /^import\s+(type\s+)?(['"])([^'"\n]+)\2\s*;?/u.exec(remainder);
      if (sideEffect !== null && sideEffect[3] !== undefined) {
        imports.push(Object.freeze({
          specifier: sideEffect[3],
          typeOnly: sideEffect[1] !== undefined,
          importClause: null,
        }));
        continue;
      }
      const from = /^import\s+(type\s+)?([^;]*?)\s+from\s+(['"])([^'"\n]+)\3\s*;?/u.exec(remainder);
      if (from === null || from[4] === undefined || from[2] === undefined) {
        return auditFailure('unparsed-import', artifact, `Every import in ${artifact} must be one explicit static string import.`);
      }
      imports.push(Object.freeze({
        specifier: from[4],
        typeOnly: from[1] !== undefined,
        importClause: from[2].trim(),
      }));
      continue;
    }
    const reexport = /^export\s+(type\s+)?(?:\*\s*(?:as\s+[A-Za-z_$][\w$]*\s*)?|\{[^}]*\})\s+from\s+(['"])([^'"\n]+)\2\s*;?/u.exec(remainder);
    if (reexport !== null && reexport[3] !== undefined) {
      imports.push(Object.freeze({
        specifier: reexport[3],
        typeOnly: reexport[1] !== undefined,
        importClause: null,
      }));
      continue;
    }
    if (
      /^export\s+(?:type\s+)?\{[^}]*\}\s*;?/u.test(remainder) ||
      /^export\s+default\b/u.test(remainder) ||
      /^export\s+(?:(?:declare|abstract|async)\s+)*(?:const|let|var|function|class|interface|type|enum|namespace)\b/u.test(remainder)
    ) {
      continue;
    }
    return auditFailure('unparsed-export', artifact, `Every export in ${artifact} must be one admitted declaration or explicit static string re-export.`);
  }
  return Object.freeze(imports);
}

function auditForbiddenCapabilities(
  source: string,
  artifact: string,
  capability: RuntimePathCapability,
): void {
  const masked = maskNonExecutableSource(source, artifact);
  const reflectReferences = countMatches(masked, /\bReflect\b/gu);
  const commentMasked = maskComments(source, artifact);
  const sourceClosureCodecReflectIsExact =
    artifact === SOURCE_CLOSURE_CODEC_SOURCE &&
    reflectReferences === 2 &&
    countMatches(masked, /\bReflect\.ownKeys\(value\)/gu) === 1 &&
    countMatches(masked, /\bReflect\.get\(value, key\)/gu) === 1;
  const anytimeExactInputSplitReflectIsExact =
    artifact === ANYTIME_EXACT_INPUT_SPLIT_SOURCE &&
    executableReflectCallsMatchProfile(masked, commentMasked, [
      /(?<![\w$.])Reflect\.get\(workCaps, field\)/gu,
      /(?<![\w$.])Reflect\.get\(deadline, 'deadlineNanoseconds'\)/gu,
      /(?<![\w$.])Reflect\.get\(deadline, 'nowNanoseconds'\)/gu,
    ]);
  const exactInputSplitSessionReflectIsExact =
    artifact === EXACT_INPUT_SPLIT_SESSION_SOURCE &&
    executableReflectCallsMatchProfile(masked, commentMasked, [
      /(?<![\w$.])Reflect\.apply\(state\.control\.shouldCancel, undefined, \[checkpoint\]\)/gu,
      /(?<![\w$.])Reflect\.apply\(state\.nowNanoseconds, undefined, \[\]\)/gu,
    ]);
  const numericalExactInputSplitReflectIsExact =
    artifact === NUMERICAL_EXACT_INPUT_SPLIT_SOURCE &&
    executableReflectCallsMatchProfile(masked, commentMasked, [
      /(?<![\w$.])Reflect\.get\(numerical, 'outerIterations'\)/gu,
      /(?<![\w$.])Reflect\.get\(numerical, 'innerIterations'\)/gu,
      /(?<![\w$.])Reflect\.get\(numerical, 'convergenceTolerance'\)/gu,
      /(?<![\w$.])Reflect\.get\(workCaps, field\)/gu,
      /(?<![\w$.])Reflect\.get\(deadline, 'deadlineNanoseconds'\)/gu,
      /(?<![\w$.])Reflect\.get\(deadline, 'nowNanoseconds'\)/gu,
    ]);
  const preparedRoutingContextReflectIsExact =
    artifact === PREPARED_ROUTING_CONTEXT_SOURCE &&
    executableReflectCallsMatchProfile(masked, commentMasked, [
      /(?<![\w$.])Reflect\.get\(value, 'assetIn'\)/gu,
      /(?<![\w$.])Reflect\.get\(value, 'poolId'\)/gu,
      /(?<![\w$.])Reflect\.get\(value, 'assetOut'\)/gu,
    ]);
  const boundedSnapshotJsonReflectIsExact =
    artifact === BOUNDED_SNAPSHOT_JSON_SOURCE &&
    executableReflectCallsMatchProfile(masked, commentMasked, [
      /(?<![\w$.])Reflect\.apply\(getter, value, \[\]\)/gu,
    ]);
  if (
    reflectReferences !== 0 &&
    !sourceClosureCodecReflectIsExact &&
    !anytimeExactInputSplitReflectIsExact &&
    !exactInputSplitSessionReflectIsExact &&
    !numericalExactInputSplitReflectIsExact &&
    !preparedRoutingContextReflectIsExact &&
    !boundedSnapshotJsonReflectIsExact
  ) {
    return auditFailure(
      'computed-capability-forbidden',
      artifact,
      `Reflect access differs from its exact path-scoped call profile in ${artifact}.`,
    );
  }
  const forbiddenPatterns: readonly [RegExp, string][] = [
    [/\brequire\b/u, 'dynamic-loader-forbidden'],
    [/\bcreateRequire\b/u, 'native-loader-forbidden'],
    [/\bgetBuiltinModule\b/u, 'native-loader-forbidden'],
    [/\bdlopen\b/u, 'native-loader-forbidden'],
    [/\b(?:eval|Function|WebAssembly)\b/u, 'codegen-forbidden'],
    [/\b(?:Worker|SharedWorker|MessagePort)\b/u, 'worker-forbidden'],
    [/\b(?:globalThis|global)\b/u, 'computed-capability-forbidden'],
    [/\b(?:process|module)\s*\[/u, 'computed-capability-forbidden'],
    [/\\u(?:[0-9a-f]{4}|\{[0-9a-f]{1,6}\})/iu, 'escaped-capability-forbidden'],
    [/\bconsole\.profile(?:End)?\b/u, 'profiler-forbidden'],
    [/\buptime\b|\bDate\b|\bperformance\b/u, 'operational-clock-forbidden'],
    [/\b(?:fetch|WebSocket)\b/u, 'network-capability-forbidden'],
    [/\bprocess\.binding\b/u, 'native-loader-forbidden'],
  ];
  for (const [pattern, code] of forbiddenPatterns) {
    if (pattern.test(masked)) {
      auditFailure(code, artifact, `Forbidden runtime capability is reachable from ${artifact}.`);
    }
  }
  if (
    /\bhrtime\b/u.test(masked) &&
    (artifact !== ACCEPTED_RUN_CLOCK_SOURCE ||
      !capability.capabilities.includes('operational-clock'))
  ) {
    auditFailure(
      'operational-clock-forbidden',
      artifact,
      `Operational clock capability is forbidden in ${artifact}.`,
    );
  }
}

function countMatches(value: string, pattern: RegExp): number {
  return [...value.matchAll(pattern)].length;
}

function executableReflectCallsMatchProfile(
  executable: string,
  literalPreserving: string,
  patterns: readonly RegExp[],
): boolean {
  const executableOffsets = new Set(
    [...executable.matchAll(/\bReflect\b/gu)]
      .map((match) => match.index),
  );
  return executableOffsets.size === patterns.length &&
    patterns.every((pattern) =>
      [...literalPreserving.matchAll(pattern)].filter((match) =>
        executableOffsets.has(match.index)).length === 1);
}

function decodeStaticLiteralEscapes(value: string): string | null {
  let decoded = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if (character !== '\\') {
      decoded += character;
      continue;
    }
    const escapeType = value[index + 1];
    if (escapeType === undefined) return null;
    if (escapeType === '\n') {
      index += 1;
      continue;
    }
    if (escapeType === '\r') {
      index += value[index + 2] === '\n' ? 2 : 1;
      continue;
    }
    if (escapeType === '\u2028' || escapeType === '\u2029') {
      index += 1;
      continue;
    }
    if (escapeType === 'u') {
      const braced = value[index + 2] === '{';
      const end = braced ? value.indexOf('}', index + 3) : index + 6;
      const digits = braced
        ? value.slice(index + 3, end)
        : value.slice(index + 2, end);
      if (
        end >= 0 &&
        (braced ? /^[0-9a-f]{1,6}$/iu : /^[0-9a-f]{4}$/iu).test(digits)
      ) {
        const codePoint = Number.parseInt(digits, 16);
        if (codePoint <= 0x10ffff) {
          decoded += String.fromCodePoint(codePoint);
          index = braced ? end : end - 1;
          continue;
        }
      }
      return null;
    } else if (escapeType === 'x') {
      const digits = value.slice(index + 2, index + 4);
      if (/^[0-9a-f]{2}$/iu.test(digits)) {
        decoded += String.fromCodePoint(Number.parseInt(digits, 16));
        index += 3;
        continue;
      }
      return null;
    } else if (escapeType === '0') {
      if (/^[0-9]$/u.test(value[index + 2] ?? '')) return null;
      decoded += '\0';
      index += 1;
      continue;
    } else if (/^[1-9]$/u.test(escapeType)) {
      return null;
    }
    const standardEscapes: Readonly<Record<string, string>> = Object.freeze({
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
      v: '\v',
    });
    decoded += standardEscapes[escapeType] ?? escapeType;
    index += 1;
  }
  return decoded;
}

interface DecodedStaticLiteral {
  readonly start: number;
  readonly end: number;
  readonly value: string | null;
}

function decodedStaticLiterals(source: string): readonly DecodedStaticLiteral[] {
  const literals: DecodedStaticLiteral[] = [];
  for (const match of source.matchAll(
    /(['"`])((?:\\[\s\S]|(?!\1)[^\\])*)\1/gu,
  )) {
    const start = match.index;
    if (start === undefined) continue;
    const delimiter = match[1];
    const content = match[2] ?? '';
    if (delimiter === '`' && content.includes('${')) continue;
    literals.push(Object.freeze({
      start,
      end: start + match[0].length,
      value: decodeStaticLiteralEscapes(content),
    }));
  }
  return Object.freeze(literals);
}

function containsConstructorLiteral(source: string): boolean {
  return decodedStaticLiterals(source).some((literal) =>
    literal.value === null || /^constructor$/u.test(literal.value));
}

function regexSourceReconstructsConstructor(
  commentMasked: string,
  regexSources: readonly RuntimeRegexSourceEvidence[],
): boolean {
  for (let start = 0; start < regexSources.length; start += 1) {
    const first = regexSources[start];
    if (first?.value === null || first?.value === undefined) continue;
    let joined = first.value;
    if (/^constructor$/u.test(joined)) return true;
    let prior = first;
    for (let end = start + 1; end < regexSources.length; end += 1) {
      const next = regexSources[end];
      if (
        next?.value === null ||
        next?.value === undefined ||
        !/^\s*\+\s*$/u.test(commentMasked.slice(prior.end, next.start))
      ) {
        break;
      }
      joined += next.value;
      if (/^constructor$/u.test(joined)) return true;
      prior = next;
    }
  }
  return false;
}

function nestedAuditConstructorResidual(
  sourceBytes: Uint8Array,
  commentMasked: string,
  executable: string,
  artifact: string,
): string {
  if (artifact !== INPUT_CLOSURE_AUDIT_SOURCE) return commentMasked;
  const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
  if (
    sourceBytes.byteLength !== INPUT_CLOSURE_AUDIT_REVIEWED_BYTES ||
    sourceSha256 !== INPUT_CLOSURE_AUDIT_REVIEWED_SHA256
  ) {
    return auditFailure(
      'codegen-forbidden',
      artifact,
      `Nested constructor-audit source identity differs in ${artifact}.`,
    );
  }
  const residual = [...commentMasked];
  const literal = "'constructor'";
  for (const context of INPUT_CLOSURE_AUDIT_CONSTRUCTOR_CONTEXTS) {
    const executableContext = maskNonExecutableSource(context, artifact);
    const offsets: number[] = [];
    let offset = commentMasked.indexOf(context);
    while (offset >= 0) {
      if (
        executable.slice(offset, offset + context.length) === executableContext
      ) {
        offsets.push(offset);
      }
      offset = commentMasked.indexOf(context, offset + 1);
    }
    const contextOffset = offsets[0];
    const literalOffset = context.indexOf(literal);
    if (
      offsets.length !== 1 ||
      contextOffset === undefined ||
      literalOffset < 0 ||
      context.indexOf(literal, literalOffset + 1) >= 0
    ) {
      return auditFailure(
        'codegen-forbidden',
        artifact,
        `Nested constructor-audit context differs in ${artifact}.`,
      );
    }
    for (let index = 0; index < literal.length; index += 1) {
      residual[contextOffset + literalOffset + index] = ' ';
    }
  }
  return residual.join('');
}

function auditConstructorCodegen(
  source: string,
  artifact: string,
  sourceBytes: Uint8Array,
): void {
  const literalEvidence: RuntimeLiteralEvidence = {
    staticTemplateValues: [],
    regexSources: [],
  };
  const executable = maskNonExecutableSource(source, artifact);
  const commentMasked = nestedAuditConstructorResidual(
    sourceBytes,
    maskComments(source, artifact, literalEvidence),
    executable,
    artifact,
  );
  // Revision-bound source bytes are primary; this lexical gate closes direct and
  // common one-expression constructor recovery without claiming general dataflow.
  if (
    literalEvidence.staticTemplateValues.some((value) =>
      /^constructor$/u.test(value)) ||
    regexSourceReconstructsConstructor(
      commentMasked,
      literalEvidence.regexSources,
    ) ||
    containsConstructorLiteral(commentMasked) ||
    /\.\s*constructor\b/u.test(executable) ||
    /\[\s*(['"])constructor\1\s*\]/u.test(commentMasked)
  ) {
    return auditFailure(
      'codegen-forbidden',
      artifact,
      `Function-constructor reachability is forbidden in ${artifact}.`,
    );
  }
  const staticLiterals = decodedStaticLiterals(commentMasked);
  for (let start = 0; start < staticLiterals.length; start += 1) {
    let joined = staticLiterals[start]?.value ?? '';
    for (let end = start + 1; end < staticLiterals.length; end += 1) {
      const prior = staticLiterals[end - 1];
      const next = staticLiterals[end];
      if (
        prior === undefined ||
        next === undefined ||
        next.value === null ||
        !/^\s*\+\s*$/u.test(commentMasked.slice(prior.end, next.start))
      ) {
        break;
      }
      joined += next.value;
      if (!/^constructor$/u.test(joined)) continue;
      return auditFailure(
        'codegen-forbidden',
        artifact,
        `Split-string function-constructor reachability is forbidden in ${artifact}.`,
      );
    }
  }
  for (const match of commentMasked.matchAll(
    /\[([^[\]\n]*)\]\s*\.join\s*\(\s*(['"])\2\s*\)/gu,
  )) {
    const literalList = match[1] ?? '';
    const pieces = decodedStaticLiterals(literalList);
    let residue = '';
    let cursor = 0;
    for (const piece of pieces) {
      residue += literalList.slice(cursor, piece.start);
      cursor = piece.end;
    }
    residue += literalList.slice(cursor);
    if (
      pieces.length > 0 &&
      pieces.every((piece) => piece.value !== null) &&
      /^[\s,]*$/u.test(residue) &&
      /^constructor$/u.test(pieces.map((piece) => piece.value).join(''))
    ) {
      return auditFailure(
        'codegen-forbidden',
        artifact,
        `Array-joined function-constructor reachability is forbidden in ${artifact}.`,
      );
    }
  }
}

const PROCESS_ACCESS_PROFILE: Readonly<
  Record<string, Readonly<Record<string, number>>>
> = Object.freeze({
  [VERIFIER_CLI_SOURCE]: Object.freeze({
    'process.argv.slice': 1,
    'process.exitCode': 3,
    'process.kill': 1,
    'process.pid': 1,
    'process.stderr.write': 1,
  }),
  [FIXED_DISPATCH_SOURCE]: Object.freeze({
    'process.env': 1,
    'process.execArgv': 1,
    'process.execPath': 2,
  }),
  [SOURCE_CLOSURE_GENERATION_ENTRY_SOURCE]: Object.freeze({
    'process.argv.slice': 1,
    'process.exitCode': 1,
    'process.stderr.write': 1,
  }),
  [SOURCE_CLOSURE_PUBLICATION_SOURCE]: Object.freeze({
    'process.pid': 1,
  }),
  [DURABLE_ENTRY_SOURCE]: Object.freeze({
    'process.cwd': 1,
    'process.exitCode': 1,
    'process.stderr.write': 1,
    'process.stdout.write': 2,
  }),
  [ACCEPTED_RUN_CLOCK_SOURCE]: Object.freeze({
    'process.hrtime.bigint': 1,
  }),
  [ACCEPTED_RUN_ENVIRONMENT_SOURCE]: Object.freeze({
    'process.arch': 1,
    'process.env': 1,
    'process.execArgv': 1,
    'process.platform': 1,
    'process.version': 1,
    'process.versions.uv': 1,
    'process.versions.v8': 1,
  }),
});

function auditProcessAccess(source: string, artifact: string): void {
  const executable = maskNonExecutableSource(source, artifact);
  const processTokens = countMatches(executable, /\bprocess\b/gu);
  const accesses = [...executable.matchAll(
    /\bprocess(?:\.[A-Za-z_$][\w$]*)+/gu,
  )].map((match) => match[0]);
  const expected = PROCESS_ACCESS_PROFILE[artifact];
  if (processTokens === 0) return;
  if (
    expected === undefined ||
    accesses.length !== processTokens ||
    Object.values(expected).reduce((sum, count) => sum + count, 0) !==
      accesses.length
  ) {
    return auditFailure(
      'process-capability-mismatch',
      artifact,
      `Bare, aliased, or path-unauthorized process access is forbidden in ${artifact}.`,
    );
  }
  const actual = new Map<string, number>();
  for (const access of accesses) {
    actual.set(access, (actual.get(access) ?? 0) + 1);
  }
  if (
    Object.entries(expected).some(([access, count]) => actual.get(access) !== count) ||
    [...actual.keys()].some((access) => !Object.hasOwn(expected, access)) ||
    (expected['process.argv.slice'] !== undefined &&
      countMatches(executable, /\bprocess\.argv\.slice\s*\(/gu) !==
        expected['process.argv.slice']) ||
    (expected['process.cwd'] !== undefined &&
      countMatches(executable, /\bprocess\.cwd\s*\(/gu) !==
        expected['process.cwd']) ||
    (expected['process.exitCode'] !== undefined &&
      countMatches(executable, /\bprocess\.exitCode\s*=/gu) !==
        expected['process.exitCode']) ||
    (expected['process.kill'] !== undefined &&
      countMatches(executable, /\bprocess\.kill\s*\(/gu) !==
        expected['process.kill']) ||
    (expected['process.hrtime.bigint'] !== undefined &&
      countMatches(executable, /\bprocess\.hrtime\.bigint\s*\(/gu) !==
        expected['process.hrtime.bigint']) ||
    (expected['process.stderr.write'] !== undefined &&
      countMatches(executable, /\bprocess\.stderr\.write\s*\(/gu) !==
        expected['process.stderr.write']) ||
    (expected['process.stdout.write'] !== undefined &&
      countMatches(executable, /\bprocess\.stdout\.write\s*\(/gu) !==
        expected['process.stdout.write']) ||
    (artifact === FIXED_DISPATCH_SOURCE &&
      !/process\.env\[['"]NODE_OPTIONS['"]\]/u.test(maskComments(source, artifact))) ||
    (artifact === ACCEPTED_RUN_ENVIRONMENT_SOURCE &&
      countMatches(
        maskComments(source, artifact),
        /process\.env\[['"]NODE_OPTIONS['"]\]/gu,
      ) !== 1)
  ) {
    return auditFailure(
      'process-capability-mismatch',
      artifact,
      `Process access in ${artifact} differs from its exact path profile.`,
    );
  }
}

async function assertRegularTrackedFile(
  repositoryRoot: string,
  expected: RuntimeProjectDescriptor,
  trackedPaths: ReadonlySet<string>,
  ignoredPaths: ReadonlySet<string>,
): Promise<Uint8Array> {
  const relativePath = expected.path;
  if (!trackedPaths.has(relativePath)) {
    return auditFailure('untracked-runtime-target', relativePath, `Runtime target ${relativePath} is not tracked.`);
  }
  if (ignoredPaths.has(relativePath)) {
    return auditFailure('ignored-runtime-target', relativePath, `Runtime target ${relativePath} is ignored.`);
  }
  try {
    return await readBoundedIdentityFile({
      repositoryRoot,
      relativePath,
      maximumBytes: 64 * 1_048_576,
      expectedBytes: expected.bytes,
    });
  } catch (error) {
    if (error instanceof ServiceFastBoundedIdentityReadError) {
      return auditFailure(
        error.code === 'bounded-file-symlink-forbidden'
          ? 'symlink-runtime-target'
          : error.code === 'bounded-file-identity-mismatch'
            ? 'runtime-source-identity-mismatch'
            : 'runtime-source-admission-failure',
        relativePath,
        `Runtime target ${relativePath} failed bounded identity admission.`,
      );
    }
    throw error;
  }
}

function resolveProjectImport(sourcePath: string, specifier: string): string {
  if (path.posix.isAbsolute(specifier)) {
    return auditFailure('absolute-import-forbidden', sourcePath, `Absolute import ${specifier} is forbidden.`);
  }
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return auditFailure('bare-import-forbidden', sourcePath, `Bare import ${specifier} is forbidden.`);
  }
  if (!specifier.endsWith('.ts')) {
    return auditFailure('extensionless-import-forbidden', sourcePath, `Runtime import ${specifier} must name one .ts leaf.`);
  }
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), specifier));
  return canonicalRuntimePath(resolved);
}

function expectedCapability(
  profile: RuntimeImportAuditProfile,
  sourcePath: string,
): RuntimePathCapability {
  const matches = profile.pathCapabilities.filter((entry) => entry.path === sourcePath);
  if (matches.length !== 1) {
    return auditFailure('capability-profile-mismatch', sourcePath, `Runtime source ${sourcePath} lacks one exact capability profile.`);
  }
  return matches[0] as RuntimePathCapability;
}

function auditFixedCapabilitySource(
  source: string,
  sourcePath: string,
  capability: RuntimePathCapability,
  imports: readonly StaticImport[],
): void {
  const capabilities = new Set(capability.capabilities);
  const commentMasked = maskComments(source, sourcePath);
  const executable = maskNonExecutableSource(source, sourcePath);
  if (sourcePath === FIXED_DISPATCH_CONTRACT_SOURCE) {
    const expectedContract = [
      'export const SERVICE_FAST_ARTIFACT_VERIFIER_HELPER =',
      `  '${SERVICE_FAST_ARTIFACT_VERIFIER_HELPER}';`,
      '',
      'export const SERVICE_FAST_SOURCE_CLOSURE_GENERATOR_HELPER =',
      `  '${SERVICE_FAST_SOURCE_CLOSURE_GENERATOR_HELPER}';`,
      '',
    ].join('\n');
    if (source !== expectedContract) {
      auditFailure(
        'fixed-dispatch-capability-mismatch',
        sourcePath,
        'Fixed helper path contract differs from its exact zero-capability leaf.',
      );
    }
  }
  if (
    (capabilities.has('operational-clock') &&
      (sourcePath !== ACCEPTED_RUN_CLOCK_SOURCE || capabilities.size !== 1)) ||
    (capabilities.has('runtime-environment') &&
      (sourcePath !== ACCEPTED_RUN_ENVIRONMENT_SOURCE || capabilities.size !== 1)) ||
    (capabilities.has('accepted-publication') &&
      (sourcePath !== ACCEPTED_RUN_PUBLICATION_SOURCE || capabilities.size !== 1))
  ) {
    auditFailure(
      'path-capability-mismatch',
      sourcePath,
      'Accepted-run privileged capability is declared outside its exact leaf.',
    );
  }
  if (
    capabilities.has('operational-clock') &&
    (countMatches(executable, /\bprocess\b/gu) !== 1 ||
      countMatches(executable, /\bprocess\.hrtime\.bigint\s*\(/gu) !== 1)
  ) {
    auditFailure(
      'operational-clock-capability-mismatch',
      sourcePath,
      'Operational clock leaf differs from its sole exact clock call.',
    );
  }
  const spawnSyncCalls = [...executable.matchAll(/\bspawnSync\s*\(/gu)].length;
  const spawnSyncReferences = [...executable.matchAll(/\bspawnSync\b/gu)].length;
  const childProcessImports = imports.filter((entry) =>
    !entry.typeOnly && entry.specifier === 'node:child_process');
  const cryptoImports = imports.filter((entry) =>
    !entry.typeOnly && entry.specifier === 'node:crypto');
  if (capability.builtins.includes('node:crypto')) {
    const createHashCalls = countMatches(executable, /\bcreateHash\s*\(/gu);
    const createHashReferences = countMatches(executable, /\bcreateHash\b/gu);
    const randomBytesCalls = countMatches(executable, /\brandomBytes\s*\(/gu);
    const randomBytesReferences = countMatches(executable, /\brandomBytes\b/gu);
    const publicationCrypto =
      capabilities.has('source-closure-publication') ||
      capabilities.has('accepted-publication');
    if (
      cryptoImports.length !== 1 ||
      (publicationCrypto
        ? cryptoImports[0]?.importClause?.replace(/\s+/gu, ' ') !==
            '{ randomBytes }' ||
          (sourcePath !== SOURCE_CLOSURE_PUBLICATION_SOURCE &&
            sourcePath !== ACCEPTED_RUN_PUBLICATION_SOURCE) ||
          randomBytesCalls !== 1 ||
          randomBytesReferences !== 2 ||
          createHashReferences !== 0
        : !capabilities.has('hash') ||
          cryptoImports[0]?.importClause?.replace(/\s+/gu, ' ') !==
            '{ createHash }' ||
          createHashCalls < 1 ||
          createHashReferences !== createHashCalls + 1 ||
          randomBytesReferences !== 0)
    ) {
      auditFailure(
        'crypto-capability-mismatch',
        sourcePath,
        'Crypto imports differ from the exact path-scoped hash or publication profile.',
      );
    }
  }
  const osImports = imports.filter((entry) =>
    !entry.typeOnly && entry.specifier === 'node:os');
  const processImports = imports.filter((entry) =>
    !entry.typeOnly && entry.specifier === 'node:process');
  const workerThreadImports = imports.filter((entry) =>
    !entry.typeOnly && entry.specifier === 'node:worker_threads');
  if (
    osImports.length > 0 ||
    processImports.length > 0 ||
    workerThreadImports.length > 0
  ) {
    const durableHostFunctions = [
      'availableParallelism',
      'cpus',
      'endianness',
      'release',
      'type',
    ];
    const durableHostValues = [
      'arch',
      'env',
      'execArgv',
      'platform',
      'version',
      'versions',
    ];
    const durableHostIsExact =
      sourcePath === DURABLE_HOST_ADMISSION_SOURCE &&
      capability.capabilities.length === 0 &&
      capability.builtins.length === 2 &&
      capability.builtins.includes('node:os') &&
      capability.builtins.includes('node:process') &&
      osImports.length === 1 &&
      processImports.length === 1 &&
      workerThreadImports.length === 0 &&
      osImports[0]?.importClause?.replace(/\s+/gu, ' ') ===
        '{ availableParallelism, cpus, endianness, release, type }' &&
      processImports[0]?.importClause?.replace(/\s+/gu, ' ') ===
        '{ arch, env, execArgv, platform, version, versions }' &&
      durableHostFunctions.every((identifier) =>
        countMatches(
          executable,
          new RegExp(`\\b${identifier}\\s*\\(`, 'gu'),
        ) === 1 &&
        countMatches(
          executable,
          new RegExp(`\\b${identifier}\\b`, 'gu'),
        ) === 2) &&
      durableHostValues.every((identifier) =>
        countMatches(
          executable,
          new RegExp(`\\b${identifier}\\b`, 'gu'),
        ) === 2) &&
      countMatches(executable, /\bnodeOptions\b/gu) === 2 &&
      /const\s+nodeOptions\s*=\s*env\[['"]NODE_OPTIONS['"]\]\s*;/u.test(
        commentMasked,
      );
    const environmentFunctions = [
      'availableParallelism',
      'cpus',
      'endianness',
      'release',
      'totalmem',
      'type',
    ];
    const acceptedEnvironmentIsExact =
      sourcePath === ACCEPTED_RUN_ENVIRONMENT_SOURCE &&
      capabilities.has('runtime-environment') &&
      capability.builtins.length === 2 &&
      capability.builtins.includes('node:os') &&
      capability.builtins.includes('node:worker_threads') &&
      osImports.length === 1 &&
      processImports.length === 0 &&
      workerThreadImports.length === 1 &&
      osImports[0]?.importClause?.replace(/\s+/gu, ' ') ===
        '{ availableParallelism, cpus, endianness, release, totalmem, type }' &&
      workerThreadImports[0]?.importClause?.replace(/\s+/gu, ' ') ===
        '{ isMainThread }' &&
      countMatches(executable, /\bprocess\b/gu) === 7 &&
      environmentFunctions.every((identifier) =>
        countMatches(
          executable,
          new RegExp(`\\b${identifier}\\s*\\(`, 'gu'),
        ) === 1 &&
        countMatches(
          executable,
          new RegExp(`\\b${identifier}\\b`, 'gu'),
        ) === 2) &&
      countMatches(executable, /\bisMainThread\b/gu) === 2 &&
      countMatches(
        commentMasked,
        /new\s+Intl\.DateTimeFormat\s*\(\s*\)\.resolvedOptions\s*\(\s*\)\.timeZone/gu,
      ) === 1 &&
      countMatches(executable, /\bIntl\b/gu) === 1 &&
      countMatches(executable, /\bDateTimeFormat\b/gu) === 1 &&
      countMatches(executable, /\bresolvedOptions\b/gu) === 1 &&
      countMatches(executable, /\btimeZone\b/gu) === 1;
    if (!durableHostIsExact && !acceptedEnvironmentIsExact) {
      auditFailure(
        'host-admission-capability-mismatch',
        sourcePath,
        'Host admission imports differ from the exact durable child leaf.',
      );
    }
  }
  if (capability.builtins.includes('node:child_process')) {
    if (capabilities.has('fixed-child-dispatch')) {
      const dispatchContractImports = imports.filter((entry) =>
        !entry.typeOnly &&
        entry.specifier === './dispatch-contract.ts' &&
        entry.importClause !== null);
      if (
        sourcePath !== FIXED_DISPATCH_SOURCE ||
        spawnSyncCalls !== 1 ||
        spawnSyncReferences !== 2 ||
        childProcessImports.length !== 1 ||
        childProcessImports[0]?.importClause?.replace(/\s+/gu, ' ') !== '{ spawnSync, type SpawnSyncOptions }' ||
        !/spawnSync\s*\(\s*executable\s*,\s*\[\.\.\.arguments_\]\s*,\s*options\s*\)/u.test(commentMasked) ||
        !/execPath\s*:\s*process\.execPath\b/u.test(executable) ||
        !/dependencies\.execPath\s*!==\s*process\.execPath\b/u.test(executable) ||
        !/dependencies\.spawn\s*\(\s*dependencies\.execPath\s*,/u.test(executable) ||
        [...executable.matchAll(/\bdependencies\.spawn\b/gu)].length !== 1 ||
        /\b(?:dependencies|spawnSync)\s*\[/u.test(executable) ||
        /\bspawnSync\s*\./u.test(executable) ||
        !/invocation\.mode\s*===\s*['"]durable-verification['"]\s*\)\s*\{\s*await\s+dependencies\.authenticateDurableVerifier\s*\(\s*repositoryRoot\s*\)/u.test(commentMasked) ||
        executable.indexOf('dependencies.authenticateDurableVerifier') >
          executable.indexOf('dependencies.spawn') ||
        dispatchContractImports.length !== 1 ||
        dispatchContractImports[0]?.importClause?.replace(/\s+/gu, ' ') !==
          '{ SERVICE_FAST_ARTIFACT_VERIFIER_HELPER, SERVICE_FAST_SOURCE_CLOSURE_GENERATOR_HELPER, }' ||
        !/stdio\s*:\s*['"]inherit['"]/u.test(commentMasked) ||
        !/shell\s*:\s*false\b/u.test(executable) ||
        /\benv\s*:/u.test(executable)
      ) {
        auditFailure('fixed-dispatch-capability-mismatch', sourcePath, 'The fixed dispatcher source does not preserve its literal process boundary.');
      }
    } else if (capabilities.has('bounded-git-metadata')) {
      if (
        sourcePath !== BOUNDED_GIT_SOURCE ||
        spawnSyncCalls !== 1 ||
        spawnSyncReferences !== 2 ||
        childProcessImports.length !== 1 ||
        childProcessImports[0]?.importClause?.replace(/\s+/gu, ' ') !== '{ spawnSync }' ||
        !/^const\s+FIXED_GIT_EXECUTABLE\s*=\s*['"]\/usr\/bin\/git['"]\s*;/mu.test(commentMasked) ||
        !/spawnSync\s*\(\s*FIXED_GIT_EXECUTABLE\s*,/u.test(executable) ||
        [...executable.matchAll(/\bFIXED_GIT_EXECUTABLE\b/gu)].length !== 2 ||
        /\b(?:spawnSync|FIXED_GIT_EXECUTABLE)\s*(?:\.|\[)/u.test(executable) ||
        !commentMasked.includes("'--no-replace-objects'") ||
        !commentMasked.includes("'core.fsmonitor=false'") ||
        !commentMasked.includes("'core.untrackedCache=false'") ||
        !commentMasked.includes("'core.hooksPath=/dev/null'") ||
        !/GIT_NO_REPLACE_OBJECTS\s*:\s*['"]1['"]/u.test(commentMasked) ||
        !/function\s+runGit\s*\(/u.test(executable) ||
        /export\s+function\s+runGit\s*\(/u.test(executable) ||
        !/shell\s*:\s*false\b/u.test(executable) ||
        [...executable.matchAll(/\benv\s*:/gu)].length !== 1 ||
        !/env\s*:\s*FIXED_GIT_ENVIRONMENT\b/u.test(executable)
      ) {
        auditFailure('bounded-git-capability-mismatch', sourcePath, 'The bounded Git leaf does not preserve its fixed shell-free boundary.');
      }
    } else {
      auditFailure('arbitrary-child-process-forbidden', sourcePath, 'Child process is reachable outside a fixed admitted leaf.');
    }
  }
  if (
    capability.builtins.includes('node:fs/promises') &&
    !capabilities.has('read-only-filesystem') &&
    !capabilities.has('source-closure-publication') &&
    !capabilities.has('accepted-publication')
  ) {
    auditFailure('filesystem-capability-mismatch', sourcePath, 'Filesystem access lacks a path-scoped capability.');
  }
  if (capabilities.has('accepted-publication')) {
    const filesystemImports = imports.filter((entry) =>
      !entry.typeOnly && entry.specifier === 'node:fs/promises');
    const nodeFilesystemImports = imports.filter((entry) =>
      !entry.typeOnly && entry.specifier === 'node:fs');
    const pathImports = imports.filter((entry) =>
      !entry.typeOnly && entry.specifier === 'node:path');
    if (
      sourcePath !== ACCEPTED_RUN_PUBLICATION_SOURCE ||
      capability.builtins.length !== 4 ||
      !capability.builtins.includes('node:crypto') ||
      !capability.builtins.includes('node:fs') ||
      !capability.builtins.includes('node:fs/promises') ||
      !capability.builtins.includes('node:path') ||
      filesystemImports.length !== 1 ||
      filesystemImports[0]?.importClause?.replace(/\s+/gu, ' ') !==
        '{ lstat, mkdir, open, readdir, rename, rm, statfs, unlink }' ||
      nodeFilesystemImports.length !== 1 ||
      nodeFilesystemImports[0]?.importClause?.replace(/\s+/gu, ' ') !==
        '{ constants }' ||
      pathImports.length !== 1 ||
      pathImports[0]?.importClause !== 'path'
    ) {
      auditFailure(
        'accepted-publication-capability-mismatch',
        sourcePath,
        'Accepted publication imports differ from its exact privileged leaf.',
      );
    }
  }
  if (
    capabilities.has('read-only-filesystem') &&
    (() => {
      const filesystemImports = imports.filter((entry) =>
        !entry.typeOnly && entry.specifier === 'node:fs/promises');
      const nodeFilesystemImports = imports.filter((entry) =>
        !entry.typeOnly && entry.specifier === 'node:fs');
      const mutationApi = /\b(?:appendFile|chmod|chown|copyFile|cp|link|lchmod|lchown|lutimes|mkdir|mkdtemp|rename|rm|rmdir|symlink|truncate|unlink|utimes|writeFile)\b/u;
      const importsOpen = filesystemImports.some((entry) =>
        /\bopen\b/u.test(entry.importClause ?? ''));
      const boundedHandleDeclaration =
        /const\s+handle\s*=\s*await\s+open\s*\(\s*absolutePath\s*,\s*constants\.O_RDONLY\s*\|\s*constants\.O_NOFOLLOW\s*\|\s*constants\.O_NONBLOCK\s*,?\s*\)\s*;/gu;
      const boundedHandleDeclarationCount = countMatches(
        executable,
        boundedHandleDeclaration,
      );
      const boundedHandleResidual = executable
        .replace(boundedHandleDeclaration, '')
        .replace(/\bhandle\.(?:stat|read|close)\s*\(/gu, '(');
      const boundedOpenIsExact =
        sourcePath === DURABLE_BOUNDED_FILE_SOURCE &&
        filesystemImports.length === 1 &&
        nodeFilesystemImports.length === 1 &&
        nodeFilesystemImports[0]?.importClause?.replace(/\s+/gu, ' ') === '{ constants }' &&
        (filesystemImports[0]?.importClause ?? '')
          .replace(/^\{|\}$/gu, '')
          .split(',')
          .map((member) => member.trim())
          .filter((member) => /\bopen\b/u.test(member))
          .every((member) => member === 'open') &&
        [...executable.matchAll(/\bopen\b/gu)].length === 2 &&
        [...executable.matchAll(/\bconstants\b/gu)].length === 4 &&
        boundedHandleDeclarationCount === 1 &&
        !/\bhandle\b/u.test(boundedHandleResidual) &&
        !/\b(?:open|constants|handle)\s*\[/u.test(executable) &&
        !/\bReflect\b/u.test(executable) &&
        !/=\s*(?:open|constants)\b/u.test(executable) &&
        !/\bconstants\.O_(?:WRONLY|RDWR|CREAT|TRUNC|APPEND|EXCL)\b/u.test(executable) &&
        !/\bhandle\.(?:write|writeFile|truncate|chmod|chown|sync|datasync)\b/u.test(executable);
      return filesystemImports.length !== 1 ||
        filesystemImports.some((entry) =>
          entry.importClause === null ||
          !/^\{[\s\S]*\}$/u.test(entry.importClause) ||
          mutationApi.test(entry.importClause)) ||
        mutationApi.test(executable) ||
        (importsOpen && !boundedOpenIsExact) ||
        (!importsOpen && /\bopen\b/u.test(executable)) ||
        (nodeFilesystemImports.length > 0 && !boundedOpenIsExact);
    })()
  ) {
    auditFailure('read-only-filesystem-mutation-forbidden', sourcePath, 'Read-only filesystem source references a mutation API.');
  }
}

function fixedRuntimeCapability(
  pathValue: string,
  builtins: readonly string[],
  capabilities: RuntimePathCapability['capabilities'],
): RuntimePathCapability {
  return Object.freeze({
    path: pathValue,
    builtins: Object.freeze([...builtins]),
    capabilities: Object.freeze([...capabilities]),
  });
}

function exactProjectSources(
  profileId: string,
  paths: readonly string[],
  descriptors: readonly RuntimeProjectDescriptor[],
): readonly RuntimeProjectDescriptor[] {
  const byPath = new Map(descriptors.map((descriptor) => [descriptor.path, descriptor]));
  return Object.freeze(paths.map((sourcePath) => {
    const descriptor = byPath.get(sourcePath);
    if (descriptor === undefined) {
      return auditFailure(
        'runtime-profile-source-missing',
        sourcePath,
        `${profileId} source ${sourcePath} is absent from the source closure.`,
      );
    }
    return descriptor;
  }));
}

export function noArgumentParentRuntimeAuditProfile(
  descriptors: readonly RuntimeProjectDescriptor[],
): RuntimeImportAuditProfile {
  const profileId = 'service-fast-no-argument-parent-v1';
  const projectSources = exactProjectSources(
    profileId,
    SERVICE_FAST_NO_ARGUMENT_PARENT_RUNTIME_PATHS,
    descriptors,
  );
  const capabilities = projectSources.map((descriptor): RuntimePathCapability => {
    if (descriptor.path === FIXED_DISPATCH_SOURCE) {
      return fixedRuntimeCapability(
        descriptor.path,
        ['node:child_process', 'node:path'],
        ['fixed-child-dispatch'],
      );
    }
    if (descriptor.path === BOUNDED_GIT_SOURCE) {
      return fixedRuntimeCapability(
        descriptor.path,
        ['node:child_process', 'node:path'],
        ['bounded-git-metadata'],
      );
    }
    if (
      descriptor.path === SOURCE_CLOSURE_CODEC_SOURCE
    ) {
      return fixedRuntimeCapability(descriptor.path, ['node:crypto'], ['hash']);
    }
    if (
      descriptor.path ===
        'src/benchmark/service-fast-numerical-experiment/tooling/runtime-import-audit.ts'
    ) {
      return fixedRuntimeCapability(
        descriptor.path,
        ['node:crypto', 'node:path'],
        ['hash'],
      );
    }
    if (
      descriptor.path ===
        'src/benchmark/service-fast-numerical-experiment/tooling/bounded-identity-reader.ts'
    ) {
      return fixedRuntimeCapability(
        descriptor.path,
        ['node:fs/promises', 'node:path'],
        ['read-only-filesystem'],
      );
    }
    if (
      descriptor.path ===
        'src/benchmark/service-fast-numerical-experiment/tooling/fixed-repository-root.ts'
    ) {
      return fixedRuntimeCapability(
        descriptor.path,
        ['node:path', 'node:url'],
        ['fixed-repository-root'],
      );
    }
    return fixedRuntimeCapability(descriptor.path, [], []);
  });
  return Object.freeze({
    profileId,
    entryRoots: Object.freeze(['cli/verify-service-fast-numerical-experiment.ts']),
    projectSources,
    nodeBuiltins: SERVICE_FAST_NO_ARGUMENT_PARENT_RUNTIME_BUILTINS,
    pathCapabilities: Object.freeze(capabilities),
  });
}

export function generationChildRuntimeAuditProfile(
  descriptors: readonly RuntimeProjectDescriptor[],
): RuntimeImportAuditProfile {
  const profileId = 'service-fast-source-closure-generation-child-v1';
  const projectSources = exactProjectSources(
    profileId,
    SERVICE_FAST_GENERATION_CHILD_RUNTIME_PATHS,
    descriptors,
  );
  const capabilities = projectSources.map((descriptor): RuntimePathCapability => {
    if (descriptor.path === BOUNDED_GIT_SOURCE) {
      return fixedRuntimeCapability(
        descriptor.path,
        ['node:child_process', 'node:path'],
        ['bounded-git-metadata'],
      );
    }
    if (
      descriptor.path === SOURCE_CLOSURE_CODEC_SOURCE
    ) {
      return fixedRuntimeCapability(descriptor.path, ['node:crypto'], ['hash']);
    }
    if (
      descriptor.path ===
        'src/benchmark/service-fast-numerical-experiment/source-closure/generate.ts'
    ) {
      return fixedRuntimeCapability(
        descriptor.path,
        ['node:fs/promises', 'node:path'],
        ['read-only-filesystem'],
      );
    }
    if (
      descriptor.path ===
        'src/benchmark/service-fast-numerical-experiment/source-closure/publication.ts'
    ) {
      return fixedRuntimeCapability(
        descriptor.path,
        ['node:crypto', 'node:fs/promises', 'node:path'],
        ['source-closure-publication'],
      );
    }
    if (
      descriptor.path ===
        'src/benchmark/service-fast-numerical-experiment/tooling/runtime-import-audit.ts'
    ) {
      return fixedRuntimeCapability(
        descriptor.path,
        ['node:crypto', 'node:path'],
        ['hash'],
      );
    }
    if (
      descriptor.path ===
        'src/benchmark/service-fast-numerical-experiment/tooling/bounded-identity-reader.ts'
    ) {
      return fixedRuntimeCapability(
        descriptor.path,
        ['node:fs/promises', 'node:path'],
        ['read-only-filesystem'],
      );
    }
    if (
      descriptor.path ===
        'src/benchmark/service-fast-numerical-experiment/tooling/fixed-repository-root.ts'
    ) {
      return fixedRuntimeCapability(
        descriptor.path,
        ['node:path', 'node:url'],
        ['fixed-repository-root'],
      );
    }
    return fixedRuntimeCapability(descriptor.path, [], []);
  });
  return Object.freeze({
    profileId,
    entryRoots: Object.freeze([
      'src/benchmark/service-fast-numerical-experiment/source-closure/generate-entry.ts',
    ]),
    projectSources,
    nodeBuiltins: SERVICE_FAST_GENERATION_CHILD_RUNTIME_BUILTINS,
    pathCapabilities: Object.freeze(capabilities),
  });
}

export async function auditServiceFastRuntimeImports(
  options: RuntimeImportAuditOptions,
): Promise<RuntimeImportAuditResult> {
  if (!path.isAbsolute(options.repositoryRoot) || path.resolve(options.repositoryRoot) !== options.repositoryRoot) {
    throw new TypeError('Runtime audit repository root must be absolute and normalized.');
  }
  const ignoredPaths = options.ignoredPaths ?? new Set<string>();
  if (new Set(options.profile.entryRoots).size !== options.profile.entryRoots.length) {
    return auditFailure('duplicate-entry-root', options.profile.profileId, 'Runtime profile contains a duplicate entry root.');
  }
  if (new Set(options.profile.nodeBuiltins).size !== options.profile.nodeBuiltins.length) {
    return auditFailure('duplicate-runtime-builtin', options.profile.profileId, 'Runtime profile contains a duplicate global builtin.');
  }
  const expectedDescriptors = new Map<string, RuntimeProjectDescriptor>();
  for (const descriptor of options.profile.projectSources) {
    canonicalRuntimePath(descriptor.path);
    if (expectedDescriptors.has(descriptor.path)) {
      return auditFailure('duplicate-runtime-source', descriptor.path, 'Runtime profile contains a duplicate project source.');
    }
    expectedDescriptors.set(descriptor.path, descriptor);
  }
  const capabilitiesByPath = new Map<string, RuntimePathCapability>();
  for (const capability of options.profile.pathCapabilities) {
    canonicalRuntimePath(capability.path);
    if (capabilitiesByPath.has(capability.path)) {
      return auditFailure('duplicate-path-capability', capability.path, 'Runtime profile contains a duplicate path capability.');
    }
    if (new Set(capability.builtins).size !== capability.builtins.length) {
      return auditFailure('duplicate-path-builtin', capability.path, 'Runtime path capability contains a duplicate builtin.');
    }
    if (new Set(capability.capabilities).size !== capability.capabilities.length) {
      return auditFailure('duplicate-path-capability-name', capability.path, 'Runtime path capability contains a duplicate capability name.');
    }
    capabilitiesByPath.set(capability.path, capability);
  }
  if (
    capabilitiesByPath.size !== expectedDescriptors.size ||
    [...capabilitiesByPath.keys()].some((sourcePath) => !expectedDescriptors.has(sourcePath))
  ) {
    return auditFailure('capability-profile-mismatch', options.profile.profileId, 'Runtime capability paths do not equal the project source set.');
  }
  const pending = [...options.profile.entryRoots];
  const seen = new Set<string>();
  const builtins = new Set<string>();
  while (pending.length > 0) {
    const sourcePath = canonicalRuntimePath(pending.shift() as string);
    if (seen.has(sourcePath)) continue;
    seen.add(sourcePath);
    const expected = expectedDescriptors.get(sourcePath);
    if (expected === undefined) {
      return auditFailure('unexpected-runtime-source', sourcePath, `Runtime graph reached unexpected source ${sourcePath}.`);
    }
    const bytes = await assertRegularTrackedFile(
      options.repositoryRoot,
      expected,
      options.trackedPaths,
      ignoredPaths,
    );
    const actualHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (bytes.byteLength !== expected.bytes || actualHash !== expected.sha256) {
      return auditFailure('runtime-source-byte-mismatch', sourcePath, `Runtime source ${sourcePath} does not match its revision-bound descriptor.`);
    }
    let source: string;
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return auditFailure('invalid-runtime-source-utf8', sourcePath, `Runtime source ${sourcePath} is not canonical UTF-8.`);
    }
    const imports = staticImports(source, sourcePath);
    const capability = expectedCapability(options.profile, sourcePath);
    auditConstructorCodegen(source, sourcePath, bytes);
    auditForbiddenCapabilities(source, sourcePath, capability);
    auditProcessAccess(source, sourcePath);
    const declaredBuiltins = new Set(capability.builtins);
    const pathBuiltins = new Set<string>();
    auditFixedCapabilitySource(source, sourcePath, capability, imports);
    for (const imported of imports) {
      if (imported.typeOnly) continue;
      if (imported.specifier.startsWith('node:')) {
        if (FORBIDDEN_BUILTINS.has(imported.specifier)) {
          return auditFailure('forbidden-builtin', sourcePath, `Forbidden builtin ${imported.specifier} is reachable.`);
        }
        if (!declaredBuiltins.has(imported.specifier)) {
          return auditFailure('path-builtin-mismatch', sourcePath, `${sourcePath} imports undeclared builtin ${imported.specifier}.`);
        }
        pathBuiltins.add(imported.specifier);
        builtins.add(imported.specifier);
        continue;
      }
      pending.push(resolveProjectImport(sourcePath, imported.specifier));
    }
    const actualPathBuiltins = [...pathBuiltins].sort(compareRawUtf16);
    const expectedPathBuiltins = [...declaredBuiltins].sort(compareRawUtf16);
    if (
      actualPathBuiltins.length !== expectedPathBuiltins.length ||
      actualPathBuiltins.some((builtin, index) => builtin !== expectedPathBuiltins[index])
    ) {
      return auditFailure('path-builtin-set-mismatch', sourcePath, `${sourcePath} builtin reachability does not equal its exact path profile.`);
    }
  }
  const actualSources = [...seen].sort(compareRawUtf16);
  const expectedSources = [...expectedDescriptors.keys()].sort(compareRawUtf16);
  if (
    actualSources.length !== expectedSources.length ||
    actualSources.some((sourcePath, index) => sourcePath !== expectedSources[index])
  ) {
    return auditFailure('runtime-project-set-mismatch', options.profile.profileId, 'Runtime project reachability does not equal the frozen profile.');
  }
  const actualBuiltins = [...builtins].sort(compareRawUtf16);
  const expectedBuiltins = [...options.profile.nodeBuiltins].sort(compareRawUtf16);
  if (
    actualBuiltins.length !== expectedBuiltins.length ||
    actualBuiltins.some((builtin, index) => builtin !== expectedBuiltins[index])
  ) {
    return auditFailure('runtime-builtin-set-mismatch', options.profile.profileId, 'Runtime builtin reachability does not equal the frozen profile.');
  }
  return Object.freeze({
    projectSources: Object.freeze(actualSources),
    nodeBuiltins: Object.freeze(actualBuiltins),
  });
}
