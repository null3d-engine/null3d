// Checks the folder of image test references without a browser: every reference that a manifest
// test needs in some place must exist, and every file must be the reference of some test. A pull
// request that adds a test without both sets of references fails here, before the browsers run.
// From the repository root:
//   bun tests/check-references.ts
import { readdirSync } from 'node:fs';
import { relative } from 'node:path';
import { IMAGE_RUNS } from './image/manifest.ts';
import { HARNESS_DIRS, referenceFileProblems } from './lib/images.ts';

const files = readdirSync(HARNESS_DIRS.references, { recursive: true, withFileTypes: true })
	.filter((entry) => entry.isFile())
	.map((entry) => relative(HARNESS_DIRS.references, `${entry.parentPath}/${entry.name}`));
const problems = referenceFileProblems(IMAGE_RUNS, files);
if (problems.length > 0) {
	console.error(
		`The image test references do not match the manifest (.dev/image-tests.md, "Adding a test"):\n${problems.map((problem) => `  ${problem}`).join('\n')}`,
	);
	process.exit(1);
}
console.log(`Every image test has its references: ${files.length} files.`);
