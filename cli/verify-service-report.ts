import { verifyCommittedServiceReport } from '../src/service/verify.ts';

const issues = await verifyCommittedServiceReport();
if (issues.length !== 0) {
  for (const issue of issues) process.stderr.write(`service verification: ${issue}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('service-v2 report verification passed\n');
}
