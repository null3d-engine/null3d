// How many tasks wait for an answer on this thread, so hold mode can let them finish before it
// draws its held frame. The loader keeps the count and this module holds it, because the loader's
// own code loads on the first task and the frame code must read the count without it. The level
// plans of meshes made in code count as tasks too, each with a label that names its mesh, so a
// held frame can wait for them all the way and say which meshes still plan.

/** How many tasks wait for an answer. */
let pending = 0;

/** Counts a task that waits for its answer. */
export function taskStarted(): void {
	pending++;
}

/** Stops counting a task that has answered, or that the engine ended. */
export function taskEnded(): void {
	if (pending > 0) pending--;
}

/** How many tasks wait for an answer. */
export function tasksPending(): number {
	return pending;
}

/** The level plans that wait, each by a label that names its mesh. */
const plans = new Map<number, string>();
let lastPlan = 0;

/** Counts a mesh's level plan, named by `label`, as a task, and returns the plan's number. */
export function planStarted(label: string): number {
	lastPlan++;
	plans.set(lastPlan, label);
	pending++;
	return lastPlan;
}

/** Stops counting the level plan with number `plan`, once its levels are in or it ended. */
export function planEnded(plan: number): void {
	if (plans.delete(plan)) taskEnded();
}

/** The labels of the level plans that wait. */
export function plansPending(): string[] {
	return [...plans.values()];
}
