// Runs the unit tests, one group of paths at a time, each in a process of its own. One `bun test`
// holds every file it finds in one process, so what one file holds the next file still pays for.
// With a process for each group, the run's peak is the largest group's rather than the sum of them.
// The groups are the repository's own: the tools, each package, the benchmark's scenes and pages,
// the tests and their helpers, and the demos. Each process gets the memory ceiling of the unit run,
// through `tests/lib/memory-ceiling.ts`, and its checks the time budget of `tests/lib/run-budget.ts`
// ([Test memory](../.dev/tests.md)).
//
// The checks that hold gigabytes are not here; `bun run test:heavy` runs them in processes of their
// own, one at a time, because a process that holds one of them holds it for good.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { HEAVY_CHECKS, ignorePatternOf } from './lib/heavy-checks.ts';
import { budgetNote, checkTimeoutMs, LOAD_FACTOR_ENV, loadFactor } from './lib/run-budget.ts';
import { exactTestPath } from './lib/test-paths.ts';

/** The repository, which the groups' paths are relative to. */
const ROOT = join(import.meta.dirname, '..');
/** The preload that reads a run's memory and stops it past its ceiling. */
const CEILING_PRELOAD = './tests/lib/memory-ceiling.ts';
/** The memory in MiB that one group's process may hold. */
const CEILING_MIB = 4096;
/** The packages of the workspace: each is a group, so a heavy package is paid for alone. */
const packages = readdirSync(join(ROOT, 'packages')).map((name) => `packages/${name}`);

/**
 * The groups of the run. A group is one `bun test` invocation, so the memory its files hold together
 * is what the run pays for it, and the largest group sets the run's peak.
 */
const GROUPS: readonly (readonly string[])[] = [
	['tools'],
	...packages.map((name) => [name]),
	['bench/scenes', 'bench/pages', 'bench/lib'],
	['tests/lib'],
	['examples/lib', 'examples/compare', 'examples/showcase', 'examples/addons'],
];

let failed = 0;
for (const paths of GROUPS) {
	// `--isolate` is not used: it gives each file a global of its own, which shrank the engine's
	// group from 2,908 MB to 2,054 MB, but grew the group of the runner's tests from 1,220 MB to
	// 3,822 MB and made it three times slower, so the run's peak was higher with it.
	const factor = loadFactor();
	const timeout = checkTimeoutMs(factor);
	const args = [
		'test',
		`--timeout=${timeout}`,
		'--preload',
		CEILING_PRELOAD,
		'--conditions=null3d-source',
	];
	// A check that runs in parts names its file more than once, and the run leaves that file out once.
	for (const file of new Set(HEAVY_CHECKS.map((check) => check.file)))
		args.push(`--path-ignore-patterns=${ignorePatternOf(file)}`);
	args.push(...paths.map(exactTestPath));
	const started = Date.now();
	const result = spawnSync('bun', args, {
		cwd: ROOT,
		stdio: 'inherit',
		env: {
			...process.env,
			NULL3D_TEST_MEMORY_MIB: `${CEILING_MIB}`,
			[LOAD_FACTOR_ENV]: `${factor}`,
		},
	});
	const seconds = Math.round((Date.now() - started) / 1000);
	const outcome = result.status === 0 ? 'passed' : `failed with ${result.status}`;
	console.log(
		`unit: ${paths.join(' ')} ${outcome} in ${seconds}s, under ${CEILING_MIB} MiB${budgetNote(timeout)}`,
	);
	if (result.status !== 0) failed += 1;
}
process.exit(failed === 0 ? 0 : 1);
