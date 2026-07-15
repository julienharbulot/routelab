const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const CANONICAL_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/)[^\\\0]+$/u;
const REVIEWED_INPUT_BINDING_RECORD =
  '{"status":"reviewed","path":"fixtures/m7c/service-fast-numerical/experiment-inputs.v1.ndjson","bytes":22608083,"sha256":"sha256:a7f79b910dced36e7b65d3e5912763d089f35c071c4880ddacf6e6c67dac66c5"}';
void REVIEWED_INPUT_BINDING_RECORD;

export const SERVICE_FAST_REVIEWED_INPUT_BINDING_PATH =
  'src/benchmark/service-fast-numerical-experiment/source-closure/reviewed-input-binding.ts';

export interface ReviewedInputDescriptor {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export type ReviewedInputBinding =
  | Readonly<{ readonly status: 'pending' }>
  | Readonly<{
    readonly status: 'reviewed';
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
  }>;

export class ServiceFastReviewedInputBindingError extends Error {
  readonly code: string;
  readonly artifact: string;
  readonly toolFailureFamily = 'repository';

  constructor(code: string, artifact: string, message: string) {
    super(message);
    this.code = code;
    this.artifact = artifact;
  }
}

function bindingFailure(code: string, artifact: string, message: string): never {
  throw new ServiceFastReviewedInputBindingError(code, artifact, message);
}

function decodeRecord(record: string, artifact: string): ReviewedInputBinding {
  let value: unknown;
  try {
    value = JSON.parse(record);
  } catch {
    return bindingFailure('invalid-reviewed-input-binding', artifact, 'Reviewed input binding record is not valid JSON.');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return bindingFailure('invalid-reviewed-input-binding', artifact, 'Reviewed input binding record is not an object.');
  }
  const binding = value as Record<string, unknown>;
  if (binding['status'] === 'pending' && Object.keys(binding).join('\0') === 'status') {
    return Object.freeze({ status: 'pending' as const });
  }
  if (
    Object.keys(binding).join('\0') !== 'status\0path\0bytes\0sha256' ||
    binding['status'] !== 'reviewed' ||
    typeof binding['path'] !== 'string' ||
    !CANONICAL_PATH.test(binding['path']) ||
    !Number.isSafeInteger(binding['bytes']) ||
    (binding['bytes'] as number) <= 0 ||
    typeof binding['sha256'] !== 'string' ||
    !SHA256.test(binding['sha256'])
  ) {
    return bindingFailure('invalid-reviewed-input-binding', artifact, 'Reviewed input binding fields are not canonical.');
  }
  return Object.freeze({
    status: 'reviewed' as const,
    path: binding['path'],
    bytes: binding['bytes'] as number,
    sha256: binding['sha256'],
  });
}

export function decodeReviewedInputBindingSource(
  bytes: Uint8Array,
): ReviewedInputBinding {
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return bindingFailure(
      'invalid-reviewed-input-binding',
      SERVICE_FAST_REVIEWED_INPUT_BINDING_PATH,
      'Reviewed input binding source is not canonical UTF-8.',
    );
  }
  const matches = [...source.matchAll(
    /^const REVIEWED_INPUT_BINDING_RECORD =\n {2}'([^'\n]+)';$/gmu,
  )];
  const record = matches[0]?.[1];
  if (matches.length !== 1 || record === undefined) {
    return bindingFailure(
      'invalid-reviewed-input-binding',
      SERVICE_FAST_REVIEWED_INPUT_BINDING_PATH,
      'Reviewed input binding source does not contain one exact record.',
    );
  }
  return decodeRecord(record, SERVICE_FAST_REVIEWED_INPUT_BINDING_PATH);
}

export function requireReviewedInputBinding(
  binding: ReviewedInputBinding,
  descriptor: ReviewedInputDescriptor,
): void {
  if (binding.status !== 'reviewed') {
    bindingFailure('reviewed-input-binding-pending', descriptor.path, 'Source-closure generation requires an independently reviewed input binding.');
  }
  if (
    binding.path !== descriptor.path ||
    binding.bytes !== descriptor.bytes ||
    binding.sha256 !== descriptor.sha256
  ) {
    bindingFailure('reviewed-input-binding-mismatch', descriptor.path, 'Input artifact differs from its reviewed binding.');
  }
}
