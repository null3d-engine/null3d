// Inside the repository, the pages, the tools and the type checks read each package's TypeScript
// source, under the export condition that this file names. A project that installs a package from
// npm sets no such condition, so it gets the package's built JavaScript and declarations. The
// repository's tsconfig files set the condition in `customConditions`, its Vite configs set it
// with these resolve options, and `bun run test` passes it to Bun's test runner. Vite loads its
// configs with Node, and Playwright runs in Node, which takes no such condition here, so those
// import the Vite plugin's source by its path.
import { defaultClientConditions } from 'vite';

/** The export condition that selects a package's TypeScript source. */
export const SOURCE_CONDITION = 'null3d-source';

/** Vite's resolve options for pages that import the packages' source. */
export const sourceResolve = { conditions: [SOURCE_CONDITION, ...defaultClientConditions] };
