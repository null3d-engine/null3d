// The engine core on a test page's own thread, as the sketch worker runs it, with job workers of
// the page's own and no drawing: for pages that test the core's animation step. It loads the
// threaded build, starts an engine for WebGL2 with a small scene, and starts the job workers in
// the core's memory.
import { type CoreGlue, loadCore, startCore, stopJobWorkersAt } from '@null3d/engine/internal';

/** How long the job workers may take to start, or to leave their loops at the end. */
const WORKER_TIMEOUT_MS = 20_000;

/** Fails with the core's last error when a call returned `status`, which is 0 for success. */
export function check(glue: CoreGlue, call: string, status: number): void {
	if (status !== 0)
		throw new Error(
			`${call} failed: code ${glue.lastErrorCode()} (${glue.lastErrorDetail(0)}, ${glue.lastErrorDetail(1)})`,
		);
}

/** An id that a create call returned: the table's id plus one, or 0 on failure. */
export function created(glue: CoreGlue, call: string, id: number): number {
	if (id === 0) check(glue, call, glue.lastErrorCode() || 1);
	return id;
}

/** Writes `words` into fresh staging words of the core. */
export function stage(core: CoreGlue, memory: WebAssembly.Memory, words: Float32Array): void {
	const address = created(core, 'animationStaging', core.animationStaging(words.length));
	new Float32Array(memory.buffer, address, words.length).set(words);
}

/** Starts the job workers in the core's memory and waits until each runs. */
async function startWorkers(module: WebAssembly.Module, memory: WebAssembly.Memory, count: number) {
	const workers = Array.from(
		{ length: count },
		(_, index) =>
			new Worker(new URL('./animation-worker.ts', import.meta.url), {
				type: 'module',
				name: `animation-job-${index}`,
			}),
	);
	const replies = (type: string) =>
		Promise.all(
			workers.map(
				(worker) =>
					new Promise<void>((resolve, reject) => {
						const timer = setTimeout(
							() => reject(new Error(`a job worker sent no ${type} reply`)),
							WORKER_TIMEOUT_MS,
						);
						worker.addEventListener('message', ({ data }) => {
							if (data.type === 'error') reject(new Error(`a job worker failed: ${data.message}`));
							if (data.type !== type) return;
							clearTimeout(timer);
							resolve();
						});
					}),
			),
		);
	const ready = replies('ready');
	const stopped = replies('stopped');
	// The page waits for the stop replies only at the end.
	stopped.catch(() => {});
	workers.forEach((worker, index) => {
		worker.postMessage({ module, memory, index });
	});
	await ready;
	return { workers, stopped };
}

/** The core on the page's thread with its job workers, and the call that stops them. */
export interface CorePage {
	core: CoreGlue;
	memory: WebAssembly.Memory;
	/** Stops the job workers, waits for them to leave their loops, and ends them. */
	stop(): Promise<void>;
}

/** Loads the threaded core, starts an engine for WebGL2 with a small scene, and `jobWorkers` job workers. */
export async function startCorePage(
	jobWorkers: number,
	progress: (text: string) => void,
): Promise<CorePage> {
	const { module, memory } = await loadCore('threaded');
	if (!memory)
		throw new Error('the page is not cross-origin isolated, so it has no threaded build');
	const { glue: core } = await startCore('threaded', module, memory);
	check(
		core,
		'initEngine',
		core.initEngine(
			jobWorkers,
			64,
			1,
			64,
			0,
			true,
			0,
			2048,
			0,
			0,
			false,
			true,
			false,
			false,
			false,
			16,
		),
	);
	const { workers, stopped } = await startWorkers(module, memory, jobWorkers);
	progress(`${jobWorkers} job workers ready`);
	return {
		core,
		memory,
		async stop() {
			stopJobWorkersAt(memory, core.jobsWakeAddress(), core.jobsStopAddress());
			await stopped.catch(() => progress('a job worker did not stop'));
			for (const worker of workers) worker.terminate();
		},
	};
}
