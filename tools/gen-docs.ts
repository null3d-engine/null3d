// Generates the docs files that come from a single source, or checks that the committed ones are
// current. Run from the repository root:
//   bun tools/gen-docs.ts           write every generated file that changed, then fail on exports
//                                   that the API reference cannot show, and on shader library
//                                   items without doc comments
//   bun tools/gen-docs.ts --check   report those exports, stale files, missing pages, bad front
//                                   matter and broken links
import { readApi } from './lib/api-docs';
import {
	checkDocs,
	generateDocs,
	libraryProblems,
	PAGES,
	referenceProblems,
	writeGeneratedDocs,
} from './lib/docs';

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

const api = readApi(root);
const written = writeGeneratedDocs(root, generateDocs(root, api));
for (const path of written) console.log(`wrote ${path}`);
console.log(`docs generated: ${written.length} file(s) changed`);
const problems = [...referenceProblems(api), ...libraryProblems(root)];
for (const p of problems) console.log(`error: ${p}`);
if (problems.length) process.exit(1);
