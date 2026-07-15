import { scanBoundedRegularFile } from './bounded-file.ts';
import { parseCanonicalNdjsonLine } from '../json/strict-json.ts';
import type { ArtifactDescriptor, JsonValue } from '../types.ts';

export interface NdjsonRecord {
  readonly index: number;
  readonly bytes: Uint8Array;
  readonly value: JsonValue;
}

export type NdjsonRecordVisitor = (
  record: NdjsonRecord,
) => void | Promise<void>;

export async function scanCanonicalNdjson(
  repositoryRoot: string,
  descriptor: ArtifactDescriptor,
  maximumBytes: number,
  expectedRecordCount: number,
  maximumRecordBytes: number,
  visitor: NdjsonRecordVisitor,
): Promise<void> {
  if (
    !Number.isSafeInteger(expectedRecordCount) ||
    expectedRecordCount <= 0 ||
    !Number.isSafeInteger(maximumRecordBytes) ||
    maximumRecordBytes <= 1
  ) {
    throw new TypeError('NDJSON bounds are invalid.');
  }
  let pending = new Uint8Array(0);
  let recordIndex = 0;
  await scanBoundedRegularFile(
    repositoryRoot,
    descriptor.path,
    maximumBytes,
    async (chunk) => {
      const combined = new Uint8Array(pending.byteLength + chunk.byteLength);
      combined.set(pending);
      combined.set(chunk, pending.byteLength);
      let start = 0;
      for (let index = 0; index < combined.byteLength; index += 1) {
        if (combined[index] !== 0x0a) continue;
        const lineLength = index - start + 1;
        if (lineLength > maximumRecordBytes) {
          throw new TypeError('NDJSON record exceeds its bound.');
        }
        const bytes = combined.slice(start, index + 1);
        await visitor(Object.freeze({
          index: recordIndex,
          bytes,
          value: parseCanonicalNdjsonLine(bytes),
        }));
        recordIndex += 1;
        start = index + 1;
      }
      pending = combined.slice(start);
      if (pending.byteLength >= maximumRecordBytes) {
        throw new TypeError('NDJSON record exceeds its bound.');
      }
    },
    descriptor,
  );
  if (pending.byteLength !== 0 || recordIndex !== expectedRecordCount) {
    throw new TypeError('NDJSON record count or terminator is invalid.');
  }
}
