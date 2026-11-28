import { afterEach, describe, expect, it } from 'bun:test';
import { PermutationRecording } from './permutation-recording';

/** The page's global, where a recording publishes its words. */
const view = globalThis as unknown as {
	window?: { __null3dPermutations?: number[] };
};

/** A stand-in for the page's window, which the recording publishes into. */
function pageWindow(): { __null3dPermutations?: number[] } {
	const window = {};
	view.window = window;
	return window;
}

afterEach(() => {
	delete view.window;
});

describe('PermutationRecording', () => {
	it('publishes each word as the drawing thread finds it', () => {
		const window = pageWindow();
		const recording = new PermutationRecording('render');
		recording.heard(0x20);
		expect(window.__null3dPermutations).toEqual([0x20]);
		recording.heard(0x10);
		expect(window.__null3dPermutations).toEqual([0x10, 0x20]);
		// The same word twice changes nothing.
		recording.heard(0x20);
		expect(window.__null3dPermutations).toEqual([0x10, 0x20]);
	});

	it("publishes the words that a stop gathers, including another thread's", () => {
		const window = pageWindow();
		const recording = new PermutationRecording('render');
		recording.answered('sketch', [0x30]);
		expect(window.__null3dPermutations).toBeUndefined();
		recording.answered('render', [0x20, 0x30]);
		expect(window.__null3dPermutations).toEqual([0x20, 0x30]);
	});
});
