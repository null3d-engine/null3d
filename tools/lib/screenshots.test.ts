import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pageShotProblems, readShots, type ShotEntry, shotIdOf, shotProblems } from './docs';

const dirs: string[] = [];
afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tempRoot(): string {
	const dir = mkdtempSync(join(tmpdir(), 'null3d-shots-'));
	dirs.push(dir);
	return dir;
}

function write(root: string, path: string, content: string | Uint8Array): void {
	mkdirSync(join(root, path, '..'), { recursive: true });
	writeFileSync(join(root, path), content);
}

const ENTRY: ShotEntry = {
	id: 'concepts/instances/instances',
	pages: ['concepts/instances#under the opening paragraphs'],
	source: 'reference',
	images: ['webgpu/demo-instances.png'],
	alt: 'A field of columns.',
	caption: 'One dynamic batch.',
	files: ['examples/instances/sketch.ts'],
	verdict: 'shots-concepts__instances.md',
};

describe('shotIdOf', () => {
	it('reads the ID from a relative picture link', () => {
		expect(shotIdOf('../images/concepts/instances/instances.webp')).toBe(
			'concepts/instances/instances',
		);
	});

	it('reads the ID from a link at the page root', () => {
		expect(shotIdOf('images/index/showcase-island.webp')).toBe('index/showcase-island');
		expect(shotIdOf('/images/index/showcase-island.webp')).toBe('index/showcase-island');
	});

	it('drops a title after the address', () => {
		expect(shotIdOf('../images/a/b.webp "The picture"')).toBe('a/b');
	});

	it('ignores a link that is not a docs picture', () => {
		expect(shotIdOf('../images/logo.png')).toBeUndefined();
		expect(shotIdOf('https://example.com/images/a.webp')).toBeUndefined();
	});
});

describe('pageShotProblems', () => {
	const pages = () =>
		new Map([
			[
				'docs/concepts/instances.md',
				'Text.\n\n![A field of columns.](../images/concepts/instances/instances.webp)\n',
			],
		]);

	it('accepts a page whose picture has an entry and a file', () => {
		expect(pageShotProblems(pages(), [ENTRY], () => true)).toEqual([]);
	});

	it('refuses a page that shows a picture without an entry', () => {
		const problems = pageShotProblems(pages(), [], () => true);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('has no entry in docs/images/shots.json');
	});

	it('refuses a shown entry without its picture', () => {
		const problems = pageShotProblems(pages(), [ENTRY], () => false);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('its entry has no picture there');
	});

	it('ignores a page outside docs/', () => {
		const other = new Map([['.dev/guide.md', '![x](images/a/b.webp)']]);
		expect(pageShotProblems(other, [ENTRY], () => false)).toEqual([]);
	});
});

describe('readShots', () => {
	it('reads a valid list', () => {
		const root = tempRoot();
		write(root, 'docs/images/shots.json', JSON.stringify([ENTRY]));
		const { entries, problems } = readShots(root);
		expect(problems).toEqual([]);
		expect(entries.map((entry) => entry.id)).toEqual([ENTRY.id]);
	});

	it('refuses a list that is missing', () => {
		expect(readShots(tempRoot()).problems[0]).toContain('is missing');
	});

	it('refuses a repeated ID and a bad source', () => {
		const root = tempRoot();
		write(
			root,
			'docs/images/shots.json',
			JSON.stringify([ENTRY, { ...ENTRY, source: 'screenshot' }]),
		);
		const { problems } = readShots(root);
		expect(problems.some((problem) => problem.includes('listed twice'))).toBe(true);
		expect(problems.some((problem) => problem.includes('needs a source'))).toBe(true);
	});
});

describe('shotProblems', () => {
	function tree(): string {
		const root = tempRoot();
		write(
			root,
			'docs/images/shots.json',
			JSON.stringify([{ ...ENTRY, files: ['examples/instances/sketch.ts'] }]),
		);
		write(root, 'tests/image/references/chrome-real-gpu/webgpu/demo-instances.png', 'x');
		write(
			root,
			'docs/concepts/instances.md',
			'![A field of columns.](../images/concepts/instances/instances.webp)\n',
		);
		write(root, 'docs/images/concepts/instances/instances.webp', 'x');
		return root;
	}

	it('accepts a tree whose pictures, entries and references agree', () => {
		expect(shotProblems(tree())).toEqual([]);
	});

	it('refuses a picture that the entry lacks', () => {
		const root = tree();
		rmSync(join(root, 'docs/images/concepts/instances/instances.webp'));
		const problems = shotProblems(root);
		expect(problems.some((problem) => problem.includes('has no picture there'))).toBe(true);
	});

	it('refuses a missing reference image', () => {
		const root = tree();
		rmSync(join(root, 'tests/image/references/chrome-real-gpu/webgpu/demo-instances.png'));
		const problems = shotProblems(root);
		expect(problems.some((problem) => problem.includes('reference image'))).toBe(true);
	});
});
