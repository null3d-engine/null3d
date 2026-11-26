import { afterEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from '../../../tools/lib/fixture';
import { parseShaderList } from '../../vite-plugin/src/shader-list.ts';
import { parseWordList, readWordList, recordedWords, writeWordList } from './shader-words.js';

/** The globals that a recording page holds, which the fake page below keeps on this process's own. */
type Recorded = { __null3dPermutations?: number[]; __null3dStopRecording?: () => void };
const recorded = globalThis as unknown as Recorded;

afterEach(() => {
	delete recorded.__null3dPermutations;
	delete recorded.__null3dStopRecording;
});

/**
 * A page whose engine publishes `published` once its recording stops, or at once for a held page,
 * driven as Playwright drives it: each function runs where the page's globals are.
 */
function recordingPage(published: number[], live = true) {
	if (live) recorded.__null3dStopRecording = () => (recorded.__null3dPermutations = published);
	else recorded.__null3dPermutations = published;
	return {
		evaluate: async (fn: () => unknown) => fn(),
		waitForFunction: async (fn: () => unknown) => {
			if (!fn()) throw new Error('the page published nothing');
		},
	};
}

describe('the list file', () => {
	it('adds recorded words to the words that the list holds, once each, in order', () => {
		const file = join(fixture({ 'list.txt': '# words\n0x00000010\n0x00000000\n' }), 'list.txt');
		expect(writeWordList(file, [0x20, 0x10])).toEqual({ words: [0, 0x10, 0x20], added: 1 });
		expect(readWordList(file)).toEqual([0, 0x10, 0x20]);
		expect(parseShaderList(readFileSync(file, 'utf8'), 'list.txt')).toEqual([0, 0x10, 0x20]);
	});

	it('writes the recorded words alone with replace, and starts a list that does not exist', () => {
		const root = fixture({ 'list.txt': '0x00000010\n' });
		expect(writeWordList(join(root, 'list.txt'), [0], { replace: true }).words).toEqual([0]);
		expect(writeWordList(join(root, 'new.txt'), [4, 0]).words).toEqual([0, 4]);
	});

	it('reads the words as the plugin does, and names the line of one that it cannot read', () => {
		expect(parseWordList('0x10\n# a comment\n20\n', 'list.txt')).toEqual([16, 20]);
		expect(() => parseWordList('0x10\nsoon\n', 'list.txt')).toThrow(/list\.txt line 2: "soon"/);
	});
});

describe('the words of a page', () => {
	it('stops a live page and reads what it published', async () => {
		expect(await recordedWords(recordingPage([0, 0x10]))).toEqual([0, 0x10]);
	});

	it('reads a held page, which published once its frame drew', async () => {
		expect(await recordedWords(recordingPage([4], false))).toEqual([4]);
	});
});
