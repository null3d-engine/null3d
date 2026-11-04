// Installs the pinned Chrome for Testing into the cache folder that every copy of the repository and
// every project on this computer shares, where the repository's tests, benchmarks and tools start it
// on the real GPU. It does nothing when that build is already there. The command-line tool installs
// the same build on first use; the repository's own runs never do, and stop with this command.
//
// Usage, from the repository root: bun run chrome:install
import { existsSync } from 'node:fs';
import {
	CHROME_FOR_TESTING_VERSION,
	chromeForTestingPath,
	installChromeForTesting,
} from '../packages/cli/src/browser.js';

const already = existsSync(chromeForTestingPath());
const executable = await installChromeForTesting();
console.log(
	already
		? `Chrome for Testing ${CHROME_FOR_TESTING_VERSION} is already installed at ${executable}.`
		: `Installed Chrome for Testing ${CHROME_FOR_TESTING_VERSION}.`,
);
