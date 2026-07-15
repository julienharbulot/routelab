import { validatePrimitiveCodec } from './codec.ts';
import {
  exactKeys,
  isJsonObject,
  requireJsonArray,
  requireJsonObject,
  requireString,
  type JsonObject,
  type JsonValue,
} from '../types.ts';

export type SchemaRuleCollection = 'crossFieldRules' | 'arrayRules';

export interface ArtifactObjectSchema {
  readonly schemaId: string;
  readonly fields: readonly Readonly<{
    readonly name: string;
    readonly type: string;
  }>[];
  readonly crossFieldRules: readonly string[];
  readonly arrayRules: ReadonlyMap<string, string>;
}

export interface ArtifactRecordBinding {
  readonly path: string;
  readonly schemaId: string;
  readonly recordOrder: string;
}

export interface ArtifactSchemaProgram {
  readonly source: JsonObject;
  readonly config: JsonObject;
  readonly primitiveCodecs: ReadonlySet<string>;
  readonly enums: ReadonlyMap<string, readonly string[]>;
  readonly schemas: ReadonlyMap<string, ArtifactObjectSchema>;
  readonly recordBindings: ReadonlyMap<string, ArtifactRecordBinding>;
}

function nonemptyUniqueStrings(value: JsonValue): readonly string[] {
  const values = requireJsonArray(value).map(requireString);
  if (values.some((item) => item.length === 0) || new Set(values).size !== values.length) {
    throw new TypeError('Schema string collection is invalid.');
  }
  return Object.freeze(values);
}

function configEnum(config: JsonObject, dotPath: string): readonly string[] {
  let value: JsonValue = config;
  for (const segment of dotPath.split('.')) {
    if (!isJsonObject(value) || !(segment in value)) {
      throw new TypeError('Schema config enum path is invalid.');
    }
    value = value[segment] as JsonValue;
  }
  return nonemptyUniqueStrings(value);
}

function parseType(
  type: string,
  primitiveCodecs: ReadonlySet<string>,
  enums: ReadonlyMap<string, readonly string[]>,
  schemas: ReadonlyMap<string, ArtifactObjectSchema>,
  config: JsonObject,
): void {
  if (type.startsWith('array(') && type.endsWith(')')) {
    parseType(type.slice(6, -1), primitiveCodecs, enums, schemas, config);
    return;
  }
  if (type.startsWith('nullable(') && type.endsWith(')')) {
    parseType(type.slice(9, -1), primitiveCodecs, enums, schemas, config);
    return;
  }
  const separator = type.indexOf(':');
  if (separator <= 0 || separator === type.length - 1) {
    throw new TypeError('Schema field type is invalid.');
  }
  const kind = type.slice(0, separator);
  const target = type.slice(separator + 1);
  if (kind === 'primitive' && primitiveCodecs.has(target)) return;
  if (kind === 'enum' && enums.has(target)) return;
  if (kind === 'object' && schemas.has(target)) return;
  if (kind === 'config-enum') {
    configEnum(config, target);
    return;
  }
  if (kind === 'literal' && target.length > 0) return;
  throw new TypeError('Schema field type target is invalid.');
}

function parseObjectSchemas(value: JsonValue): ReadonlyMap<string, ArtifactObjectSchema> {
  const schemas = new Map<string, ArtifactObjectSchema>();
  for (const raw of requireJsonArray(value)) {
    const object = requireJsonObject(raw);
    const keys = Object.keys(object);
    if (
      keys.length < 2 || keys.length > 4 ||
      keys[0] !== 'schemaId' || keys[1] !== 'fields' ||
      keys.slice(2).some((key) => key !== 'arrayRules' && key !== 'crossFieldRules')
    ) {
      throw new TypeError('Object schema fields are invalid.');
    }
    const schemaId = requireString(object['schemaId']);
    if (schemaId.length === 0 || schemas.has(schemaId)) {
      throw new TypeError('Object schema identity is invalid.');
    }
    const fields = requireJsonArray(object['fields']).map((rawField) => {
      const field = requireJsonArray(rawField);
      if (field.length !== 2) throw new TypeError('Object schema field is invalid.');
      return Object.freeze({
        name: requireString(field[0]),
        type: requireString(field[1]),
      });
    });
    if (new Set(fields.map((field) => field.name)).size !== fields.length) {
      throw new TypeError('Object schema field names are invalid.');
    }
    const crossFieldRules = object['crossFieldRules'] === undefined
      ? Object.freeze([])
      : nonemptyUniqueStrings(object['crossFieldRules']);
    const arrayRules = new Map<string, string>();
    if (object['arrayRules'] !== undefined) {
      const rules = requireJsonObject(object['arrayRules']);
      for (const [field, rule] of Object.entries(rules)) {
        if (!fields.some((candidate) => candidate.name === field)) {
          throw new TypeError('Array rule field is absent from its schema.');
        }
        const text = requireString(rule);
        if (text.length === 0) throw new TypeError('Array rule text is empty.');
        arrayRules.set(field, text);
      }
    }
    schemas.set(schemaId, Object.freeze({
      schemaId,
      fields: Object.freeze(fields),
      crossFieldRules,
      arrayRules,
    }));
  }
  return schemas;
}

export function compileArtifactSchemaProgram(
  source: JsonValue,
  config: JsonObject,
): ArtifactSchemaProgram {
  const root = requireJsonObject(source);
  if (!exactKeys(root, [
    'schemaVersion',
    'experimentId',
    'serializationContract',
    'primitiveCodecs',
    'enums',
    'objectSchemas',
    'recordBindings',
    'hashProjections',
  ])) {
    throw new TypeError('Artifact schema root fields are invalid.');
  }
  if (
    root['schemaVersion'] !== 'routelab.service-fast-numerical-artifact-schema.v1' ||
    root['experimentId'] !== 'm7c-core12-service-fast-numerical-v1'
  ) {
    throw new TypeError('Artifact schema identity is invalid.');
  }
  const primitiveCodecsValue = root['primitiveCodecs'];
  const enumsValue = root['enums'];
  const objectSchemasValue = root['objectSchemas'];
  if (
    primitiveCodecsValue === undefined || enumsValue === undefined ||
    objectSchemasValue === undefined
  ) {
    throw new TypeError('Artifact schema registries are missing.');
  }
  const primitiveObject = requireJsonObject(primitiveCodecsValue);
  const primitiveCodecs = new Set(Object.keys(primitiveObject));
  if (primitiveCodecs.size !== 19 || Object.values(primitiveObject).some((item) =>
    typeof item !== 'string' || item.length === 0)) {
    throw new TypeError('Artifact primitive registry is invalid.');
  }
  const enumObject = requireJsonObject(enumsValue);
  const enums = new Map<string, readonly string[]>();
  for (const [enumId, raw] of Object.entries(enumObject)) {
    enums.set(enumId, nonemptyUniqueStrings(raw));
  }
  if (enums.size !== 29) throw new TypeError('Artifact enum registry is incomplete.');
  const schemas = parseObjectSchemas(objectSchemasValue);
  if (schemas.size !== 58) throw new TypeError('Artifact object schema registry is incomplete.');
  for (const schema of schemas.values()) {
    for (const field of schema.fields) {
      parseType(field.type, primitiveCodecs, enums, schemas, config);
    }
  }
  const recordBindingsValue = root['recordBindings'];
  if (recordBindingsValue === undefined) {
    throw new TypeError('Artifact record bindings are missing.');
  }
  const recordBindings = new Map<string, ArtifactRecordBinding>();
  for (const raw of requireJsonArray(recordBindingsValue)) {
    const binding = requireJsonObject(raw);
    if (!exactKeys(binding, ['path', 'schemaId', 'recordOrder'])) {
      throw new TypeError('Artifact record binding fields are invalid.');
    }
    const path = requireString(binding['path']);
    const schemaId = requireString(binding['schemaId']);
    const recordOrder = requireString(binding['recordOrder']);
    if (
      path.length === 0 || recordOrder.length === 0 ||
      recordBindings.has(path) || !schemas.has(schemaId)
    ) {
      throw new TypeError('Artifact record binding is invalid.');
    }
    recordBindings.set(path, Object.freeze({ path, schemaId, recordOrder }));
  }
  if (recordBindings.size !== 9) {
    throw new TypeError('Artifact record binding registry is incomplete.');
  }
  return Object.freeze({
    source: root,
    config,
    primitiveCodecs,
    enums,
    schemas,
    recordBindings,
  });
}

function validateType(
  program: ArtifactSchemaProgram,
  type: string,
  value: JsonValue,
): void {
  if (type.startsWith('array(') && type.endsWith(')')) {
    const child = type.slice(6, -1);
    for (const member of requireJsonArray(value)) validateType(program, child, member);
    return;
  }
  if (type.startsWith('nullable(') && type.endsWith(')')) {
    if (value === null) return;
    validateType(program, type.slice(9, -1), value);
    return;
  }
  const separator = type.indexOf(':');
  const kind = type.slice(0, separator);
  const target = type.slice(separator + 1);
  if (kind === 'primitive') {
    validatePrimitiveCodec(target, value);
    return;
  }
  if (kind === 'literal') {
    if (value !== target) throw new TypeError('Artifact literal is invalid.');
    return;
  }
  if (kind === 'enum') {
    if (typeof value !== 'string' || !program.enums.get(target)?.includes(value)) {
      throw new TypeError('Artifact enum member is invalid.');
    }
    return;
  }
  if (kind === 'config-enum') {
    if (typeof value !== 'string' || !configEnum(program.config, target).includes(value)) {
      throw new TypeError('Artifact config enum member is invalid.');
    }
    return;
  }
  if (kind === 'object') {
    validateSchemaObject(program, target, value);
    return;
  }
  throw new TypeError('Artifact type is invalid.');
}

export function validateSchemaObject(
  program: ArtifactSchemaProgram,
  schemaId: string,
  value: JsonValue,
): JsonObject {
  const schema = program.schemas.get(schemaId);
  if (schema === undefined) throw new TypeError('Artifact object schema is absent.');
  const object = requireJsonObject(value);
  if (!exactKeys(object, schema.fields.map((field) => field.name))) {
    throw new TypeError('Artifact object fields are invalid.');
  }
  for (const field of schema.fields) {
    const child = object[field.name];
    if (child === undefined) throw new TypeError('Artifact object field is absent.');
    validateType(program, field.type, child);
  }
  return object;
}

export function validateBoundRecord(
  program: ArtifactSchemaProgram,
  bindingPath: string,
  value: JsonValue,
): JsonObject {
  const binding = program.recordBindings.get(bindingPath);
  if (binding === undefined) throw new TypeError('Artifact record binding is absent.');
  return validateSchemaObject(program, binding.schemaId, value);
}
