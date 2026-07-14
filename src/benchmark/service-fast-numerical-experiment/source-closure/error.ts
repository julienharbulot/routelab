export class ServiceFastSourceClosureError extends Error {
  readonly code: string;
  readonly artifact: string;
  readonly toolFailureFamily = 'repository';

  constructor(code: string, artifact: string, message: string) {
    super(message);
    this.code = code;
    this.artifact = artifact;
  }
}

export function sourceClosureFailure(
  code: string,
  artifact: string,
  message: string,
): never {
  throw new ServiceFastSourceClosureError(code, artifact, message);
}
