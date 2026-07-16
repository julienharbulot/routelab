import { runDeadlineSweep } from '../src/service/load.ts';

const rows = await runDeadlineSweep();
for (const row of rows) {
  process.stdout.write(
    `deadline=${row.deadlineMs}ms requests=${row.requests} ` +
    `complete=${row.classifications['complete-exact-quote']} ` +
    `incumbent=${row.classifications['validated-deadline-incumbent']} ` +
    `beforePlan=${row.classifications['deadline-before-plan']} ` +
    `overload=${row.classifications.overload} timeout=${row.classifications['client-timeout']} ` +
    `failure=${row.classifications['schema-or-internal-failure']}\n`,
  );
}
process.stdout.write('deadline sweep passed; raw observations are ignored\n');
