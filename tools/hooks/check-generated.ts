// Pre-commit guard: writes every generated file (tools/lib/generated.ts), which git does not keep,
// and refuses the commit when a generator reports a problem: a public export without the doc
// comments that the API reference needs, a shader library item without doc comments, or a file of
// the record of tested devices that breaks its rules. It also refuses a generated file that git
// would keep. Git does not keep the shader modules; the type check that runs before this guard
// builds them, and fails when a shader does not build.
import { gitProblems, writeGenerated } from '../lib/generated';

const root = process.cwd();
const generated = writeGenerated(root);
const problems = [...generated.problems, ...gitProblems(root, [...generated.files.keys()])];
if (problems.length) {
	console.error('\ncommit rejected: a generator reports problems:\n');
	for (const p of problems) console.error(`  ${p}`);
	console.error('\nAdd any missing doc comments, or follow the steps above, then commit again.\n');
	process.exit(1);
}
