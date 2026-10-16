// The checks that hold gigabytes, and the memory in MiB that each one's own process may hold. The
// unit run leaves these files out and `bun run test:heavy` runs them, so both read this one list
// ([Test memory](../../.dev/tests.md)).
//
// One list, because the two halves of it must agree: a file that the unit run leaves out and no
// runner names runs nowhere, and a file that a runner names without the unit run leaving it out
// runs twice.
export interface HeavyCheck {
	/** The test file, relative to the repository. */
	readonly file: string;
	/** Its measured peak in MiB, with room for a busier machine, which its process may hold. */
	readonly ceilingMiB: number;
}

export const HEAVY_CHECKS: readonly HeavyCheck[] = [
	// The whole generated set beside the text the tests read their counts from.
	{ file: 'tests/lib/shader-set.test.ts', ceilingMiB: 7168 },
	// The engine's programs and pipelines, read for every build the build wrote.
	{ file: 'packages/engine/src/gpu/webgl2/programs.test.ts', ceilingMiB: 6144 },
	// Two bundles of the engine, built to read which math helpers a sketch keeps.
	{ file: 'packages/engine/src/math/tree-shaking.test.ts', ceilingMiB: 10240 },
	// The release build, built to read which debug helpers it drops.
	{ file: 'packages/engine/src/debug/release.test.ts', ceilingMiB: 7168 },
	// Changed texture files through the WebAssembly transcoder: its heap grows on the hostile ones
	// and does not shrink, so the checks hold every growth they have made.
	{ file: 'packages/engine/src/scene/malformed-files.test.ts', ceilingMiB: 2560 },
];

/**
 * The pattern that `bun test --path-ignore-patterns` takes to leave one check's file out of a run.
 * The whole path is named, so a file of the same name elsewhere is not left out with it.
 */
export const ignorePatternOf = (file: string) => `**/${file}`;
