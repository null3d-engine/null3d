// A recording run of a page: the permutation words that the thread that draws asked for, gathered
// from its start until the page says it has shown every state that it offers, then published on the
// page where the tool that writes a narrowed build's list reads them. A thread that never answers
// publishes nothing, so the tool refuses to write a partial list rather than let a page fail at run
// time.

/** The thread that draws in this mode: a worker, the sketch worker, or the page itself. */
export type DrawingThread = 'render' | 'sketch' | 'page';

/** Where a recording publishes its words, and the stop that a live page offers its tool. */
declare global {
	interface Window {
		/** The recorded permutation words, once the drawing thread has answered. */
		__null3dPermutations?: number[];
		/** Ends a live page's recording, so its tool reads the words once it has driven the page. */
		__null3dStopRecording?: () => void;
	}
}

/** Gathers the words of the thread that draws, and publishes them once it answers. */
export class PermutationRecording {
	private readonly words = new Set<number>();

	constructor(private readonly drawing: DrawingThread) {}

	/**
	 * Takes the drawing thread's words, which publishes them. Another thread that does not draw asks
	 * no pipelines for a variant, so its words wait for the drawing thread.
	 */
	answered(role: 'sketch' | 'render' | 'page', words: readonly number[]): void {
		for (const word of words) this.add(word);
		if (role === this.drawing) this.publish();
	}

	/** Takes a word as the drawing thread finds it, and publishes the growing set at once. */
	heard(word: number): void {
		if (this.add(word)) this.publish();
	}

	/** Adds a word, and says whether it was new. */
	private add(word: number): boolean {
		const held = this.words.has(word >>> 0);
		this.words.add(word >>> 0);
		return !held;
	}

	/** Publishes the words gathered so far. A live page's set grows until its tool stops it. */
	private publish(): void {
		window.__null3dPermutations = [...this.words].sort((a, b) => a - b);
	}
}
