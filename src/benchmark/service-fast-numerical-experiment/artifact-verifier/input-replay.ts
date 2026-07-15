import {
  loadVerifiedExperimentInputSource,
  protectedExperimentInputOperations,
  streamExperimentInputRecords,
  type ExperimentInputOperations,
  type ExperimentInputSource,
} from '../input/build.ts';
import {
  SERVICE_FAST_INPUT_RECORD_COUNT,
  SERVICE_FAST_INPUT_PATH,
} from './contract.ts';
import { integrityFailure, isIntegrityFailure } from './failure.ts';
import { readBoundedRegularFile } from './io/bounded-file.ts';
import { parseCanonicalNdjsonLine } from './json/strict-json.ts';
import {
  requireBoolean,
  requireJsonArray,
  requireJsonObject,
  requireSafeNonnegativeInteger,
  requireString,
  type ArtifactDescriptor,
  type DecodedExperimentInput,
  type JsonObject,
} from './types.ts';

const INPUT_CAP_BYTES = 64 * 1024 * 1024;

export interface ReplayedExperimentInputs {
  readonly source: ExperimentInputSource;
  readonly operations: ExperimentInputOperations;
  readonly records: readonly DecodedExperimentInput[];
  readonly bytes: Uint8Array;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function decodeInputRecord(value: JsonObject): DecodedExperimentInput {
  const request = requireJsonObject(value['request']);
  requireString(request['assetIn']);
  requireString(request['assetOut']);
  requireString(request['amountIn']);
  const discovery = requireJsonObject(value['candidateDiscovery']);
  for (const rawSet of requireJsonArray(discovery['candidateSets'])) {
    const set = requireJsonObject(rawSet);
    if (requireJsonArray(set['routes']).length !== 2) {
      throw new TypeError('Builder-bound candidate sets require two routes.');
    }
  }
  return Object.freeze({
    value,
    sourceIndex: requireSafeNonnegativeInteger(value['sourceIndex']),
    caseId: requireString(value['caseId']),
    requestId: requireString(value['requestId']),
    timingCohortIndex: value['timingCohortIndex'] === null
      ? null
      : requireSafeNonnegativeInteger(value['timingCohortIndex']),
    serviceDecisionMember: requireBoolean(value['serviceDecisionMember']),
    amplifiedStressMember: requireBoolean(value['amplifiedStressMember']),
  });
}

export function decodeCanonicalServiceFastInputBytes(
  bytes: Uint8Array,
): readonly DecodedExperimentInput[] {
  const records: DecodedExperimentInput[] = [];
  let start = 0;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (bytes[index] !== 0x0a) continue;
    const value = requireJsonObject(parseCanonicalNdjsonLine(bytes.slice(start, index + 1)));
    const decoded = decodeInputRecord(value);
    if (decoded.sourceIndex !== records.length) {
      throw new TypeError('Input sourceIndex order is invalid.');
    }
    records.push(decoded);
    start = index + 1;
  }
  if (
    start !== bytes.byteLength ||
    records.length !== SERVICE_FAST_INPUT_RECORD_COUNT
  ) {
    throw new TypeError('Input NDJSON record count is invalid.');
  }
  return Object.freeze(records);
}

async function loadSource(
  repositoryRoot: string,
): Promise<ExperimentInputSource> {
  return loadVerifiedExperimentInputSource(Object.freeze({
    readFile: (relativePath: string) =>
      readBoundedRegularFile(repositoryRoot, relativePath, INPUT_CAP_BYTES),
  }));
}

export async function replayAndAdmitExperimentInputs(
  repositoryRoot: string,
  publicDescriptor: ArtifactDescriptor,
  retainedDescriptor: ArtifactDescriptor,
): Promise<ReplayedExperimentInputs> {
  try {
    if (
      publicDescriptor.path !== SERVICE_FAST_INPUT_PATH ||
      publicDescriptor.bytes !== retainedDescriptor.bytes ||
      publicDescriptor.sha256 !== retainedDescriptor.sha256
    ) {
      return integrityFailure('input-hash-mismatch');
    }
    const [publicBytes, retainedBytes, source] = await Promise.all([
      readBoundedRegularFile(
        repositoryRoot,
        publicDescriptor.path,
        INPUT_CAP_BYTES,
        publicDescriptor,
      ),
      readBoundedRegularFile(
        repositoryRoot,
        retainedDescriptor.path,
        INPUT_CAP_BYTES,
        retainedDescriptor,
      ),
      loadSource(repositoryRoot),
    ]);
    if (!bytesEqual(publicBytes, retainedBytes)) {
      return integrityFailure('input-hash-mismatch');
    }

    const operations = protectedExperimentInputOperations();
    const regeneratedChunks: Uint8Array[] = [];
    let regeneratedBytes = 0;
    const summary = await streamExperimentInputRecords(
      source,
      operations,
      Object.freeze({
        write: (chunk: Uint8Array) => {
          regeneratedBytes += chunk.byteLength;
          if (regeneratedBytes > INPUT_CAP_BYTES) {
            return integrityFailure('artifact-cap-failure');
          }
          regeneratedChunks.push(Uint8Array.from(chunk));
          return Promise.resolve();
        },
      }),
    );
    if (
      summary.bytes !== publicDescriptor.bytes ||
      summary.sha256 !== publicDescriptor.sha256
    ) {
      return integrityFailure('baseline-mismatch');
    }
    const regenerated = new Uint8Array(regeneratedBytes);
    let offset = 0;
    for (const chunk of regeneratedChunks) {
      regenerated.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (!bytesEqual(regenerated, publicBytes)) {
      return integrityFailure('baseline-mismatch');
    }
    return Object.freeze({
      source,
      operations,
      records: decodeCanonicalServiceFastInputBytes(publicBytes),
      bytes: publicBytes,
    });
  } catch (error) {
    if (isIntegrityFailure(error)) throw error;
    return integrityFailure('baseline-mismatch');
  }
}
