import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ServiceFastRuntimeImportAuditError,
  auditServiceFastRuntimeImports,
  type RuntimeImportAuditProfile,
} from '../src/benchmark/service-fast-numerical-experiment/tooling/runtime-import-audit.ts';

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
const INPUT_CLOSURE_AUDIT_SOURCE =
  'src/benchmark/service-fast-numerical-experiment/input/closure-audit.ts';

const ANYTIME_EXACT_INPUT_SPLIT_REFLECT_SOURCE = `function probe(
  workCaps: unknown,
  field: string,
  deadline: unknown,
): void {
  void Reflect.get(workCaps, field);
  void Reflect.get(deadline, 'deadlineNanoseconds');
  void Reflect.get(deadline, 'nowNanoseconds');
}
`;
const EXACT_INPUT_SPLIT_SESSION_REFLECT_SOURCE = `function probe(
  state: any,
  checkpoint: unknown,
): void {
  void Reflect.apply(state.control.shouldCancel, undefined, [checkpoint]);
  void Reflect.apply(state.nowNanoseconds, undefined, []);
}
`;
const NUMERICAL_EXACT_INPUT_SPLIT_REFLECT_SOURCE = `function probe(
  numerical: unknown,
  workCaps: unknown,
  field: string,
  deadline: unknown,
): void {
  void Reflect.get(numerical, 'outerIterations');
  void Reflect.get(numerical, 'innerIterations');
  void Reflect.get(numerical, 'convergenceTolerance');
  void Reflect.get(workCaps, field);
  void Reflect.get(deadline, 'deadlineNanoseconds');
  void Reflect.get(deadline, 'nowNanoseconds');
}
`;
const PREPARED_ROUTING_CONTEXT_REFLECT_SOURCE = `function captureDirectionalHop(value: unknown): void {
  void Reflect.get(value, 'assetIn');
  void Reflect.get(value, 'poolId');
  void Reflect.get(value, 'assetOut');
}
`;
const BOUNDED_SNAPSHOT_JSON_REFLECT_SOURCE = `function probe(
  getter: unknown,
  value: unknown,
): void {
  void Reflect.apply(getter, value, []);
}
`;
const ANYTIME_WORK_CAP_REFLECT_CALL = 'Reflect.get(workCaps, field)';
const REFLECT_REGEX_DECOYS = Object.freeze([
  `void /${ANYTIME_WORK_CAP_REFLECT_CALL}/;`,
  `function decoyReturn(): RegExp { return /${ANYTIME_WORK_CAP_REFLECT_CALL}/; }`,
  `function decoyThrow(): never { throw /${ANYTIME_WORK_CAP_REFLECT_CALL}/; }`,
  `switch (value) { case /${ANYTIME_WORK_CAP_REFLECT_CALL}/: break; }`,
  `do /${ANYTIME_WORK_CAP_REFLECT_CALL}/.test(''); while (false);`,
  `if (false) {} else /${ANYTIME_WORK_CAP_REFLECT_CALL}/.test('');`,
  `class DecoyExtends extends /${ANYTIME_WORK_CAP_REFLECT_CALL}/ {}`,
  `export default /${ANYTIME_WORK_CAP_REFLECT_CALL}/;`,
  `void delete /${ANYTIME_WORK_CAP_REFLECT_CALL}/.unused;`,
  `void typeof /${ANYTIME_WORK_CAP_REFLECT_CALL}/;`,
  `void (value instanceof /${ANYTIME_WORK_CAP_REFLECT_CALL}/);`,
  `void (value in /${ANYTIME_WORK_CAP_REFLECT_CALL}/);`,
  `for (const item of /${ANYTIME_WORK_CAP_REFLECT_CALL}/) void item;`,
  `for (const of of /${ANYTIME_WORK_CAP_REFLECT_CALL}/) { void of; }`,
  `for (let of of /${ANYTIME_WORK_CAP_REFLECT_CALL}/) { void of; }`,
  `for (var of of /${ANYTIME_WORK_CAP_REFLECT_CALL}/) { void of; }`,
  `async function decoyForAwait(): Promise<void> { for await (const item of values) /${ANYTIME_WORK_CAP_REFLECT_CALL}/.test(''); }`,
  `function* decoyYield(): Generator { yield /${ANYTIME_WORK_CAP_REFLECT_CALL}/; }`,
  `async function decoyAwait(): Promise<void> { await /${ANYTIME_WORK_CAP_REFLECT_CALL}/; }`,
  `void new /${ANYTIME_WORK_CAP_REFLECT_CALL}/;`,
  `const decoyArrow = () => /${ANYTIME_WORK_CAP_REFLECT_CALL}/;`,
  `const decoySpread = [.../${ANYTIME_WORK_CAP_REFLECT_CALL}/];`,
  `void (value + /${ANYTIME_WORK_CAP_REFLECT_CALL}/);`,
  `void (value ? /${ANYTIME_WORK_CAP_REFLECT_CALL}/ : /fallback/);`,
  `if (value) /${ANYTIME_WORK_CAP_REFLECT_CALL}/.test('');`,
  `while (true) { break\n/${ANYTIME_WORK_CAP_REFLECT_CALL}/.test(''); }`,
  `outerBreak: while (true) { break outerBreak\n/${ANYTIME_WORK_CAP_REFLECT_CALL}/.test(''); }`,
  `while (true) { continue\n/${ANYTIME_WORK_CAP_REFLECT_CALL}/.test(''); }`,
  `outerContinue: while (true) { continue outerContinue\n/${ANYTIME_WORK_CAP_REFLECT_CALL}/.test(''); }`,
  `debugger\n/${ANYTIME_WORK_CAP_REFLECT_CALL}/.test('');`,
]);

const PROTECTED_REFLECT_PROFILES = Object.freeze([
  Object.freeze({
    path: ANYTIME_EXACT_INPUT_SPLIT_SOURCE,
    source: ANYTIME_EXACT_INPUT_SPLIT_REFLECT_SOURCE,
  }),
  Object.freeze({
    path: EXACT_INPUT_SPLIT_SESSION_SOURCE,
    source: EXACT_INPUT_SPLIT_SESSION_REFLECT_SOURCE,
  }),
  Object.freeze({
    path: NUMERICAL_EXACT_INPUT_SPLIT_SOURCE,
    source: NUMERICAL_EXACT_INPUT_SPLIT_REFLECT_SOURCE,
  }),
  Object.freeze({
    path: PREPARED_ROUTING_CONTEXT_SOURCE,
    source: PREPARED_ROUTING_CONTEXT_REFLECT_SOURCE,
  }),
  Object.freeze({
    path: BOUNDED_SNAPSHOT_JSON_SOURCE,
    source: BOUNDED_SNAPSHOT_JSON_REFLECT_SOURCE,
  }),
]);

const INPUT_CLOSURE_AUDIT_BUILTINS = Object.freeze([
  'node:crypto',
  'node:fs/promises',
  'node:path',
]);
const INPUT_CLOSURE_AUDIT_CAPABILITIES = Object.freeze([
  'hash',
  'read-only-filesystem',
] as const);

interface SyntheticAuditOptions {
  readonly nodeBuiltins?: readonly string[];
  readonly capabilities?: RuntimeImportAuditProfile[
    'pathCapabilities'
  ][number]['capabilities'];
}

async function auditSyntheticSource(
  source: string,
  relativePath: string,
  options: SyntheticAuditOptions = {},
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'rlt087-protected-reflect-'));
  try {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, source);
    const bytes = Uint8Array.from(await readFile(absolutePath));
    const descriptor = Object.freeze({
      path: relativePath,
      bytes: bytes.byteLength,
      sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    });
    const profile: RuntimeImportAuditProfile = Object.freeze({
      profileId: 'synthetic-protected-reflect-v1',
      entryRoots: Object.freeze([relativePath]),
      projectSources: Object.freeze([descriptor]),
      nodeBuiltins: Object.freeze([...(options.nodeBuiltins ?? [])]),
      pathCapabilities: Object.freeze([Object.freeze({
        path: relativePath,
        builtins: Object.freeze([...(options.nodeBuiltins ?? [])]),
        capabilities: Object.freeze([...(options.capabilities ?? [])]),
      })]),
    });
    await auditServiceFastRuntimeImports({
      repositoryRoot: root,
      profile,
      trackedPaths: new Set([relativePath]),
      ignoredPaths: new Set(),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function isComputedCapabilityFailure(error: unknown): boolean {
  return error instanceof ServiceFastRuntimeImportAuditError &&
    error.code === 'computed-capability-forbidden';
}

function isCodegenFailure(error: unknown): boolean {
  return error instanceof ServiceFastRuntimeImportAuditError &&
    error.code === 'codegen-forbidden';
}

void test('admits each exact path-scoped protected Reflect call profile', async () => {
  for (const profile of PROTECTED_REFLECT_PROFILES) {
    await assert.doesNotReject(
      auditSyntheticSource(profile.source, profile.path),
      profile.path,
    );
  }
  for (const divisionExpression of [
    `numerator / ${ANYTIME_WORK_CAP_REFLECT_CALL} / denominator`,
    `'left' / ${ANYTIME_WORK_CAP_REFLECT_CALL} / denominator`,
    `\`left\` / ${ANYTIME_WORK_CAP_REFLECT_CALL} / denominator`,
    `/left/ / ${ANYTIME_WORK_CAP_REFLECT_CALL} / denominator`,
    `(numerator) / ${ANYTIME_WORK_CAP_REFLECT_CALL} / denominator`,
    `numerator++ / ${ANYTIME_WORK_CAP_REFLECT_CALL} / denominator`,
    `numerator\n / ${ANYTIME_WORK_CAP_REFLECT_CALL} / denominator`,
    `numerator++\n / ${ANYTIME_WORK_CAP_REFLECT_CALL} / denominator`,
  ]) {
    await assert.doesNotReject(auditSyntheticSource(
      ANYTIME_EXACT_INPUT_SPLIT_REFLECT_SOURCE.replace(
        `void ${ANYTIME_WORK_CAP_REFLECT_CALL};`,
        `void (${divisionExpression});`,
      ),
      ANYTIME_EXACT_INPUT_SPLIT_SOURCE,
    ));
  }
});

void test('rejects wrong target, property, arguments, count, and decoy mutations', async () => {
  const hostileProfiles = Object.freeze([
    ...REFLECT_REGEX_DECOYS.map((decoy) => Object.freeze({
      path: ANYTIME_EXACT_INPUT_SPLIT_SOURCE,
      source: `${ANYTIME_EXACT_INPUT_SPLIT_REFLECT_SOURCE.replace(
        `void ${ANYTIME_WORK_CAP_REFLECT_CALL};`,
        'void other.get(workCaps, field);',
      )}\n${decoy}\n`,
    })),
    Object.freeze({
      path: ANYTIME_EXACT_INPUT_SPLIT_SOURCE,
      source: ANYTIME_EXACT_INPUT_SPLIT_REFLECT_SOURCE.replace(
        'Reflect.get(workCaps, field)',
        'Reflect.get(otherCaps, field)',
      ),
    }),
    Object.freeze({
      path: ANYTIME_EXACT_INPUT_SPLIT_SOURCE,
      source: ANYTIME_EXACT_INPUT_SPLIT_REFLECT_SOURCE.replace(
        "Reflect.get(deadline, 'deadlineNanoseconds')",
        "Reflect.get(deadline, 'deadline')",
      ),
    }),
    Object.freeze({
      path: ANYTIME_EXACT_INPUT_SPLIT_SOURCE,
      source: ANYTIME_EXACT_INPUT_SPLIT_REFLECT_SOURCE.replace(
        "Reflect.get(deadline, 'nowNanoseconds')",
        "Reflect.get(deadline, ['now', 'Nanoseconds'].join(''))",
      ),
    }),
    Object.freeze({
      path: ANYTIME_EXACT_INPUT_SPLIT_SOURCE,
      source: `${ANYTIME_EXACT_INPUT_SPLIT_REFLECT_SOURCE}void Reflect.get(workCaps, field);\n`,
    }),
    Object.freeze({
      path: ANYTIME_EXACT_INPUT_SPLIT_SOURCE,
      source: `${ANYTIME_EXACT_INPUT_SPLIT_REFLECT_SOURCE.replace(
        'Reflect.get(workCaps, field)',
        'Reflect.get(workCaps, fields[0])',
      )}void 'Reflect.get(workCaps, field)';\n`,
    }),
    Object.freeze({
      path: PREPARED_ROUTING_CONTEXT_SOURCE,
      source: PREPARED_ROUTING_CONTEXT_REFLECT_SOURCE.replace(
        "Reflect.get(value, 'assetIn')",
        "Reflect.get(subject, 'assetIn')",
      ),
    }),
    Object.freeze({
      path: PREPARED_ROUTING_CONTEXT_SOURCE,
      source: PREPARED_ROUTING_CONTEXT_REFLECT_SOURCE.replace(
        "Reflect.get(value, 'assetIn')",
        "Reflect.get(value, ['asset', 'In'].join(''))",
      ),
    }),
    Object.freeze({
      path: PREPARED_ROUTING_CONTEXT_SOURCE,
      source: PREPARED_ROUTING_CONTEXT_REFLECT_SOURCE.replace(
        "Reflect.get(value, 'assetIn')",
        "Reflect.get(value, 'asset')",
      ),
    }),
    Object.freeze({
      path: PREPARED_ROUTING_CONTEXT_SOURCE,
      source: `${PREPARED_ROUTING_CONTEXT_REFLECT_SOURCE}void Reflect;\n`,
    }),
    Object.freeze({
      path: PREPARED_ROUTING_CONTEXT_SOURCE,
      source: `${PREPARED_ROUTING_CONTEXT_REFLECT_SOURCE.replace(
        "Reflect.get(value, 'assetIn')",
        'Reflect.get(value, field)',
      )}void "Reflect.get(value, 'assetIn')";\n`,
    }),
    Object.freeze({
      path: EXACT_INPUT_SPLIT_SESSION_SOURCE,
      source: EXACT_INPUT_SPLIT_SESSION_REFLECT_SOURCE.replace(
        'Reflect.apply(state.control.shouldCancel, undefined, [checkpoint])',
        'Reflect.apply(state.cancel, undefined, [checkpoint])',
      ),
    }),
    Object.freeze({
      path: EXACT_INPUT_SPLIT_SESSION_SOURCE,
      source: EXACT_INPUT_SPLIT_SESSION_REFLECT_SOURCE.replace(
        'Reflect.apply(state.control.shouldCancel, undefined, [checkpoint])',
        'Reflect.apply(state.control.shouldCancel, null, [checkpoint])',
      ),
    }),
    Object.freeze({
      path: EXACT_INPUT_SPLIT_SESSION_SOURCE,
      source: `${EXACT_INPUT_SPLIT_SESSION_REFLECT_SOURCE}void Reflect.apply(state.nowNanoseconds, undefined, []);\n`,
    }),
    Object.freeze({
      path: EXACT_INPUT_SPLIT_SESSION_SOURCE,
      source: `${EXACT_INPUT_SPLIT_SESSION_REFLECT_SOURCE.replace(
        'Reflect.apply(state.control.shouldCancel, undefined, [checkpoint])',
        'Reflect.apply(state.control.shouldCancel, undefined, arguments_)',
      )}void "Reflect.apply(state.control.shouldCancel, undefined, [checkpoint])";\n`,
    }),
    Object.freeze({
      path: NUMERICAL_EXACT_INPUT_SPLIT_SOURCE,
      source: NUMERICAL_EXACT_INPUT_SPLIT_REFLECT_SOURCE.replace(
        "Reflect.get(numerical, 'outerIterations')",
        "Reflect.get(other, 'outerIterations')",
      ),
    }),
    Object.freeze({
      path: NUMERICAL_EXACT_INPUT_SPLIT_SOURCE,
      source: NUMERICAL_EXACT_INPUT_SPLIT_REFLECT_SOURCE.replace(
        "Reflect.get(numerical, 'outerIterations')",
        "Reflect.get(numerical, ['outer', 'Iterations'].join(''))",
      ),
    }),
    Object.freeze({
      path: NUMERICAL_EXACT_INPUT_SPLIT_SOURCE,
      source: NUMERICAL_EXACT_INPUT_SPLIT_REFLECT_SOURCE.replace(
        "Reflect.get(deadline, 'deadlineNanoseconds')",
        "Reflect.get(deadline, 'deadline')",
      ),
    }),
    Object.freeze({
      path: NUMERICAL_EXACT_INPUT_SPLIT_SOURCE,
      source: `${NUMERICAL_EXACT_INPUT_SPLIT_REFLECT_SOURCE}void Reflect.get(workCaps, field);\n`,
    }),
    Object.freeze({
      path: NUMERICAL_EXACT_INPUT_SPLIT_SOURCE,
      source: `${NUMERICAL_EXACT_INPUT_SPLIT_REFLECT_SOURCE.replace(
        "Reflect.get(numerical, 'outerIterations')",
        'Reflect.get(numerical, field)',
      )}void "Reflect.get(numerical, 'outerIterations')";\n`,
    }),
    Object.freeze({
      path: BOUNDED_SNAPSHOT_JSON_SOURCE,
      source: BOUNDED_SNAPSHOT_JSON_REFLECT_SOURCE.replace(
        'Reflect.apply(getter, value, [])',
        'Reflect.apply(otherGetter, value, [])',
      ),
    }),
    Object.freeze({
      path: BOUNDED_SNAPSHOT_JSON_SOURCE,
      source: BOUNDED_SNAPSHOT_JSON_REFLECT_SOURCE.replace(
        'Reflect.apply(getter, value, [])',
        'Reflect.apply(getter, value, [value])',
      ),
    }),
    Object.freeze({
      path: BOUNDED_SNAPSHOT_JSON_SOURCE,
      source: `${BOUNDED_SNAPSHOT_JSON_REFLECT_SOURCE}void Reflect.apply(getter, value, []);\n`,
    }),
    Object.freeze({
      path: BOUNDED_SNAPSHOT_JSON_SOURCE,
      source: `${BOUNDED_SNAPSHOT_JSON_REFLECT_SOURCE.replace(
        'Reflect.apply(getter, value, [])',
        'Reflect.apply(getter, value, arguments_)',
      )}void 'Reflect.apply(getter, value, [])';\n`,
    }),
  ]);
  for (const hostile of hostileProfiles) {
    await assert.rejects(
      auditSyntheticSource(hostile.source, hostile.path),
      isComputedCapabilityFailure,
      hostile.path,
    );
  }
});

void test('does not admit any exact Reflect profile on another runtime path', async () => {
  for (const [index, profile] of PROTECTED_REFLECT_PROFILES.entries()) {
    await assert.rejects(
      auditSyntheticSource(profile.source, `src/other-${index}.ts`),
      isComputedCapabilityFailure,
      profile.path,
    );
  }
});

void test('admits constructor literals only in the exact reviewed nested-auditor source', async () => {
  const reviewedSource = await readFile(
    path.resolve(import.meta.dirname, '..', INPUT_CLOSURE_AUDIT_SOURCE),
    'utf8',
  );
  const protectedOptions = Object.freeze({
    nodeBuiltins: INPUT_CLOSURE_AUDIT_BUILTINS,
    capabilities: INPUT_CLOSURE_AUDIT_CAPABILITIES,
  });
  await assert.doesNotReject(auditSyntheticSource(
    reviewedSource,
    INPUT_CLOSURE_AUDIT_SOURCE,
    protectedOptions,
  ));

  const hostileSources = Object.freeze([
    `\uFEFF${reviewedSource}`,
    reviewedSource.replace(
      "['constructor', 'runtime-codegen-forbidden']",
      "['safe', 'runtime-codegen-forbidden']",
    ),
    `${reviewedSource}\n['constructor', 'runtime-codegen-forbidden'];\n`,
    reviewedSource.replace(
      "first === 'constructor'",
      "candidate === 'constructor'",
    ),
    reviewedSource.replace(
      "'constructor'",
      "'constr\\u0075ctor'",
    ),
    `${reviewedSource}\nvoid 'constructor';\n`,
    `${reviewedSource}\nvoid ('con' + 'structor');\n`,
    `${reviewedSource}\nvoid ['con', 'structor'].join('');\n`,
    `${reviewedSource}\nvoid value['constructor'];\n`,
    `${reviewedSource}\nvoid value.constructor;\n`,
    `${reviewedSource.replace(
      "['constructor', 'runtime-codegen-forbidden']",
      "['safe', 'runtime-codegen-forbidden']",
    )}\nvoid (() => {})[['constructor', 'runtime-codegen-forbidden'][0]]('return 0');\n`,
    `${reviewedSource.replace(
      "['constructor', 'runtime-codegen-forbidden']",
      "['safe', 'runtime-codegen-forbidden']",
    )}\nvoid /['constructor', 'runtime-codegen-forbidden']/;\n`,
    reviewedSource.replace(
      "first === 'constructor'",
      "prefixfirst === 'constructor'",
    ),
    `${reviewedSource.replace(
      "first === 'constructor'",
      "first === 'safe'",
    )}\nvoid (first === 'constructor');\n`,
    reviewedSource.replace(
      "prior === '.' && first === 'constructor'",
      "prior !== '.' && first === 'constructor'",
    ),
  ]);
  for (const hostile of hostileSources) {
    await assert.rejects(
      auditSyntheticSource(
        hostile,
        INPUT_CLOSURE_AUDIT_SOURCE,
        protectedOptions,
      ),
      isCodegenFailure,
    );
  }
  await assert.rejects(
    auditSyntheticSource(reviewedSource, 'src/other-audit.ts', protectedOptions),
    isCodegenFailure,
  );
  await assert.doesNotReject(auditSyntheticSource(
    "void /'constructor'/;\nvoid /value\\.constructor/;\n",
    'src/constructor-regex-only.ts',
  ));
  for (const [index, payload] of [
    "void `${(() => { const k = 'constructor'; return (() => 1)[k]('return process')(); })()}`;\n",
    "void `${`${(() => { const k = 'constructor'; return (() => 1)[k]('return process')(); })()}`}`;\n",
    "const k = `con${''}structor`; void (() => 1)[k]('return process')();\n",
    "const k = `con${'struc'}tor`; void (() => 1)[k]('return process')();\n",
    "const k = `con${``}structor`; void (() => 1)[k]('return process')();\n",
    "const k = `con${`${''}`}structor`; void (() => 1)[k]('return process')();\n",
    "const k = `con${/*}*/''}structor`; void (() => 1)[k]('return process')();\n",
    "const k = `con${//}\n''}structor`; void (() => 1)[k]('return process')();\n",
    "const k = `con${/struc/.source}tor`; void (() => 1)[k]('return process')();\n",
    "const k = `con${'str' + 'uc'}tor`; void (() => 1)[k]('return process')();\n",
    "const k = `con${(/*}*/ 'str' + ('uc'))}tor`; void (() => 1)[k]('return process')();\n",
    "const k = `con${(/*}*/ /struc/.source)}tor`; void (() => 1)[k]('return process')();\n",
    "const k = /constructor/.source; void (() => 1)[k]('return process')();\n",
    "const k = /con/.source + /structor/.source; void (() => 1)[k]('return process')();\n",
  ].entries()) {
    await assert.rejects(
      auditSyntheticSource(payload, `src/static-constructor-recovery-${index}.ts`),
      isCodegenFailure,
    );
  }
  for (const [index, leftOperand] of [
    "'x'",
    '`x`',
    '/x/',
    'value!',
  ].entries()) {
    await assert.rejects(
      auditSyntheticSource(
        `void (${leftOperand} / (() => 1).constructor('return process')() / 1);\n`,
        `src/constructor-division-${index}.ts`,
      ),
      isCodegenFailure,
    );
  }
  await assert.rejects(
    auditSyntheticSource(
      "declare const of: number; for (let x = of / (() => 1).constructor('return process')() / 1; x < 1; x++) {}\n",
      'src/traditional-for-of-identifier-division.ts',
    ),
    isCodegenFailure,
  );
  for (const [index, leftOperand] of [
    'factory<string>',
    'new Foo<string>',
    'value as Box<string>',
    'value satisfies Box<string>',
    'factory<Box<string>>',
    'factory<Box<Nested<string>>>',
  ].entries()) {
    await assert.rejects(
      auditSyntheticSource(
        `void (${leftOperand} / (() => 1).constructor('return process')() / 1);\n`,
        `src/generic-close-division-${index}.ts`,
      ),
      (error: unknown) =>
        error instanceof ServiceFastRuntimeImportAuditError &&
        error.code === 'invalid-source-syntax',
    );
  }
});
