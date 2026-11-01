// How many tasks wait for an answer on this thread, so hold mode can let them finish before it
// draws its held frame. The loader keeps the count and this module holds it, because the loader's
// own code loads on the first task and the frame code must read the count without it.

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
