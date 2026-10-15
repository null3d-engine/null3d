// Checks the engine's code against hard rule 20 without a browser: only the accessor module reads
// a WebAssembly memory's buffer, and only an object that drops its views when the memory grows
// keeps views of it (.dev/implementation-notes.md, "Views of the shared memory").
// From the repository root:
//   bun tools/check-memory-views.ts
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { ACCESSOR_MODULE, memoryViewProblems } from './lib/memory-views.ts';

const root = join(import.meta.dir, '..');
const configPath = join(root, 'packages/engine/tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
const program = ts.createProgram(parsed.fileNames, parsed.options);
const problems = memoryViewProblems(program, join(root, 'packages/engine/src'));
if (problems.length > 0) {
	console.error(
		`Code makes or keeps views of the engine's memory outside ${ACCESSOR_MODULE} (hard rule 20, .dev/implementation-notes.md "Views of the shared memory"):\n${problems
			.map(({ file, line, problem }) => `  ${file.slice(root.length + 1)}:${line}: ${problem}`)
			.join('\n')}`,
	);
	process.exit(1);
}
console.log(`No engine code makes or keeps a view of the memory outside ${ACCESSOR_MODULE}.`);
