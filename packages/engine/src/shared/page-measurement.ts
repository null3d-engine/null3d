// The browser's measurement of the page's memory, `performance.measureUserAgentSpecificMemory`, as
// every part of the engine asks for it. Chrome answers once each worker of the page has run the
// measurement as a task. A thread that blocks, as an engine's idle job workers do, never runs it,
// and while Chrome waits for such a thread the whole page can stop answering, for minutes. So each
// engine on the page adds a release: a call that makes its job workers run their threads' tasks
// until the measurement ends. Every measurement goes through `measureWithEveryThread`, which holds
// every release while it runs. This module stays apart from the stats overlay's, so the engine's
// start loads only this much.

/** Starts letting a set of threads run their tasks, and returns the call that ends it. */
export type ThreadRelease = () => () => void;

const releases = new Set<ThreadRelease>();

/** Adds a release that every measurement holds while it runs, and returns the call that removes it. */
export function addMeasurementRelease(release: ThreadRelease): () => void {
	releases.add(release);
	return () => {
		releases.delete(release);
	};
}

/**
 * Runs `measure`, a call of the browser's measurement, while every release holds, and ends them
 * when it settles. A measurement that throws at once ends them at once and rejects.
 */
export function measureWithEveryThread<T>(measure: () => Promise<T>): Promise<T> {
	const ends = [...releases].map((release) => release());
	const end = () => {
		for (const done of ends) done();
	};
	let pending: Promise<T>;
	try {
		pending = measure();
	} catch (error) {
		end();
		return Promise.reject(error);
	}
	pending.then(end, end);
	return pending;
}
