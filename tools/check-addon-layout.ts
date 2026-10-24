// Checks that every example add-on under `examples/addons/` keeps the shape that the shared README
// gives (D-173 ruling 5, M3-D5). From the repository root:
//   bun tools/check-addon-layout.ts
import { join } from 'node:path';
import { addonLayoutProblems } from './lib/addon-layout.ts';

const { problems, folders } = addonLayoutProblems(join(import.meta.dir, '..'));
if (problems.length > 0) {
	console.error(
		`Every example add-on follows the shape in examples/addons/README.md (D-173 ruling 5):\n${problems
			.map((problem) => `  ${problem}`)
			.join('\n')}`,
	);
	process.exit(1);
}
console.log(`Every example add-on follows the layout: ${folders.length} folders.`);
