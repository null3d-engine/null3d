// Checks and syncs the agent skills. Run from the repository root:
//   bun tools/skills.ts check   validate every skill; exit code 1 on any problem
//   bun tools/skills.ts sync    rewrite .claude/skills from skills/, which git does not keep
import { checkSkills, syncSkills } from './lib/skills';

const root = process.cwd();
const command = process.argv[2];

if (command === 'check') {
	const report = checkSkills(root);
	console.log(`skills: ${report.skills}; docs pages referenced: ${report.docPagesReferenced}`);
	for (const p of report.problems) console.log(`error: ${p}`);
	console.log(report.problems.length ? `FAILED with ${report.problems.length} problem(s)` : 'OK');
	process.exit(report.problems.length ? 1 : 0);
} else if (command === 'sync') {
	const changed = syncSkills(root);
	for (const path of changed) console.log(`synced ${path}`);
	console.log(`skills synced: ${changed.length} file(s) changed`);
} else {
	console.error('usage: bun tools/skills.ts check | sync');
	process.exit(2);
}
