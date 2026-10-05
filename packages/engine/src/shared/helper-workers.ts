// The helper workers that a thread's loaders start on first use, such as the glTF worker and the
// KTX2 transcoder. Each stays for later loads, so the sketch runner stops them when the engine on
// this thread stops: a page keeps its thread for the next engine, and a worker that keeps a canvas
// stays too.

const stops = new Set<() => void>();

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
