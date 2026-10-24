// Checks that add-ons and the examples reach the engine only through its public entry points, and
// that no package imports an example add-on (D-173, AGENTS.md "Parity with three.js and add-on
// modules", rules 5 and 12). From the repository root:
//   bun tools/check-addon-imports.ts
import { join } from 'node:path';
import { addonImportProblems } from './lib/addon-imports.ts';

const { problems, files } = addonImportProblems(join(import.meta.dir, '..'));
if (problems.length > 0) {
	console.error(
		`Add-ons and examples reach the engine only through its public entry points, and no package imports an example add-on (D-173, AGENTS.md "Parity with three.js and add-on modules", rules 5 and 12):\n${problems
			.map((problem) => `  ${problem}`)
			.join('\n')}`,
	);
	process.exit(1);
}
console.log(
	`Every add-on and example imports only the engine's public entry points, and no package imports an example: ${files} files.`,
);
