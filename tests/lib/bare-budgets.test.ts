import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bareBudgetLines } from './bare-budgets.ts';

const ROOT = join(import.meta.dirname, '../..');

describe('bareBudgetLines', () => {
	it('finds a budget that does not grow with the load, on a check or for its file', () => {
		const text = [
			"import { it, setDefaultTimeout, test } from 'bun:test';",
			"it('a', async () => {}, 60_000);",
			"test.skip('b', () => {}, { timeout: 5000 });",
			"it.if(true)('c', () => {}, 1000);",
			'setDefaultTimeout(30_000);',
			'const LIMIT = 60_000;',
			"it('d', () => {}, LIMIT);",
			"it('e', () => {}, 60 * 1000);",
			"it('f', () => {}, scaledBudget(1) + 5);",
			"it('g', () => {}, { ...options });",
			"it('h', () => {}, { ['timeout']: scaledBudget(1) });",
			'let later = scaledBudget(1);',
			"it('i', () => {}, later);",
			"test.each([1])('j %d', () => {}, 2000);",
		].join('\n');
		expect(bareBudgetLines('a.test.ts', text)).toEqual([2, 3, 4, 5, 7, 8, 9, 10, 11, 13, 14]);
	});

	it('passes a scaled budget, a constant that holds one, and numbers that are no budget', () => {
		const text = [
			"import { it as check, setDefaultTimeout } from 'bun:test';",
			'const it = check;',
			'const test = (name, fn, rows) => rows;',
			"check('a', async () => {}, scaledBudget(60_000));",
			'setDefaultTimeout(scaledBudget(30_000));',
			'const LIMIT = scaledBudget(60_000);',
			"check('b', () => {}, LIMIT);",
			"check('c', () => {}, { timeout: LIMIT, retry: 2 });",
			"check('d', () => {}, { 'timeout': scaledBudget(1) });",
			"test('own helper', 'a', 3);",
			'setTimeout(() => {}, 300);',
			"check('e', () => expect(sum(1, 2)).toBe(3));",
			"describe('f', () => {});",
		].join('\n');
		expect(bareBudgetLines('a.test.ts', text)).toEqual([]);
	});

	it('finds a budget that a setup or teardown hook states without scaling it', () => {
		const text = [
			"import { afterAll, afterEach, beforeAll, beforeEach, onTestFinished } from 'bun:test';",
			'beforeAll(async () => {}, 60_000);',
			'beforeEach(() => {}, { timeout: 5000 });',
			'const LIMIT = 30_000;',
			'afterAll(() => {}, LIMIT);',
			'afterEach(() => {}, 10 * 1000);',
			"describe('a', () => { onTestFinished(() => {}, 2000); });",
		].join('\n');
		expect(bareBudgetLines('a.test.ts', text)).toEqual([2, 3, 5, 6, 7]);
	});

	it('passes a hook budget that scales, and finds a fixed one under a renamed import', () => {
		const text = [
			"import { afterAll as teardown, beforeEach } from 'bun:test';",
			'const LIMIT = scaledBudget(30_000);',
			'beforeEach(() => {});',
			'beforeEach(() => {}, scaledBudget(5000));',
			'teardown(() => {}, { timeout: LIMIT });',
			'teardown(() => {}, 2000);',
		].join('\n');
		expect(bareBudgetLines('a.test.ts', text)).toEqual([6]);
	});

	it("finds a fixed budget for a file set through jest's setTimeout, and only that call", () => {
		const text = [
			"import { jest as mocks } from 'bun:test';",
			'mocks.setTimeout(60_000);',
			'mocks.fn(() => 60_000);',
			'mocks.setTimeout(scaledBudget(30_000));',
		].join('\n');
		expect(bareBudgetLines('a.test.ts', text)).toEqual([2]);
	});

	it('finds a fixed budget on a skipped check written with xit', () => {
		const text = [
			"import { xit } from 'bun:test';",
			"xit('a', () => {}, 60_000);",
			"xit('b', () => {}, scaledBudget(60_000));",
			"xit('c', () => {});",
		].join('\n');
		expect(bareBudgetLines('a.test.ts', text)).toEqual([2]);
	});

	it('finds a fixed budget on a skipped check written with xtest', () => {
		const text = [
			"import { xtest } from 'bun:test';",
			"xtest('a', () => {}, { timeout: 5000 });",
			"xtest('b', () => {}, { timeout: scaledBudget(5000) });",
		].join('\n');
		expect(bareBudgetLines('a.test.ts', text)).toEqual([2]);
	});
});

describe('the test files', () => {
	it('state every budget of their own through scaledBudget', () => {
		const files = execFileSync('git', ['ls-files', '-z', '--', '*.test.ts', '*.test.js'], {
			cwd: ROOT,
			encoding: 'utf8',
		})
			.split('\0')
			// A tracked file that this checkout deleted, and git has not yet staged, has nothing to read.
			.filter((file) => file && existsSync(join(ROOT, file)));
		const bare = files.flatMap((file) =>
			bareBudgetLines(file, readFileSync(join(ROOT, file), 'utf8')).map(
				(line) => `${file}:${line}`,
			),
		);
		expect(bare).toEqual([]);
	});
});
