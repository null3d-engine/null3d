// A recording run of a page: the permutation words that each thread's pipelines asked for, gathered
// until every thread that draws has answered, then published on the page where the tool that writes
// a narrowed build's list reads them. A thread that never answers publishes nothing, so the tool
// refuses to write a partial list rather than let a page fail at run time.

/** The thread that draws in this mode: a worker, the sketch worker, or the page itself. */
export type DrawingThread = 'render' | 'sketch' | 'page';

/** How long the page's own drawing may take to ask for its words, in ms, before they are read. */
const PAGE_RECORD_MS = 2000;

/** Where a recording publishes its words. */
declare global {
	interface Window {
		/** The recorded permutation words, once every drawing thread has answered. */
		__null3dPermutations?: number[];
	}
}

/** Gathers the words of the threads that draw, and publishes them once all of them answered. */
export class PermutationRecording {
	private readonly words = new Set<number>();
	/** True once the words are published, so a later answer changes nothing. */
	private published = false;

	constructor(private readonly drawing: DrawingThread) {}

	/**
	 * Takes one thread's words. The words publish once the drawing thread answers, since a thread
	 * that does not draw asks no pipelines for a variant.
	 */
	answered(role: 'sketch' | 'render' | 'job', words: readonly number[]): void {
		for (const word of words) this.words.add(word >>> 0);
		if (role === this.drawing) this.publish();
	}

	/**
	 * Reads the page's own words after its first frames, when the page draws, and publishes them.
	 * The read is a timer rather than a frame callback so that a page that draws nothing still
	 * publishes what it has asked for.
	 */
	expectPage(read: () => number[]): void {
		setTimeout(() => {
			for (const word of read()) this.words.add(word >>> 0);
			this.publish();
		}, PAGE_RECORD_MS);
	}

	/** Publishes the words gathered so far, once. */
	private publish(): void {
		if (this.published) return;
		this.published = true;
		window.__null3dPermutations = [...this.words].sort((a, b) => a - b);
	}
}
