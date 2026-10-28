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
	/**
	 * The environment that a check needs to run one part of its work. A check that reads more than
	 * one process may hold names one entry for each part, so that each part runs in a process of its
	 * own; a check without parts has none.
	 */
	readonly env?: Readonly<Record<string, string>>;
}

/**
 * The variable that names the part of a check's work that its process runs, as `part/parts`. A
 * check that runs in parts reads it, and its list names one entry for each part, so that the parts
 * together read every build ([Test memory](../../.dev/tests.md)).
 */
export const PART_ENV = 'NULL3D_CHECK_PART';

export const HEAVY_CHECKS: readonly HeavyCheck[] = [
	// The whole generated set beside the text the tests read their counts from.
	{ file: 'tests/lib/shader-set.test.ts', ceilingMiB: 7168 },
	// The engine's programs, read for every build the build wrote. The GLSL sources are most of the
	// generated set's bytes, and one process that reads every build of it holds 16,839 MiB on the
	// Mac, past what CI's runner holds beside the rest of the job. So the check runs in three parts,
	// each in a process of its own: a part reads every third build of the set, and the parts together
	// read them all. A part holds about 6,000 MiB, and each takes the 7,680 ceiling the whole check
	// had, with room for a busy machine.
	{
		file: 'packages/engine/src/gpu/webgl2/programs.test.ts',
		ceilingMiB: 7680,
		env: { [PART_ENV]: '1/3' },
	},
	{
		file: 'packages/engine/src/gpu/webgl2/programs.test.ts',
		ceilingMiB: 7680,
		env: { [PART_ENV]: '2/3' },
	},
	{
		file: 'packages/engine/src/gpu/webgl2/programs.test.ts',
		ceilingMiB: 7680,
		env: { [PART_ENV]: '3/3' },
	},
	// The WebGPU pipeline layouts, read for every build the build wrote. A layout comes from the
	// WGSL side of a build alone, so this check reads the modules of the WGSL target and leaves the
	// WebGL2 ones alone: 1,599 MiB measured, against 10,251 for every module of both targets. It
	// keeps the 7,680 ceiling that the checks beside it take.
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
	// It holds the engine's generated shaders, which the page resolves from source: the build peaks
	// at 10,520 MiB, and the maps carry no source text. After the vegetation package and four new
	// pages joined the build, CI measured 12,930 MiB and 13,120 MiB (runs 40125822864 and
	// 40127501793), past the 12,288 ceiling more often than not, so the ceiling is 14 GB. CI's Linux
	// runners have 16 GB. The cost is the engine's build in the page's own process, which a ceiling
	// cannot fix; that question waits for the owner.
	{ file: 'packages/cli/src/add-on-page-build.test.ts', ceilingMiB: 14336 },
];

/**
 * The pattern that `bun test --path-ignore-patterns` takes to leave one check's file out of a run.
 * The whole path is named, so a file of the same name elsewhere is not left out with it.
 */
export const ignorePatternOf = (file: string) => `**/${file}`;
