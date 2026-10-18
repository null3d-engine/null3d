import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');

/** The folders whose scripts run in Bun, as the repository's commands start them. */
const BUN_FOLDERS = ['bench', 'tests', 'tools', 'examples'];

/** A browser that Playwright starts without the guard against an ended browser process. */
const OWN_LAUNCH = /\b(?:chromium|firefox|webkit)\.launch(?:Server|PersistentContext)?\(/;

/**
 * The scripts that Bun runs under `folder`: TypeScript outside the dependencies, apart from
 * Playwright's own test files, which its test runner runs in Node.
 */
function bunScripts(folder: string): string[] {
	return readdirSync(join(ROOT, folder), { withFileTypes: true }).flatMap((entry) => {
		const path = join(folder, entry.name);
		if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : bunScripts(path);
		return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
	});
}

describe('browser launches in Bun', () => {
	it('go through launchChromium, which guards them, never straight through Playwright', () => {
		const scripts = BUN_FOLDERS.flatMap(bunScripts);
		expect(scripts.length).toBeGreaterThan(50);
		const own = scripts.filter((file) =>
			readFileSync(join(ROOT, file), 'utf8')
				.split('\n')
				.some((line) => !line.trimStart().startsWith('//') && OWN_LAUNCH.test(line)),
		);
		expect(own).toEqual([]);
	});
});
