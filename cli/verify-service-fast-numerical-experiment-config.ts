import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_CONFIG_BYTES = 62_014;
const EXPECTED_CONFIG_SHA256 =
  'sha256:191bce2ff6a39cc7cbef5ce233c3b322b6eb04747e41965e7764298cb206edac';
const CONFIG_PATH = 'fixtures/m7c/service-fast-numerical/experiment-config.v1.json';

type KnownJsonKey =
  | 'acceptedBaseRevision'
  | 'acceptedCorpusObservationAuthorizedByThisConfigAlone'
  | 'actionCaps'
  | 'aggregateServiceTransitionCap'
  | 'amountBucket'
  | 'amplifiedStress'
  | 'anchorPolicyId'
  | 'artifacts'
  | 'authorities'
  | 'authorizations'
  | 'baseGitTree'
  | 'baselineEligibility'
  | 'boundInputs'
  | 'bytes'
  | 'callOnly'
  | 'caseId'
  | 'cases'
  | 'cellCount'
  | 'cells'
  | 'cohorts'
  | 'count'
  | 'currentResidualOptionReplays'
  | 'deadline'
  | 'driverId'
  | 'driverOrder'
  | 'drivers'
  | 'files'
  | 'full'
  | 'innerUpdates'
  | 'instrumented'
  | 'maxBytes'
  | 'maximumConservativeIncludingUnmeasuredModelSetup'
  | 'maximumMeasuredExperimentStageActions'
  | 'maximumShareActions'
  | 'method'
  | 'modelRouteSetupSteps'
  | 'name'
  | 'nonConvergenceOrder'
  | 'numericalProposals'
  | 'observationPerformed'
  | 'observationState'
  | 'operational'
  | 'operationalProtocol'
  | 'outerUpdates'
  | 'path'
  | 'policyIds'
  | 'policyMatrix'
  | 'priorEligibleBoundOnly'
  | 'priorEligibleServiceBoundOnly'
  | 'protectedRuntimeSources'
  | 'protectedSurfaces'
  | 'reconstructionOrder'
  | 'reconstructionRoutePassSteps'
  | 'recordCount'
  | 'repairNeighborReplays'
  | 'requestId'
  | 'requests'
  | 'retainedRecordCount'
  | 'schemaVersion'
  | 'semanticEvidence'
  | 'serviceDecision'
  | 'sha256'
  | 'snapshotChecksum'
  | 'snapshotId'
  | 'sourceClosure'
  | 'status'
  | 'timingCohortIndex'
  | 'topology'
  | 'totalPolicyCalls'
  | 'warmupCallCount';

type JsonObject = Record<string, unknown> & {
  readonly [Key in KnownJsonKey]: unknown;
};

function fail(message: string): never {
  throw new Error(`Service-fast experiment config verification failed: ${message}`);
}

function object(value: unknown, label: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  return value as JsonObject;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string') fail(`${label} must be a string.`);
  return value;
}

function integer(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a nonnegative safe integer.`);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label} must be a boolean.`);
  return value;
}

function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function same(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} does not match the frozen value.`);
  }
}

function repositoryRoot(): string {
  return fileURLToPath(new URL('..', import.meta.url));
}

function readJson(root: string, relativePath: string): unknown {
  const bytes = readFileSync(path.join(root, relativePath));
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    return fail(`${relativePath} is not valid JSON.`);
  }
}

function verifyDescriptor(root: string, value: unknown, label: string): void {
  const descriptor = object(value, label);
  const relativePath = string(descriptor.path, `${label}.path`);
  const expectedBytes = integer(descriptor.bytes, `${label}.bytes`);
  const expectedSha256 = string(descriptor.sha256, `${label}.sha256`);
  const bytes = readFileSync(path.join(root, relativePath));
  if (bytes.length !== expectedBytes) fail(`${label} byte count mismatch.`);
  if (sha256(bytes) !== expectedSha256) fail(`${label} hash mismatch.`);
}

function requestIdentities(requestsValue: unknown): {
  readonly identities: readonly { readonly caseId: string; readonly requestId: string }[];
  readonly requests: readonly {
    readonly caseId: string;
    readonly requestId: string;
    readonly topology: string;
    readonly amountBucket: string;
  }[];
} {
  const requestsRoot = object(requestsValue, 'requests');
  const cases = array(requestsRoot.cases, 'requests.cases');
  const identities: { caseId: string; requestId: string }[] = [];
  const requests: {
    caseId: string;
    requestId: string;
    topology: string;
    amountBucket: string;
  }[] = [];
  for (const [caseIndex, caseValue] of cases.entries()) {
    const requestCase = object(caseValue, `requests.cases[${caseIndex}]`);
    const caseId = string(requestCase.caseId, `requests.cases[${caseIndex}].caseId`);
    for (const [requestIndex, requestValue] of array(
      requestCase.requests,
      `requests.cases[${caseIndex}].requests`,
    ).entries()) {
      const request = object(
        requestValue,
        `requests.cases[${caseIndex}].requests[${requestIndex}]`,
      );
      const requestId = string(request.requestId, 'requestId');
      identities.push({ caseId, requestId });
      requests.push({
        caseId,
        requestId,
        topology: string(request.topology, 'topology'),
        amountBucket: string(request.amountBucket, 'amountBucket'),
      });
    }
  }
  return { identities, requests };
}

function identityHash(
  identities: readonly { readonly caseId: string; readonly requestId: string }[],
): string {
  return sha256(JSON.stringify(identities));
}

function verifyCohorts(root: string, config: JsonObject): void {
  const boundInputs = object(config.boundInputs, 'boundInputs');
  const requestsDescriptor = object(boundInputs.requests, 'boundInputs.requests');
  const eligibilityDescriptor = object(
    boundInputs.baselineEligibility,
    'boundInputs.baselineEligibility',
  );
  const projected = requestIdentities(
    readJson(root, string(requestsDescriptor.path, 'boundInputs.requests.path')),
  );
  const cohorts = object(config.cohorts, 'cohorts');
  const cases = array(cohorts.cases, 'cohorts.cases').map((value, index) =>
    object(value, `cohorts.cases[${index}]`),
  );
  const caseOrder = cases.map((value, index) => string(value.caseId, `case ${index}`));
  same(
    [...new Set(projected.identities.map((identity) => identity.caseId))],
    caseOrder,
    'source case order',
  );
  const snapshotKeys = [
    'historicalSnapshot',
    'dualTreeSnapshot',
    'compressedSnapshot',
    'amplifiedSnapshot',
  ] as const;
  for (const [index, key] of snapshotKeys.entries()) {
    const descriptor = object(boundInputs[key], `boundInputs.${key}`);
    const snapshot = object(
      readJson(root, string(descriptor.path, `boundInputs.${key}.path`)),
      `boundInputs.${key} content`,
    );
    same(
      {
        snapshotId: string(snapshot.snapshotId, `${key}.snapshotId`),
        snapshotChecksum: string(snapshot.snapshotChecksum, `${key}.snapshotChecksum`),
      },
      {
        snapshotId: string(cases[index]?.snapshotId, `cohorts.cases[${index}].snapshotId`),
        snapshotChecksum: string(
          cases[index]?.snapshotChecksum,
          `cohorts.cases[${index}].snapshotChecksum`,
        ),
      },
      `cohorts.cases[${index}] snapshot binding`,
    );
  }

  const full = object(cohorts.full, 'cohorts.full');
  if (projected.identities.length !== integer(full.count, 'cohorts.full.count')) {
    fail('full cohort count mismatch.');
  }
  if (identityHash(projected.identities) !== string(full.sha256, 'cohorts.full.sha256')) {
    fail('full cohort hash mismatch.');
  }

  const serviceIds = new Set(
    cases
      .filter((value, index) => boolean(value.serviceDecision, `case ${index}.serviceDecision`))
      .map((value, index) => string(value.caseId, `service case ${index}`)),
  );
  const service = projected.identities.filter((identity) => serviceIds.has(identity.caseId));
  const serviceConfig = object(cohorts.serviceDecision, 'cohorts.serviceDecision');
  if (service.length !== integer(serviceConfig.count, 'cohorts.serviceDecision.count')) {
    fail('service cohort count mismatch.');
  }
  if (identityHash(service) !== string(serviceConfig.sha256, 'cohorts.serviceDecision.sha256')) {
    fail('service cohort hash mismatch.');
  }

  const amplified = projected.identities.filter(
    (identity) => identity.caseId === 'synthetic-reserve-amplified-1e60',
  );
  const amplifiedConfig = object(cohorts.amplifiedStress, 'cohorts.amplifiedStress');
  if (amplified.length !== integer(amplifiedConfig.count, 'cohorts.amplifiedStress.count')) {
    fail('amplified cohort count mismatch.');
  }
  if (
    identityHash(amplified) !== string(amplifiedConfig.sha256, 'cohorts.amplifiedStress.sha256')
  ) {
    fail('amplified cohort hash mismatch.');
  }

  const eligibility = object(
    readJson(root, string(eligibilityDescriptor.path, 'eligibility path')),
    'eligibility',
  );
  const eligibleCells = array(eligibility.cells, 'eligibility.cells')
    .map((value, index) => object(value, `eligibility.cells[${index}]`))
    .filter((value) => value.status === 'eligible')
    .map((value) => ({
      caseId: string(value.caseId, 'eligibility caseId'),
      requestId: string(value.requestId, 'eligibility requestId'),
    }));
  const prior = object(cohorts.priorEligibleBoundOnly, 'cohorts.priorEligibleBoundOnly');
  if (eligibleCells.length !== integer(prior.count, 'prior eligible count')) {
    fail('prior eligible count mismatch.');
  }
  if (identityHash(eligibleCells) !== string(prior.sha256, 'prior eligible hash')) {
    fail('prior eligible hash mismatch.');
  }
  const serviceEligible = eligibleCells.filter((identity) => serviceIds.has(identity.caseId));
  const servicePrior = object(
    cohorts.priorEligibleServiceBoundOnly,
    'cohorts.priorEligibleServiceBoundOnly',
  );
  if (serviceEligible.length !== integer(servicePrior.count, 'service prior count')) {
    fail('service prior eligible count mismatch.');
  }
  if (identityHash(serviceEligible) !== string(servicePrior.sha256, 'service prior hash')) {
    fail('service prior eligible hash mismatch.');
  }

  const seen = new Map<string, number>();
  const timing = projected.requests.filter((request) => {
    if (!serviceIds.has(request.caseId)) return false;
    const key = JSON.stringify([request.caseId, request.topology, request.amountBucket]);
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    return count < 12;
  });
  const timingConfig = object(cohorts.operational, 'cohorts.operational');
  if (timing.length !== integer(timingConfig.count, 'operational count')) {
    fail('operational cohort count mismatch.');
  }
  if (
    identityHash(timing.map(({ caseId, requestId }) => ({ caseId, requestId }))) !==
    string(timingConfig.sha256, 'operational hash')
  ) {
    fail('operational cohort hash mismatch.');
  }
}

function verifyPolicyMatrix(config: JsonObject): void {
  const matrix = object(config.policyMatrix, 'policyMatrix');
  const drivers = array(matrix.driverOrder, 'driverOrder').map((value, index) =>
    string(value, `driverOrder[${index}]`),
  );
  const convergence = array(matrix.nonConvergenceOrder, 'nonConvergenceOrder').map(
    (value, index) => string(value, `nonConvergenceOrder[${index}]`),
  );
  const reconstruction = array(matrix.reconstructionOrder, 'reconstructionOrder').map(
    (value, index) => string(value, `reconstructionOrder[${index}]`),
  );
  const expectedIds = drivers.flatMap((driver) =>
    convergence.flatMap((mode) => reconstruction.map((repair) => `${driver}--${mode}--${repair}`)),
  );
  same(matrix.policyIds, expectedIds, 'policy matrix Cartesian product');
  if (expectedIds.length !== 24) fail('policy matrix must contain exactly 24 IDs.');
  if (matrix.anchorPolicyId !== expectedIds[0]) fail('anchor must be the first policy ID.');

  const driverConfigs = array(matrix.drivers, 'policyMatrix.drivers').map((value, index) =>
    object(value, `policyMatrix.drivers[${index}]`),
  );
  same(
    driverConfigs.map((value) => value.driverId),
    drivers,
    'driver config order',
  );
  for (const [index, driver] of driverConfigs.entries()) {
    const outer = integer(driver.outerUpdates, `driver ${index}.outerUpdates`);
    const method = string(driver.method, `driver ${index}.method`);
    let expected: number;
    if (method === 'bisection') {
      const inner = integer(driver.innerUpdates, `driver ${index}.innerUpdates`);
      expected = 4 * 4 * (outer + 1) * (inner + 2);
    } else {
      const perRouteSample = method === 'pinned-sqrt' ? 2 : 11;
      expected = 4 * 4 * (outer + 1) * perRouteSample;
    }
    if (integer(driver.maximumShareActions, `driver ${index}.maximumShareActions`) !== expected) {
      fail(`driver ${index} share-action ceiling mismatch.`);
    }
  }
}

function verifyActionAndArtifactArithmetic(config: JsonObject): void {
  const caps = object(config.actionCaps, 'actionCaps');
  const measured =
    68640 +
    integer(caps.reconstructionRoutePassSteps, 'reconstructionRoutePassSteps') +
    integer(caps.currentResidualOptionReplays, 'currentResidualOptionReplays') +
    integer(caps.repairNeighborReplays, 'repairNeighborReplays') +
    integer(caps.authorizations, 'authorizations') +
    integer(caps.numericalProposals, 'numericalProposals');
  if (measured !== integer(caps.maximumMeasuredExperimentStageActions, 'measured actions')) {
    fail('maximum measured action sum mismatch.');
  }
  const includingSetup = measured + integer(caps.modelRouteSetupSteps, 'model setup steps');
  if (
    includingSetup !==
    integer(caps.maximumConservativeIncludingUnmeasuredModelSetup, 'including setup actions')
  ) {
    fail('maximum including-setup action sum mismatch.');
  }
  if (includingSetup >= integer(caps.aggregateServiceTransitionCap, 'aggregate cap')) {
    fail('experiment actions exceed the service transition cap.');
  }

  const semantic = object(config.semanticEvidence, 'semanticEvidence');
  if (integer(semantic.cellCount, 'semantic cell count') !== 1584 * 24) {
    fail('semantic record count formula mismatch.');
  }
  const protocol = object(config.operationalProtocol, 'operationalProtocol');
  const callOnly = object(protocol.callOnly, 'callOnly');
  const instrumented = object(protocol.instrumented, 'instrumented');
  const deadline = object(protocol.deadline, 'deadline');
  if (integer(callOnly.retainedRecordCount, 'call count') !== 252 * 24 * 5) {
    fail('call-only record count formula mismatch.');
  }
  if (integer(instrumented.retainedRecordCount, 'timeline count') !== 252 * 24 * 3) {
    fail('instrumented record count formula mismatch.');
  }
  if (integer(deadline.retainedRecordCount, 'deadline count') !== 252 * 24 * 6 * 3) {
    fail('deadline record count formula mismatch.');
  }
  if (integer(callOnly.warmupCallCount, 'call warmups') !== 252 * 24) {
    fail('call-only warmup count formula mismatch.');
  }
  if (integer(deadline.warmupCallCount, 'deadline warmups') !== 252 * 24 * 6) {
    fail('deadline warmup count formula mismatch.');
  }
  const expectedTotalPolicyCalls =
    1584 * 24 +
    integer(callOnly.warmupCallCount, 'call warmups') +
    integer(callOnly.retainedRecordCount, 'call count') +
    integer(instrumented.retainedRecordCount, 'timeline count') +
    integer(deadline.warmupCallCount, 'deadline warmups') +
    integer(deadline.retainedRecordCount, 'deadline count');
  if (integer(protocol.totalPolicyCalls, 'total policy calls') !== expectedTotalPolicyCalls) {
    fail('total policy-call formula mismatch.');
  }

  const artifacts = object(config.artifacts, 'artifacts');
  const expectedCounts = new Map<string, number | null>([
    ['inputs.ndjson', 1584],
    ['semantic-results.ndjson', 1584 * 24],
    ['call-timing-observations.ndjson', 252 * 24 * 5],
    ['incumbent-timeline-observations.ndjson', 252 * 24 * 3],
    ['deadline-observations.ndjson', 252 * 24 * 6 * 3],
    ['analysis.json', null],
    ['manifest.json', null],
    ['README.md', null],
  ]);
  const files = array(artifacts.files, 'artifacts.files').map((value, index) =>
    object(value, `artifacts.files[${index}]`),
  );
  same(
    files.map((value) => string(value.name, 'artifact name')),
    [...expectedCounts.keys()],
    'artifact order',
  );
  for (const file of files) {
    const name = string(file.name, 'artifact name');
    if (file.recordCount !== expectedCounts.get(name)) fail(`${name} record count mismatch.`);
    integer(file.maxBytes, `${name}.maxBytes`);
  }
}

function schemaFieldNames(value: JsonObject, label: string): readonly string[] {
  const names = array(value['fields'], `${label}.fields`).map((fieldValue, index) => {
    const field = array(fieldValue, `${label}.fields[${index}]`);
    if (field.length !== 2) fail(`${label}.fields[${index}] must have two entries.`);
    string(field[1], `${label}.fields[${index}][1]`);
    return string(field[0], `${label}.fields[${index}][0]`);
  });
  if (new Set(names).size !== names.length) fail(`${label} has duplicate field names.`);
  return names;
}

function verifyArtifactSchema(root: string, config: JsonObject): void {
  const descriptor = object(config['artifactSchema'], 'artifactSchema');
  verifyDescriptor(root, descriptor, 'artifactSchema');
  const schema = object(
    readJson(root, string(descriptor.path, 'artifactSchema.path')),
    'artifact schema',
  );
  if (
    schema['schemaVersion'] !== 'routelab.service-fast-numerical-artifact-schema.v1' ||
    schema['experimentId'] !== 'm7c-core12-service-fast-numerical-v1'
  ) {
    fail('unexpected artifact schema identity.');
  }

  const primitiveIds = new Set(Object.keys(object(schema['primitiveCodecs'], 'primitiveCodecs')));
  const enumIds = new Set(Object.keys(object(schema['enums'], 'enums')));
  const schemas = array(schema['objectSchemas'], 'objectSchemas').map((value, index) =>
    object(value, `objectSchemas[${index}]`),
  );
  const schemaById = new Map<string, JsonObject>();
  for (const [index, value] of schemas.entries()) {
    const schemaId = string(value['schemaId'], `objectSchemas[${index}].schemaId`);
    if (schemaById.has(schemaId)) fail(`duplicate artifact object schema ${schemaId}.`);
    schemaFieldNames(value, `objectSchemas[${index}]`);
    schemaById.set(schemaId, value);
  }

  const configEnum = (dotPath: string): void => {
    let value: unknown = config;
    for (const segment of dotPath.split('.')) {
      value = object(value, `config-enum:${dotPath}`)[segment];
    }
    array(value, `config-enum:${dotPath}`);
  };
  const verifyType = (type: string, label: string): void => {
    if (type.startsWith('array(') && type.endsWith(')')) {
      verifyType(type.slice(6, -1), label);
      return;
    }
    if (type.startsWith('nullable(') && type.endsWith(')')) {
      verifyType(type.slice(9, -1), label);
      return;
    }
    const separator = type.indexOf(':');
    if (separator < 1 || separator === type.length - 1) fail(`${label} has invalid type ${type}.`);
    const kind = type.slice(0, separator);
    const target = type.slice(separator + 1);
    if (kind === 'primitive' && primitiveIds.has(target)) return;
    if (kind === 'enum' && enumIds.has(target)) return;
    if (kind === 'object' && schemaById.has(target)) return;
    if (kind === 'config-enum') {
      configEnum(target);
      return;
    }
    if (kind === 'literal') return;
    fail(`${label} references unknown type ${type}.`);
  };
  for (const [schemaId, value] of schemaById) {
    for (const [index, fieldValue] of array(value['fields'], `${schemaId}.fields`).entries()) {
      const field = array(fieldValue, `${schemaId}.fields[${index}]`);
      verifyType(string(field[1], `${schemaId}.fields[${index}][1]`), `${schemaId} field type`);
    }
  }

  const bindings = array(schema['recordBindings'], 'recordBindings').map((value, index) =>
    object(value, `recordBindings[${index}]`),
  );
  const bindingPaths = bindings.map((value, index) =>
    string(value['path'], `recordBindings[${index}].path`),
  );
  if (new Set(bindingPaths).size !== bindingPaths.length) fail('duplicate artifact record binding.');
  for (const [index, binding] of bindings.entries()) {
    const schemaId = string(binding['schemaId'], `recordBindings[${index}].schemaId`);
    if (!schemaById.has(schemaId)) fail(`record binding references unknown schema ${schemaId}.`);
  }

  const fields = (schemaId: string): readonly string[] => {
    const value = schemaById.get(schemaId);
    if (value === undefined) fail(`missing artifact schema ${schemaId}.`);
    return schemaFieldNames(value, schemaId);
  };
  if (
    object(schema['primitiveCodecs'], 'primitiveCodecs')['counterVector'] !==
    'json-array-of-exactly-12-safe-nonnegative-integers-in-config.semanticEvidence.counterOrder-each-less-than-or-equal-config.actionCaps.aggregateServiceTransitionCap-100000'
  ) {
    fail('artifact counter-vector ceiling mismatch.');
  }
  same(
    fields('IncumbentReference'),
    [
      'origin',
      'candidateSetIndex',
      'selectedScoreSource',
      'selectedAttemptIndex',
      'objectiveHash',
      'receiptHash',
    ],
    'compact incumbent reference fields',
  );
  same(
    fields('ProposalEvidence'),
    [
      'status',
      'failureCode',
      'converged',
      'completedOuterIterations',
      'weightBits',
      'reconstructionHash',
    ],
    'compact proposal evidence fields',
  );
  same(
    fields('ScoreEvidence'),
    [
      'status',
      'failureCode',
      'selectedAttemptIndex',
      'receiptHash',
      'scoreTranscriptHash',
    ],
    'compact score evidence fields',
  );
  same(
    fields('RepairEvidence'),
    [
      'status',
      'attemptedNeighbors',
      'rejectedNeighbors',
      'winnerAttemptIndex',
      'winnerReceiptHash',
      'failureCode',
      'scoreTranscriptHash',
    ],
    'compact repair evidence fields',
  );
  same(
    fields('CandidateSetDiagnostic'),
    [
      'setIndex',
      'resolutionStatus',
      'terminalStatus',
      'failureCode',
      'proposal',
      'currentScore',
      'repair',
      'selectedScoreSource',
      'reconstructionDisposition',
      'authorization',
      'counters',
    ],
    'compact candidate-set diagnostic fields',
  );
  const input = object(object(config['inputConstruction'], 'inputConstruction')['inputArtifact'], 'inputArtifact');
  same(input['recordFieldOrder'], fields('ExperimentInputRecord'), 'input record schema fields');
  const sourceClosure = object(object(config['artifacts'], 'artifacts')['sourceClosure'], 'sourceClosure');
  same(sourceClosure['recordFieldOrder'], fields('SourceClosure'), 'source closure schema fields');
  same(
    sourceClosure['sourceEntryFieldOrder'],
    fields('SourceEntry'),
    'source entry schema fields',
  );
  same(sourceClosure['descriptorFieldOrder'], fields('Descriptor'), 'descriptor schema fields');

  const artifactSchemaIds = new Map<string, string>([
    ['semantic-results.ndjson', 'SemanticResultRecord'],
    ['call-timing-observations.ndjson', 'CallTimingRecord'],
    ['incumbent-timeline-observations.ndjson', 'TimelineRecord'],
    ['deadline-observations.ndjson', 'DeadlineRecord'],
    ['analysis.json', 'Analysis'],
    ['manifest.json', 'Manifest'],
  ]);
  for (const [index, value] of array(object(config['artifacts'], 'artifacts')['files'], 'files').entries()) {
    const file = object(value, `files[${index}]`);
    const name = string(file['name'], `files[${index}].name`);
    const schemaId = artifactSchemaIds.get(name);
    if (schemaId !== undefined) {
      same(file['recordFieldOrder'], fields(schemaId), `${name} schema fields`);
    }
  }

  const projections = object(schema['hashProjections'], 'hashProjections');
  const semanticHash = object(projections['semanticHash'], 'hashProjections.semanticHash');
  const semanticFields = fields('SemanticResultRecord');
  same(
    semanticHash['includedFields'],
    semanticFields.slice(0, -1),
    'semantic hash included fields',
  );
  same(semanticHash['excludedFields'], ['semanticHash'], 'semantic hash excluded fields');

  const selection = object(config['selection'], 'selection');
  const qualification = object(selection['qualification'], 'selection.qualification');
  const clauseOrder = [
    'fresh-exact-safety',
    'full-semantic-nonregression',
    'service-failure-reduction',
    'service-timing-nonregression',
    'hotspot-speedup',
    'deadline-and-event-quality',
  ];
  same(qualification['clauseResultOrder'], clauseOrder, 'qualification clause order');
  same(
    array(qualification['clauses'], 'qualification.clauses').map((value, index) =>
      string(object(value, `qualification.clauses[${index}]`)['clauseId'], 'clauseId'),
    ),
    clauseOrder,
    'qualification clause identities',
  );
  same(object(schema['enums'], 'enums')['clauseId'], clauseOrder, 'artifact clause enum');
  const ranking = object(selection['ranking'], 'selection.ranking');
  same(
    array(ranking['keys'], 'ranking.keys').map((value, index) =>
      string(object(value, `ranking.keys[${index}]`)['keyId'], 'keyId'),
    ),
    [
      'worst-hotspot-elapsed-ratio',
      'anchor-quality-vector',
      'mapped-share-action-ceiling',
      'policy-matrix-index',
    ],
    'ranking key order',
  );
}

function verifyUniformSemanticEnvelope(config: JsonObject): void {
  const artifacts = object(config['artifacts'], 'artifacts');
  const admission = object(artifacts['sizeAdmission'], 'artifacts.sizeAdmission');
  const envelope = object(
    admission['uniformSemanticEnvelope'],
    'artifacts.sizeAdmission.uniformSemanticEnvelope',
  );
  const expectedEnvelope = {
    requiredAtConfigVerification: true,
    candidateSetCount: 4,
    maximumRoutesPerCandidateSet: 4,
    maximumRequestAndAllocationDecimalDigits: 83,
    maximumReserveOutputAndDeltaDecimalDigits: 86,
    maximumBpsNumeratorAndIntegerDecimalDigits: 90,
    maximumBinary64IntegerWeightDecimalDigits: 324,
    maximumCounterValue: 100_000,
    syntheticStructuralIntegerValue: Number.MAX_SAFE_INTEGER,
    semanticRecordCount: 38_016,
    semanticFileCapBytes: 268_435_456,
  } as const;
  for (const [key, value] of Object.entries(expectedEnvelope)) {
    if (envelope[key] !== value) fail(`uniform semantic envelope ${key} mismatch.`);
  }

  const hash = `sha256:${'f'.repeat(64)}`;
  const weightBits = 'f'.repeat(16);
  const output = '9'.repeat(expectedEnvelope.maximumReserveOutputAndDeltaDecimalDigits);
  const bps = '9'.repeat(expectedEnvelope.maximumBpsNumeratorAndIntegerDecimalDigits);
  const structuralInteger = expectedEnvelope.syntheticStructuralIntegerValue;
  const counters = Array<number>(12).fill(structuralInteger);
  const proposal = {
    status: 'failed',
    failureCode: 'finite-nonconverged-replayed',
    converged: false,
    completedOuterIterations: structuralInteger,
    weightBits: Array<string>(expectedEnvelope.maximumRoutesPerCandidateSet).fill(weightBits),
    reconstructionHash: hash,
  };
  const score = {
    status: 'rejected',
    failureCode: 'finite-nonconverged-replayed',
    selectedAttemptIndex: structuralInteger,
    receiptHash: hash,
    scoreTranscriptHash: hash,
  };
  const authorization = {
    status: 'not-attempted',
    receiptHash: hash,
    failureCode: 'finite-nonconverged-replayed',
  };
  const diagnostic = (repairEvidence: unknown) => ({
    setIndex: structuralInteger,
    resolutionStatus: 'resolved',
    terminalStatus: 'model-resolution-failed',
    failureCode: 'finite-nonconverged-replayed',
    proposal,
    currentScore: score,
    repair: repairEvidence,
    selectedScoreSource: 'current',
    reconstructionDisposition: 'current-only-nontarget',
    authorization,
    counters,
  });
  const repair = {
    status: 'incomplete',
    attemptedNeighbors: structuralInteger,
    rejectedNeighbors: structuralInteger,
    winnerAttemptIndex: structuralInteger,
    winnerReceiptHash: hash,
    failureCode: 'finite-nonconverged-replayed',
    scoreTranscriptHash: hash,
  };
  const candidateSetDiagnostics = Array.from(
    { length: expectedEnvelope.candidateSetCount },
    (_, index) => diagnostic(index === 0 ? repair : null),
  );
  const maximalRecord = {
    schemaVersion: 'routelab.service-fast-numerical-semantic-result.v1',
    semanticIndex: structuralInteger,
    sourceIndex: structuralInteger,
    policyMatrixIndex: structuralInteger,
    entryIncumbentHash: hash,
    candidateSetDiagnostics,
    finalIncumbent: {
      origin: 'candidate-set',
      candidateSetIndex: structuralInteger,
      selectedScoreSource: 'current',
      selectedAttemptIndex: structuralInteger,
      objectiveHash: hash,
      receiptHash: hash,
    },
    anchorComparison: {
      relation: 'policy-objective-strictly-better',
      comparison: 'policy-better',
      anchorHasPlan: false,
      policyHasPlan: false,
    },
    exactRegret: {
      outputDelta: `-${output}`,
      bpsNumerator: `-${bps}`,
      bpsDenominator: output,
      integerBps: `-${bps}`,
    },
    counters,
    semanticHash: hash,
  };
  const recordBytes = Buffer.byteLength(`${JSON.stringify(maximalRecord)}\n`, 'utf8');
  if (envelope['maximumSemanticRecordBytesIncludingLineFeed'] !== recordBytes) {
    fail(`uniform semantic maximum record byte count mismatch: computed ${recordBytes}.`);
  }
  if (recordBytes > Math.floor(expectedEnvelope.semanticFileCapBytes / 38_016)) {
    fail('uniform semantic envelope exceeds the per-record file-cap allowance.');
  }
  if (recordBytes * 38_016 > expectedEnvelope.semanticFileCapBytes) {
    fail('uniform semantic envelope exceeds the semantic artifact cap.');
  }
}

function verifyBindings(root: string, config: JsonObject): void {
  const expectedAuthorities = [
    'docs/invariants.md',
    'docs/adr/accepted/0004-path-level-numerical-allocation.md',
    'docs/adr/accepted/0005-service-routing-runtime.md',
    'IMPLEMENTATION_PLAN.md',
  ];
  same(config.authorities, expectedAuthorities, 'accepted authorities');
  for (const authority of expectedAuthorities) {
    readFileSync(path.join(root, authority));
  }
  const authorityBindings = object(config['authorityBindings'], 'authorityBindings');
  const bindingEntries = Object.values(authorityBindings).map((value, index) =>
    object(value, `authorityBindings[${index}]`),
  );
  same(
    bindingEntries.map((value, index) => string(value.path, `authority binding ${index}.path`)),
    expectedAuthorities,
    'authority binding order',
  );
  const baseRevision = string(config.acceptedBaseRevision, 'acceptedBaseRevision');
  for (const [index, binding] of bindingEntries.entries()) {
    verifyDescriptor(root, binding, `authorityBindings[${index}]`);
    const relativePath = string(binding.path, `authorityBindings[${index}].path`);
    const expectedBlob = string(binding['baseGitBlob'], `authorityBindings[${index}].baseGitBlob`);
    const baseBlob = execFileSync('git', ['rev-parse', `${baseRevision}:${relativePath}`], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const currentBlob = execFileSync('git', ['hash-object', relativePath], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    if (baseBlob !== expectedBlob || currentBlob !== expectedBlob) {
      fail(`${relativePath} authority Git blob mismatch.`);
    }
  }

  const boundInputs = object(config.boundInputs, 'boundInputs');
  for (const [name, descriptor] of Object.entries(boundInputs)) {
    verifyDescriptor(root, descriptor, `boundInputs.${name}`);
  }
  const sources = object(config.protectedRuntimeSources, 'protectedRuntimeSources');
  for (const [name, descriptor] of Object.entries(sources)) {
    verifyDescriptor(root, descriptor, `protectedRuntimeSources.${name}`);
  }
  for (const [index, value] of array(config.protectedSurfaces, 'protectedSurfaces').entries()) {
    const surface = object(value, `protectedSurfaces[${index}]`);
    const relativePath = string(surface.path, `protectedSurfaces[${index}].path`);
    const expectedTree = string(surface.baseGitTree, `protectedSurfaces[${index}].baseGitTree`);
    const actualTree = execFileSync('git', ['rev-parse', `HEAD:${relativePath}`], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    if (actualTree !== expectedTree) fail(`${relativePath} protected Git tree mismatch.`);
  }
}

function main(): void {
  if (process.argv.length !== 2) fail('unexpected command arguments.');
  const root = repositoryRoot();
  const configBytes = readFileSync(path.join(root, CONFIG_PATH));
  if (configBytes.length !== EXPECTED_CONFIG_BYTES) fail('config byte count mismatch.');
  if (sha256(configBytes) !== EXPECTED_CONFIG_SHA256) fail('config hash mismatch.');
  const config = object(JSON.parse(configBytes.toString('utf8')) as unknown, 'config');
  if (config.schemaVersion !== 'routelab.service-fast-numerical-experiment-config.v1') {
    fail('unexpected schemaVersion.');
  }
  if (config.acceptedBaseRevision !== 'aaf5608856b8ca3ed940f3ec47db48442b6adcd5') {
    fail('unexpected accepted base revision.');
  }
  if (config.observationPerformed !== false) {
    fail('output-free config must record that no observation was performed.');
  }
  const observation = object(config.observationState, 'observationState');
  if (observation.acceptedCorpusObservationAuthorizedByThisConfigAlone !== false) {
    fail('output-free config must not authorize candidate-corpus observation.');
  }
  verifyBindings(root, config);
  verifyArtifactSchema(root, config);
  verifyUniformSemanticEnvelope(config);
  verifyCohorts(root, config);
  verifyPolicyMatrix(config);
  verifyActionAndArtifactArithmetic(config);
  process.stdout.write(
    `Verified output-free service-fast experiment config: ${EXPECTED_CONFIG_BYTES} bytes, ${EXPECTED_CONFIG_SHA256}.\n`,
  );
}

main();
