// Where the demos find the sample files that they load. The repository's dev and preview servers
// serve them under /samples/. A build that ships the demos elsewhere, such as a website's, copies
// the files beside its pages and sets the VITE_NULL3D_SAMPLES_BASE environment variable to their
// folder, such as './samples/'. A relative folder resolves against the page's address.
//
// A build with the repository's sample plugin (samplesServer in tools/lib/samples.ts) gives each
// named file's content hash, and the address carries it as `?h=`. Such an address names one set of
// bytes, so the servers let the browser keep the file for good, and a new pin that changes a file
// changes its address. Without the plugin, the address has no hash and the browser checks the file
// on each use.

declare global {
	interface ImportMetaEnv {
		/** The folder of the sample files, when a build sets it. */
		readonly VITE_NULL3D_SAMPLES_BASE?: string;
	}
}

// The environment is read through a cast, so the file does not redeclare `import.meta.env` and
// clash with a bundler's own declaration of it.
const env = (import.meta as { env?: Record<string, string | undefined> }).env;
const base = env?.VITE_NULL3D_SAMPLES_BASE ?? '/samples/';

declare const __NULL3D_SAMPLE_HASHES__: Readonly<Record<string, string>> | undefined;

/** The content hash of each sample file that the demos name, by its path, when the build gives it. */
const hashes: Readonly<Record<string, string>> =
	typeof __NULL3D_SAMPLE_HASHES__ === 'undefined' ? {} : __NULL3D_SAMPLE_HASHES__;

/**
 * The address of a sample file, with its content hash when the build gives one. Name the file with
 * a string literal, so the sample check can read it and a build can copy it.
 */
export const sampleUrl = (path: string): string => {
	const hash = hashes[path];
	return hash === undefined ? `${base}${path}` : `${base}${path}?h=${hash}`;
};
