import { verifyPortfolioBenchmark } from '../src/benchmark/portfolio/verify.ts';

const issues = await verifyPortfolioBenchmark();
if (issues.length !== 0) {
  for (const issue of issues) process.stderr.write(`benchmark verification: ${issue}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('portfolio-v2 benchmark verification passed\n');
}
