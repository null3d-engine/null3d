// Every browser that the repository starts for itself on the real GPU is the pinned Chrome for
// Testing, through `chrome-for-testing.ts`. The installed Google Chrome leaves keys in the macOS
// keychain as it starts, and Playwright's own Chromium is another Chrome version than the one the
// real-GPU references and cost limits come from. This check reads the repository's own code, which
// the command-line tool's package is not part of, and refuses every other way to start Chrome there.
import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The repository's root folder. */
const REPO_ROOT = join(import.meta.dir, '../..');

/** This check's own file, whose examples name the channels that it refuses. */
const THIS_FILE = 'tests/lib/chrome-launches.test.ts';

/** The one module that may call the launcher's own real-GPU entry points. */
const LAUNCH_MODULE = 'tests/lib/chrome-for-testing.ts';

/** The folders of the repository's own code: its tests, benchmarks, tools and examples. */
const OWN_CODE = ['bench', 'tests', 'tools', 'examples'];

/** A Playwright channel of an installed Chrome, or of Playwright's own Chromium. */
const CHROME_CHANNEL = /\bchannel\s*:\s*['"`](chrome(?:-beta|-dev|-canary)?|chromium)['"`]/;

/** An import from the command-line tool's browser launcher, with the names that it imports. */
const LAUNCHER_IMPORT =
	/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"][./]*packages\/cli\/src\/browser\.js['"]/g;

/** The launcher's entry points whose real-GPU build depends on the environment variable. */
const BUILD_DEPENDENT = new Set(['browserOptions', 'launchBrowser']);

/** The repository's own source files, tracked or new, that still exist in this checkout. */
function ownSources(): string[] {
	const listed = execFileSync(
		'git',
		['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...OWN_CODE],
		{ cwd: REPO_ROOT, encoding: 'utf8' },
	);
	return listed
		.split('\0')
		.filter(
			(file) =>
				file !== THIS_FILE && /\.(?:ts|js|mjs)$/.test(file) && existsSync(join(REPO_ROOT, file)),
		);
}

/** The problems of one file: each line that starts Chrome some other way. */
function chromeLaunchProblems(file: string, text: string): string[] {
	const problems: string[] = [];
	text.split('\n').forEach((line, index) => {
		const channel = CHROME_CHANNEL.exec(line);
		if (channel)
			problems.push(
				`${file}:${index + 1} starts Chrome by the channel '${channel[1]}'; use chromeForTesting() from ${LAUNCH_MODULE}`,
			);
	});
	if (file === LAUNCH_MODULE) return problems;
	for (const match of text.matchAll(LAUNCHER_IMPORT)) {
		const names = (match[1] ?? '').split(',').map((name) => name.trim().split(/\s+as\s+/)[0]);
		for (const name of names)
			if (name && BUILD_DEPENDENT.has(name))
				problems.push(
					`${file} imports ${name} from the command-line tool's launcher; use ${name === 'launchBrowser' ? 'launchRepoBrowser' : 'repoBrowserOptions'} from ${LAUNCH_MODULE}`,
				);
	}
	return problems;
}

describe('chromeLaunchProblems', () => {
	it("refuses the installed Chrome's channels and Playwright's Chromium", () => {
		expect(
			chromeLaunchProblems('bench/a.ts', "launchChromium({ channel: 'chrome' });"),
		).toHaveLength(1);
		expect(
			chromeLaunchProblems('bench/a.ts', 'launchInWindow({ channel: "chrome-beta" });'),
		).toHaveLength(1);
		expect(chromeLaunchProblems('tests/a.ts', "const o = { channel: 'chromium' };")).toHaveLength(
			1,
		);
		expect(
			chromeLaunchProblems('bench/a.ts', 'launchInWindow({ ...chromeForTesting() });'),
		).toEqual([]);
	});

	it("refuses the launcher's real-GPU entry points outside the one module", () => {
		const text =
			"import { defaultEnvironment, launchBrowser } from '../packages/cli/src/browser.js';";
		expect(chromeLaunchProblems('tools/a.ts', text)).toEqual([
			"tools/a.ts imports launchBrowser from the command-line tool's launcher; use launchRepoBrowser from tests/lib/chrome-for-testing.ts",
		]);
		expect(chromeLaunchProblems(LAUNCH_MODULE, text)).toEqual([]);
		expect(
			chromeLaunchProblems(
				'tools/a.ts',
				"import { GPU_TIMING_ARGS } from '../packages/cli/src/browser.js';",
			),
		).toEqual([]);
	});
});

describe("the repository's own code", () => {
	it('starts Chrome on the real GPU only as the pinned Chrome for Testing', () => {
		const problems = ownSources().flatMap((file) =>
			chromeLaunchProblems(file, readFileSync(join(REPO_ROOT, file), 'utf8')),
		);
		expect(problems).toEqual([]);
	});
});
