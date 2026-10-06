import { describe, expect, it } from 'bun:test';
import { readRecords, recordFiles, recordList } from './decisions';

const record = (id: string, title: string) =>
	`# ${id}: ${title}\n\nStatus: decided. Date: 2026-10-06.\n\nSummary: Keep the first\noption.\n\n## Question\n`;

describe('readRecords', () => {
	it('reads each record and sorts the records by number', () => {
		const { records, problems } = readRecords(
			new Map([
				['.dev/decisions/D-100-later.md', record('D-100', 'A later choice')],
				['.dev/decisions/D-07-job-workers.md', record('D-07', 'Job worker count')],
			]),
		);
		expect(problems).toEqual([]);
		expect(records.map((r) => r.id)).toEqual(['D-07', 'D-100']);
		expect(records[0]).toEqual({
			number: 7,
			id: 'D-07',
			title: 'Job worker count',
			path: '.dev/decisions/D-07-job-workers.md',
			status: 'decided. Date: 2026-10-06.',
			summary: 'Keep the first option.',
		});
	});

	it('reports a record without a matching title, a status or a summary', () => {
		const { problems } = readRecords(
			new Map([['.dev/decisions/D-08-depth.md', '# D-09: Depth\n\nThe status comes later.\n']]),
		);
		expect(problems).toEqual([
			'.dev/decisions/D-08-depth.md: start the record with the line "# D-08: <title>"',
			'.dev/decisions/D-08-depth.md: add a "Status:" paragraph under the title',
			'.dev/decisions/D-08-depth.md: add a "Summary:" paragraph under the status',
		]);
	});

	it('reports a file name without an ID', () => {
		const { records, problems } = readRecords(
			new Map([['.dev/decisions/Depth.md', record('D-08', 'Depth')]]),
		);
		expect(records).toEqual([]);
		expect(problems).toEqual([
			'.dev/decisions/Depth.md: name the file D-<number>-<short-name>.md, in lowercase',
		]);
	});

	it('reports two records that take the same number', () => {
		const { problems } = readRecords(
			new Map([
				['.dev/decisions/D-70-hot-reload.md', record('D-70', 'Hot reload')],
				['.dev/decisions/D-70-cascades.md', record('D-70', 'Cascades')],
			]),
		);
		expect(problems).toEqual([
			'.dev/decisions/D-70-cascades.md and .dev/decisions/D-70-hot-reload.md both take D-70: give one the next free number',
		]);
	});
});

describe('recordList', () => {
	it('gives each record its title, file, status and summary', () => {
		const { records } = readRecords(
			new Map([['.dev/decisions/D-07-job-workers.md', record('D-07', 'Job worker count')]]),
		);
		expect(recordList(records)).toBe(
			'D-07: Job worker count (.dev/decisions/D-07-job-workers.md)\n  Status: decided. Date: 2026-10-06.\n  Summary: Keep the first option.\n',
		);
	});
});

describe('the repository', () => {
	it('has a title, a status and a summary in every record, and no number twice', () => {
		const { records, problems } = readRecords(recordFiles(process.cwd()));
		expect(problems).toEqual([]);
		expect(records.length).toBeGreaterThan(0);
	});
});
