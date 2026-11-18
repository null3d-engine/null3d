// Inside the repository, the pages, the tools and the type checks read each package's TypeScript
// source, under the export condition that this file names. A project that installs a package from
// npm sets no such condition, so it gets the package's built JavaScript and declarations. The
// repository's tsconfig files set the condition in `customConditions`, its Vite configs set it
// with these resolve options, and `bun run test` passes it to Bun's test runner. Playwright runs in
// Node, and every command that starts it passes the condition in NODE_OPTIONS
// (`playwrightNodeOptions`), so a test that imports a package's source, which in turn imports
// another package by name, reads that package's source too. Vite loads its configs with Node and
// no condition, so a config imports the Vite plugin's source by its path.
import { defaultClientConditions } from 'vite';

/** The export condition that selects a package's TypeScript source. */
export const SOURCE_CONDITION = 'null3d-source';

/** Vite's resolve options for pages that import the packages' source. */
export const sourceResolve = { conditions: [SOURCE_CONDITION, ...defaultClientConditions] };

/**
 * The NODE_OPTIONS that start Playwright in the repository: the source condition, then whatever the
 * caller's environment already asks for.
 */
export function playwrightNodeOptions(current = process.env.NODE_OPTIONS): string {
	return [`--conditions=${SOURCE_CONDITION}`, current].filter(Boolean).join(' ');
}
