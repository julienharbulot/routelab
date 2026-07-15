import { createHash } from 'node:crypto';

import type { ArtifactDescriptor, JsonObject, JsonValue } from './types.ts';

export function sha256Bytes(value: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function hashJson(value: JsonValue): string {
  return sha256Bytes(JSON.stringify(value));
}

export function descriptorForBytes(
  path: string,
  bytes: Uint8Array,
): ArtifactDescriptor {
  return Object.freeze({
    path,
    bytes: bytes.byteLength,
    sha256: sha256Bytes(bytes),
  });
}

export function semanticRecordHash(recordWithoutHash: JsonObject): string {
  return hashJson(recordWithoutHash);
}

export function operationalAggregate(
  callEntry: JsonObject,
  timelineEntry: JsonObject,
  deadlineEntry: JsonObject,
): string {
  return hashJson(Object.freeze([callEntry, timelineEntry, deadlineEntry]));
}
