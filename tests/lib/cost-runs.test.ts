// Browser tests that time pages must end on their own. A test with no time limit, or with a wait
// for a quiet computer of its own, waited for hours on a busy computer and held the queue.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const specs = ['tests/image', 'bench/tests'].flatMap((folder) =>
	readdirSync(join(root, folder))
		.filter((name) => name.endsWith('.spec.ts'))
		.map((name) => ({
			path: `${folder}/${name}`,
			text: readFileSync(join(root, folder, name), 'utf8'),
		})),
);

describe('a browser test that times pages', () => {
	test('keeps a time limit', () => {
		expect(specs.length).toBeGreaterThan(0);
		expect(
			specs.filter((spec) => /setTimeout\(\s*0\s*\)/.test(spec.text)).map((spec) => spec.path),
		).toEqual([]);
	});

	test('waits for a quiet computer through the shared wait, which has a time limit', () => {
		expect(specs.filter((spec) => /\bloadavg\b/.test(spec.text)).map((spec) => spec.path)).toEqual(
			[],
		);
	});
});
