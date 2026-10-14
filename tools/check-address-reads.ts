// Checks the engine's code against hard rule 31 without a browser: every address read from a signed
// 32-bit array is converted with `>>> 0` before it is used (.dev/implementation-notes.md,
// "Addresses above 2 GiB"). From the repository root:
//   bun tools/check-address-reads.ts
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { addressReadProblems } from './lib/address-reads.ts';

const root = join(import.meta.dir, '..');
const configPath = join(root, 'packages/engine/tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
const program = ts.createProgram(parsed.fileNames, parsed.options);
const problems = addressReadProblems(program, join(root, 'packages/engine/src'));
if (problems.length > 0) {
	console.error(
		`Code reads an address from a signed array without >>> 0 (hard rule 31, .dev/implementation-notes.md "Addresses above 2 GiB"):\n${problems
			.map(({ file, line, problem }) => `  ${file.slice(root.length + 1)}:${line}: ${problem}`)
			.join('\n')}`,
	);
	process.exit(1);
}
console.log('Every address read from a signed array is converted with >>> 0.');
