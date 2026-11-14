// Installs the pinned Chrome for Testing into the cache folder that every copy of the repository and
// every project on this computer shares, where the repository's tests, benchmarks and tools start it
// on the real GPU. It does nothing when that build is already there. The command-line tool installs
// the same build on first use; the repository's own runs never do, and stop with this command.
// The install checks the archive's SHA-256 hash before it unpacks it, and replaces a copy whose
// install did not.
//
// Usage, from the repository root: bun run chrome:install
import {
	CHROME_FOR_TESTING_VERSION,
	chromeForTestingInstalled,
	installChromeForTesting,
} from '../packages/cli/src/browser.js';

const already = chromeForTestingInstalled();
const executable = await installChromeForTesting();
console.log(
	already
		? `Chrome for Testing ${CHROME_FOR_TESTING_VERSION} is already installed at ${executable}.`
		: `Installed Chrome for Testing ${CHROME_FOR_TESTING_VERSION}.`,
);
