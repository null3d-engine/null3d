// A sketch's download list in a live engine, in every thread mode: the first listed files start
// downloading before the setup begins, and the setup's loads take every listed file without a second
// download. The files answer from the test itself, a little late, so the setup begins while the
// first ones are still on their way. A development build warns once about the loads that the sketch
// makes one after the other.
import { expect, test } from '@playwright/test';
import { ENGINE_MODES, modeProblems, type ReportedMode } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

interface DownloadListResult {
	error?: string;
	mode: ReportedMode;
	recorded: {
		/** When the setup began, in ms on the sketch thread's clock. */
		setupAt: number;
		/** The bytes of each listed file, in the list's order. */
		sizes: number[];
		/** Each download of the test's files: its path and when it started, on the same clock. */
		fetches: [string, number][];
	};
}

const LISTED = ['one', 'two', 'three', 'four'];
const LATE = ['late-one', 'late-two'];
/** The bytes of each file, which differ so a file cannot pass for another. */
const bytesOf = (name: string) => 1000 + LISTED.concat(LATE).indexOf(name);
/** How long each answer waits, in ms. */
const ANSWER_MS = 150;

for (const mode of ENGINE_MODES)
	test(`a sketch's listed files start before its setup and download once, ${mode.name}`, async ({
		page,
	}) => {
		const warnings: string[] = [];
		page.on('console', (message) => {
			if (message.type() === 'warning') warnings.push(message.text());
		});
		await page.context().route('**/tests/pages/download-list/*.bin', async (route) => {
			const name = new URL(route.request().url()).pathname.split('/').at(-1)?.replace('.bin', '');
			await new Promise((resolve) => setTimeout(resolve, ANSWER_MS));
			await route.fulfill({
				body: Buffer.alloc(bytesOf(name ?? ''), 1),
				contentType: 'application/octet-stream',
			});
		});
		await page.goto(`download-list.html?${mode.query}`);
		const result = await pageResult<DownloadListResult>(page, 60_000);
		expect(result.error).toBeUndefined();
		expect(modeProblems(result.mode, mode)).toEqual([]);
		const { setupAt, sizes, fetches } = result.recorded;
		expect(sizes).toEqual(LISTED.map(bytesOf));

		// Each file downloads once: the setup's loads took the list's downloads.
		const paths = fetches.map(([path]) => path.split('/').at(-1)).sort();
		expect(paths).toEqual(
			LISTED.concat(LATE)
				.map((name) => `${name}.bin`)
				.sort(),
		);
		// The list's first two files started before the setup began.
		const startOf = (name: string) =>
			fetches.find(([path]) => path.endsWith(`/${name}.bin`))?.[1] ?? Number.NaN;
		expect(startOf('one')).toBeLessThan(setupAt);
		expect(startOf('two')).toBeLessThan(setupAt);

		// The first file that the list leaves out started only after the listed files had arrived,
		// with nothing else downloading, so the development build warned and named it. The second
		// waited in the same way, and the warning comes once.
		const serial = warnings.filter((text) => text.includes('only after'));
		expect(serial).toHaveLength(1);
		expect(serial[0]).toContain('late-one.bin');
		expect(serial[0]).toContain('/download-list/');
	});
