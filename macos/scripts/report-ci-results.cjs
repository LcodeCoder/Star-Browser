'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../test-results');
const escape = value => String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const cell = value => String(value).replace(/\|/g, '\uFF5C').replace(/[\r\n]/g, ' ');
const reports = [];
function inspect(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) inspect(file);
    else if (entry.isFile() && entry.name.endsWith('.json')) {
      let report;
      try { report = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
      if (!report || typeof report !== 'object' || typeof report.status !== 'string') continue;
      const rows = Array.isArray(report.results) ? report.results : Array.isArray(report.checks) ? report.checks : [];
      const failed = rows.filter(row => row && row.status === 'failed');
      const label = path.relative(root, file).split(path.sep).join('/');
      reports.push({label, status:report.status, passed:rows.filter(row => row?.status === 'passed').length, failed:failed.length});
      for (const row of failed) console.error(`::error title=Test report::${escape(label + ': ' + (row.name || 'Check') + '\n' + (row.error || row.detail || 'failed'))}`);
      if (report.status === 'failed' && !failed.length) console.error(`::error title=Test report::${escape(label + ': ' + (report.error || 'failed'))}`);
    }
  }
}
inspect(root);
reports.sort((a, b) => a.label.localeCompare(b.label));
const summary = ['### Actual test reports', '', '| Report | Status | Passed | Failed |', '| --- | --- | ---: | ---: |', ...reports.map(report => `| ${cell(report.label)} | ${cell(report.status)} | ${report.passed} | ${report.failed} |`), '', 'Counts describe the saved checks only. Partial, unavailable, and skipped results remain separate from passed checks.', ''].join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
