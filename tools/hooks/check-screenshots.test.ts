import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { screenshotProblems } from './check-screenshots';

const dirs: string[] = [];
afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function write(root: string, path: string, content: string): void {
	mkdirSync(join(root, path, '..'), { recursive: true });
	writeFileSync(join(root, path), content);
}

/** A tree whose one shot is shown, listed and drawn. */
function tree(): string {
	const root = mkdtempSync(join(tmpdir(), 'null3d-shot-hook-'));
	dirs.push(root);
	write(
		root,
		'docs/images/shots.json',
		JSON.stringify([
			{
				id: 'index/box',
				pages: ['index#the top'],
				source: 'scripted',
				images: ['webgpu/demo-box.png'],
				alt: 'A box.',
				caption: 'The box.',
				files: ['examples/box/sketch.ts'],
				verdict: 'shots-index.md',
			},
		]),
	);
	write(root, 'tests/image/references/chrome-real-gpu/webgpu/demo-box.png', 'png');
	write(root, 'docs/index.md', '![A box.](images/index/box.webp)\n');
	write(root, 'docs/images/index/box.webp', 'webp');
	return root;
}

describe('the screenshot commit guard', () => {
	it('passes a tree whose page, entry and picture agree', () => {
		expect(screenshotProblems(tree())).toEqual([]);
	});

	it('refuses a page that shows a picture without an entry', () => {
		const root = tree();
		write(root, 'docs/index.md', '![A box.](images/index/missing.webp)\n');
		expect(screenshotProblems(root).some((problem) => problem.includes('has no entry'))).toBe(true);
	});

	it('refuses an entry whose picture is missing', () => {
		const root = tree();
		rmSync(join(root, 'docs/images/index/box.webp'));
		expect(
			screenshotProblems(root).some((problem) => problem.includes('has no picture there')),
		).toBe(true);
	});
});
