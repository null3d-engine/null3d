// Checks the folder of image test references without a browser: every reference that a manifest
// test needs in some place must exist, every file must be the reference of some test, and no two
// tests of one scene may share one picture, which passes a test whose feature draws nothing. A pull
// request that adds a test without both sets of references fails here, before the browsers run.
// From the repository root:
//   bun tests/check-references.ts
import { IMAGE_RUNS } from './image/manifest.ts';
import { referenceProblemsOnDisk } from './lib/images.ts';

const { files, problems } = referenceProblemsOnDisk(IMAGE_RUNS);
if (problems.length > 0) {
	console.error(
		`The image test references do not match the manifest (.dev/image-tests.md, "Adding a test"):\n${problems.map((problem) => `  ${problem}`).join('\n')}`,
	);
	process.exit(1);
}
console.log(`Every image test has its references: ${files} files.`);
