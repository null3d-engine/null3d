// How many tasks wait for an answer on this thread, so hold mode can let them finish before it
// draws its held frame. The loader keeps the count and this module holds it, because the loader's
// own code loads on the first task and the frame code must read the count without it. The level
// plans of meshes made in code count as tasks too, each with a label that names its mesh, so a
// held frame can wait for them all the way and say which meshes still plan. The count is the
// thread's, so the tasks that the sketch's own copy of the engine runs count too.
//
// Hold mode also holds the plans' levels back until it lets them go, and then lets one plan hand
// over its levels at a time, in the order the plans started. A plan answers whenever its job
// worker finishes, and the meshes of its levels take their places in engine memory as it hands
// them over, so plans that handed over as they answered would leave the scene's meshes in another
// order on each run.

interface Pending {
	/** How many tasks wait for an answer. */
	tasks: number;
	/** The level plans that wait, each by a label that names its mesh. */
	plans: Map<number, string>;
	/** The number of the last level plan. */
	lastPlan: number;
	/**
	 * While hold mode holds the plans back, whether it has let them go yet; undefined while plans
	 * hand over their levels as they answer.
	 */
	released?: boolean;
	/** The plans that wait for their turn to hand over their levels, by number. */
	turns: Map<number, () => void>;
}

/** The key of the thread's count on its global object. */
const PENDING = Symbol.for('null3d.pendingTasks');
const thread = globalThis as { [PENDING]?: Pending };
/** The thread's count. The first copy of this module in the thread makes it. */
const pending: Pending = thread[PENDING] ?? {
	tasks: 0,
	plans: new Map(),
	lastPlan: 0,
	turns: new Map(),
};
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
	pending.turns.delete(plan);
	nextTurn();
}

/**
 * Resolves when the level plan with number `plan` may hand over its levels: at once, unless hold
 * mode holds the plans back. Then it resolves once hold mode has let the plans go and every plan
 * that started before this one has ended.
 */
export function planTurn(plan: number): Promise<void> {
	if (pending.released === undefined) return Promise.resolve();
	return new Promise((resolve) => {
		pending.turns.set(plan, resolve);
		nextTurn();
	});
}

/** Holds every plan's levels back from now on, until `releasePlans`, as hold mode asks. */
export function holdPlans(): void {
	pending.released = false;
}

/** Lets the plans that hold mode held back hand over their levels, one at a time in their order. */
export function releasePlans(): void {
	if (pending.released === false) pending.released = true;
	nextTurn();
}

/** Ends hold mode's hold on the plans: each plan hands over its levels as it answers again. */
export function endPlanHold(): void {
	pending.released = undefined;
	const waiting = [...pending.turns.values()];
	pending.turns.clear();
	for (const turn of waiting) turn();
}

/** Gives the turn to the oldest plan that is still pending, once it waits for it. */
function nextTurn(): void {
	if (pending.released !== true) return;
	let oldest: number | undefined;
	for (const plan of pending.plans.keys()) if (oldest === undefined || plan < oldest) oldest = plan;
	if (oldest === undefined) return;
	const turn = pending.turns.get(oldest);
	if (!turn) return;
	pending.turns.delete(oldest);
	turn();
}

/** The labels of the level plans that wait. */
export function plansPending(): string[] {
	return [...pending.plans.values()];
}
