// Writes the generated files, which git does not keep (tools/lib/generated.ts), or checks the docs.
// Run from the repository root:
//   bun tools/gen-docs.ts           write every generated file that changed, the skills copy too,
//                                   then fail on exports that the API reference cannot show, shader
//                                   library items without doc comments, and files of the record of
//                                   tested devices that break its rules
//   bun tools/gen-docs.ts --check   write them, then report those problems, missing pages, bad
//                                   front matter, broken links, and generated files that git keeps
import { checkDocs, PAGES } from './lib/docs';
import { gitProblems, isWorkTree, writeGenerated } from './lib/generated';

const root = process.cwd();
const generated = writeGenerated(root);

if (process.argv.includes('--check')) {
	const problems = [
		...checkDocs(root),
		...(isWorkTree(root) ? gitProblems(root, [...generated.files.keys()]) : []),
	];
	for (const p of problems) console.log(`error: ${p}`);
	console.log(
		problems.length
			? `FAILED with ${problems.length} problem(s)`
			: `docs OK (${PAGES.length} inventory pages)`,
	);
	process.exit(problems.length ? 1 : 0);
}

for (const path of generated.written) console.log(`wrote ${path}`);
console.log(`docs generated: ${generated.written.length} file(s) changed`);
for (const p of generated.problems) console.log(`error: ${p}`);
if (generated.problems.length) process.exit(1);
