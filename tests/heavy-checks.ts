// Runs the checks that hold gigabytes, each in a process of its own: the unit run shares one
// process, so what one such check holds every test after it pays for, and a check cannot hand that
// memory back ([Test memory](../.dev/tests.md)). Two kinds are here. A check that reads the
// generated shader set holds the 1,343 modules it parses, about 3.6 GB. A check that builds the
// engine with the bundler holds the bundle and the bundler's copy of it, which the generated
// shaders make about 890 MB of code.
//
// Each process gets a memory ceiling of its own, which is the peak its check measured with room for
// a busier machine, so a check that grows past its need stops with a message that names the ceiling
// rather than taking the machine's memory. Split a check that reaches its ceiling; the guide says
// how.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/** The repository, which the checks' paths are relative to. */
const ROOT = join(import.meta.dirname, '..');
/** The preload that reads a run's memory and stops it past its ceiling. */
const CEILING = './tests/lib/memory-ceiling.ts';

/** One check, and the memory in MiB that its own process may hold. */
const CHECKS: readonly { file: string; ceilingMiB: number }[] = [
	// The whole generated set beside the text the tests read their counts from.
	{ file: 'tests/lib/shader-set.test.ts', ceilingMiB: 7168 },
	// The engine's programs and pipelines, read for every build the build wrote.
	{ file: 'packages/engine/src/gpu/webgl2/programs.test.ts', ceilingMiB: 6144 },
	// Two bundles of the engine, built to read which math helpers a sketch keeps.
	{ file: 'packages/engine/src/math/tree-shaking.test.ts', ceilingMiB: 10240 },
	// The release build, built to read which debug helpers it drops.
	{ file: 'packages/engine/src/debug/release.test.ts', ceilingMiB: 7168 },
];

let failed = 0;
for (const { file, ceilingMiB } of CHECKS) {
	const started = Date.now();
	const result = spawnSync(
		'bun',
		['test', '--preload', CEILING, '--conditions=null3d-source', file],
		{
			cwd: ROOT,
			stdio: 'inherit',
			env: { ...process.env, NULL3D_TEST_MEMORY_MIB: `${ceilingMiB}` },
		},
	);
	const seconds = Math.round((Date.now() - started) / 1000);
	const outcome = result.status === 0 ? 'passed' : `failed with ${result.status}`;
	console.log(`heavy-checks: ${file} ${outcome} in ${seconds}s, under ${ceilingMiB} MiB`);
	if (result.status !== 0) failed += 1;
}
process.exit(failed === 0 ? 0 : 1);
