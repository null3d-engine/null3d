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
	/** Asks job worker `index` to leave the job loop for one more task, once no frame work waits. */
	call(index: number): void;
	/**
	 * Asks for at least `count` job workers, and returns how many have been asked for: the ports
	 * of those workers take tasks. The page starts the job workers only as the work asks for them.
	 */
	want(count: number): number;
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
const thread = globalThis as { [HOST]?: JobTaskHost };

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
