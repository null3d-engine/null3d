import { describe, expect, it } from 'bun:test';
import {
	chooseBase,
	compareSizes,
	grownFiles,
	growthLines,
	growthOf,
	growthProblems,
	growthSummary,
	growthText,
} from './size-check';

/** A size record with the given Brotli sizes. */
const record = (sizes: Record<string, number>) =>
	Object.fromEntries(
		Object.entries(sizes).map(([file, brotli]) => [file, { raw: brotli * 3, brotli }]),
	);

describe('compareSizes', () => {
	it("lists this build's files in order, then the files that only the base has", () => {
		const changes = compareSizes(
			record({ 'a.wasm': 1000, 'old.js': 50 }),
			record({ 'b.js': 10, 'a.wasm': 1010 }),
		);
		expect(changes).toEqual([
			{ file: 'b.js', base: undefined, head: 10 },
			{ file: 'a.wasm', base: 1000, head: 1010 },
			{ file: 'old.js', base: 50, head: undefined },
		]);
	});
});

describe('the growth limit', () => {
	it('lets a file grow by 2% after Brotli, and fails more', () => {
		const changes = compareSizes(
			record({ 'at.wasm': 1000, 'over.wasm': 1000, 'shrunk.js': 1000 }),
			record({ 'at.wasm': 1020, 'over.wasm': 1021, 'shrunk.js': 900 }),
		);
		expect(grownFiles(changes).map(({ file }) => file)).toEqual(['over.wasm']);
		expect(growthOf(changes[1]!)).toBeCloseTo(0.021);
	});

	it('counts a new file as growth over the limit, and a removed file as none', () => {
		const changes = compareSizes(record({ 'gone.js': 500 }), record({ 'new.js': 10 }));
		expect(grownFiles(changes).map(({ file }) => file)).toEqual(['new.js']);
	});

	it('writes the growth to one decimal, with its sign', () => {
		expect(growthText({ file: 'a', base: 1000, head: 1036 })).toBe('+3.6%');
		expect(growthText({ file: 'a', base: 1000, head: 988 })).toBe('-1.2%');
		expect(growthText({ file: 'a', base: 1000, head: 1000 })).toBe('0.0%');
		expect(growthText({ file: 'a', base: 100_000, head: 99_999 })).toBe('0.0%');
		expect(growthText({ file: 'a', head: 5 })).toBe('new');
		expect(growthText({ file: 'a', base: 5 })).toBe('removed');
	});
});

describe('growthProblems', () => {
	const changes = compareSizes(
		record({ 'js/page.js': 13_709, 'js/job-worker.js': 1596 }),
		record({ 'js/page.js': 14_203, 'js/job-worker.js': 1600, 'js/new.js': 1200 }),
	);

	it('names each file over the limit that no trailer explains', () => {
		expect(growthProblems(changes, new Map())).toEqual([
			'js/page.js grew +3.6% after Brotli, from 13,709 to 14,203 bytes, and no Size-Growth trailer names it',
			'js/new.js is new, 1,200 bytes after Brotli, and no Size-Growth trailer names it',
		]);
	});

	it('passes the files that a trailer explains', () => {
		const explained = new Map([
			['js/page.js', 'a1b2c3d4e5'],
			['js/new.js', 'f6a7b8c9d0'],
		]);
		expect(growthProblems(changes, explained)).toEqual([]);
	});
});

describe('the growth tables', () => {
	const changes = compareSizes(
		record({ 'js/page.js': 13_709, 'js/job-worker.js': 1596 }),
		record({ 'js/page.js': 14_203, 'js/job-worker.js': 1600 }),
	);
	const explained = new Map([['js/page.js', 'a1b2c3d4e5f6']]);

	it("show each file's sizes, its growth and the commit that explains growth over the limit", () => {
		expect(growthLines(changes, explained)).toEqual([
			'  file                               base   this build    growth',
			'  js/page.js                       13,709       14,203     +3.6%  explained in a1b2c3d4',
			'  js/job-worker.js                  1,596        1,600     +0.3%',
		]);
		expect(growthLines(changes, new Map())[1]).toEndWith('+3.6%  not explained');
	});

	it('give CI a Markdown table that names the base', () => {
		const summary = growthSummary(
			changes,
			explained,
			'`5fefcdbe`, the merge base with origin/main',
		);
		expect(summary).toContain('The base is `5fefcdbe`, the merge base with origin/main.');
		expect(summary).toContain('| `js/page.js` | 13,709 | 14,203 | +3.6% | explained in a1b2c3d4 |');
		expect(summary).toContain('| `js/job-worker.js` | 1,596 | 1,600 | +0.3% |  |');
	});
});

describe('chooseBase', () => {
	it('takes the commit that --base names, wherever the check runs', () => {
		expect(chooseBase('v0.0.1', { GITHUB_EVENT_NAME: 'push' })).toEqual({
			ref: 'v0.0.1',
			why: 'the commit that --base names',
		});
	});

	it('compares a push to main with the commit before', () => {
		expect(chooseBase(undefined, { GITHUB_EVENT_NAME: 'push', GITHUB_REF_NAME: 'main' })).toEqual({
			ref: 'HEAD^',
			why: 'the commit before on main',
		});
	});

	it('compares a pull request with its merge base with the branch it targets', () => {
		const env = { GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main' };
		expect(chooseBase(undefined, env)).toEqual({
			branch: 'main',
			why: 'the merge base with origin/main',
		});
		expect(chooseBase(undefined, { ...env, GITHUB_BASE_REF: 'feat/cells' })).toEqual({
			branch: 'feat/cells',
			why: 'the merge base with origin/feat/cells',
		});
	});

	it('compares a local run with its merge base with main', () => {
		expect(chooseBase(undefined, {})).toEqual({
			branch: 'main',
			why: 'the merge base with origin/main',
		});
	});
});
