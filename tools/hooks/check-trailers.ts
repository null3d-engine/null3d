// Checks the acknowledgement trailers on every commit in a range, so a commit made with
// --no-verify cannot skip them. CI runs it on pull requests:
//   bun tools/hooks/check-trailers.ts origin/main..HEAD
import { execFileSync } from 'node:child_process';
import { DOCS_ACK_RULE } from './check-docs-ack';
import { SKILLS_ACK_RULE } from './check-skills-ack';
import { checkAck } from './commit-ack';

const RULES = [DOCS_ACK_RULE, SKILLS_ACK_RULE];

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' });

function main(): void {
	const range = process.argv[2];
	if (!range) {
		console.error('usage: bun tools/hooks/check-trailers.ts <base>..<head>');
		process.exit(2);
	}
	const failures: string[] = [];
	for (const sha of git('rev-list', '--no-merges', range).split('\n').filter(Boolean)) {
		const message = git('log', '-1', '--format=%B', sha);
		const files = git('diff-tree', '--no-commit-id', '--name-only', '-r', sha)
			.split('\n')
			.filter(Boolean);
		for (const rule of RULES) {
			const result = checkAck(message, files, rule);
			if (!result.ok)
				failures.push(`${sha.slice(0, 8)} ${message.split('\n')[0]}: ${result.error}`);
		}
	}
	if (failures.length === 0) {
		console.log(`trailers OK in ${range}`);
		return;
	}
	for (const f of failures) console.error(f);
	console.error(
		'\nAmend or reword these commits to add the missing trailers (AGENTS.md, "Commit gates").',
	);
	process.exit(1);
}

if (import.meta.main) main();
