// Generates the docs files that come from a single source, which git does not keep, or checks the
// docs. Run from the repository root:
//   bun tools/gen-docs.ts           write every generated file that changed, then fail on exports
//                                   that the API reference cannot show, and on shader library
//                                   items without doc comments
//   bun tools/gen-docs.ts --check   write every generated file, the skills copy too, then report
//                                   those exports, missing pages, bad front matter, broken links,
//                                   files of the record of tested devices that break its rules,
//                                   and generated files that git keeps
import { readApi } from './lib/api-docs';
import {
	checkDocs,
	generateDocs,
	libraryProblems,
	PAGES,
	referenceProblems,
	writeGeneratedDocs,
} from './lib/docs';
import { gitProblems, isWorkTree, writeGenerated } from './lib/generated';

const root = process.cwd();

if (process.argv.includes('--check')) {
	const generated = writeGenerated(root);
	const problems = [...checkDocs(root), ...(isWorkTree(root) ? gitProblems(root, generated) : [])];
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
