// Runs the checks that hold gigabytes, each in a process of its own. The unit run shares one process
// between its files, so what one such check holds every test after it pays for, and a check cannot
// hand that memory back ([Test memory](../.dev/tests.md)). Three kinds are here. A check that reads
// the generated shader set holds the 1,343 modules it parses, about 3.6 GB. A check that builds the
// engine with the bundler holds the bundle and the bundler's copy of it, which the generated shaders
// make about 890 MB of code. A check that feeds the WebAssembly texture transcoder changed files
// holds every growth of its heap, which never shrinks: about 1.7 GB, from files of a few kilobytes.
//
// The list is shared with the unit run, which leaves these files out: `tests/lib/heavy-checks.ts`.
// Each process gets a memory ceiling of its own, which is the peak its check measured with room for
// a busier machine, so a check that grows past its need stops with a message that names the ceiling
// rather than taking the machine's memory. Split a check that reaches its ceiling; the guide says
// how.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { HEAVY_CHECKS } from './lib/heavy-checks.ts';
import { CHECK_TIMEOUT_MS } from './lib/run-budget.ts';

/** The repository, which the checks' files are relative to. */
const ROOT = join(import.meta.dirname, '..');
/** The preload that reads a run's memory and stops it past its ceiling. */
const CEILING = './tests/lib/memory-ceiling.ts';

let failed = 0;
for (const { file, ceilingMiB } of HEAVY_CHECKS) {
	const started = Date.now();
	const result = spawnSync(
		'bun',
		[
			'test',
			`--timeout=${CHECK_TIMEOUT_MS}`,
			'--preload',
			CEILING,
			'--conditions=null3d-source',
			file,
		],
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
