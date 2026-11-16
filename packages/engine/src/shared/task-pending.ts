// How many tasks wait for an answer on this thread, so hold mode can let them finish before it
// draws its held frame. The loader keeps the count and this module holds it, because the loader's
// own code loads on the first task and the frame code must read the count without it. The level
// plans of meshes made in code count as tasks too, each with a label that names its mesh, so a
// held frame can wait for them all the way and say which meshes still plan. The count is the
// thread's, so the tasks that the sketch's own copy of the engine runs count too.

interface Pending {
	/** How many tasks wait for an answer. */
	tasks: number;
	/** The level plans that wait, each by a label that names its mesh. */
	plans: Map<number, string>;
	/** The number of the last level plan. */
	lastPlan: number;
}

/** The key of the thread's count on its global object. */
const PENDING = Symbol.for('null3d.pendingTasks');
const thread = globalThis as { [PENDING]?: Pending };
/** The thread's count. The first copy of this module in the thread makes it. */
const pending: Pending = thread[PENDING] ?? { tasks: 0, plans: new Map(), lastPlan: 0 };
thread[PENDING] = pending;

/** Counts a task that waits for its answer. */
export function taskStarted(): void {
	pending.tasks++;
}

/** Stops counting a task that has answered, or that the engine ended. */
export function taskEnded(): void {
	if (pending.tasks > 0) pending.tasks--;
}

/** How many tasks wait for an answer. */
export function tasksPending(): number {
	return pending.tasks;
}

/** Counts a mesh's level plan, named by `label`, as a task, and returns the plan's number. */
export function planStarted(label: string): number {
	const plan = ++pending.lastPlan;
	pending.plans.set(plan, label);
	pending.tasks++;
	return plan;
}

/** Stops counting the level plan with number `plan`, once its levels are in or it ended. */
export function planEnded(plan: number): void {
	if (pending.plans.delete(plan)) taskEnded();
}

/** The labels of the level plans that wait. */
export function plansPending(): string[] {
	return [...pending.plans.values()];
}
