import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { verifyEvidenceSource } from '../evidence/source-identity.ts';
import { renderServiceLatencySvg, renderServiceMarkdown } from './load-report.ts';
import { type ServiceLoadReport, validateServiceLoadReport } from './load.ts';

const COMMITTED_FILES = [
  'service-v2-summary.json',
  'service-v2.md',
  'service-latency.svg',
] as const;

export async function verifyCommittedServiceReport(
  root = process.cwd(),
): Promise<readonly string[]> {
  const issues: string[] = [];
  const reports = path.join(root, 'reports');
  let report: ServiceLoadReport;
  let summaryText: string;
  try {
    summaryText = await readFile(path.join(reports, 'service-v2-summary.json'), 'utf8');
    report = JSON.parse(summaryText) as ServiceLoadReport;
  } catch {
    return Object.freeze(['Could not read reports/service-v2-summary.json.']);
  }

  try {
    issues.push(...validateServiceLoadReport(report));
    issues.push(...verifyEvidenceSource(report.evidenceSource, root));
  } catch {
    issues.push('Service report structure could not be validated.');
  }

  for (const file of COMMITTED_FILES) {
    try {
      if ((await stat(path.join(reports, file))).size >= 250 * 1_024) {
        issues.push(`${file}: committed result is not below 250 KiB.`);
      }
    } catch {
      issues.push(`${file}: committed result is missing.`);
    }
  }

  try {
    const markdown = await readFile(path.join(reports, 'service-v2.md'), 'utf8');
    const svg = await readFile(path.join(reports, 'service-latency.svg'), 'utf8');
    if (summaryText !== `${JSON.stringify(report, null, 2)}\n`) {
      issues.push('Service summary JSON is not in canonical presentation form.');
    }
    if (markdown !== renderServiceMarkdown(report)) {
      issues.push('Service Markdown rendering changed.');
    }
    if (svg !== renderServiceLatencySvg(report)) {
      issues.push('Service latency SVG rendering changed.');
    }
  } catch {
    issues.push('Could not compare deterministic service report renderings.');
  }

  try {
    const trackedRaw = execFileSync('git', ['ls-files', 'reports/raw', 'reports/tmp'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    if (trackedRaw.length !== 0) issues.push('Raw service observations are tracked.');
  } catch {
    issues.push('Could not inspect tracked raw service observations.');
  }
  return Object.freeze(issues);
}
