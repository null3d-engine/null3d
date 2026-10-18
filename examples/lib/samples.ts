// Where the demos find the sample files that they load. The repository's dev and preview servers
// serve them under /samples/. A build that ships the demos elsewhere, such as a website's, copies
// the files beside its pages and sets the VITE_NULL3D_SAMPLES_BASE environment variable to their
// folder, such as './samples/'. A relative folder resolves against the page's address.

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

/**
 * The address of a sample file. Name the file with a string literal, so the sample check can read
 * it and a build can copy it.
 */
export const sampleUrl = (path: string): string => `${base}${path}`;
