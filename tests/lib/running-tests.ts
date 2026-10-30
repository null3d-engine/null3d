// The tests that each Playwright worker runs now, kept where the other workers can read them. A page
// that fails on a contended machine says nothing about what else the machine did, and a worker
// cannot see another worker's test: the workers are separate processes, so they share their state
// through a file. The reporter (neighbour-reporter.ts) writes each test as it starts and clears it
// as it ends, and a failure reads the records that the other workers left.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Where the workers keep their records, under the ignored build folder. */
const DEFAULT_DIR = join(import.meta.dirname, '../../target/running-tests');

/** The folder of the records, which a test run may move to keep its own apart. */
const directory = () => process.env.NULL3D_RUNNING_TESTS_DIR ?? DEFAULT_DIR;

/** The index of this Playwright worker, or undefined outside a test run. */
export function workerIndex(): number | undefined {
	const index = Number(process.env.TEST_WORKER_INDEX);
	return Number.isInteger(index) && index >= 0 ? index : undefined;
}

const recordPath = (worker: number) => join(directory(), `worker-${worker}.json`);

/** Records that `worker` started the test `name` now. */
export function noteTestRunning(worker: number | undefined, name: string): void {
	if (worker === undefined || worker < 0) return;
	mkdirSync(directory(), { recursive: true });
	writeFileSync(recordPath(worker), JSON.stringify({ name, startedAt: Date.now() }));
}

/** Clears `worker`'s record, which it keeps only while its test runs. */
export function clearTestRunning(worker: number | undefined): void {
	if (worker === undefined || worker < 0) return;
	rmSync(recordPath(worker), { force: true });
}

/** Clears every record at the start of a run: one that a crashed worker left would lie. */
export function clearRunningTests(): void {
	rmSync(directory(), { recursive: true, force: true });
}

/** The tests that the other workers were running at `now`, with how long each had run. */
function neighbours(own: number, now: number): { name: string; runMs: number }[] {
	let files: string[];
	try {
		files = readdirSync(directory());
	} catch {
		return [];
	}
	const running: { name: string; runMs: number }[] = [];
	for (const file of files) {
		const index = /^worker-(\d+)\.json$/.exec(file)?.[1];
		if (index === undefined || Number(index) === own) continue;
		try {
			const { name, startedAt } = JSON.parse(readFileSync(join(directory(), file), 'utf8')) as {
				name?: unknown;
				startedAt?: unknown;
			};
			if (typeof name === 'string' && typeof startedAt === 'number')
				running.push({ name, runMs: Math.max(0, now - startedAt) });
		} catch {
			// A record that a worker is still writing reads as an empty one, which names nothing.
		}
	}
	return running;
}

/** How many of the other workers' tests a failure names. */
const NAMED_NEIGHBOURS = 3;

/**
 * What a failure adds to name the tests that other workers ran beside it, or nothing when it ran
 * alone. Empty outside a Playwright worker, where no record is kept.
 */
export function neighbourNote(own = workerIndex(), now = Date.now()): string {
	if (own === undefined) return '';
	const running = neighbours(own, now)
		.sort((a, b) => b.runMs - a.runMs)
		.slice(0, NAMED_NEIGHBOURS);
	if (running.length === 0) return '';
	const names = running.map(
		({ name, runMs }) => `"${name}" (started ${(runMs / 1000).toFixed(1)} s ago)`,
	);
	const who = running.length === 1 ? 'another worker was running' : 'other workers were running';
	return `; ${who} ${names.join(', ')}`;
}
