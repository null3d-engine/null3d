// A minimal add-on for the add-on tasks test. It sorts numbers in shared memory on the engine's job
// workers, and reaches the engine through the public task hook alone, as a published add-on must.
// A real add-on shapes its code like a package: an index module, a task module and a README.

import { runTask, type Task } from '@null3d/engine';

/** The sort task, whose module the engine imports once in each worker that runs it. */
export const SORT_TASK: Task = {
	name: 'task-probe-sort',
	script: new URL('./sort-task.ts', import.meta.url),
};

/** What one round of the sort answers. */
export interface SortAnswer {
	/** The round that the sketch gave. */
	round: number;
	/** The browser's name of the worker that ran the task. */
	worker: string;
	/** The round's values, smallest first. */
	order: number[];
}

/**
 * Sorts the values in a shared buffer on a job worker, smallest first. The buffer holds the count
 * at 0, the values after it, and room for as many again, where the task writes the sorted values.
 */
export function sortRound(view: Int32Array, round: number): Promise<SortAnswer> {
	return runTask<SortAnswer>(SORT_TASK, { view, round }, []);
}
