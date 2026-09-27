// Generates the docs files that come from a single source, or checks that the committed ones are
// current. Run from the repository root:
//   bun tools/gen-docs.ts           write every generated file that changed
//   bun tools/gen-docs.ts --check   report stale files, missing pages, bad front matter and broken links
import { checkDocs, PAGES, writeGeneratedDocs } from './lib/docs';

const root = process.cwd();

if (process.argv.includes('--check')) {
	const problems = checkDocs(root);
	for (const p of problems) console.log(`error: ${p}`);
	console.log(
		problems.length
			? `FAILED with ${problems.length} problem(s)`
			: `docs OK (${PAGES.length} inventory pages)`,
	);
	process.exit(problems.length ? 1 : 0);
}

const written = writeGeneratedDocs(root);
for (const path of written) console.log(`wrote ${path}`);
console.log(`docs generated: ${written.length} file(s) changed`);
