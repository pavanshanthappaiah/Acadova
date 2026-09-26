import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const testSuites = [
  { name: 'Phase 1: Foundation & Authentication', file: 'run-tests.js' },
  { name: 'Phase 2: Student Day & Planned vs Actual', file: 'run-phase2-tests.js' },
  { name: 'Phase 3: Academic System & Attendance Engine', file: 'run-phase3-tests.js' },
  { name: 'Phase 4: Technical Growth & DSA Tracker', file: 'run-phase4-tests.js' },
  { name: 'Phase 5: Productivity Radar & Intelligence', file: 'run-phase5-tests.js' },
  { name: 'Phase 6: Polish & Demo Seed Engine', file: 'run-phase6-tests.js' },
  { name: 'Phase 9: Timetable, Attendance & Custom Routine Features', file: 'run-phase9-tests.js' },
  { name: 'Phase 10: Assessment Dates vs Marks → Reminders', file: 'run-phase10-tests.js' },
  { name: 'Phase 11: Per-Assessment Independence (Date vs Marks)', file: 'run-phase11-tests.js' },
  { name: 'Phase 12: LeetCode Near-Real-Time Sync', file: 'run-leetcode-sync-tests.js' },
];

console.log('===========================================================');
console.log('   STUDENTOS MASTER VERIFICATION TEST SUITE (PHASES 1 - 7)  ');
console.log('===========================================================');

let passedCount = 0;

for (const suite of testSuites) {
  console.log(`\n▶ Running Suite: ${suite.name}...`);
  const filePath = path.join(__dirname, suite.file);
  try {
    const output = execSync(`node "${filePath}"`, { stdio: 'pipe' }).toString();
    console.log(output.trim());
    console.log(`✓ ${suite.name} PASSED`);
    passedCount++;
  } catch (err) {
    console.error(`✗ ${suite.name} FAILED!`);
    console.error(err.stdout ? err.stdout.toString() : err.message);
    process.exit(1);
  }
}

console.log('\n===========================================================');
console.log(`✓ ALL ${passedCount} / ${testSuites.length} TEST SUITES PASSED CLEANLY!`);
console.log('===========================================================');
process.exit(0);
