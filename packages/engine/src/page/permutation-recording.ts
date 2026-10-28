// A recording run of a page: the permutation words that the thread that draws asked for, gathered
// from its start until the held frame is drawn, then published on the page where the tool that
// writes a narrowed build's list reads them. A thread that never answers publishes nothing, so the
// tool refuses to write a partial list rather than let a page fail at run time.

/** The thread that draws in this mode: a worker, the sketch worker, or the page itself. */
export type DrawingThread = 'render' | 'sketch' | 'page';

/** How long a live page may take to ask for its words after it starts, in ms, before they are read. */
const LIVE_RECORD_MS = 5000;

/** Where a recording publishes its words. */
declare global {
	interface Window {
		/** The recorded permutation words, once the drawing thread has answered. */
		__null3dPermutations?: number[];
	}
}

/** Gathers the words of the thread that draws, and publishes them once it answers. */
export class PermutationRecording {
	private readonly words = new Set<number>();
	/** True once the words are published, so a later answer changes nothing. */
	private published = false;

	constructor(private readonly drawing: DrawingThread) {}

	/**
	 * Takes the drawing thread's words, which publishes them. Another thread that does not draw asks
	 * no pipelines for a variant, so its words wait for the drawing thread.
	 */
	answered(role: 'sketch' | 'render' | 'page', words: readonly number[]): void {
		for (const word of words) this.words.add(word >>> 0);
		if (role === this.drawing) this.publish();
	}

	/**
	 * Ends a live page's recording after its first frames, since a live page has no held frame to
	 * say when the scene's pipelines exist. The page's own drawing answers at once, and a worker
	 * answers the request that `stop` sends it.
	 */
	live(stop: () => void): void {
		setTimeout(stop, LIVE_RECORD_MS);
	}

	/** Publishes the words gathered so far, once. */
	private publish(): void {
		if (this.published) return;
		this.published = true;
		window.__null3dPermutations = [...this.words].sort((a, b) => a - b);
	}
}
