import { describe, expect, it } from 'bun:test';
import {
	addedText,
	branchEntries,
	type Facts,
	findFolders,
	folderName,
	fullRecord,
	readmeText,
	readRecord,
	rebaseLinks,
	recordTables,
	rowFiles,
	runEntryText,
	runFileName,
	runText,
	sentenceLines,
	tableRows,
} from './tested-devices';

const pixel: Facts = {
	Device: 'Pixel 9, 412 x 924 at 2.625x, 8 cores',
	OS: 'Android 17',
	Browser: 'Chrome 149.0.7827.160',
	GPU: 'Mali-G715',
	'GPU paths': 'WebGPU, compatibility mode, WebGL2',
	Where: 'BrowserStack Automate',
};

const ipad: Facts = {
	Device: 'iPad Pro 11-inch, 834 x 1194 at 2x, 8 cores',
	OS: '',
	Browser: 'Safari 26.6.2, with a Mac user agent',
	GPU: 'Apple GPU',
	'GPU paths': 'WebGPU, compatibility mode, WebGL2',
	Where: "The owner's tablet, over the local network",
};

const DIR = '.dev/tested-devices';

/** A record with a folder for each device and browser, each with one run. */
const record = () =>
	new Map([
		[`${DIR}/pixel-9-chrome/README.md`, readmeText('Pixel 9 in Chrome', pixel, [])],
		[`${DIR}/pixel-9-chrome/20261004-earlier-runs.md`, runText('smoke 2026-10-04', '22 passed.')],
		[
			`${DIR}/ipad-pro-11-inch-safari/README.md`,
			readmeText('iPad Pro 11-inch in Safari', ipad, [
				'The tab closed at 2016 MiB ([D-12](../../decisions/D-12-memory-budgets.md)).',
			]),
		],
		[
			`${DIR}/ipad-pro-11-inch-safari/20260929-earlier-runs.md`,
			runText('checks 2026-09-29', '656 of 656. Warm runs slowed.'),
		],
		[
			`${DIR}/ipad-pro-11-inch-safari/20261007-054211-effects.md`,
			`${runText('effects 2026-10-07', '4 of 4 ([D-71](../../decisions/D-71-custom-effects.md)).')}\nNo memory refusal.\n`,
		],
	]);

describe('readRecord', () => {
	it("reads each folder's facts, issues and runs, the owner's devices first and runs by date", () => {
		const { rows, problems } = readRecord(record());
		expect(problems).toEqual([]);
		expect(rows.map((row) => row.folder)).toEqual([
			`${DIR}/ipad-pro-11-inch-safari`,
			`${DIR}/pixel-9-chrome`,
		]);
		expect(rows[0]?.facts).toEqual(ipad);
		expect(rows[0]?.runs.map((run) => run.plans)).toEqual([
			'checks 2026-09-29',
			'effects 2026-10-07',
		]);
		expect(rows[0]?.runs[0]?.result).toBe('656 of 656. Warm runs slowed.');
		// A result may take several paragraphs.
		expect(rows[0]?.runs[1]?.result).toEndWith('.md)). No memory refusal.');
		expect(rows[1]?.issues).toEqual([]);
	});

	it('reports a folder without a README or runs, bad names, and files that lack a part', () => {
		const { problems } = readRecord(
			new Map([
				[`${DIR}/Pixel/README.md`, ''],
				[`${DIR}/loose.md`, ''],
				[`${DIR}/pixel-8-chrome/20261003-checks.md`, 'Plans: checks 2026-10-03\n'],
				[`${DIR}/pixel-10-chrome/README.md`, '- Device: Pixel 10\n'],
				[`${DIR}/pixel-10-chrome/checks.md`, runText('checks', 'ok')],
			]),
		);
		expect(problems).toEqual([
			`${DIR}/Pixel/README.md: name the folder in lowercase words joined by hyphens`,
			`${DIR}/loose.md: put each file in the folder of its device and browser`,
			`${DIR}/pixel-10-chrome/checks.md: name a run file <date as YYYYMMDD>-<plan>.md, in lowercase, such as the run's name`,
			`${DIR}/pixel-8-chrome: add a README.md with the device's facts and known issues`,
			`${DIR}/pixel-10-chrome/README.md: start the file with a title line, "# <device> in <browser>"`,
			...['OS', 'Browser', 'GPU', 'GPU paths', 'Where'].map(
				(fact) =>
					`${DIR}/pixel-10-chrome/README.md: add the line "- ${fact}: <text>", empty when nobody knows`,
			),
			`${DIR}/pixel-10-chrome/README.md: add a "## Known issues" section, with "None recorded." when there are none`,
			`${DIR}/pixel-10-chrome: add a file for each run`,
		]);
	});
});

describe('the tables and the full record', () => {
	it('gives each place its table, with the links moved to the page and a link to the runs', () => {
		const tables = recordTables(readRecord(record()).rows);
		expect(tables).toContain("## The owner's devices\n\n| Device | OS | Browser |");
		expect(tables).toContain(
			"| iPad Pro 11-inch, 834 x 1194 at 2x, 8 cores | | Safari 26.6.2, with a Mac user agent | Apple GPU | WebGPU, compatibility mode, WebGL2 | The owner's tablet, over the local network | The tab closed at 2016 MiB ([D-12](decisions/D-12-memory-budgets.md)). | [Runs](tested-devices/ipad-pro-11-inch-safari/) |",
		);
		expect(tables).toContain('## Device clouds');
		expect(tables).not.toContain("CI's machines");
	});

	it("joins each row's runs into the old table's cells, which read back as they were", () => {
		const full = fullRecord(readRecord(record()).rows);
		expect(tableRows(full)[0]?.slice(6)).toEqual([
			'checks 2026-09-29; effects 2026-10-07',
			'656 of 656. Warm runs slowed. 4 of 4 ([D-71](decisions/D-71-custom-effects.md)). No memory refusal.',
			'The tab closed at 2016 MiB ([D-12](decisions/D-12-memory-budgets.md)).',
		]);
	});

	it('moves a row of the old table into files that print the same row, pipes included', () => {
		const cells = [
			...Object.values({ ...pixel, GPU: 'A | B' }),
			'smoke 2026-10-04; checks 2026-10-05',
			'All passed. See [the notes](implementation-notes.md#captures); then more.',
			'',
		];
		const files = rowFiles(cells, '20261004-earlier-runs', new Set());
		expect([...files.keys()]).toEqual([
			`${DIR}/pixel-9-chrome/README.md`,
			`${DIR}/pixel-9-chrome/20261004-earlier-runs.md`,
		]);
		expect(files.get(`${DIR}/pixel-9-chrome/20261004-earlier-runs.md`)).toBe(
			'Plans: smoke 2026-10-04;\nchecks 2026-10-05\n\nResult: All passed.\nSee [the notes](../../implementation-notes.md#captures); then more.\n',
		);
		expect(tableRows(fullRecord(readRecord(files).rows))).toEqual([cells]);
	});
});

describe('the text helpers', () => {
	it('moves relative links between folders, and leaves URLs and anchors alone', () => {
		const text =
			'[a](decisions/D-12.md#why) [b](https://x.org/a.md) [c](#here) [d](tested-devices/ipad/)';
		expect(rebaseLinks(text, '.dev', '.dev/tested-devices/ipad')).toBe(
			'[a](../../decisions/D-12.md#why) [b](https://x.org/a.md) [c](#here) [d](./)',
		);
	});

	it('breaks lines only where joining them with a space gives the text back', () => {
		const text =
			'One (a. B) ends. `x. Y` stays. 1. Not a list. Two; three. - no bullet. 3.5 ms. end';
		const lines = sentenceLines(text, true);
		expect(lines.split('\n')).toEqual([
			'One (a. B) ends.',
			'`x. Y` stays. 1.',
			'Not a list.',
			'Two;',
			'three. - no bullet.',
			'3.5 ms.',
			'end',
		]);
		expect(lines.replaceAll('\n', ' ')).toBe(text);
	});

	it("names a folder from the device's name and the browser's, with its version when taken", () => {
		const s24 = { ...pixel, Device: 'Galaxy S24+ (SM-S926B), 12 GB', Browser: 'Brave 154.0.0.0' };
		expect(folderName(s24, new Set())).toBe('galaxy-s24-plus-sm-s926b-brave');
		const iphone = { ...pixel, Device: "iPhone 13 (BrowserStack's device list), 4 cores" };
		expect(folderName(iphone, new Set())).toBe('iphone-13-chrome');
		expect(folderName(pixel, new Set(['pixel-9-chrome']))).toBe('pixel-9-chrome-149');
	});

	it("names a run's file after the run, or after its first date and plan", () => {
		expect(
			runFileName('effects 2026-10-07', '4 of 4 (run 20261007-054211-effects)', new Set()),
		).toBe('20261007-054211-effects');
		expect(runFileName('bench 2026-10-06, S4', '', new Set(['20261006-bench']))).toBe(
			'20261006-bench-2',
		);
	});

	it('finds the text that an edit added to a cell, and notices text it changed', () => {
		expect(addedText('a; b', 'a; new; b')).toEqual({ text: 'new', edited: false, closes: false });
		expect(addedText('Done.', 'Done. More.')).toEqual({
			text: 'More.',
			edited: false,
			closes: false,
		});
		expect(addedText('Done', 'Done. More.')).toEqual({
			text: 'More.',
			edited: false,
			closes: true,
		});
		expect(addedText('Done.', 'Undone. More.').edited).toBe(true);
	});
});

describe('the runner entry', () => {
	const rows = readRecord(record()).rows;

	it('finds the folder from the model, the screen and the place', () => {
		const run = { ...ipad, Device: 'iPad, 834 x 1194 at 2x, 8 cores', Browser: 'Safari 26.7' };
		expect(findFolders(rows, run).map((row) => row.folder)).toEqual([
			`${DIR}/ipad-pro-11-inch-safari`,
		]);
		const text = runEntryText(rows, '20261008-101500-checks', run, 'checks 2026-10-08', '5 passed');
		expect(text).toStartWith(`${DIR}/ipad-pro-11-inch-safari/20261008-101500-checks.md:\n`);
		expect(text).toContain(
			'  Browser: the README says "Safari 26.6.2, with a Mac user agent"; the run found "Safari 26.7"',
		);
	});

	it('finds an Android folder for a browser that hides the model', () => {
		const run = { ...pixel, Device: 'Android device, 412 x 924 at 2.625x, 7 cores' };
		expect(findFolders(rows, run).map((row) => row.folder)).toEqual([`${DIR}/pixel-9-chrome`]);
	});

	it('prints a new folder with its README when none fits', () => {
		const run = { ...pixel, Device: 'Pixel 10, 412 x 924 at 2.625x, 8 cores' };
		const text = runEntryText(rows, '20261008-101500-smoke', run, 'smoke 2026-10-08', '3 passed');
		expect(text).toContain(`${DIR}/pixel-10-chrome/README.md`);
		expect(text).toContain('# Pixel 10 in Chrome');
		expect(text).toContain(
			`${DIR}/pixel-10-chrome/20261008-101500-smoke.md:\nPlans: smoke 2026-10-08`,
		);
	});
});

describe('branchEntries', () => {
	const head = [
		'| Device | OS | Browser | GPU | GPU paths | Where | Plans | Result | Known issues |',
		'| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
	];
	const line = (cells: readonly string[]) => `| ${cells.join(' | ')} |`;
	const ipadRow = [...Object.values(ipad), 'checks 2026-09-29', 'Done.', 'The tab closed.'];

	it("writes a branch's new runs, issues, facts and rows into the record's files", () => {
		const before = [...head, line(ipadRow)].join('\n');
		const changed = [
			...Object.values({ ...ipad, Browser: 'Safari 26.7, with a Mac user agent' }),
			'checks 2026-09-29; soak 2026-10-08',
			'Done. Soak held 60 fps ([D-16](decisions/D-16-moving-casters-and-bias.md)).',
			'The tab closed. Soak slowed when warm.',
		];
		const added = [
			...Object.values({ ...pixel, Device: 'Pixel 10' }),
			'smoke 2026-10-08',
			'3 passed',
			'',
		];
		const after = [...head, line(changed), line(added)].join('\n');
		const { writes, notes } = branchEntries(before, after, record());
		expect([...writes.keys()].sort()).toEqual([
			`${DIR}/ipad-pro-11-inch-safari/20261008-soak.md`,
			`${DIR}/ipad-pro-11-inch-safari/README.md`,
			`${DIR}/pixel-10-chrome/20261008-smoke.md`,
			`${DIR}/pixel-10-chrome/README.md`,
		]);
		expect(writes.get(`${DIR}/ipad-pro-11-inch-safari/20261008-soak.md`)).toBe(
			'Plans: soak 2026-10-08\n\nResult: Soak held 60 fps ([D-16](../../decisions/D-16-moving-casters-and-bias.md)).\n',
		);
		const readme = writes.get(`${DIR}/ipad-pro-11-inch-safari/README.md`) ?? '';
		expect(readme).toContain('- Browser: Safari 26.7, with a Mac user agent\n');
		expect(readme).toEndWith(
			'MiB ([D-12](../../decisions/D-12-memory-budgets.md)).\n\nSoak slowed when warm.\n',
		);
		expect(notes).toEqual([
			'iPad Pro 11-inch in Safari: the Browser fact is now "Safari 26.7, with a Mac user agent"',
			`Pixel 10 in Chrome: a new folder, ${DIR}/pixel-10-chrome`,
		]);
	});

	it('leaves out text that main already holds, and the full stop that closes the old text', () => {
		const before = [...head, line([...ipadRow.slice(0, 7), 'Done', ipadRow[8] as string])].join(
			'\n',
		);
		const after = [
			...head,
			line([
				...ipadRow.slice(0, 6),
				'checks 2026-09-29; effects 2026-10-07; soak 2026-10-08',
				'Done. Warm runs slowed. Soak held.',
				ipadRow[8] as string,
			]),
		].join('\n');
		const { writes } = branchEntries(before, after, record());
		expect(writes.get(`${DIR}/ipad-pro-11-inch-safari/20261008-soak.md`)).toBe(
			'Plans: soak 2026-10-08\n\nResult: Soak held.\n',
		);
		// The last run's result already ends its sentence, so its file stays as it is.
		expect([...writes.keys()]).toEqual([`${DIR}/ipad-pro-11-inch-safari/20261008-soak.md`]);
		// A branch whose new text closed the old cell's last sentence gives the old text that full stop.
		const unclosed = new Map(record());
		unclosed.set(
			`${DIR}/ipad-pro-11-inch-safari/20261007-054211-effects.md`,
			runText('effects 2026-10-07', 'No memory refusal'),
		);
		expect(
			branchEntries(before, after, unclosed).writes.get(
				`${DIR}/ipad-pro-11-inch-safari/20261007-054211-effects.md`,
			),
		).toBe('Plans: effects 2026-10-07\n\nResult: No memory refusal.\n');
	});

	it('notes a cell that the branch changed in place', () => {
		const before = [...head, line(ipadRow)].join('\n');
		const after = [
			...head,
			line([...ipadRow.slice(0, 7), 'Redone. Then more.', ipadRow[8] as string]),
		].join('\n');
		const { notes } = branchEntries(before, after, record());
		expect(notes).toEqual([
			'iPad Pro 11-inch in Safari: the branch changed text inside its Result cell, not only added to it; check the new files',
			'iPad Pro 11-inch in Safari: the run lacks its plans or its result; fill in "(not given)"',
		]);
	});
});
