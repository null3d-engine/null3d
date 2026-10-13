import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');

/** The Bun version that package.json names, which every workflow and checkout must run. */
const PINNED = /bun@([\d.]+)/.exec(
	JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).packageManager as string,
)?.[1];

/** Whether version `a` comes before version `b`, part by part. */
function before(a: string, b: string): boolean {
	const [x, y] = [a, b].map((version) => version.split('.').map(Number));
	for (let i = 0; i < Math.max(x?.length ?? 0, y?.length ?? 0); i++) {
		const d = (x?.[i] ?? 0) - (y?.[i] ?? 0);
		if (d !== 0) return d < 0;
	}
	return false;
}

// Bun before 1.4.3 closes Playwright's pipe to Chrome at random. Chrome then ends, Playwright never
// notices, and every later call waits forever, so every Bun script that drives a browser can hang.
describe('the Bun version', () => {
	it('is the same in every workflow as in package.json', () => {
		expect(PINNED).toBeDefined();
		const folder = join(ROOT, '.github/workflows');
		const pins = readdirSync(folder).flatMap((file) =>
			[...readFileSync(join(folder, file), 'utf8').matchAll(/BUN_VERSION:\s*"([^"]+)"/g)].map(
				([, version]) => `${file}: ${version}`,
			),
		);
		expect(pins.length).toBeGreaterThan(0);
		expect(pins.filter((pin) => !pin.endsWith(`: ${PINNED}`))).toEqual([]);
	});

	it('is the minimum that the README and the install guide name', () => {
		for (const file of ['README.md', 'docs/getting-started/install.md']) {
			const text = readFileSync(join(ROOT, file), 'utf8');
			expect(text, `${file} names Bun ${PINNED} or newer`).toMatch(
				new RegExp(`Bun\\]\\(https://bun\\.sh/?\\) ${PINNED?.replaceAll('.', '\\.')} or newer`),
			);
		}
	});

	it('that runs the tests is not older than package.json names', () => {
		expect(
			before(Bun.version, PINNED ?? ''),
			`Bun ${Bun.version} runs the tests; run bun upgrade to ${PINNED} or newer`,
		).toBe(false);
	});

	it('compares versions part by part', () => {
		expect(before('1.3.14', '1.4.3')).toBe(true);
		expect(before('1.4.3', '1.4.3')).toBe(false);
		expect(before('1.10.0', '1.4.3')).toBe(false);
	});
});
