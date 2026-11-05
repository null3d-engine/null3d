// The browser that the repository starts for itself on the real GPU: always the pinned Chrome for
// Testing, never the installed Google Chrome, which leaves keys in the macOS keychain as it starts.
// Unlike the command-line tool, the repository's runs neither download it nor fall back to the
// installed Chrome: a run without it stops and names the install command. Every test, benchmark and
// tool of the repository launches through this module, and a unit test refuses any other way of
// starting Chrome on the real GPU (`chrome-launches.test.ts`). Importing it sets
// `NULL3D_CHROME=testing` for this process and every process it starts, so the command-line tool's
// runs inside the repository's tests take the same build, with no fallback.
import {
	browserOptions,
	CHROME_FOR_TESTING_VERSION,
	chromeForTestingInstalled,
	chromeForTestingPath,
	launchBrowser,
} from '../../packages/cli/src/browser.js';

/** The places that draw frames, as the browser launcher names them. */
type Environment = Parameters<typeof browserOptions>[0];

process.env.NULL3D_CHROME = 'testing';

/** The repository's command that installs the pinned Chrome for Testing. */
export const CHROME_INSTALL_COMMAND = 'bun run chrome:install';

/**
 * The pinned Chrome for Testing's launch options, once its executable is known to be installed from
 * an archive whose hash the install checked.
 */
export function chromeForTesting(): { executablePath: string } {
	const executablePath = chromeForTestingPath();
	if (!chromeForTestingInstalled())
		throw new Error(
			`Chrome for Testing ${CHROME_FOR_TESTING_VERSION} is not installed at ${executablePath}, or its install did not check its hash. Install it with ${CHROME_INSTALL_COMMAND}.`,
		);
	return { executablePath };
}

/** How Playwright starts an environment's browser in the repository's own runs. */
export function repoBrowserOptions(environment: Environment): ReturnType<typeof browserOptions> {
	if (environment === 'chrome-real-gpu') chromeForTesting();
	return browserOptions(environment, 'testing');
}

/** Starts an environment's browser, headless, for the repository's own runs. */
export function launchRepoBrowser(
	environment: Environment,
	args: readonly string[] = [],
): ReturnType<typeof launchBrowser> {
	if (environment === 'chrome-real-gpu') chromeForTesting();
	return launchBrowser(environment, args, 'testing', false);
}
