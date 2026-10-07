// The large-world jitter check's results on disk and in the runner's summary, shared by the browser
// tests and the device runner. tests/pages/lib/jitter.ts holds the figures and their limits.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JITTER_TOLERANCE_PIXELS, type JitterResult } from '../pages/lib/jitter.ts';

/**
 * Writes a jitter page's figures into `folder` as `figures.json`, without the objects' centers, and
 * each PNG file it captured as `<name>.png`, so people can look at the frames of each flight.
 */
export function saveJitterResult(folder: string, result: JitterResult): void {
	mkdirSync(folder, { recursive: true });
	for (const [name, png] of Object.entries(result.images ?? {}))
		writeFileSync(join(folder, `${name}.png`), Buffer.from(png, 'base64'));
	const flights = result.flights.map(({ centers: _, ...figures }) => figures);
	writeFileSync(join(folder, 'figures.json'), JSON.stringify(flights, null, '\t'));
}

/** A jitter page's flights as Markdown table rows, after the GPU path's name. */
export function jitterRows(tier: string, result: JitterResult): string[] {
	return result.flights.map(
		(f) =>
			`| ${tier} | ${f.name} | ${f.jitterPixels.toFixed(4)} | ${f.ownJitterPixels.toFixed(4)} | ${(100 * f.coverage).toFixed(1)}% |`,
	);
}

/** The head of the jitter table, with what its columns mean. */
export const JITTER_TABLE_HEAD = [
	`Jitter: the largest difference, in pixels, between an object's motion from one frame to the next and the same motion at the origin; the limit is ${JITTER_TOLERANCE_PIXELS} px, and flights with every cell taken must exceed it. Own: the largest difference from the object's mean motion in the flight itself.`,
	'',
	'| GPU path | Flight | Jitter | Own | Smallest area |',
	'| --- | --- | --- | --- | --- |',
];
