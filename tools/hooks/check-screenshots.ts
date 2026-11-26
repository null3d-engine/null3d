// Pre-commit guard: refuses a commit that leaves the docs screenshots out of step (AGENTS.md, hard
// rule 44). A page that shows a picture needs its entry in docs/images/shots.json, and that entry
// needs the picture at docs/images/<id>.webp. The same check runs in `bun run docs:check`.
import { shotProblems } from '../lib/docs';

/** Every problem with the docs screenshots in the tree at `root`. */
export function screenshotProblems(root: string = process.cwd()): string[] {
	return shotProblems(root);
}

if (import.meta.main) {
	const problems = screenshotProblems();
	if (problems.length) {
		console.error('\ncommit rejected: the docs screenshots are out of step:\n');
		for (const problem of problems) console.error(`  ${problem}`);
		console.error(
			'\nDraw the pictures with bun tools/docs-screenshots.ts, add the entry in docs/images/shots.json,',
		);
		console.error('or take the picture out of the page. Then commit again.\n');
		process.exit(1);
	}
}
