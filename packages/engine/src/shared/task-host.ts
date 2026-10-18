// What the thread that runs the sketch needs to send tasks to the job workers: a port to each, and
// the core's call that asks a job worker to leave the job loop for its tasks. The thread's start
// sets it, its stop clears it, and the on-demand loader (shared/tasks.ts), which loads on first
// use, reads it. It
// lives on the thread's global object, because Safari can run a worker's first file twice and so
// hold two copies of this module.

/** The job workers' side of the tasks, as the thread that runs the sketch reaches them. */
export interface JobTaskHost {
	/** One port to each job worker, by its index. */
	ports: readonly MessagePort[];
	/**
	 * The indices of the job workers that run, once the page has said which of them started. The page
	 * leaves out a worker whose script or its core did not load, and the loader then sends it no
	 * task: such a worker never answers, and a task that waits for it stops the page that asked.
	 * Undefined until the page's first word, when every worker the thread asked for counts as
	 * running. `tasks.ts` decides which of them take tasks.
	 */
	running?: readonly number[];
	/** Asks job worker `index` to leave the job loop for one more task, once no frame work waits. */
	call(index: number): void;
	/**
	 * Asks for at least `count` job workers, and returns how many have been asked for: the ports
	 * of those workers take tasks. The page starts the job workers only as the work asks for them.
	 */
	want(count: number): number;
}

/**
 * The job workers that take this thread's tasks, out of `running` and the `asked` count of workers
 * the thread has asked the page for. With two or more job workers the first stays in the job loop
 * for the frames, so it takes none. Before the page has said which workers run, every worker the
 * thread asked for counts, as a thread with job workers always had.
 */
export function taskTakers(running: readonly number[] | undefined, asked: number): number[] {
	const workers = running ?? Array.from({ length: asked }, (_, index) => index);
	const below = workers.filter((index) => index < asked);
	return below.length > 1 ? below.slice(1) : below;
}

/**
 * Asks for job workers as the work grows, up to `most` of them: `start` starts them up to a count.
 * Returns the function that asks for a count, which returns how many have been asked for in all.
 * A count at or below that changes nothing, so the workers never shrink.
 */
export function jobAsker(most: number, start: (count: number) => void): (count: number) => number {
	let asked = 0;
	return (count) => {
		const wanted = Math.min(count, most);
		if (wanted > asked) {
			asked = wanted;
			start(wanted);
		}
		return asked;
	};
}

const HOST = Symbol.for('null3d.jobTasks');
/**
 * The global function that the core calls when it queues work between frames, such as a model's
 * animation clips, before any job worker has joined. Only job workers run that work.
 */
const WANT_JOB_WORKERS = '__null3dWantJobWorkers';
const thread = globalThis as { [HOST]?: JobTaskHost; [WANT_JOB_WORKERS]?: () => void };
// The core asks for the first job workers, as the loader's first task does. A thread without a
// running engine asks for none.
thread[WANT_JOB_WORKERS] = () => thread[HOST]?.want(2);

/** Gives this thread the job workers' task ports. */
export function setJobTasks(host: JobTaskHost): void {
	thread[HOST] = host;
}

/**
 * Takes the job workers' task ports from this thread when its engine stops, unless a later engine
 * has given its own, so the thread no longer reaches the stopped engine's core and workers.
 */
export function clearJobTasks(host: JobTaskHost | undefined): void {
	if (host && thread[HOST] === host) delete thread[HOST];
}

/** The job workers' task ports, or undefined in a thread without job workers. */
export function jobTasks(): JobTaskHost | undefined {
	const host = thread[HOST];
	return host && host.ports.length > 0 ? host : undefined;
}
