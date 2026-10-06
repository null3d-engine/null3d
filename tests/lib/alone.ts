// The browser tests that run alone. Each checks a frame rate, a time limit, the frames or the work
// that come in a fixed time, or that a loop allocates nothing. On CI's two-core runners a heavy test
// on the other worker, such as one that filters an environment map with SwiftShader, can slow such a
// test past its limit, whatever the engine does. So these tests carry a tag. The Playwright projects
// that take the tag run one test at a time, the other projects leave them out, and CI runs them in a
// job of their own with no other test beside them.

/** The tag that puts a test among the tests that run alone. */
export const ALONE_TAG = '@alone';
/** The test details of a test that runs alone. */
export const ALONE = { tag: ALONE_TAG };
/** The end of the name of each Playwright project that takes the tests that run alone. */
export const ALONE_PROJECT_SUFFIX = ', alone';
/** Matches the tests that run alone, by their tag. */
export const RUNS_ALONE = new RegExp(ALONE_TAG);
