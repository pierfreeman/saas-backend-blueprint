#!/usr/bin/env node
/**
 * Parses lcov.info files from the coverage directory and outputs a Markdown
 * summary table. Used by CI to populate GitHub Job Summary and PR comments.
 *
 * Usage: node scripts/coverage-summary.mjs [coverage-dir]
 *   Default coverage-dir: ./coverage
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const coverageDir = process.argv[2] || 'coverage';

function findLcovFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findLcovFiles(full));
    else if (entry.name === 'lcov.info') results.push(full);
  }
  return results;
}

function parseLcov(content) {
  const totals = { linesFound: 0, linesHit: 0, branchesFound: 0, branchesHit: 0, funcsFound: 0, funcsHit: 0 };
  for (const line of content.split('\n')) {
    if (line.startsWith('LF:')) totals.linesFound += +line.slice(3);
    else if (line.startsWith('LH:')) totals.linesHit += +line.slice(3);
    else if (line.startsWith('BRF:')) totals.branchesFound += +line.slice(4);
    else if (line.startsWith('BRH:')) totals.branchesHit += +line.slice(4);
    else if (line.startsWith('FNF:')) totals.funcsFound += +line.slice(4);
    else if (line.startsWith('FNH:')) totals.funcsHit += +line.slice(4);
  }
  return totals;
}

function pct(hit, found) {
  if (found === 0) return '—';
  const v = (hit / found) * 100;
  return v.toFixed(1) + '%';
}

function badge(hit, found) {
  if (found === 0) return '⚪';
  const v = (hit / found) * 100;
  if (v >= 80) return '🟢';
  if (v >= 60) return '🟡';
  return '🔴';
}

const files = findLcovFiles(coverageDir);
if (files.length === 0) {
  console.log('> No coverage data found.');
  process.exit(0);
}

const projects = [];
const grand = { linesFound: 0, linesHit: 0, branchesFound: 0, branchesHit: 0, funcsFound: 0, funcsHit: 0 };

for (const f of files) {
  const content = readFileSync(f, 'utf8');
  const t = parseLcov(content);
  // Derive project name from directory path
  const rel = relative(coverageDir, f).replace('/lcov.info', '');
  projects.push({ name: rel, ...t });
  grand.linesFound += t.linesFound;
  grand.linesHit += t.linesHit;
  grand.branchesFound += t.branchesFound;
  grand.branchesHit += t.branchesHit;
  grand.funcsFound += t.funcsFound;
  grand.funcsHit += t.funcsHit;
}

projects.sort((a, b) => a.name.localeCompare(b.name));

const lines = [];
lines.push('## 📊 Coverage Report');
lines.push('');
lines.push(`| | Project | Lines | Branches | Functions |`);
lines.push(`|---|---|---|---|---|`);

for (const p of projects) {
  const b = badge(p.linesHit, p.linesFound);
  lines.push(`| ${b} | ${p.name} | ${pct(p.linesHit, p.linesFound)} | ${pct(p.branchesHit, p.branchesFound)} | ${pct(p.funcsHit, p.funcsFound)} |`);
}

lines.push(`| **${badge(grand.linesHit, grand.linesFound)}** | **Total** | **${pct(grand.linesHit, grand.linesFound)}** | **${pct(grand.branchesHit, grand.branchesFound)}** | **${pct(grand.funcsHit, grand.funcsFound)}** |`);
lines.push('');
lines.push(`> ${files.length} projects · ${grand.linesFound} lines tracked`);

console.log(lines.join('\n'));
