// The addresses of the demos' code that the "View code" links give.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { DEMOS } from '../../examples/demos.ts';
import { codePath, REPOSITORY_URL, sourceUrl } from '../../examples/lib/source.ts';

describe("a demo's code address", () => {
	test('is the sketch file of a demo that is one file', () => {
		expect(sourceUrl({ name: 'instances' })).toBe(
			'https://github.com/null3d-engine/null3d/blob/main/examples/instances/sketch.ts',
		);
	});

	test('is the folder of a demo of several files', () => {
		expect(sourceUrl({ name: 'city', code: 'showcase/city/' })).toBe(
			'https://github.com/null3d-engine/null3d/tree/main/examples/showcase/city/',
		);
	});

	test('names the branch or tag that it is given', () => {
		expect(sourceUrl({ name: 'instances' }, 'v0.1.0')).toBe(
			'https://github.com/null3d-engine/null3d/blob/v0.1.0/examples/instances/sketch.ts',
		);
		expect(sourceUrl({ name: 'battle', code: 'compare/battle/' }, 'v0.1.0')).toBe(
			'https://github.com/null3d-engine/null3d/tree/v0.1.0/examples/compare/battle/',
		);
	});

	test('comes from the repository that the root package.json names', () => {
		const manifest = JSON.parse(
			readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
		) as { repository: { url: string } };
		expect(manifest.repository.url.replace(/^git\+/, '').replace(/\.git$/, '')).toBe(
			REPOSITORY_URL,
		);
	});

	test('names a file or a folder in this checkout for every demo', () => {
		const examples = new URL('../../examples/', import.meta.url);
		for (const demo of DEMOS) {
			const path = codePath(demo);
			expect(existsSync(new URL(path, examples)), path).toBe(true);
		}
	});
});
