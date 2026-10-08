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

/**
 * The URL prefix under which the dev server and the preview server serve the environment maps of
 * the sample HDR files, which the asset tool builds (tools/lib/sample-environments.ts).
 */
export const SAMPLE_ENVIRONMENTS_URL = '/sample-environments/';

/**
 * The address of the environment map of a sample HDR file, from the file's address that
 * `sampleUrl` gives.
 */
export function sampleEnvironment(hdrUrl: string): string {
	return `${SAMPLE_ENVIRONMENTS_URL}${hdrUrl.slice(SAMPLES_URL.length)}`;
}

/**
 * The URL prefix under which the dev server and the preview server serve the KTX2 files of the
 * sample images, which the asset tool encodes (tools/lib/sample-textures.ts).
 */
export const SAMPLE_TEXTURES_URL = '/sample-textures/';

/** The address of the list of the city scene's textures, as addresses of their KTX2 files. */
export const SAMPLE_TEXTURES_LIST = `${SAMPLE_TEXTURES_URL}city.json`;
