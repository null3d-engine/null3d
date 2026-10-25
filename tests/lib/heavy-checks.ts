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
	// The engine's programs and pipelines, read for every build the build wrote. It reads the whole
	// generated set as the WebGPU pipelines check does, so it holds the same ceiling: the masked
	// transmission's permutations took the manifest from 72,989 to 78,261 builds, 7.2 per cent, and
	// the measured peaks are 7,343 and 7,283 MiB, so both take 7,680 with room for a busy machine.
	{ file: 'packages/engine/src/gpu/webgl2/programs.test.ts', ceilingMiB: 7680 },
	// The WebGPU pipeline layouts, read for every build the build wrote.
	{ file: 'packages/engine/src/gpu/webgpu/pipelines.test.ts', ceilingMiB: 7680 },
	// One bundle of the engine for each tree-shaking check, each in a process of its own, with an
	// empty module in place of the shader modules: about 1.5 GB each.
	{ file: 'packages/engine/src/math/tree-shaking-vec3.test.ts', ceilingMiB: 3072 },
	{ file: 'packages/engine/src/math/tree-shaking-quat.test.ts', ceilingMiB: 3072 },
	// One release build for each check, each in a process of its own.
	{ file: 'packages/engine/src/debug/release-runner.test.ts', ceilingMiB: 4096 },
	{ file: 'packages/engine/src/debug/release-draw-release.test.ts', ceilingMiB: 12288 },
	{ file: 'packages/engine/src/debug/release-draw-development.test.ts', ceilingMiB: 12288 },
	// Changed texture files through the WebAssembly transcoder: its heap grows on the hostile ones
	// and does not shrink, so the checks hold every growth they have made.
	{ file: 'packages/engine/src/scene/malformed-files.test.ts', ceilingMiB: 2560 },
	// A page of the add-on check's fixture, built with the source maps that the allocation gate reads.
	// It holds the engine's generated shaders, which the page resolves from source: measured on
	// 24 October 2026, the build peaked at 10,520 MiB, and the maps carried no source text. After the
	// vegetation package and four new pages joined the build, CI measured 12,930 MiB and 13,120 MiB
	// on 25 October (runs 40125822864 and 40127501793), past the 12,288 ceiling more often than not,
	// so the ceiling went to 14 GB. CI's Linux runners have 16 GB. The cost is the engine's build in
	// the page's own process, which a ceiling cannot fix; that question waits for the owner.
	{ file: 'packages/cli/src/add-on-page-build.test.ts', ceilingMiB: 14336 },
];

/**
 * The pattern that `bun test --path-ignore-patterns` takes to leave one check's file out of a run.
 * The whole path is named, so a file of the same name elsewhere is not left out with it.
 */
export const ignorePatternOf = (file: string) => `**/${file}`;
