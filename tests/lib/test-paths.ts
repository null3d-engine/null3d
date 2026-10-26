// How a runner names the test files and folders it hands to `bun test`.

/**
 * `path`, relative to the repository, as `bun test` takes it exactly: with `./` in front. Without
 * it, `bun test` reads the path as a filter. It then searches every folder of the checkout for test
 * files, which took seconds in a checkout whose `target` folder held 86 GB, and runs every file whose
 * path contains it: `tools` also ran `packages/cli/src/devtools.test.ts`.
 */
export const exactTestPath = (path: string): string =>
	path.startsWith('./') || path.startsWith('/') ? path : `./${path}`;
