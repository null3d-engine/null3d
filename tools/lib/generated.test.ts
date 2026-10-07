import { describe, expect, it } from 'bun:test';
import { execFileSync, execSync } from 'node:child_process';
import { join } from 'node:path';
import { generateDocs } from './docs';
import { emptySections, FILTER_CLEAN, hasSections } from './generated';

const repoRoot = join(import.meta.dir, '../..');

const PAGE = [
	'# Title',
	'',
	'Prose.',
	'',
	'<!-- null3d:api:start -->',
	'',
	'### `thing`',
	'',
	'<!-- null3d:other:end -->',
	'',
	'<!-- null3d:api:end -->',
	'',
	'<!-- null3d:table:start -->',
	'| a |',
	'<!-- null3d:table:end -->',
	'End.',
	'',
].join('\n');

describe('emptySections', () => {
	it('empties each generated section and keeps its markers and the prose around it', () => {
		expect(emptySections(PAGE)).toBe(
			[
				'# Title',
				'',
				'Prose.',
				'',
				'<!-- null3d:api:start -->',
				'<!-- null3d:api:end -->',
				'',
				'<!-- null3d:table:start -->',
				'<!-- null3d:table:end -->',
				'End.',
				'',
			].join('\n'),
		);
		expect(hasSections(PAGE)).toBe(true);
		expect(hasSections(emptySections(PAGE))).toBe(false);
		expect(hasSections('No markers.\n')).toBe(false);
	});

	it("gives what git's clean filter gives", () => {
		expect(execSync(FILTER_CLEAN, { input: PAGE, encoding: 'utf8' })).toBe(emptySections(PAGE));
	});
});

describe('the repository', () => {
	it('sets up the filter for every page with generated sections', () => {
		const files = generateDocs(repoRoot);
		const paths = [...files.keys()].filter((path) => hasSections(files.get(path) ?? ''));
		const attributes = execFileSync('git', ['check-attr', 'filter', '--', ...paths], {
			cwd: repoRoot,
			encoding: 'utf8',
		});
		for (const line of attributes.trim().split('\n'))
			expect(line).toEndWith('filter: null3d-generated');
	});
});
