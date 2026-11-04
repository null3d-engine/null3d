import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { linkDuplicates } from './link-duplicates.ts';

describe('linkDuplicates', () => {
	it('links each file to an earlier one of equal contents, and keeps every other file', () => {
		const root = mkdtempSync(join(tmpdir(), 'link-duplicates-'));
		const write = (path: string, text: string) => {
			mkdirSync(join(root, path, '..'), { recursive: true });
			writeFileSync(join(root, path), text);
		};
		write('a/shader.js', 'the same shader');
		write('b/deep/shader.js', 'the same shader');
		write('b/other.js', 'the same length');
		write('b/page.js', 'another page');

		const linked = linkDuplicates([join(root, 'a'), join(root, 'b')]);

		expect(linked).toEqual({ files: 4, links: 1, bytes: 'the same shader'.length });
		const inode = (path: string) => statSync(join(root, path)).ino;
		expect(inode('b/deep/shader.js')).toBe(inode('a/shader.js'));
		expect(inode('b/other.js')).not.toBe(inode('a/shader.js'));
		const kept: [string, string][] = [
			['b/deep/shader.js', 'the same shader'],
			['b/other.js', 'the same length'],
			['b/page.js', 'another page'],
		];
		for (const [path, text] of kept) expect(readFileSync(join(root, path), 'utf8')).toBe(text);
		// A second run finds the link already made.
		expect(linkDuplicates([join(root, 'a'), join(root, 'b')]).links).toBe(0);
	});
});
