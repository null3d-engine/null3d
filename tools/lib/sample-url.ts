// The address of a sample file on the dev server and the preview server, apart from the sample
// tools in samples.ts, which need Node: pages and sketches import this module in the browser.

/** The URL prefix under which the dev server and the preview server serve sample files. */
export const SAMPLES_URL = '/samples/';

/**
 * The address of a sample file on the dev server and the preview server, for pages. Name the file
 * with a string literal, so the sample check can read it.
 */
export function sampleUrl(path: string): string {
	return `${SAMPLES_URL}${path}`;
}
