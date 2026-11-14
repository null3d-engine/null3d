// The helper workers that a thread's loaders start on first use, such as the glTF worker and the
// KTX2 transcoder. Each stays for later loads, so the sketch runner stops them when the engine on
// this thread stops: a page keeps its thread for the next engine, and a worker that keeps a canvas
// stays too. The list is the thread's, so the engine's stop also stops the helpers that the
// sketch's own copy of the engine started.

/** The key of the thread's list on its global object. */
const STOPS = Symbol.for('null3d.helperWorkerStops');
const thread = globalThis as { [STOPS]?: Set<() => void> };
/** The thread's list. The first copy of this module in the thread makes it. */
const stops = thread[STOPS] ?? new Set<() => void>();
thread[STOPS] = stops;

/** Registers how to stop a helper worker; returns a function that forgets it again. */
export function onEngineStop(stop: () => void): () => void {
	stops.add(stop);
	return () => stops.delete(stop);
}

/** Stops every helper worker of this thread, and fails the loads that wait for one. */
export function stopHelperWorkers(): void {
	const each = [...stops];
	stops.clear();
	for (const stop of each) stop();
}
