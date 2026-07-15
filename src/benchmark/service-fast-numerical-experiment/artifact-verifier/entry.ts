import {
  encodeServiceFastVerifierToolFailure,
  integrityFailureCode,
} from './failure.ts';
import {
  encodeIntegrityFailureResult,
  encodeVerificationSuccess,
} from './result.ts';
import { verifyServiceFastArtifacts } from './verify.ts';

async function main(): Promise<void> {
  try {
    const result = await verifyServiceFastArtifacts(process.cwd());
    process.stdout.write(encodeVerificationSuccess(result));
  } catch (error) {
    process.exitCode = 1;
    const code = integrityFailureCode(error);
    if (code !== undefined) {
      process.stdout.write(encodeIntegrityFailureResult(code));
      return;
    }
    process.stderr.write(encodeServiceFastVerifierToolFailure(error));
  }
}

await main();
