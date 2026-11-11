// Runs the unit tests, one group of paths per process. One `bun test` holds every file it finds in
// one process, so what one file holds the next file still pays for. With a process for each group,
// the run's peak is the largest group's rather than the sum of every file's.
// The groups are the repository's own: the tools, each package, the benchmark's scenes and pages,
// the tests and their helpers, and every demo folder that holds a test file. Each process gets the
// memory ceiling of the unit run, through `tests/lib/memory-ceiling.ts`, and its checks the time
// budget of `tests/lib/run-budget.ts` ([Test memory](../.dev/tests.md)).
//
// Two groups run at once. A group spends its time in starting an interpreter and in the files it
// holds, so the run lasts about as long as its groups added together, and a second lane takes back
// close to half of that. The lanes are held at two: each group may reach the memory ceiling, so each
// lane can add a run's worth of memory, and the queue's booking for the run covers two.
//
// The checks that hold gigabytes are not here; `bun run test:heavy` runs them in processes of their
// own, one at a time, because a process that holds one of them holds it for good.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { HEAVY_CHECKS, ignorePatternOf } from './lib/heavy-checks.ts';
import { budgetNote, checkTimeoutMs, LOAD_FACTOR_ENV, loadFactor } from './lib/run-budget.ts';
import { exactTestPath } from './lib/test-paths.ts';
import { UNIT_GROUPS } from './lib/unit-groups.ts';

/** The repository, which the groups' paths are relative to. */
const ROOT = join(import.meta.dirname, '..');
/** The preload that reads a run's memory and stops it past its ceiling. */
const CEILING_PRELOAD = './tests/lib/memory-ceiling.ts';
/** The memory in MiB that one group's process may hold. */
const CEILING_MIB = 4096;
/** How many groups run at once. */
const LANES = 2;

/** Groups that have failed, which the run's exit status reports. */
let failed = 0;
/** The next group for a free lane to take. */
let next = 0;

/**
 * Runs one group of paths and prints what it wrote and how long it took.
 *
 * @param paths The group's folders.
 */
function runGroup(paths: readonly string[]): Promise<void> {
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
	return new Promise((done) => {
		const child = spawn('bun', args, {
			cwd: ROOT,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: {
				...process.env,
				NULL3D_TEST_MEMORY_MIB: `${CEILING_MIB}`,
				[LOAD_FACTOR_ENV]: `${factor}`,
			},
		});
		// A lane holds its group's output until the group ends, so that two groups running at once
		// cannot weave their lines together, and each block stands beside the line that names it.
		let written = '';
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (text: string) => {
			written += text;
		});
		child.stderr.on('data', (text: string) => {
			written += text;
		});
		child.on('close', (code) => {
			const seconds = Math.round((Date.now() - started) / 1000);
			const outcome = code === 0 ? 'passed' : `failed with ${code}`;
			process.stdout.write(written);
			console.log(
				`unit: ${paths.join(' ')} ${outcome} in ${seconds}s, under ${CEILING_MIB} MiB${budgetNote(timeout)}`,
			);
			if (code !== 0) failed += 1;
			done();
		});
	});
}

/** Takes the next group and runs it, until no group is left. */
async function lane(): Promise<void> {
	for (let paths = UNIT_GROUPS[next]; paths; paths = UNIT_GROUPS[next]) {
		next += 1;
		await runGroup(paths);
	}
}

await Promise.all(Array.from({ length: LANES }, lane));
process.exit(failed === 0 ? 0 : 1);
