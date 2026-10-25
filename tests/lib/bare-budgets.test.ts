import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
});

describe('the test files', () => {
	it('state every budget of their own through scaledBudget', () => {
		const files = execFileSync('git', ['ls-files', '-z', '--', '*.test.ts', '*.test.js'], {
			cwd: ROOT,
			encoding: 'utf8',
		})
			.split('\0')
			.filter(Boolean);
		const bare = files.flatMap((file) =>
			bareBudgetLines(file, readFileSync(join(ROOT, file), 'utf8')).map(
				(line) => `${file}:${line}`,
			),
		);
		expect(bare).toEqual([]);
	});
});
