// Names four files in its download list, and loads them in its setup. Then it loads two files that
// the list leaves out, one after the other, which a development build warns about once. It reports
// each file's downloads from its thread's timeline, with the time at which its setup began.
import { defineSketch } from '@null3d/engine';

/** The files that the list names, by their addresses from the test page. */
const LISTED = ['one', 'two', 'three', 'four'].map((name) => `download-list/${name}.bin`);

// The thread's timeline keeps 250 files by default, and a worker on the dev server loads more
// modules than that before the list's files arrive.
performance.setResourceTimingBufferSize(100_000);

export default defineSketch(
	async ({ assets, page }) => {
		const setupAt = performance.now();
		const sizes = (await Promise.all(LISTED.map((file) => assets.loadBinary(file)))).map(
			(bytes) => bytes.byteLength,
		);
		await assets.loadBinary('download-list/late-one.bin');
		await assets.loadBinary('download-list/late-two.bin');
		const fetches = performance
			.getEntriesByType('resource')
			.filter((entry) => entry.name.includes('/download-list/'))
			.map((entry) => [new URL(entry.name).pathname, entry.startTime] as const);
		page.post('result', { setupAt, sizes, fetches });
		return {};
	},
	{ downloads: LISTED },
);
