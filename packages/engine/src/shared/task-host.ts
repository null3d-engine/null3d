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
	 * Where the page starts the job workers as the work grows: asks for at least `count` of them and
	 * returns how many the page has been asked for, which the loader's tasks may use.
	 */
	ensure?(count: number): number;
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
